import { createHash, createHmac } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { assertPluginGcacCompatibility } from '../../../common/version.js';
import { newId } from '../../../shared/id.js';
import type { AgentAtomicExecutionPlanV1, AgentDeploymentPluginManifestV1, AgentPluginOperation, AgentPlanVerificationV1 } from '../dto/agent-deployment-plugins.dto.js';
import type { ResolvedDeploymentInputV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import { validateAgentDeploymentPluginManifest } from '../schema/agent-deployment-plugins.schema.js';
import { isUnifiedPluginVersionAccessibleToTenant, type UnifiedPluginsApplicationService } from './unified-plugins.application-service.js';

export class UnifiedAgentPlanCompilerService {
  constructor(
    private readonly plugins: UnifiedPluginsApplicationService,
  ) {}

  async compile(input: {
    tenantId: string;
    agentId: string;
    executionRunId: string;
    executionStepId: string;
    pluginVersionId: string;
    pluginBindingId: string;
    resolvedInput: ResolvedDeploymentInputV1;
    executionMode?: 'APPLY' | 'PREFLIGHT' | 'ROLLBACK';
    ttlSeconds?: number;
  }): Promise<AgentAtomicExecutionPlanV1> {
    if (!input.resolvedInput.executable) {
      throw new AppError('VALIDATION_FAILED', '统一部署输入未通过执行前校验', { issues: input.resolvedInput.issues });
    }
    const plugin = await this.plugins.getVersion(input.pluginVersionId);
    if (!isUnifiedPluginVersionAccessibleToTenant(plugin, input.tenantId) || plugin.status !== 'ENABLED') {
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
    const variables = input.resolvedInput.variables;
    const values = {
      variables,
      connections: input.resolvedInput.connections,
      credentials: input.resolvedInput.credentials,
      artifacts: normalizeArtifacts(input.resolvedInput.artifacts),
    };
    const executionMode = input.executionMode ?? 'APPLY';
    const sourceOperations = executionMode === 'ROLLBACK'
      ? recipe.rollback ?? []
      : recipe.operations;
    const operations = renderOperations(sourceOperations, values);
    const rollback = executionMode === 'APPLY' ? renderOperations(recipe.rollback ?? [], values) : [];
    const permissions = resolveExecutionPermissions(recipe, variables);
    assertResolvedPermissions(permissions, [...operations, ...rollback]);
    const verification = resolvePlanVerification(variables.verify);
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
        pluginBindingId: input.pluginBindingId,
        variables,
        artifacts: Object.keys(values.artifacts).sort(),
      })),
      permissions,
      variablesDigest: sha256(JSON.stringify(variables)),
      executionMode,
      ...(verification ? { verification } : {}),
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

function resolvePlanVerification(value: unknown): AgentPlanVerificationV1 | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new AppError('VALIDATION_FAILED', 'TLS 验证输入必须是对象');
  const host = typeof value.host === 'string' ? value.host.trim() : '';
  const sni = typeof value.sni === 'string' ? value.sni.trim() : '';
  const port = typeof value.port === 'number' && Number.isInteger(value.port) ? value.port : 0;
  if (!host || !sni || port < 1 || port > 65535) {
    throw new AppError('VALIDATION_FAILED', 'TLS 验证输入必须包含有效 host、port 和 sni');
  }
  return {
    capabilityKey: 'certificate.verify',
    schemaVersion: '1.0',
    connectHost: host,
    serverName: sni,
    port,
  };
}

function normalizeArtifacts(artifacts: ResolvedDeploymentInputV1['artifacts']): Record<string, unknown> {
  return Object.fromEntries(Object.entries(artifacts).map(([name, artifact]) => {
    const outputs = isRecord(artifact.outputs) ? artifact.outputs as Record<string, unknown> : {};
    const { outputs: _outputs, ...material } = artifact;
    const outputValues = Object.values(outputs);
    const primary = outputValues.length === 1 && isRecord(outputValues[0]) ? outputValues[0] : outputs;
    return [name, { ...material, ...primary }];
  }));
}

type AgentOperationInputContext = Pick<ResolvedDeploymentInputV1, 'variables' | 'connections' | 'credentials'> & { artifacts: Record<string, unknown> };

function renderOperations(operations: AgentPluginOperation[], values: AgentOperationInputContext): AgentPluginOperation[] {
  return operations.map((operation) => ({ ...operation, input: interpolateValue(operation.input, values) as Record<string, unknown> }));
}

function interpolateValue(value: unknown, context: AgentOperationInputContext): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^\$\{(variables|connections|credentials|artifacts)\.([A-Za-z_][A-Za-z0-9_.-]*)\}$/);
    if (exact) return resolveContextPath(context[exact[1] as keyof AgentOperationInputContext], exact[2]) ?? '';
    return value.replace(/\$\{(variables|connections|credentials|artifacts)\.([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (_, group: keyof AgentOperationInputContext, key: string) => String(resolveContextPath(context[group], key) ?? ''));
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, context));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateValue(item, context)]));
  return value;
}

function resolveExecutionPermissions(
  manifest: AgentDeploymentPluginManifestV1,
  variables: Record<string, unknown>,
): AgentDeploymentPluginManifestV1['permissions'] {
  const filePaths = Object.entries(manifest.inputContract.variables)
    .filter(([, definition]) => definition.type === 'file')
    .map(([name]) => variables[name])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  const referencedProcessPaths = referencedVariableValues(manifest, variables, 'program');
  const referencedServiceNames = referencedVariableValues(manifest, variables, 'serviceName', 'service');
  return manifest.permissions.map((permission) => ({
    ...permission,
    values: [...new Set([
      ...permission.values,
      ...(permission.scope === 'filesystem' ? filePaths : []),
      ...(permission.scope === 'process' ? referencedProcessPaths : []),
      ...(permission.scope === 'service' ? referencedServiceNames : []),
    ])],
  }));
}

function referencedVariableValues(
  manifest: AgentDeploymentPluginManifestV1,
  variables: Record<string, unknown>,
  ...inputKeys: string[]
): string[] {
  const values = new Set<string>();
  for (const operation of [...manifest.operations, ...(manifest.rollback ?? [])]) {
    for (const inputKey of inputKeys) {
      const reference = operation.input[inputKey];
      if (typeof reference !== 'string') continue;
      const match = /^\$\{variables\.([A-Za-z_][A-Za-z0-9_.-]*)\}$/.exec(reference);
      if (!match) continue;
      const value = variables[match[1]];
      if (typeof value === 'string' && value.trim()) values.add(value.trim());
    }
  }
  return [...values];
}

function assertResolvedPermissions(permissions: AgentDeploymentPluginManifestV1['permissions'], operations: AgentPluginOperation[]): void {
  const byScope = new Map<string, string[]>();
  for (const permission of permissions) byScope.set(permission.scope, [...(byScope.get(permission.scope) ?? []), ...permission.values]);
  for (const operation of operations) {
    if (operation.input.whenVariablePresent === '') continue;
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
