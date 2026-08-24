import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgAssetsRepository } from '../repository/assets.repository.js';
import type { CreateWorkflowExecutionBindingInput } from '../../workflow-templates/dto/workflow-execution-bindings.dto.js';
import { WorkflowExecutionBindingsRepository } from '../../workflow-templates/repository/workflow-execution-bindings.repository.js';
import { WorkflowExecutionBindingsService } from '../../workflow-templates/application/workflow-execution-bindings.service.js';
import { WorkflowDeploymentInputSaveService } from '../../deployment-inputs/application/workflow-deployment-input-save.service.js';

export interface SaveStandaloneWorkflowExecutionInput {
  workflowExecution: CreateWorkflowExecutionBindingInput & { bindingId?: string; expectedVersion?: number };
  expectedAssetVersion?: number;
}

export class ApplicationAssetExecutionService {
  constructor(private readonly db: DatabasePort) {}

  async saveStandaloneWorkflowExecution(tenantId: string, applicationAssetId: string, input: SaveStandaloneWorkflowExecutionInput) {
    return this.db.transaction(async (tx) => {
      const assets = new PgAssetsRepository(tx);
      const asset = await assets.getServiceAsset(tenantId, applicationAssetId);
      if (!asset) throw new AppError('RESOURCE_NOT_FOUND', 'ApplicationAsset 不存在', { applicationAssetId });
      const approvalRequired = asset.deploymentStrategy?.approvalRequired === true;
      if (input.expectedAssetVersion !== undefined && asset.version !== input.expectedAssetVersion) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', 'ApplicationAsset 版本冲突', { expectedVersion: input.expectedAssetVersion, actualVersion: asset.version });
      }
      const relation = await assets.getApplicationAssetTargetByApplicationAssetId(tenantId, applicationAssetId);
      if (relation?.status === 'ACTIVE') throw new AppError('EXECUTION_SOURCE_CONFLICT', '非受管工作流资产不得存在 ManagedTarget 关系', { managedTargetId: relation.managedTargetId });
      const assignments = await tx.query<{ id: string }>(`select id from plugin_capability_assignments where tenant_id=$1 and owner_type='APPLICATION_ASSET' and owner_id=$2 and status='ACTIVE'`, [tenantId, applicationAssetId]);
      if (assignments.rows.length) throw new AppError('EXECUTION_SOURCE_CONFLICT', '非受管工作流资产不得存在 ACTIVE CapabilityAssignment', { assignmentIds: assignments.rows.map((item) => item.id) });
      const { bindingId, expectedVersion, ...bindingInput } = input.workflowExecution;
      if (bindingInput.tenantId !== tenantId) throw new AppError('VALIDATION_FAILED', 'WorkflowExecutionBinding tenantId 不匹配');
      const bindings = new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(tx));
      const currentBinding = bindingId ? await bindings.get(tenantId, bindingId) : undefined;
      if (currentBinding && expectedVersion !== undefined && currentBinding.version !== expectedVersion) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '工作流执行绑定版本冲突', { id: currentBinding.id, expectedVersion, actualVersion: currentBinding.version });
      }
      if (currentBinding && isSameWorkflowExecutionBinding(currentBinding, bindingInput)) {
        const updated = await assets.updateServiceAsset(tenantId, applicationAssetId, {
          deploymentStrategy: { type: 'WORKFLOW', approvalRequired, workflow: { workflowExecutionBindingId: currentBinding.id } },
        });
        return { asset: updated, executionMode: 'WORKFLOW' as const, workflowExecutionBinding: currentBinding };
      }
      const validation = await new WorkflowDeploymentInputSaveService(tx).validate({ applicationAsset: asset, workflowExecution: bindingInput, currentBinding });
      if (!validation.saveable) throw new AppError('VALIDATION_FAILED', '应用资产部署输入校验失败', { issues: validation.issues });
      bindingInput.inputBindings = validation.assetOverride;
      const binding = bindingId
        ? await bindings.update(tenantId, bindingId, { ...bindingInput, expectedVersion: expectedVersion ?? 0 })
        : await bindings.create(bindingInput);
      const updated = await assets.updateServiceAsset(tenantId, applicationAssetId, {
        deploymentStrategy: { type: 'WORKFLOW', approvalRequired, workflow: { workflowExecutionBindingId: binding.id } },
      });
      return { asset: updated, executionMode: 'WORKFLOW' as const, workflowExecutionBinding: binding };
    });
  }
}

function isSameWorkflowExecutionBinding(
  current: Awaited<ReturnType<WorkflowExecutionBindingsService['get']>>,
  input: CreateWorkflowExecutionBindingInput,
): boolean {
  return stableSerialize({
    tenantId: current.tenantId,
    pluginVersionId: current.pluginVersionId,
    capabilityKey: current.capabilityKey,
    workflowKey: current.workflowKey,
    workflowTemplateId: current.workflowTemplateId,
    workflowVersionSelection: current.workflowVersionSelection,
    workflowVersionId: current.workflowVersionId,
    runner: current.runner,
    gatewayId: current.gatewayId,
    inputBindings: current.inputBindings,
  }) === stableSerialize(input);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => JSON.stringify(key) + ':' + stableSerialize(child))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}
