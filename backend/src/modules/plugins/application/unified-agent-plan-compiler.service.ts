import { createHash, createHmac } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { assertPluginGcacCompatibility } from '../../../common/version.js';
import { newId } from '../../../shared/id.js';
import type { AgentAtomicExecutionPlanV1, AgentDeploymentPluginManifestV1, AgentPluginOperation } from '../dto/agent-deployment-plugins.dto.js';
import type { PluginBindingV1 } from '../dto/plugin-bindings.dto.js';
import { validateAgentDeploymentPluginManifest, validateAgentPluginVariableValues } from '../schema/agent-deployment-plugins.schema.js';
import type { PluginBindingsApplicationService } from './plugin-bindings.application-service.js';
import type { UnifiedPluginsApplicationService } from './unified-plugins.application-service.js';

export class UnifiedAgentPlanCompilerService {
  constructor(
    private readonly plugins: UnifiedPluginsApplicationService,
    private readonly bindings: PluginBindingsApplicationService,
  ) {}

  async compile(input: {
    tenantId: string;
    agentId: string;
    executionRunId: string;
    executionStepId: string;
    pluginBindingId: string;
    artifacts: Record<string, unknown>;
    executionContext?: Record<string, unknown>;
    executionVariables?: Record<string, unknown>;
    executionMode?: 'APPLY' | 'PREFLIGHT' | 'ROLLBACK';
    ttlSeconds?: number;
  }): Promise<AgentAtomicExecutionPlanV1> {
    const binding = await this.bindings.getTenantBinding(input.tenantId, input.pluginBindingId);
    if (binding.status !== 'ACTIVE') throw new AppError('PLUGIN_PERMISSION_DENIED', '统一插件绑定未启用');
    if (binding.mode !== 'MANAGED') throw new AppError('AGENT_PLUGIN_BINDING_INVALID', 'Agent Atomic 插件必须使用 MANAGED Binding');
    const plugin = await this.plugins.getVersion(binding.pluginVersionId);
    if (plugin.tenantId !== input.tenantId || plugin.status !== 'ENABLED') {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '统一插件版本未启用');
    }
    if (plugin.runtime !== 'AGENT_ATOMIC' || !plugin.manifest.capabilities.some((item) => item.key === 'certificate.deploy')) {
      throw new AppError('AGENT_PLUGIN_BINDING_INVALID', '插件不是可用的 Agent Atomic 证书插件');
    }
    assertPluginGcacCompatibility(plugin.pluginId, plugin.manifest.minGcacVersion);
    const recipePath = plugin.manifest.resources.agentRecipes?.['certificate.deploy'];
    const recipeText = recipePath ? plugin.resources[recipePath] : undefined;
    if (!recipePath || !recipeText) throw new AppError('RESOURCE_NOT_FOUND', '统一插件缺少 Agent Recipe', { pluginVersionId: plugin.id });
    const recipe = validateAgentDeploymentPluginManifest(JSON.parse(recipeText));
    if (recipe.pluginId !== plugin.pluginId) throw new AppError('AGENT_PLUGIN_BINDING_INVALID', 'Agent Recipe 与统一插件身份不一致');
    const sourcedVariables = resolveExecutionContextVariables(recipe.variables, input.executionContext ?? {});
    const variables = validateAgentPluginVariableValues(recipe.variables, {
      ...binding.variableBindings,
      ...binding.secretBindings,
      ...sourcedVariables,
      ...input.executionVariables,
    });
    const values = { variables, artifacts: normalizeArtifacts(binding, input.artifacts) };
    const executionMode = input.executionMode ?? 'APPLY';
    const sourceOperations = executionMode === 'ROLLBACK'
      ? recipe.rollback ?? []
      : recipe.operations;
    const operations = renderOperations(sourceOperations, values);
    const rollback = executionMode === 'APPLY' ? renderOperations(recipe.rollback ?? [], values) : [];
    const permissions = resolveExecutionPermissions(recipe, variables);
    assertResolvedPermissions(permissions, [...operations, ...rollback]);
    const now = new Date();
    const ttlSeconds = Math.min(Math.max(input.ttlSeconds ?? 300, 30), 3600);
    const unsigned = {
      apiVersion: 'gcac.agent-plan/v1' as const,
      planId: newId('agplan'),
      tenantId: input.tenantId,
      agentId: input.agentId,
      executionRunId: input.executionRunId,
      executionStepId: input.executionStepId,
      plugin: {
        pluginPackageId: plugin.id,
        pluginVersionId: plugin.id,
        packageHash: plugin.packageSha256,
        manifestHash: plugin.manifestSha256,
      },
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
      idempotencyKey: sha256(JSON.stringify({
        executionRunId: input.executionRunId,
        executionStepId: input.executionStepId,
        pluginVersionId: plugin.id,
        pluginBindingId: binding.id,
        variables,
        artifacts: Object.keys(input.artifacts).sort(),
      })),
      permissions,
      variablesDigest: sha256(JSON.stringify(variables)),
      executionMode,
      operations,
      rollback,
    };
    const transportUnsigned = normalizeJsonTransport(unsigned);
    const signature = createHmac('sha256', process.env.GCAC_AGENT_PLAN_SIGNING_KEY?.trim() || 'gcac-development-agent-plan-key')
      .update(canonicalAgentPlanJson(transportUnsigned))
      .digest('hex');
    return { ...transportUnsigned, authorization: { keyId: 'agent-plan-v1', signature } };
  }
}

function resolveExecutionContextVariables(
  definitions: AgentDeploymentPluginManifestV1['variables'],
  executionContext: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.source?.kind !== 'execution_context') continue;
    const value = readContextPath(executionContext, definition.source.path);
    if (value !== undefined) resolved[name] = value;
  }
  return resolved;
}

function readContextPath(context: Record<string, unknown>, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function normalizeArtifacts(binding: PluginBindingV1, artifacts: Record<string, unknown>): Record<string, unknown> {
  const artifactNames = new Set([
    ...Object.keys(artifacts),
    ...Object.keys(binding.certificateArtifactBindings),
  ]);
  return Object.fromEntries([...artifactNames].map((name) => {
    const material = isRecord(artifacts[name]) ? artifacts[name] : {};
    const definition = binding.certificateArtifactBindings[name];
    if (!definition) return [name, material];
    const outputs = isRecord(material.outputs) ? material.outputs : {};
    const selectedBySlot = Object.fromEntries(Object.entries(definition.outputBindings)
      .map(([slot, outputKey]) => [slot, outputs[slot] ?? outputs[outputKey]] as const)
      .filter(([, value]) => value !== undefined));
    const selected = Object.values(selectedBySlot);
    const primary = selected.length === 1 && isRecord(selected[0]) ? selected[0] : {};
    return [name, { ...material, ...primary, ...selectedBySlot }];
  }));
}

function renderOperations(operations: AgentPluginOperation[], values: { variables: Record<string, unknown>; artifacts: Record<string, unknown> }): AgentPluginOperation[] {
  return operations.map((operation) => ({ ...operation, input: interpolateValue(operation.input, values) as Record<string, unknown> }));
}

function interpolateValue(value: unknown, context: { variables: Record<string, unknown>; artifacts: Record<string, unknown> }): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\$\{(variables|artifacts)\.([A-Za-z_][A-Za-z0-9_.-]*)\}$/);
    if (exact) return resolveContextPath(context[exact[1] as 'variables' | 'artifacts'], exact[2]);
    return value.replace(/\$\{(variables|artifacts)\.([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_, group: 'variables' | 'artifacts', key: string) => String(resolveContextPath(context[group], key) ?? ''));
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, context));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateValue(item, context)]));
  return value;
}

function resolveExecutionPermissions(
  manifest: AgentDeploymentPluginManifestV1,
  variables: Record<string, unknown>,
): AgentDeploymentPluginManifestV1['permissions'] {
  const filePaths = Object.entries(manifest.variables)
    .filter(([, definition]) => definition.type === 'file')
    .map(([name]) => variables[name])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  return manifest.permissions.map((permission) => ({
    ...permission,
    values: [...new Set([
      ...permission.values,
      ...(permission.scope === 'filesystem' ? filePaths : []),
    ])],
  }));
}

function assertResolvedPermissions(permissions: AgentDeploymentPluginManifestV1['permissions'], operations: AgentPluginOperation[]): void {
  const byScope = new Map<string, string[]>();
  for (const permission of permissions) byScope.set(permission.scope, [...(byScope.get(permission.scope) ?? []), ...permission.values]);
  for (const operation of operations) {
    if (operation.operationType.startsWith('file.')) assertAllowed(operation.input.path ?? operation.input.targetPath, byScope.get('filesystem'), '文件路径');
    if (operation.operationType === 'command.execute') assertAllowed(operation.input.program, byScope.get('process'), '程序');
    if (operation.operationType === 'service.control') assertAllowed(operation.input.serviceName, byScope.get('service'), '服务');
    if (operation.operationType === 'preflight.assert') {
      if (operation.input.path !== undefined) assertAllowed(operation.input.path, byScope.get('filesystem'), '预检文件路径');
      if (operation.input.program !== undefined) assertAllowed(operation.input.program, byScope.get('process'), '预检程序');
    }
  }
}

function assertAllowed(value: unknown, allowed: string[] | undefined, label: string): void {
  if (typeof value !== 'string' || allowed?.some((pattern) => matchesPermission(value, pattern))) return;
  throw new AppError('PLUGIN_PERMISSION_DENIED', `${label}超出插件权限`, { value });
}

function matchesPermission(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function resolveContextPath(root: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => isRecord(current) ? current[segment] : undefined, root);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function canonicalAgentPlanJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAgentPlanJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalAgentPlanJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeJsonTransport<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
