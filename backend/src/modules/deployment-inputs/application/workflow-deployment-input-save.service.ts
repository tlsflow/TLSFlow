import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { ResolvedManagedTargetTopology } from '../../assets/application/managed-target-context.resolver.js';
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';
import type { CreateWorkflowExecutionBindingInput, WorkflowExecutionBinding } from '../../workflow-templates/dto/workflow-execution-bindings.dto.js';
import type { WorkflowTemplate, WorkflowTemplateVersion } from '../../workflow-templates/dto/workflow-templates.dto.js';
import { WorkflowTemplatesDomainService } from '../../workflow-templates/domain/workflow-templates.domain-service.js';
import { deploymentAssetContextBuilder } from './deployment-asset-context.builder.js';
import { DeploymentInputBindingSaveService } from './deployment-input-binding-save.service.js';
import { DeploymentInputContractLoader } from './deployment-input-contract-loader.js';

export class WorkflowDeploymentInputSaveService {
  private readonly workflows: WorkflowTemplatesDomainService;
  private readonly contracts = new DeploymentInputContractLoader();
  private readonly saves = new DeploymentInputBindingSaveService();

  constructor(db: DatabasePort) {
    this.workflows = new WorkflowTemplatesDomainService(
      new PgDocumentRepository<WorkflowTemplate>(db, 'workflow.templates'),
      new PgDocumentRepository<WorkflowTemplateVersion>(db, 'workflow.template_versions'),
    );
  }

  async validate(input: {
    applicationAsset: ServiceAssetDto;
    managedTargetContext?: ResolvedManagedTargetTopology;
    workflowExecution: CreateWorkflowExecutionBindingInput;
    currentBinding?: WorkflowExecutionBinding;
  }) {
    const version = await this.resolveVersion(input.workflowExecution);
    const currentVersion = input.currentBinding ? await this.resolveVersion(input.currentBinding) : undefined;
    const currentAssetOverride = input.currentBinding && currentVersion?.id === version.id
      ? { pluginVersionId: input.currentBinding.pluginVersionId, inputBindings: input.currentBinding.inputBindings }
      : undefined;
    return this.saves.validate({
      pluginVersionId: input.workflowExecution.pluginVersionId,
      contract: this.contracts.fromWorkflowVersion(version),
      assetContext: deploymentAssetContextBuilder.build({ applicationAsset: input.applicationAsset, managedTargetContext: input.managedTargetContext }),
      currentAssetOverride,
      submitted: input.workflowExecution.inputBindings,
    });
  }

  private async resolveVersion(input: CreateWorkflowExecutionBindingInput): Promise<WorkflowTemplateVersion> {
    if (input.workflowVersionSelection !== 'FIXED' || !input.workflowVersionId) {
      throw new AppError('VALIDATION_FAILED', '工作流输入绑定必须引用 FIXED WorkflowVersion', {
        code: 'WORKFLOW_VERSION_REQUIRED',
        workflowTemplateId: input.workflowTemplateId,
      });
    }
    return this.workflows.getVersion(input.workflowVersionId);
  }
}
