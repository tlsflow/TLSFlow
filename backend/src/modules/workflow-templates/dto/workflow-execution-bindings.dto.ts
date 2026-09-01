export type WorkflowExecutionBindingStatus = 'ACTIVE' | 'DISABLED';
export type WorkflowExecutionRunner = 'CONTROL_PLANE' | 'GATEWAY';
/** `FIXED` 只用于兼容旧客户端输入，持久化配置统一规范化为 CURRENT。 */
export type WorkflowExecutionVersionSelection = 'CURRENT' | 'FIXED';

export interface WorkflowExecutionBinding {
  id: string;
  tenantId: string;
  pluginId: string;
  /** 历史读取兼容字段；应用配置不再写入或依赖该字段。 */
  pluginVersionId?: string;
  capabilityKey: string;
  workflowKey: string;
  workflowTemplateId: string;
  workflowVersionSelection: WorkflowExecutionVersionSelection;
  /** 历史读取兼容字段；新计划创建时解析当前发布版本。 */
  workflowVersionId?: string;
  runner: WorkflowExecutionRunner;
  gatewayId?: string;
  inputBindings: InputBindingsV1;
  status: WorkflowExecutionBindingStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * `pluginVersionId`、`workflowVersionId` 和 `FIXED` 是旧客户端兼容输入。
 * 服务层会在写库前把它们转换为稳定身份与 CURRENT。
 */
export type CreateWorkflowExecutionBindingInput = Omit<WorkflowExecutionBinding, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt' | 'pluginId' | 'workflowVersionSelection'> & {
  pluginId?: string;
  workflowVersionSelection?: WorkflowExecutionVersionSelection;
};
export type UpdateWorkflowExecutionBindingInput = Partial<Omit<CreateWorkflowExecutionBindingInput, 'tenantId'>> & { expectedVersion: number; status?: WorkflowExecutionBindingStatus };
import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';
