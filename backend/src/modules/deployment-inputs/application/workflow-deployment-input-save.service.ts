import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { ResolvedManagedTargetTopology } from '../../assets/application/managed-target-context.resolver.js';
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';
import type { CreateWorkflowExecutionBindingInput, WorkflowExecutionBinding } from '../../workflow-templates/dto/workflow-execution-bindings.dto.js';
import type { WorkflowTemplate, WorkflowTemplateVersion } from '../../workflow-templates/dto/workflow-templates.dto.js';
import { WorkflowTemplatesDomainService } from '../../workflow-templates/domain/workflow-templates.domain-service.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import { emptyInputBindingsV1 } from '../dto/input-bindings.dto.js';
import { deploymentAssetContextBuilder } from './deployment-asset-context.builder.js';
import { DeploymentInputBindingSaveService } from './deployment-input-binding-save.service.js';
import { DeploymentInputContractLoader } from './deployment-input-contract-loader.js';

export class WorkflowDeploymentInputSaveService {
  private readonly workflows: WorkflowTemplatesDomainService;
  private readonly contracts = new DeploymentInputContractLoader();
  private readonly saves = new DeploymentInputBindingSaveService();
  private readonly executionBindings: WorkflowExecutionBindingsRepository;

  constructor(db: DatabasePort) {
    this.workflows = new WorkflowTemplatesDomainService(
      new PgDocumentRepository<WorkflowTemplate>(db, 'workflow.templates'),
      new PgDocumentRepository<WorkflowTemplateVersion>(db, 'workflow.template_versions'),
    );
    this.executionBindings = new WorkflowExecutionBindingsRepository(db);
  }

  async validate(input: {
    applicationAsset: ServiceAssetDto;
    managedTargetContext?: ResolvedManagedTargetTopology;
    workflowExecution: CreateWorkflowExecutionBindingInput;
    currentBinding?: WorkflowExecutionBinding;
  }) {
    const identity = await this.resolveCurrentVersion(input.workflowExecution);
    const version = identity.version;
    const currentIdentity = input.currentBinding ? await this.resolveCurrentVersion(input.currentBinding) : undefined;
    const currentVersion = currentIdentity?.version;
    const currentAssetOverride = input.currentBinding && currentVersion?.id === version.id
      ? { pluginVersionId: currentIdentity!.pluginVersionId, inputBindings: input.currentBinding.inputBindings }
      : undefined;
    return this.saves.validate({
      pluginVersionId: identity.pluginVersionId,
      contract: this.contracts.fromWorkflowVersion(version),
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset: input.applicationAsset, managedTargetContext: input.managedTargetContext }),
      currentAssetOverride,
      submitted: input.workflowExecution.inputBindings ?? emptyInputBindingsV1(),
    });
  }

  private async resolveCurrentVersion(input: Pick<CreateWorkflowExecutionBindingInput, 'tenantId' | 'pluginId' | 'pluginVersionId' | 'capabilityKey' | 'workflowKey' | 'workflowTemplateId'>): Promise<{ version: WorkflowTemplateVersion; pluginVersionId: string }> {
    const pluginId = input.pluginId?.trim() || await this.executionBindings.resolvePluginId(input.tenantId, input.pluginVersionId);
    if (!pluginId) throw new AppError('VALIDATION_FAILED', '工作流输入绑定缺少插件身份', { code: 'WORKFLOW_EXECUTION_BINDING_PLUGIN_ID_REQUIRED' });
    const chain = await this.executionBindings.findCurrentWorkflowChain({
      tenantId: input.tenantId,
      pluginId,
      capabilityKey: input.capabilityKey,
      workflowKey: input.workflowKey,
      workflowTemplateId: input.workflowTemplateId,
    });
    if (!chain) throw new AppError('VALIDATION_FAILED', '工作流输入绑定缺少当前发布链', {
      code: 'WORKFLOW_EXECUTION_BINDING_CURRENT_CHAIN_MISSING', pluginId, workflowKey: input.workflowKey,
    });
    return { version: await this.workflows.getVersion(chain.workflowVersionId), pluginVersionId: chain.pluginVersionId };
  }
}
