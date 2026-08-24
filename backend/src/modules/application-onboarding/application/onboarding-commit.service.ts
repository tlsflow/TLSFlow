import { AppError } from '../../../common/errors/app-error.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { CreateServiceAssetDto } from '../../assets/dto/assets.dto.js';
import type { DeploymentPlansApplicationService } from '../../deployment-plans/application/deployment-plans.application-service.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import type { PluginWorkflowBindingRecord } from '../../plugins/dto/plugin-workflow-bindings.dto.js';
import type { ApplicationOnboardingSessionDto } from '../dto/application-onboarding.dto.js';
import type { LoadedApplicationOnboardingRecipe } from '../recipe/index.js';
import type { OnboardingCommitPort } from './application-onboarding.service.js';

/**
 * 向导完成提交的唯一适配器。它只组合已有 Application Service，不直接写资产或计划表。
 */
export class OnboardingCommitService implements OnboardingCommitPort {
  constructor(
    private readonly assets: AssetsApplicationService,
    private readonly deploymentPlans: DeploymentPlansApplicationService,
    private readonly pluginWorkflows?: Pick<PluginWorkflowPublisherService, 'require'>,
    private readonly directWorkflows?: { requireExecutionWorkflow(recipe: LoadedApplicationOnboardingRecipe): Promise<PluginWorkflowBindingRecord> },
  ) {}

  async commit(tenantId: string, actorId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe): Promise<Record<string, unknown>> {
    const endpoint = readEndpoint(session.inputSnapshot.endpoint);
    const targetId = session.targetId;
    if (recipe.recipe.deploymentMode === 'MANAGED_TARGET' && !targetId) throw new AppError('VALIDATION_FAILED', '受管设备向导缺少目标站点');
    if (!session.certificateVersionId) throw new AppError('VALIDATION_FAILED', '向导缺少证书版本');
    if (recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW' && (!endpoint.host || !endpoint.port || !endpoint.protocol)) {
      throw new AppError('VALIDATION_FAILED', '直接工作流目标缺少已发现的访问端点', {
        code: 'ONBOARDING_DIRECT_WORKFLOW_ENDPOINT_REQUIRED',
        targetId,
      });
    }

    const workflow = recipe.recipe.deploymentMode === 'DIRECT_WORKFLOW'
      ? await this.resolveWorkflow(recipe)
      : undefined;

    const input: CreateServiceAssetDto = {
      address: endpoint.host ?? session.inputSnapshot.address as string ?? 'onboarding.local',
      port: endpoint.port ?? Number(session.inputSnapshot.port ?? 443),
      protocol: (endpoint.protocol ?? session.inputSnapshot.protocol ?? 'HTTPS') as CreateServiceAssetDto['protocol'],
      displayName: String(session.inputSnapshot.displayName ?? recipe.recipe.platformKey),
      discoverySource: 'MANUAL',
      ...(workflow ? {
        deploymentStrategy: {
          type: 'WORKFLOW' as const,
          workflow: {
            pluginVersionId: recipe.pluginVersionId,
            capabilityKey: recipe.recipe.capabilities.workflowExecution,
            workflowId: workflow.workflowTemplateId,
            workflowVersionSelection: 'FIXED' as const,
            workflowVersionId: workflow.workflowVersionId,
            runner: 'CONTROL_PLANE' as const,
            target: {
              port: endpoint.port ?? Number(session.inputSnapshot.port ?? 443),
              protocol: (endpoint.protocol ?? session.inputSnapshot.protocol ?? 'HTTPS') as CreateServiceAssetDto['protocol'],
            },
          },
        },
      } : {}),
      metadata: {
        onboardingSessionId: session.id,
        pluginVersionId: recipe.pluginVersionId,
        platformKey: recipe.recipe.platformKey,
        recipeHash: recipe.recipeHash,
      },
    };
    const asset = await this.assets.createServiceAsset(tenantId, input);
    if (targetId) {
      await this.assets.getRepository().createApplicationAssetTarget(tenantId, {
        applicationAssetId: asset.id,
        managedTargetId: targetId,
        metadata: { configFingerprint: session.targetFingerprint },
      });
      if (!workflow) {
        await this.assets.updateServiceAssetDeploymentStrategy(tenantId, asset.id, {
          type: 'MANAGED_TARGET',
          managedTarget: { managedTargetId: targetId, executionMode: 'PLUGIN' },
        }, actorId);
      }
    }
    const plan = await this.deploymentPlans.createFromApplicationAsset({
      applicationAssetId: asset.id,
      targetCertificateVersionId: session.certificateVersionId,
      idempotencyKey: `onboarding-plan:${session.id}`,
      actorId,
      tenantId,
      reuseDraft: false,
    });
    return { applicationAssetId: asset.id, deploymentPlanId: plan.id, pluginVersionId: recipe.pluginVersionId, recipeHash: recipe.recipeHash };
  }

  private async resolveWorkflow(recipe: LoadedApplicationOnboardingRecipe) {
    if (this.directWorkflows) return this.directWorkflows.requireExecutionWorkflow(recipe);
    const capabilityKey = recipe.recipe.capabilities.workflowExecution;
    if (!capabilityKey) throw new AppError('VALIDATION_FAILED', '直接工作流配方缺少执行能力', { code: 'ONBOARDING_WORKFLOW_CAPABILITY_REQUIRED' });
    if (!this.pluginWorkflows) throw new AppError('SYSTEM_INTERNAL_ERROR', '插件 Workflow 发布服务未接入', { code: 'ONBOARDING_WORKFLOW_PUBLISHER_UNAVAILABLE' });
    return this.pluginWorkflows.require(recipe.pluginVersionId, capabilityKey);
  }
}

function readEndpoint(value: unknown): { host?: string; port?: number; protocol?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    host: typeof record.host === 'string' ? record.host : undefined,
    port: typeof record.port === 'number' ? record.port : undefined,
    protocol: typeof record.protocol === 'string' ? record.protocol : undefined,
  };
}
