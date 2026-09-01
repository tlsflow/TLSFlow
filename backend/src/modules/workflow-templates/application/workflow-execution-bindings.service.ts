import { AppError } from '../../../common/errors/app-error.js';
import type { CreateWorkflowExecutionBindingInput, UpdateWorkflowExecutionBindingInput, WorkflowExecutionBinding } from '../dto/workflow-execution-bindings.dto.js';
import { WorkflowExecutionBindingsRepository, type WorkflowExecutionBindingChain } from '../repository/workflow-execution-bindings.repository.js';
import { emptyInputBindingsV1, INPUT_BINDINGS_API_VERSION, type InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export class WorkflowExecutionBindingsService {
  constructor(private readonly repository: WorkflowExecutionBindingsRepository) {}
  async create(input: CreateWorkflowExecutionBindingInput) {
    const normalized = await this.normalizeIdentity(normalizeInputBindingInput(input));
    await validate(this.repository, normalized);
    return this.repository.create(normalized);
  }
  async get(tenantId:string,id:string) {
    const binding=await this.repository.find(tenantId,id);
    if(!binding) throw new AppError('RESOURCE_NOT_FOUND','工作流执行绑定不存在',{id});
    return normalizeInputBindingInput(binding);
  }
  async getExecutionIdentity(tenantId: string, id: string): Promise<{ binding: Awaited<ReturnType<WorkflowExecutionBindingsRepository['find']>> extends infer T ? Exclude<T, undefined> : never; chain: WorkflowExecutionBindingChain }> {
    const binding = await this.get(tenantId, id);
    const chain = await requireCurrentWorkflowChain(this.repository, binding);
    return { binding, chain };
  }
  async update(tenantId:string,id:string,input:UpdateWorkflowExecutionBindingInput) {
    const current=await this.get(tenantId,id);
    const normalized=normalizeUpdate(current,input);
    const merged=await this.normalizeIdentity(normalizeInputBindingInput({...current,...normalized,tenantId}));
    await validate(this.repository, merged);
    const updated=await this.repository.update(tenantId,id,{ ...merged, expectedVersion: input.expectedVersion });
    if(!updated) throw new AppError('RESOURCE_VERSION_CONFLICT','工作流执行绑定版本冲突',{id,expectedVersion:input.expectedVersion});
    return updated;
  }
  async disable(tenantId:string,id:string,expectedVersion:number) { return this.update(tenantId,id,{expectedVersion,status:'DISABLED'}); }

  private async normalizeIdentity<T extends CreateWorkflowExecutionBindingInput>(input: T): Promise<T> {
    if (input.workflowVersionSelection && input.workflowVersionSelection !== 'CURRENT' && input.workflowVersionSelection !== 'FIXED') {
      throw new AppError('VALIDATION_FAILED', '工作流执行绑定版本策略无效', { code: 'WORKFLOW_VERSION_SELECTION_INVALID' });
    }
    const pluginId = input.pluginId?.trim() || await this.repository.resolvePluginId(input.tenantId, input.pluginVersionId);
    if (!pluginId) throw new AppError('VALIDATION_FAILED', '工作流执行绑定必须指定插件身份', { code: 'WORKFLOW_EXECUTION_BINDING_PLUGIN_ID_REQUIRED' });
    return { ...input, pluginId, pluginVersionId: undefined, workflowVersionId: undefined, workflowVersionSelection: 'CURRENT' } as T;
  }
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
  if (input.workflowVersionSelection !== 'CURRENT') throw new AppError('VALIDATION_FAILED','工作流执行绑定只支持 CURRENT 当前版本策略', { code: 'WORKFLOW_VERSION_SELECTION_INVALID' });
  if (!input.pluginId?.trim() || !input.capabilityKey?.trim() || !input.workflowKey?.trim() || !input.workflowTemplateId?.trim()) {
    throw new AppError('VALIDATION_FAILED','工作流执行绑定必须指定 Plugin、Capability、Workflow 和 WorkflowTemplate', { code: 'WORKFLOW_EXECUTION_BINDING_IDENTITY_REQUIRED' });
  }
  if (input.runner === 'GATEWAY' && !input.gatewayId) throw new AppError('VALIDATION_FAILED','GATEWAY Runner 必须指定 Gateway');
  if (input.runner === 'CONTROL_PLANE' && input.gatewayId) throw new AppError('VALIDATION_FAILED','CONTROL_PLANE Runner 不得指定 Gateway');
  const inputBindings = input.inputBindings ?? emptyInputBindingsV1();
  for (const [slot, binding] of Object.entries(inputBindings.credentials)) {
    if (!slot.trim() || !binding?.credentialId?.trim()) throw new AppError('VALIDATION_FAILED', 'Credential Binding 必须使用非空 credentialId');
  }
  rejectPlainSecrets(inputBindings.connections, []);
  rejectPlainSecrets(inputBindings.variables, []);
  const identity: Pick<WorkflowExecutionBinding, 'tenantId' | 'pluginId' | 'capabilityKey' | 'workflowKey' | 'workflowTemplateId'> = {
    tenantId: input.tenantId,
    pluginId: input.pluginId,
    capabilityKey: input.capabilityKey,
    workflowKey: input.workflowKey,
    workflowTemplateId: input.workflowTemplateId,
  };
  await requireCurrentWorkflowChain(repository, identity);
}

/**
 * 当前发布链缺失时先分流插件自身状态，避免把「插件未启用/运行时不符」误报为「映射不存在」。
 * 只有确实找不到插件、能力或工作流映射时，才返回 CURRENT_CHAIN_MISSING。
 */
async function requireCurrentWorkflowChain(
  repository: WorkflowExecutionBindingsRepository,
  identity: Pick<WorkflowExecutionBinding, 'tenantId' | 'pluginId' | 'capabilityKey' | 'workflowKey' | 'workflowTemplateId'>,
): Promise<WorkflowExecutionBindingChain> {
  const chain = await repository.findCurrentWorkflowChain(identity);
  if (!chain) {
    const diagnosis = await repository.findPluginDiagnosis(identity.tenantId, identity.pluginId);
    if (diagnosis && (diagnosis.status !== 'ENABLED' || diagnosis.runtime !== 'WORKFLOW_DSL')) {
      throw new AppError('VALIDATION_FAILED', '工作流执行绑定只能引用已启用的 Workflow DSL PluginVersion', {
        code: 'WORKFLOW_EXECUTION_BINDING_PLUGIN_UNAVAILABLE',
        pluginId: identity.pluginId,
        status: diagnosis.status,
        runtime: diagnosis.runtime,
      });
    }
  }
  assertCurrentWorkflowChain(identity, chain);
  return chain;
}

function normalizeInputBindingInput<T extends CreateWorkflowExecutionBindingInput>(input: T): T {
  return {
    ...input,
    inputBindings: normalizeInputBindings(input.inputBindings),
  } as T;
}

function normalizeInputBindings(value: InputBindingsV1 | null | undefined): InputBindingsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyInputBindingsV1();
  const record = value as unknown as Record<string, unknown>;
  return {
    apiVersion: typeof record.apiVersion === 'string' ? record.apiVersion as InputBindingsV1['apiVersion'] : INPUT_BINDINGS_API_VERSION,
    variables: isRecord(record.variables) ? record.variables : {},
    connections: isRecord(record.connections) ? record.connections as InputBindingsV1['connections'] : {},
    credentials: isRecord(record.credentials) ? record.credentials as InputBindingsV1['credentials'] : {},
    artifacts: isRecord(record.artifacts) ? record.artifacts as InputBindingsV1['artifacts'] : {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertCurrentWorkflowChain(input: Pick<WorkflowExecutionBinding, 'pluginId' | 'capabilityKey' | 'workflowKey' | 'workflowTemplateId'>, chain: WorkflowExecutionBindingChain | undefined): asserts chain is WorkflowExecutionBindingChain {
  if (!chain) throw new AppError('VALIDATION_FAILED', '工作流执行绑定缺少当前发布链', {
    code: 'WORKFLOW_EXECUTION_BINDING_CURRENT_CHAIN_MISSING',
    pluginId: input.pluginId,
    capabilityKey: input.capabilityKey,
    workflowKey: input.workflowKey,
    workflowTemplateId: input.workflowTemplateId,
  });
  if (chain.pluginStatus !== 'ENABLED' || chain.pluginRuntime !== 'WORKFLOW_DSL') {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定只能引用已启用的 Workflow DSL PluginVersion', {
      code: 'WORKFLOW_EXECUTION_BINDING_PLUGIN_UNAVAILABLE',
      pluginId: input.pluginId,
      status: chain.pluginStatus,
      runtime: chain.pluginRuntime,
    });
  }
  if (!chain.capabilityDeclared) {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定的 Capability 未在 PluginVersion Manifest 中声明', {
      code: 'WORKFLOW_EXECUTION_BINDING_CAPABILITY_MISSING',
      pluginId: input.pluginId,
      capabilityKey: input.capabilityKey,
    });
  }
  if (chain.workflowKey !== input.workflowKey || chain.workflowTemplateId !== input.workflowTemplateId || chain.workflowVersionTemplateId !== input.workflowTemplateId) {
    throw new AppError('VALIDATION_FAILED', '工作流执行绑定的当前 Template 与插件绑定不一致', {
      code: 'WORKFLOW_EXECUTION_BINDING_CURRENT_WORKFLOW_MISMATCH',
      workflowTemplateId: input.workflowTemplateId,
      workflowKey: input.workflowKey,
      boundWorkflowTemplateId: chain.workflowTemplateId,
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
      workflowVersionId: chain.workflowVersionId,
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
