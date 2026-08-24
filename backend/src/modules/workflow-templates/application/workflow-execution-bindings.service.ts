import { AppError } from '../../../common/errors/app-error.js';
import type { CreateWorkflowExecutionBindingInput, UpdateWorkflowExecutionBindingInput } from '../dto/workflow-execution-bindings.dto.js';
import { WorkflowExecutionBindingsRepository } from '../repository/workflow-execution-bindings.repository.js';

export class WorkflowExecutionBindingsService {
  constructor(private readonly repository: WorkflowExecutionBindingsRepository) {}
  async create(input: CreateWorkflowExecutionBindingInput) { validate(input); return this.repository.create(input); }
  async get(tenantId:string,id:string) { const binding=await this.repository.find(tenantId,id); if(!binding) throw new AppError('RESOURCE_NOT_FOUND','工作流执行绑定不存在',{id}); return binding; }
  async update(tenantId:string,id:string,input:UpdateWorkflowExecutionBindingInput) { const current=await this.get(tenantId,id); const normalized=normalizeUpdate(current,input); const merged={...current,...normalized,tenantId}; validate(merged); const updated=await this.repository.update(tenantId,id,normalized); if(!updated) throw new AppError('RESOURCE_VERSION_CONFLICT','工作流执行绑定版本冲突',{id,expectedVersion:input.expectedVersion}); return updated; }
  async disable(tenantId:string,id:string,expectedVersion:number) { return this.update(tenantId,id,{expectedVersion,status:'DISABLED'}); }
}

function normalizeUpdate(current: CreateWorkflowExecutionBindingInput, input: UpdateWorkflowExecutionBindingInput): UpdateWorkflowExecutionBindingInput {
  const workflowVersionSelection = input.workflowVersionSelection ?? current.workflowVersionSelection;
  const runner = input.runner ?? current.runner;
  return {
    ...input,
    ...(workflowVersionSelection === 'LATEST_PUBLISHED' ? { workflowVersionId: undefined } : {}),
    ...(runner === 'CONTROL_PLANE' ? { gatewayId: undefined } : {}),
  };
}

function validate(input: CreateWorkflowExecutionBindingInput) {
  if (input.workflowVersionSelection === 'PINNED' && !input.workflowVersionId) throw new AppError('VALIDATION_FAILED','PINNED 必须指定工作流版本');
  if (input.workflowVersionSelection === 'LATEST_PUBLISHED' && input.workflowVersionId) throw new AppError('VALIDATION_FAILED','LATEST_PUBLISHED 不得固定工作流版本');
  if (input.runner === 'GATEWAY' && !input.gatewayId) throw new AppError('VALIDATION_FAILED','GATEWAY Runner 必须指定 Gateway');
  if (input.runner === 'CONTROL_PLANE' && input.gatewayId) throw new AppError('VALIDATION_FAILED','CONTROL_PLANE Runner 不得指定 Gateway');
  for (const [slot, binding] of Object.entries(input.inputBindings.credentials)) {
    if (!slot.trim() || !binding?.credentialId?.trim()) throw new AppError('VALIDATION_FAILED', 'Credential Binding 必须使用非空 credentialId');
  }
  rejectPlainSecrets(input.inputBindings.connections, []);
  rejectPlainSecrets(input.inputBindings.variables, []);
}

function rejectPlainSecrets(value: unknown, path: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((item, index) => rejectPlainSecrets(item, [...path, String(index)])); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (/^(password|privateKey|secret|token)$/i.test(key) && typeof child === 'string' && child.trim() && !child.startsWith('secret://')) {
      throw new AppError('SECRET_REF_INVALID', '工作流执行绑定不得保存明文 Secret', { path: nextPath.join('.') });
    }
    rejectPlainSecrets(child, nextPath);
  }
}
