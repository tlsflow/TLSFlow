import { AppError } from '../../../common/errors/app-error.js';
import type { CreateWorkflowExecutionBindingInput, UpdateWorkflowExecutionBindingInput } from '../dto/workflow-execution-bindings.dto.js';
import { WorkflowExecutionBindingsRepository, type WorkflowExecutionBindingChain } from '../repository/workflow-execution-bindings.repository.js';

export class WorkflowExecutionBindingsService {
  constructor(private readonly repository: WorkflowExecutionBindingsRepository) {}
  async create(input: CreateWorkflowExecutionBindingInput) { await validate(this.repository, input); return this.repository.create(input); }
  async get(tenantId:string,id:string) {
    const binding=await this.repository.find(tenantId,id);
    if(!binding) throw new AppError('RESOURCE_NOT_FOUND','工作流执行绑定不存在',{id});
    await validate(this.repository, binding);
    return binding;
  }
  async getExecutionIdentity(tenantId: string, id: string): Promise<{ binding: Awaited<ReturnType<WorkflowExecutionBindingsRepository['find']>> extends infer T ? Exclude<T, undefined> : never; chain: WorkflowExecutionBindingChain }> {
    const binding = await this.get(tenantId, id);
    const chain = await this.repository.findFixedWorkflowChain(binding);
    if (!chain) throw new AppError('VALIDATION_FAILED', '工作流执行绑定缺少固定发布链', { code: 'WORKFLOW_EXECUTION_BINDING_CHAIN_MISSING', bindingId: id });
    return { binding, chain };
  }
  async update(tenantId:string,id:string,input:UpdateWorkflowExecutionBindingInput) {
    const current=await this.get(tenantId,id);
    const normalized=normalizeUpdate(current,input);
    const merged={...current,...normalized,tenantId};
    await validate(this.repository, merged);
    const updated=await this.repository.update(tenantId,id,normalized);
    if(!updated) throw new AppError('RESOURCE_VERSION_CONFLICT','工作流执行绑定版本冲突',{id,expectedVersion:input.expectedVersion});
    return updated;
  }
  async disable(tenantId:string,id:string,expectedVersion:number) { return this.update(tenantId,id,{expectedVersion,status:'DISABLED'}); }
}

function normalizeUpdate(current: CreateWorkflowExecutionBindingInput, input: UpdateWorkflowExecutionBindingInput): UpdateWorkflowExecutionBindingInput {
  const workflowVersionSelection = input.workflowVersionSelection ?? current.workflowVersionSelection;
  const runner = input.runner ?? current.runner;
  return {
    ...input,
    ...(runner === 'CONTROL_PLANE' ? { gatewayId: undefined } : {}),
    workflowVersionSelection,
  };
}

async function validate(repository: WorkflowExecutionBindingsRepository, input: CreateWorkflowExecutionBindingInput) {
  if (input.workflowVersionSelection !== 'FIXED') throw new AppError('VALIDATION_FAILED','工作流执行绑定只支持 FIXED 固定版本策略', { code: 'WORKFLOW_VERSION_SELECTION_INVALID' });
  if (!input.pluginVersionId?.trim() || !input.capabilityKey?.trim() || !input.workflowKey?.trim() || !input.workflowTemplateId?.trim() || !input.workflowVersionId?.trim()) {
    throw new AppError('VALIDATION_FAILED','工作流执行绑定必须指定 PluginVersion、Capability、Workflow、WorkflowTemplate 和 WorkflowVersion', { code: 'WORKFLOW_EXECUTION_BINDING_IDENTITY_REQUIRED' });
  }
  if (input.runner === 'GATEWAY' && !input.gatewayId) throw new AppError('VALIDATION_FAILED','GATEWAY Runner 必须指定 Gateway');
  if (input.runner === 'CONTROL_PLANE' && input.gatewayId) throw new AppError('VALIDATION_FAILED','CONTROL_PLANE Runner 不得指定 Gateway');
  for (const [slot, binding] of Object.entries(input.inputBindings.credentials)) {
    if (!slot.trim() || !binding?.credentialId?.trim()) throw new AppError('VALIDATION_FAILED', 'Credential Binding 必须使用非空 credentialId');
  }
  rejectPlainSecrets(input.inputBindings.connections, []);
  rejectPlainSecrets(input.inputBindings.variables, []);
  const chain = await repository.findFixedWorkflowChain(input);
  assertFixedWorkflowChain(input, chain);
}

function assertFixedWorkflowChain(input: CreateWorkflowExecutionBindingInput, chain: WorkflowExecutionBindingChain | undefined): asserts chain is WorkflowExecutionBindingChain {
  if (!chain) throw new AppError('VALIDATION_FAILED', '工作流执行绑定缺少 Manifest 到 WorkflowVersion 的固定发布链', {
    code: 'WORKFLOW_EXECUTION_BINDING_CHAIN_MISSING',
    pluginVersionId: input.pluginVersionId,
    capabilityKey: input.capabilityKey,
    workflowKey: input.workflowKey,
    workflowTemplateId: input.workflowTemplateId,
    workflowVersionId: input.workflowVersionId,
  });
  if (chain.pluginStatus !== 'ENABLED' || chain.pluginRuntime !== 'WORKFLOW_DSL') {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定只能引用已启用的 Workflow DSL PluginVersion', {
      code: 'WORKFLOW_EXECUTION_BINDING_PLUGIN_UNAVAILABLE',
      pluginVersionId: input.pluginVersionId,
      status: chain.pluginStatus,
      runtime: chain.pluginRuntime,
    });
  }
  if (!chain.capabilityDeclared) {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定的 Capability 未在 PluginVersion Manifest 中声明', {
      code: 'WORKFLOW_EXECUTION_BINDING_CAPABILITY_MISSING',
      pluginVersionId: input.pluginVersionId,
      capabilityKey: input.capabilityKey,
    });
  }
  if (chain.workflowKey !== input.workflowKey || chain.workflowTemplateId !== input.workflowTemplateId || chain.workflowVersionId !== input.workflowVersionId || chain.workflowVersionTemplateId !== input.workflowTemplateId) {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定的 Template、WorkflowVersion 和插件绑定不一致', {
      code: 'WORKFLOW_EXECUTION_BINDING_VERSION_MISMATCH',
      workflowTemplateId: input.workflowTemplateId,
      workflowVersionId: input.workflowVersionId,
      workflowKey: input.workflowKey,
      boundWorkflowTemplateId: chain.workflowTemplateId,
      boundWorkflowVersionId: chain.workflowVersionId,
      workflowVersionTemplateId: chain.workflowVersionTemplateId,
    });
  }
  if (chain.workflowTemplateOrigin !== 'plugin_internal') {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定只能引用插件内置 WorkflowVersion', {
      code: 'WORKFLOW_EXECUTION_BINDING_ORIGIN_INVALID',
      workflowTemplateId: input.workflowTemplateId,
      origin: chain.workflowTemplateOrigin,
    });
  }
  if (chain.workflowVersionStatus !== 'published' || chain.workflowVersionContentHash !== chain.workflowContentSha256) {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定的 WorkflowVersion 未发布或内容摘要不一致', {
      code: 'WORKFLOW_EXECUTION_BINDING_HASH_MISMATCH',
      workflowVersionId: input.workflowVersionId,
      status: chain.workflowVersionStatus,
    });
  }
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
