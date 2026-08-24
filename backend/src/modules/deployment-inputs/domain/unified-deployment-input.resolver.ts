import { createHash } from 'node:crypto';
import type {
  DeploymentConnectionDefinitionV1,
  DeploymentConnectionFieldV1,
  DeploymentInputContractV1,
  DeploymentVariableDefinitionV1,
  DeploymentVariableSourceV1,
} from '../dto/deployment-input-contract.dto.js';
import type { DeploymentAssetContextV1 } from '../dto/deployment-asset-context.dto.js';
import type { InputBindingsV1 } from '../dto/input-bindings.dto.js';
import type {
  DeploymentInputIssueV1,
  ResolveDeploymentInputRequest,
  ResolvedArtifactV1,
  ResolvedConnectionV1,
  ResolvedDeploymentInputV1,
  RuntimeCredentialV1,
} from '../dto/resolved-deployment-input.dto.js';
import type { DeploymentBindingLayerV1, InputValueProvenanceV1 } from './deployment-input-provenance.js';

type DerivedResolver = (assetContext: DeploymentAssetContextV1) => unknown;

interface ResolvedValue {
  value?: unknown;
  provenance: InputValueProvenanceV1;
}

export class UnifiedDeploymentInputResolver {
  private readonly derivedResolvers: Record<string, DerivedResolver>;

  constructor(derivedResolvers: Record<string, DerivedResolver> = {}) {
    this.derivedResolvers = {
      endpoint_url: endpointUrl,
      authority: authority,
      binding_information: bindingInformation,
      certificate_resource_name: (context) => context.deployment.certificateResourceName,
      ...derivedResolvers,
    };
  }

  resolve(request: ResolveDeploymentInputRequest): ResolvedDeploymentInputV1 {
    const variables: Record<string, unknown> = {};
    const connections: Record<string, ResolvedConnectionV1> = {};
    const credentials: Record<string, RuntimeCredentialV1> = {};
    const artifacts: Record<string, ResolvedArtifactV1> = {};
    const provenance: Record<string, InputValueProvenanceV1> = {};
    const sensitivePaths = new Set<string>();
    const issues: DeploymentInputIssueV1[] = [];

    for (const [name, definition] of Object.entries(request.contract.variables)) {
      const path = `variables.${name}`;
      const resolved = this.resolveVariable(request, name, definition, issues);
      provenance[path] = resolved.provenance;
      if (definition.sensitive) sensitivePaths.add(path);
      if (resolved.value === undefined) continue;
      if (!matchesVariableType(definition, resolved.value)) {
        issues.push(issue('VARIABLE', 'DEPLOYMENT_INPUT_TYPE_INVALID', name, path, resolved.provenance.bindingLayer));
        continue;
      }
      variables[name] = resolved.value;
    }

    for (const [name, definition] of Object.entries(request.contract.connections)) {
      const resolved = this.resolveConnection(request, name, definition, provenance, issues, sensitivePaths);
      if (resolved) connections[name] = resolved;
    }

    this.resolveCredentials(request, credentials, provenance, issues, sensitivePaths);
    this.resolveArtifacts(request, artifacts, provenance, issues, sensitivePaths);

    const hashPayload = {
      contractVersion: request.contract.apiVersion,
      assetContext: request.assetContext,
      variables,
      connections,
      credentials,
      artifacts,
    };
    return {
      apiVersion: 'gcac.resolved-deployment-input/v1',
      contractVersion: request.contract.apiVersion,
      assetContext: request.assetContext,
      variables,
      connections,
      credentials,
      artifacts,
      provenance,
      sensitivePaths: [...sensitivePaths].sort(),
      issues,
      executable: !issues.some((item) => item.severity === 'ERROR'),
      resolvedSha256: createHash('sha256').update(stableJson(hashPayload)).digest('hex'),
    };
  }

  private resolveVariable(
    request: ResolveDeploymentInputRequest,
    name: string,
    definition: DeploymentVariableDefinitionV1,
    issues: DeploymentInputIssueV1[],
  ): ResolvedValue {
    const path = `variables.${name}`;
    const executionValue = ownValue(request.executionOverrides?.variables, name);
    const bindingValue = ownValue(request.effectiveBinding.inputBindings.variables, name);
    if (definition.bindingPolicy === 'fixed') {
      if (executionValue.exists) issues.push(issue('VARIABLE', 'DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN', name, path, 'EXECUTION'));
      if (bindingValue.exists) issues.push(issue('VARIABLE', 'DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN', name, path, bindingLayer(request, path)));
      return this.resolveSource(request, definition.source, definition, name, issues);
    }
    if (executionValue.exists) return { value: executionValue.value, provenance: { source: 'binding', bindingLayer: 'EXECUTION' } };
    if (bindingValue.exists) return { value: bindingValue.value, provenance: { source: 'binding', bindingLayer: bindingLayer(request, path) } };
    if (definition.bindingPolicy === 'required_binding') {
      issues.push(issue('VARIABLE', 'DEPLOYMENT_INPUT_REQUIRED', name, path));
      return { provenance: { source: 'binding' } };
    }
    return this.resolveSource(request, definition.source, definition, name, issues);
  }

  private resolveSource(
    request: ResolveDeploymentInputRequest,
    source: DeploymentVariableSourceV1,
    definition: Pick<DeploymentVariableDefinitionV1, 'default' | 'required' | 'lifecycle'>,
    slot: string,
    issues: DeploymentInputIssueV1[],
  ): ResolvedValue {
    const path = `variables.${slot}`;
    if (isDeferred(request.phase, definition.lifecycle, source.kind)) {
      return { provenance: { source: source.kind, sourcePath: sourcePath(source), deferred: true } };
    }
    let value: unknown;
    if (source.kind === 'asset') {
      value = readPath(request.assetContext, source.path);
      if (value === undefined && definition.default !== undefined) {
        return { value: definition.default, provenance: { source: 'default', sourcePath: path } };
      }
    }
    else if (source.kind === 'default') value = definition.default;
    else if (source.kind === 'derived') value = this.derivedResolvers[source.resolver]?.(request.assetContext);
    else if (source.kind === 'system') value = readPath(request.systemValues ?? {}, source.key);
    else if (source.kind === 'step_output') value = readPath(request.stepOutputs ?? {}, `${source.step}.${source.output}`);
    else value = definition.default;
    if (value === undefined && definition.required) issues.push(issue(source.kind === 'asset' ? 'ASSET' : 'VARIABLE', 'DEPLOYMENT_INPUT_REQUIRED', slot, sourcePath(source) ?? path));
    return { value, provenance: { source: source.kind, sourcePath: sourcePath(source) } };
  }

  private resolveConnection(
    request: ResolveDeploymentInputRequest,
    name: string,
    definition: DeploymentConnectionDefinitionV1,
    provenance: Record<string, InputValueProvenanceV1>,
    issues: DeploymentInputIssueV1[],
    sensitivePaths: Set<string>,
  ): ResolvedConnectionV1 | undefined {
    const execution = request.executionOverrides?.connections[name];
    const binding = request.effectiveBinding.inputBindings.connections[name];
    const connection: ResolvedConnectionV1 = { transport: definition.transport, credentialSlot: definition.credentialSlot };
    const host = this.resolveConnectionField(request, name, 'host', definition.host, execution?.host, binding?.host, provenance, issues);
    const port = this.resolveConnectionField(request, name, 'port', definition.port, execution?.port, binding?.port, provenance, issues);
    const username = definition.username
      ? this.resolveConnectionField(request, name, 'username', definition.username, execution?.username, binding?.username, provenance, issues)
      : undefined;
    if (host !== undefined) connection.host = host as string;
    if (port !== undefined) connection.port = port as number;
    if (username !== undefined) connection.username = username as string;

    // 管理连接必须是主机名或 IP。纯数字单标签（例如历史表单误写入的“1”）
    // 会被部分 HTTP 客户端当作无效目标或错误解析，不能进入已密封的执行快照。
    if (host !== undefined && !isValidConnectionHost(host)) {
      issues.push(issue('CONNECTION', 'DEPLOYMENT_INPUT_TYPE_INVALID', name, `connections.${name}.host`, provenance[`connections.${name}.host`]?.bindingLayer));
    }

    if (definition.tls) {
      const verifyPeer = this.resolveConnectionField(request, name, 'tls.verifyPeer', definition.tls.verifyPeer, execution?.tls?.verifyPeer, binding?.tls?.verifyPeer, provenance, issues);
      const serverName = definition.tls.serverName
        ? this.resolveConnectionField(request, name, 'tls.serverName', definition.tls.serverName, execution?.tls?.serverName, binding?.tls?.serverName, provenance, issues)
        : undefined;
      connection.tls = { verifyPeer: verifyPeer as boolean | undefined, serverName: serverName as string | undefined };
    }
    if (definition.hostKey) {
      const expectedFingerprint = definition.hostKey.expectedFingerprint
        ? this.resolveConnectionField(request, name, 'hostKey.expectedFingerprint', definition.hostKey.expectedFingerprint, execution?.hostKey?.expectedFingerprint, binding?.hostKey?.expectedFingerprint, provenance, issues)
        : undefined;
      connection.hostKey = { policy: definition.hostKey.policy, expectedFingerprint: expectedFingerprint as string | undefined };
    }
    for (const field of ['host', 'port'] as const) {
      if (connection[field] === undefined) return undefined;
    }
    if (definition.host.sensitive) sensitivePaths.add(`connections.${name}.host`);
    if (definition.username?.sensitive) sensitivePaths.add(`connections.${name}.username`);
    return connection;
  }

  private resolveConnectionField(
    request: ResolveDeploymentInputRequest,
    connectionName: string,
    fieldName: string,
    definition: DeploymentConnectionFieldV1,
    executionValue: unknown,
    bindingValue: unknown,
    provenance: Record<string, InputValueProvenanceV1>,
    issues: DeploymentInputIssueV1[],
  ): unknown {
    const path = `connections.${connectionName}.${fieldName}`;
    const executionExists = executionValue !== undefined;
    const bindingExists = bindingValue !== undefined;
    let resolved: ResolvedValue;
    if (definition.bindingPolicy === 'fixed') {
      if (executionExists) issues.push(issue('CONNECTION', 'DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN', connectionName, path, 'EXECUTION'));
      if (bindingExists) issues.push(issue('CONNECTION', 'DEPLOYMENT_INPUT_FIXED_OVERRIDE_FORBIDDEN', connectionName, path, bindingLayer(request, path)));
      resolved = this.resolveSource(request, definition.source, definition, connectionName, issues);
    } else if (executionExists) resolved = { value: executionValue, provenance: { source: 'binding', bindingLayer: 'EXECUTION' } };
    else if (bindingExists) resolved = { value: bindingValue, provenance: { source: 'binding', bindingLayer: bindingLayer(request, path) } };
    else if (definition.bindingPolicy === 'required_binding') {
      issues.push(issue('CONNECTION', 'DEPLOYMENT_CONNECTION_REQUIRED', connectionName, path));
      resolved = { provenance: { source: 'binding' } };
    } else resolved = this.resolveSource(request, definition.source, definition, connectionName, issues);
    provenance[path] = resolved.provenance;
    if (resolved.value !== undefined && !matchesScalarType(definition.type, resolved.value)) {
      issues.push(issue('CONNECTION', 'DEPLOYMENT_INPUT_TYPE_INVALID', connectionName, path, resolved.provenance.bindingLayer));
      return undefined;
    }
    return resolved.value;
  }

  private resolveCredentials(
    request: ResolveDeploymentInputRequest,
    output: Record<string, RuntimeCredentialV1>,
    provenance: Record<string, InputValueProvenanceV1>,
    issues: DeploymentInputIssueV1[],
    sensitivePaths: Set<string>,
  ): void {
    for (const [name, definition] of Object.entries(request.contract.credentials)) {
      const path = `credentials.${name}`;
      sensitivePaths.add(path);
      const execution = request.executionOverrides?.credentials[name];
      const binding = request.effectiveBinding.inputBindings.credentials[name];
      const selected = execution ?? binding;
      const layer: DeploymentBindingLayerV1 | undefined = execution ? 'EXECUTION' : binding ? bindingLayer(request, path) : undefined;
      provenance[path] = { source: 'binding', bindingLayer: layer };
      if (!selected) {
        if (definition.required) issues.push(issue('CREDENTIAL', 'DEPLOYMENT_CREDENTIAL_REQUIRED', name, path));
        continue;
      }
      const snapshot = request.credentialSnapshots?.[name];
      if (!snapshot) {
        if (requiresSnapshot(request.phase, definition.lifecycle)) issues.push(issue('CREDENTIAL', 'DEPLOYMENT_CREDENTIAL_SNAPSHOT_REQUIRED', name, path, layer));
        continue;
      }
      if (snapshot.credentialId !== selected.credentialId) {
        issues.push(issue('CREDENTIAL', 'DEPLOYMENT_CREDENTIAL_SNAPSHOT_MISMATCH', name, path, layer));
        continue;
      }
      if (snapshot.kind && !definition.allowedKinds.includes(snapshot.kind as never)) {
        issues.push(issue('CREDENTIAL', 'DEPLOYMENT_CREDENTIAL_KIND_INVALID', name, path, layer));
        continue;
      }
      output[name] = snapshot;
      provenance[path] = { source: 'credential_snapshot', bindingLayer: layer };
    }
  }

  private resolveArtifacts(
    request: ResolveDeploymentInputRequest,
    output: Record<string, ResolvedArtifactV1>,
    provenance: Record<string, InputValueProvenanceV1>,
    issues: DeploymentInputIssueV1[],
    sensitivePaths: Set<string>,
  ): void {
    for (const [name, definition] of Object.entries(request.contract.artifacts)) {
      const path = `artifacts.${name}`;
      const execution = request.executionOverrides?.artifacts[name];
      const binding = request.effectiveBinding.inputBindings.artifacts[name];
      const selected = execution ?? binding;
      const layer: DeploymentBindingLayerV1 | undefined = execution ? 'EXECUTION' : binding ? bindingLayer(request, path) : undefined;
      provenance[path] = { source: 'binding', bindingLayer: layer };
      if (!selected) {
        if (definition.required) issues.push(issue('ARTIFACT', 'DEPLOYMENT_ARTIFACT_REQUIRED', name, path));
        continue;
      }
      const snapshot = request.artifactSnapshots?.[name];
      if (!snapshot) {
        if (requiresSnapshot(request.phase, definition.lifecycle)) issues.push(issue('ARTIFACT', 'DEPLOYMENT_ARTIFACT_SNAPSHOT_REQUIRED', name, path, layer));
        continue;
      }
      let complete = true;
      for (const [outputName, outputDefinition] of Object.entries(definition.artifactContract.outputs)) {
        if (outputDefinition.sensitive) sensitivePaths.add(`${path}.outputs.${outputName}`);
        if (outputDefinition.required && snapshot.outputs[outputName] === undefined) {
          issues.push(issue('ARTIFACT', 'DEPLOYMENT_ARTIFACT_OUTPUT_REQUIRED', name, `${path}.outputs.${outputName}`, layer));
          complete = false;
        }
      }
      if (!complete) continue;
      output[name] = snapshot;
      provenance[path] = { source: 'artifact_snapshot', bindingLayer: layer };
    }
  }
}

function bindingLayer(request: ResolveDeploymentInputRequest, path: string): DeploymentBindingLayerV1 | undefined {
  return request.effectiveBinding.provenance[path];
}

function ownValue(input: Record<string, unknown> | undefined, key: string): { exists: boolean; value?: unknown } {
  return input && Object.prototype.hasOwnProperty.call(input, key) ? { exists: true, value: input[key] } : { exists: false };
}

function isDeferred(phase: ResolveDeploymentInputRequest['phase'], lifecycle: DeploymentVariableDefinitionV1['lifecycle'], sourceKind: DeploymentVariableSourceV1['kind']): boolean {
  if (sourceKind === 'step_output') return phase !== 'execute';
  if (lifecycle === 'runtime_injected') return phase === 'configure' || phase === 'save' || phase === 'preflight';
  return false;
}

function requiresSnapshot(phase: ResolveDeploymentInputRequest['phase'], lifecycle: 'pre_execution' | 'runtime_injected'): boolean {
  return lifecycle === 'pre_execution' ? phase === 'preflight' || phase === 'execute' : phase === 'execute';
}

function sourcePath(source: DeploymentVariableSourceV1): string | undefined {
  if (source.kind === 'asset') return source.path;
  if (source.kind === 'derived') return source.resolver;
  if (source.kind === 'system') return source.key;
  if (source.kind === 'step_output') return `${source.step}.${source.output}`;
  return undefined;
}

function issue(
  category: DeploymentInputIssueV1['category'],
  code: string,
  slot: string,
  path: string,
  bindingLayer?: DeploymentBindingLayerV1,
): DeploymentInputIssueV1 {
  return { category, code, severity: 'ERROR', slot, path, bindingLayer, messageKey: `deploymentInputs.issues.${code}` };
}

function readPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => isRecord(current) ? current[segment] : undefined, input);
}

function endpointUrl(context: DeploymentAssetContextV1): string {
  const protocol = context.application.protocol.toLowerCase();
  const defaultPort = protocol === 'https' ? 443 : protocol === 'http' ? 80 : undefined;
  const port = defaultPort === context.application.port ? '' : `:${context.application.port}`;
  return `${protocol}://${context.application.serverName}${port}`;
}

function authority(context: DeploymentAssetContextV1): string {
  return `${context.application.serverName}:${context.application.port}`;
}

function bindingInformation(context: DeploymentAssetContextV1): string {
  return context.site?.bindingInformation
    ?? context.target?.bindingKey
    ?? `${context.site?.listenIp ?? '*'}:${context.site?.port ?? context.application.port}:${context.site?.hostHeader ?? context.application.serverName}`;
}

function matchesVariableType(definition: DeploymentVariableDefinitionV1, value: unknown): boolean {
  if (definition.type === 'string' || definition.type === 'file') return typeof value === 'string';
  if (definition.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (definition.type === 'boolean') return typeof value === 'boolean';
  if (definition.type === 'array') return Array.isArray(value);
  if (definition.type === 'object') return isRecord(value);
  return definition.enum?.some((item) => Object.is(item, value)) === true;
}

function matchesScalarType(type: DeploymentConnectionFieldV1['type'], value: unknown): boolean {
  return typeof value === type && (type !== 'number' || Number.isFinite(value));
}

function isValidConnectionHost(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const host = value.trim();
  if (!host || /^\d+$/.test(host) || /\s|\//.test(host) || /^(?:https?|ssh):\/\//i.test(host)) return false;
  return /^[a-z0-9][a-z0-9._:-]*$/i.test(host);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
