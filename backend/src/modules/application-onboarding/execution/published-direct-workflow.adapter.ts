import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import type { PluginWorkflowBindingRecord } from '../../plugins/dto/plugin-workflow-bindings.dto.js';
import type { ApplicationOnboardingSessionDto, OnboardingTargetOptionDto } from '../dto/application-onboarding.dto.js';
import type { LoadedApplicationOnboardingRecipe } from '../recipe/index.js';

/**
 * DIRECT_WORKFLOW 只使用已经发布且固定版本的插件工作流产出的标准发现投影。
 * 它不创建伪造 Device，也不接受 IP、账户或密码作为旁路执行输入。
 */
export class PublishedDirectWorkflowOnboardingAdapter {
  constructor(
    private readonly assets: Pick<AssetsRepository, 'listManagedTargets' | 'getFrameworkInstance' | 'getSiteAsset' | 'getHost'>,
    private readonly workflows: Pick<PluginWorkflowPublisherService, 'require'>,
  ) {}

  async supports(recipe: LoadedApplicationOnboardingRecipe): Promise<boolean> {
    try {
      await this.requireBindings(recipe);
      return true;
    } catch {
      return false;
    }
  }

  async test(tenantId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe): Promise<void> {
    await this.requireBindings(recipe);
    const targets = await this.projectTargets(tenantId, recipe, requireDeviceId(session));
    if (targets.length === 0) {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', '所选设备没有已发现的可用目标站点', {
        code: 'ONBOARDING_DIRECT_WORKFLOW_TARGET_UNAVAILABLE',
        pluginVersionId: recipe.pluginVersionId,
        platformKey: recipe.recipe.platformKey,
      });
    }
  }

  async discover(tenantId: string, session: ApplicationOnboardingSessionDto, recipe: LoadedApplicationOnboardingRecipe): Promise<OnboardingTargetOptionDto[]> {
    await this.requireBindings(recipe);
    return this.projectTargets(tenantId, recipe, requireDeviceId(session));
  }

  /** 返回至少拥有一个可部署平台目标的真实设备，供第二步设备选择使用。 */
  async listCompatibleDeviceIds(tenantId: string, recipe: LoadedApplicationOnboardingRecipe): Promise<Set<string>> {
    const executionCapability = recipe.recipe.capabilities.workflowExecution;
    if (!executionCapability) return new Set();
    const candidates = await this.compatibleTargets(tenantId, recipe);
    return new Set(candidates
      .filter(({ target, endpoint }) => target.status === 'ACTIVE'
        && target.supportedCapabilities.includes(executionCapability)
        && Boolean(endpoint.host && endpoint.port && endpoint.protocol))
      .map(({ target }) => target.deviceId)
      .filter((value): value is string => Boolean(value)));
  }

  async validateDevice(tenantId: string, deviceId: string, recipe: LoadedApplicationOnboardingRecipe): Promise<void> {
    const compatible = await this.listCompatibleDeviceIds(tenantId, recipe);
    if (!compatible.has(deviceId)) {
      throw new AppError('VALIDATION_FAILED', '已有设备没有当前平台可用的已发现目标', {
        code: 'ONBOARDING_DEVICE_INCOMPATIBLE',
        deviceId,
        pluginVersionId: recipe.pluginVersionId,
        platformKey: recipe.recipe.platformKey,
      });
    }
  }

  async requireExecutionWorkflow(recipe: LoadedApplicationOnboardingRecipe): Promise<PluginWorkflowBindingRecord> {
    return this.requireBindings(recipe).then((bindings) => bindings.execution);
  }

  private async requireBindings(recipe: LoadedApplicationOnboardingRecipe): Promise<{
    connection: PluginWorkflowBindingRecord;
    discovery: PluginWorkflowBindingRecord;
    execution: PluginWorkflowBindingRecord;
  }> {
    if (recipe.recipe.deploymentMode !== 'DIRECT_WORKFLOW') {
      throw new AppError('VALIDATION_FAILED', '非 DIRECT_WORKFLOW 配方不能使用直工作流适配器');
    }
    const executionCapability = recipe.recipe.capabilities.workflowExecution;
    if (!executionCapability) {
      throw new AppError('VALIDATION_FAILED', 'DIRECT_WORKFLOW 配方缺少执行能力', {
        code: 'ONBOARDING_WORKFLOW_CAPABILITY_REQUIRED',
      });
    }
    const [connection, discovery, execution] = await Promise.all([
      this.workflows.require(recipe.pluginVersionId, recipe.recipe.capabilities.connectionTest),
      this.workflows.require(recipe.pluginVersionId, recipe.recipe.capabilities.discovery),
      this.workflows.require(recipe.pluginVersionId, executionCapability),
    ]);
    for (const binding of [connection, discovery, execution]) {
      if (binding.pluginVersionId !== recipe.pluginVersionId) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '直工作流绑定没有固定到接入会话的插件版本', {
          expectedPluginVersionId: recipe.pluginVersionId,
          actualPluginVersionId: binding.pluginVersionId,
        });
      }
    }
    return { connection, discovery, execution };
  }

  private async projectTargets(
    tenantId: string,
    recipe: LoadedApplicationOnboardingRecipe,
    deviceId?: string,
  ): Promise<OnboardingTargetOptionDto[]> {
    const executionCapability = recipe.recipe.capabilities.workflowExecution!;
    const candidates = await this.compatibleTargets(tenantId, recipe, deviceId);
    const options = candidates.map(({ target, site, endpoint }) => {
      const selectable = target.status === 'ACTIVE'
        && target.supportedCapabilities.includes(executionCapability)
        && Boolean(endpoint.host && endpoint.port && endpoint.protocol);
      return {
        managedTargetId: target.id,
        targetType: target.targetType,
        displayName: site?.siteName ?? target.targetKey,
        ...(endpoint.host ? { endpoint } : {}),
        configFingerprint: fingerprint({
          pluginVersionId: recipe.pluginVersionId,
          workflowCapability: executionCapability,
          managedTargetId: target.id,
          managedTargetVersion: target.version,
          managedTargetUpdatedAt: target.updatedAt,
          siteId: site?.id,
          siteVersion: site?.version,
          siteUpdatedAt: site?.updatedAt,
        }),
        selectable,
        ...(selectable ? {} : { reasonCode: target.status !== 'ACTIVE'
          ? 'MANAGED_TARGET_INACTIVE'
          : !target.supportedCapabilities.includes(executionCapability)
            ? 'WORKFLOW_CAPABILITY_MISSING'
            : 'TARGET_ENDPOINT_MISSING' }),
      };
    });
    // 向导只展示实际可用的受管目标：停用或不满足选择条件的目标不进入会话，
    // 避免用户看到不可点击的站点选项。
    return options.filter((option) => option.selectable);
  }

  private async compatibleTargets(tenantId: string, recipe: LoadedApplicationOnboardingRecipe, deviceId?: string) {
    const targets = await listAllManagedTargets(this.assets, tenantId);
    const candidates = targets.filter((target) => target.targetType === recipe.recipe.targetProjection.targetType
      && (!deviceId || target.deviceId === deviceId));
    const resolved = await Promise.all(candidates.map(async (target) => {
      const [framework, site, host] = await Promise.all([
        target.frameworkInstanceId ? this.assets.getFrameworkInstance(tenantId, target.frameworkInstanceId) : undefined,
        target.siteId ? this.assets.getSiteAsset(tenantId, target.siteId) : undefined,
          target.deviceId ? this.assets.getHost(tenantId, target.deviceId) : undefined,
      ]);
      const endpoint = {
        host: site?.hostHeader ?? site?.listenIp ?? host?.hostname,
        ...(site?.port ? { port: site.port } : {}),
        ...(site?.protocol ? { protocol: site.protocol } : {}),
      };
      const fromPinnedPlugin = target.discoveryProviderKey === `plugin:${recipe.pluginVersionId}`;
      const fromSelectedPlatform = framework?.frameworkType === recipe.pluginId;
      return fromPinnedPlugin || fromSelectedPlatform ? { target, site, endpoint } : undefined;
    }));
    return resolved.filter((candidate): candidate is Exclude<typeof candidate, undefined> => Boolean(candidate));
  }
}

async function listAllManagedTargets(
  assets: Pick<AssetsRepository, 'listManagedTargets'>,
  tenantId: string,
) {
  const items = [] as Awaited<ReturnType<AssetsRepository['listManagedTargets']>>['items'];
  const pageSize = 200;
  for (let page = 1; ; page += 1) {
    const result = await assets.listManagedTargets(tenantId, { page, pageSize, filter: {} });
    items.push(...result.items);
    if (items.length >= result.total) return items;
  }
}

function fingerprint(value: Record<string, unknown>): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')}`;
}

function requireDeviceId(session: ApplicationOnboardingSessionDto): string {
  if (session.deviceId) return session.deviceId;
  throw new AppError('VALIDATION_FAILED', '直工作流连接测试缺少已选择设备', {
    code: 'ONBOARDING_DEVICE_REQUIRED',
  });
}
