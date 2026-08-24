import { AppError } from '../../../common/errors/app-error.js';
import type {
  WorkflowBindingPolicy,
  WorkflowConfigurationMode,
  WorkflowConnectionBinding,
  WorkflowConnectionDefinition,
  WorkflowDslV1,
  WorkflowVariableDefinition,
} from '../dto/workflow-templates.dto.js';

export interface WorkflowAssetContext { asset?: Record<string, unknown>; target?: Record<string, unknown>; binding?: Record<string, unknown>; [key: string]: unknown }
export interface WorkflowVariableResolverInput {
  content: WorkflowDslV1;
  assetContext?: WorkflowAssetContext;
  parameterBindings?: Record<string, unknown>;
  connectionBindings?: Record<string, WorkflowConnectionBinding>;
  credentialBindings?: Record<string, unknown>;
  phase: 'configure' | 'execute';
}
export interface WorkflowVariableProjectionItem {
  name: string; type: WorkflowVariableDefinition['type']; configurationMode: WorkflowConfigurationMode; value?: unknown;
  status: 'resolved' | 'unresolved' | 'deferred'; source: { kind: string; path?: string }; bindingPolicy?: WorkflowBindingPolicy;
  sensitive: boolean; editable: boolean;
}
export interface WorkflowConnectionProjectionItem {
  name: string; protocol: 'ssh' | 'http'; host?: string; port?: number; username?: string; credentialRef?: string;
  configurationMode: 'required' | 'advanced'; status: 'resolved' | 'unresolved'; source: Record<string, string>;
  fieldModes: { host: 'required' | 'advanced'; port: 'required' | 'advanced'; username?: 'required' | 'advanced'; credential?: 'required' | 'advanced'; hostKey?: 'required' | 'advanced' };
  hostKeyPolicy?: 'strict' | 'trust_on_first_use' | 'manual_approval_required';
  expectedHostKeyFingerprint?: string;
}
export interface WorkflowBindingProjection {
  required: WorkflowVariableProjectionItem[]; advanced: WorkflowVariableProjectionItem[]; runtime: Array<{ name: string; type: string; source: string }>;
  basicConnections: WorkflowConnectionProjectionItem[]; advancedConnections: WorkflowConnectionProjectionItem[];
  missingAssetFields: string[]; diagnostics: Array<{ code: string; name?: string; message: string }>;
}

export function buildWorkflowAssetContext(input: Record<string, unknown>): WorkflowAssetContext {
  const asset = { ...(isRecord(input.asset) ? input.asset : {}), ...definedValues({
    address: input.address ?? input.assetAddress,
    port: input.port,
    protocol: input.protocol,
  }) };
  const target = { ...(isRecord(input.target) ? input.target : {}), ...definedValues({
    hostHeader: input.hostHeader,
    port: input.targetPort ?? input.port,
    protocol: input.targetProtocol ?? input.protocol,
    verifyUrl: input.verifyUrl,
  }) };
  return {
    ...input,
    asset,
    target,
  };
}

export function buildWorkflowBindingProjection(input: WorkflowVariableResolverInput): WorkflowBindingProjection {
  const required: WorkflowVariableProjectionItem[] = []; const advanced: WorkflowVariableProjectionItem[] = []; const runtime: WorkflowBindingProjection['runtime'] = [];
  const diagnostics: WorkflowBindingProjection['diagnostics'] = []; const missingAssetFields: string[] = [];
  for (const [name, definition] of Object.entries(input.content.variables)) {
    const item = resolveVariable(input, name, definition);
    if (item.configurationMode === 'runtime') { runtime.push({ name, type: item.type, source: item.source.kind }); continue; }
    if (item.status === 'unresolved' && item.source.kind === 'asset_ssl') { missingAssetFields.push(item.source.path ?? name); diagnostics.push({ code: 'WORKFLOW_ASSET_FIELD_REQUIRED', name, message: `缺少资产字段 ${item.source.path ?? name}` }); }
    if (item.source.kind === 'asset_ssl' || item.source.kind === 'derived') continue;
    (item.configurationMode === 'required' ? required : advanced).push(item);
  }
  const connections = resolveConnections(input);
  return { required, advanced, runtime, basicConnections: connections.basic, advancedConnections: connections.advanced, missingAssetFields, diagnostics: [...diagnostics, ...connections.diagnostics] };
}

export function resolveVariable(input: WorkflowVariableResolverInput, name: string, definition: WorkflowVariableDefinition): WorkflowVariableProjectionItem {
  const mode = definition.configurationMode ?? legacyMode(definition); const source = definition.source ?? legacySource(definition); const binding = input.parameterBindings?.[name];
  const sourceValue = resolveSource(source, input.assetContext ?? {});
  const acceptsBinding = source.kind !== 'asset_ssl' && source.kind !== 'derived' && definition.bindingPolicy !== 'fixed';
  let value = acceptsBinding ? binding ?? sourceValue : sourceValue;
  if (value === undefined && source.kind !== 'asset_ssl' && source.kind !== 'derived') value = definition.default;
  const deferred = mode === 'runtime' || source.kind === 'step_output' || source.kind === 'system';
  return { name, type: definition.type, configurationMode: mode, value: definition.sensitive ? undefined : value, status: deferred ? 'deferred' : value === undefined ? 'unresolved' : 'resolved', source: { kind: source.kind, ...('path' in source ? { path: source.path } : {}) }, bindingPolicy: definition.bindingPolicy, sensitive: Boolean(definition.sensitive || definition.type === 'credential' || definition.type === 'certificate'), editable: mode !== 'runtime' && definition.bindingPolicy !== 'fixed' };
}

export function resolveWorkflowConnection(definition: WorkflowConnectionDefinition, binding: WorkflowConnectionBinding | undefined, context: WorkflowAssetContext) {
  const host = binding?.host ?? resolveConnectionField(definition.host, context);
  const portValue = binding?.port ?? resolveConnectionField(definition.port, context);
  const username = binding?.username ?? resolveConnectionField(definition.username, context);
  const credential = binding?.credential ?? binding?.credentialRef;
  return {
    host: typeof host === 'string' ? host : undefined,
    port: Number(portValue ?? 22),
    username: typeof username === 'string' ? username : undefined,
    credential,
    credentialRef: binding?.credentialRef ?? binding?.credential?.credentialId,
    expectedHostKeyFingerprint: binding?.expectedHostKeyFingerprint,
    hostKeyPolicy: definition.hostKey?.policy,
  };
}

export function assertProjectionExecutable(projection: WorkflowBindingProjection): void {
  const invalid = projection.required.find((item) => item.status === 'unresolved') ?? projection.basicConnections.find((item) => item.status === 'unresolved');
  if (invalid) throw new AppError('VALIDATION_FAILED', '工作流存在未完成的必填配置', { name: invalid.name });
}

function resolveConnections(input: WorkflowVariableResolverInput) {
  const basic: WorkflowConnectionProjectionItem[] = []; const advanced: WorkflowConnectionProjectionItem[] = []; const diagnostics: WorkflowBindingProjection['diagnostics'] = [];
  for (const [name, definition] of Object.entries(input.content.connections ?? {})) {
    const binding = input.connectionBindings?.[name]; const resolved = resolveWorkflowConnection(definition, binding, input.assetContext ?? {});
    const required = [definition.host, definition.credential, definition.username].some((field) => field?.configurationMode === 'required');
    const status = resolved.host && (!definition.username || resolved.username) && (!definition.credential || resolved.credential) ? 'resolved' : 'unresolved';
    const item = {
      name,
      protocol: definition.protocol,
      host: resolved.host,
      port: resolved.port,
      username: resolved.username,
      credentialRef: resolved.credentialRef,
      configurationMode: required ? 'required' : 'advanced',
      status,
      source: {
        host: binding?.host ? 'binding' : definition.host.source ?? 'dsl_default',
        port: binding?.port ? 'binding' : definition.port.source ?? 'dsl_default',
      },
      fieldModes: {
        host: definition.host.configurationMode ?? 'advanced',
        port: definition.port.configurationMode ?? 'advanced',
        username: definition.username?.configurationMode,
        credential: definition.credential?.configurationMode,
        hostKey: definition.hostKey?.configurationMode,
      },
      hostKeyPolicy: resolved.hostKeyPolicy,
      expectedHostKeyFingerprint: resolved.expectedHostKeyFingerprint,
    } as WorkflowConnectionProjectionItem;
    (required ? basic : advanced).push(item); if (status === 'unresolved') diagnostics.push({ code: 'WORKFLOW_CONNECTION_REQUIRED', name, message: '连接字段未完成配置' });
  }
  return { basic, advanced, diagnostics };
}

function resolveConnectionField(field: WorkflowConnectionDefinition['host'] | undefined, context: WorkflowAssetContext): unknown {
  if (!field) return undefined; if (field.source === 'asset_ssl' && field.assetPath) return readPath(context, field.assetPath); return field.default;
}
function resolveSource(source: NonNullable<WorkflowVariableDefinition['source']>, context: WorkflowAssetContext): unknown {
  if (source.kind === 'asset_ssl') return readPath(context, source.path);
  if (source.kind === 'derived') {
    const host = readPath(context, 'asset.address');
    const port = readPath(context, 'target.port') ?? readPath(context, 'asset.port');
    const protocol = readPath(context, 'target.protocol') ?? readPath(context, 'asset.protocol') ?? 'HTTPS';
    if (!host) return undefined;
    if (source.resolver === 'authority') return `${host}${port ? `:${port}` : ''}`;
    if (source.resolver === 'binding_information') return `*:${port ?? ''}:${host}`;
    return `${String(protocol).toLowerCase()}://${host}${port ? `:${port}` : ''}`;
  }
  return source.kind === 'dsl' ? source.value : undefined;
}
function legacyMode(definition: WorkflowVariableDefinition): WorkflowConfigurationMode { return definition.type === 'certificate' ? 'runtime' : definition.required || definition.type === 'credential' ? 'required' : 'advanced'; }
function legacySource(definition: WorkflowVariableDefinition): NonNullable<WorkflowVariableDefinition['source']> { return definition.type === 'certificate' ? { kind: 'certificate' } : definition.type === 'credential' ? { kind: 'credential' } : { kind: 'dsl', value: definition.default }; }
function readPath(context: WorkflowAssetContext, path: string): unknown { return path.split('.').reduce<unknown>((value, part) => isRecord(value) ? value[part] : undefined, context); }
function definedValues(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}
function isRecord(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
