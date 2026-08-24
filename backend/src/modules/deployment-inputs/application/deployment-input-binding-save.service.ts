import type { DeploymentAssetContextV1 } from '../dto/deployment-asset-context.dto.js';
import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from '../dto/input-bindings.dto.js';
import type { DeploymentInputIssueV1, ResolvedDeploymentInputV1 } from '../dto/resolved-deployment-input.dto.js';
import { UnifiedDeploymentInputResolver } from '../domain/unified-deployment-input.resolver.js';
import { EffectiveBindingResolver, type VersionedInputBindingLayerV1 } from './effective-binding.resolver.js';

export interface ValidateDeploymentInputBindingSaveRequest {
  pluginVersionId: string;
  contract: DeploymentInputContractV1;
  assetContext: DeploymentAssetContextV1;
  deviceDefault?: VersionedInputBindingLayerV1;
  targetOverride?: VersionedInputBindingLayerV1;
  currentAssetOverride?: VersionedInputBindingLayerV1;
  submitted: InputBindingsV1;
}

export interface ValidatedDeploymentInputBindingSaveV1 {
  assetOverride: InputBindingsV1;
  resolved: ResolvedDeploymentInputV1;
  issues: DeploymentInputIssueV1[];
  saveable: boolean;
}

export class DeploymentInputBindingSaveService {
  constructor(
    private readonly effectiveBindings = new EffectiveBindingResolver(),
    private readonly inputs = new UnifiedDeploymentInputResolver(),
  ) {}

  validate(request: ValidateDeploymentInputBindingSaveRequest): ValidatedDeploymentInputBindingSaveV1 {
    const filtered = filterSubmittedBindings(request.contract, request.submitted);
    const current = request.currentAssetOverride?.pluginVersionId === request.pluginVersionId
      ? request.currentAssetOverride.inputBindings
      : emptyInputBindingsV1();
    const assetOverride = mergeBindingPatch(current, filtered.inputBindings);
    const effectiveBinding = this.effectiveBindings.resolve({
      contract: request.contract,
      deviceDefault: request.deviceDefault,
      targetOverride: request.targetOverride,
      assetOverride: { pluginVersionId: request.pluginVersionId, inputBindings: assetOverride },
    });
    const resolved = this.inputs.resolve({
      phase: 'save',
      contract: request.contract,
      assetContext: request.assetContext,
      effectiveBinding,
    });
    const issues = [...filtered.issues, ...resolved.issues];
    return { assetOverride, resolved: { ...resolved, issues, executable: issues.every((issue) => issue.severity !== 'ERROR') }, issues, saveable: issues.every((issue) => issue.severity !== 'ERROR') };
  }
}

function filterSubmittedBindings(contract: DeploymentInputContractV1, submitted: InputBindingsV1): { inputBindings: InputBindingsV1; issues: DeploymentInputIssueV1[] } {
  const output = emptyInputBindingsV1();
  const issues: DeploymentInputIssueV1[] = [];
  for (const [slot, value] of Object.entries(submitted.variables)) {
    const definition = contract.variables[slot];
    if (!definition) issues.push(saveIssue('VARIABLE', 'DEPLOYMENT_INPUT_SLOT_UNDECLARED', slot, `variables.${slot}`));
    else if (definition.bindingPolicy === 'fixed' || definition.configurationMode === 'runtime') issues.push(saveIssue('VARIABLE', 'DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN', slot, `variables.${slot}`));
    else output.variables[slot] = structuredClone(value);
  }
  for (const [slot, value] of Object.entries(submitted.connections)) {
    const definition = contract.connections[slot];
    if (!definition) {
      issues.push(saveIssue('CONNECTION', 'DEPLOYMENT_INPUT_SLOT_UNDECLARED', slot, `connections.${slot}`));
      continue;
    }
    const allowed: Record<string, unknown> = {};
    for (const [path, fieldValue] of connectionEntries(value)) {
      const field = connectionDefinitionField(definition, path);
      if (!field) issues.push(saveIssue('CONNECTION', 'DEPLOYMENT_INPUT_FIELD_UNDECLARED', slot, `connections.${slot}.${path}`));
      else if (field.bindingPolicy === 'fixed' || field.configurationMode === 'runtime') issues.push(saveIssue('CONNECTION', 'DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN', slot, `connections.${slot}.${path}`));
      else setPath(allowed, path, fieldValue);
    }
    if (Object.keys(allowed).length > 0) output.connections[slot] = allowed as never;
  }
  for (const [slot, value] of Object.entries(submitted.credentials)) {
    if (!contract.credentials[slot]) issues.push(saveIssue('CREDENTIAL', 'DEPLOYMENT_INPUT_SLOT_UNDECLARED', slot, `credentials.${slot}`));
    else output.credentials[slot] = structuredClone(value);
  }
  for (const [slot, value] of Object.entries(submitted.artifacts)) {
    if (!contract.artifacts[slot]) issues.push(saveIssue('ARTIFACT', 'DEPLOYMENT_INPUT_SLOT_UNDECLARED', slot, `artifacts.${slot}`));
    else output.artifacts[slot] = structuredClone(value);
  }
  return { inputBindings: output, issues };
}

function mergeBindingPatch(current: InputBindingsV1, patch: InputBindingsV1): InputBindingsV1 {
  const merged = structuredClone(current);
  Object.assign(merged.variables, patch.variables);
  Object.assign(merged.credentials, patch.credentials);
  Object.assign(merged.artifacts, patch.artifacts);
  for (const [slot, connection] of Object.entries(patch.connections)) {
    merged.connections[slot] = deepMerge(merged.connections[slot] ?? {}, connection) as never;
  }
  return merged;
}

function connectionEntries(value: unknown, prefix = ''): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [[prefix, value]] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === 'object' && !Array.isArray(child) ? connectionEntries(child, path) : [[path, child]];
  });
}

function connectionDefinitionField(definition: DeploymentInputContractV1['connections'][string], path: string) {
  if (path === 'host') return definition.host;
  if (path === 'port') return definition.port;
  if (path === 'username') return definition.username;
  if (path === 'tls.verifyPeer') return definition.tls?.verifyPeer;
  if (path === 'tls.serverName') return definition.tls?.serverName;
  if (path === 'hostKey.expectedFingerprint') return definition.hostKey?.expectedFingerprint;
  return undefined;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown> ?? (current[part] = {}) as Record<string, unknown>;
  current[parts.at(-1)!] = structuredClone(value);
}

function deepMerge(base: unknown, overrideValue: unknown): unknown {
  if (!base || typeof base !== 'object' || Array.isArray(base) || !overrideValue || typeof overrideValue !== 'object' || Array.isArray(overrideValue)) return structuredClone(overrideValue);
  const result = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrideValue as Record<string, unknown>)) result[key] = deepMerge(result[key], value);
  return result;
}

function saveIssue(category: DeploymentInputIssueV1['category'], code: string, slot: string, path: string): DeploymentInputIssueV1 {
  return { category, code, severity: 'ERROR', slot, path, bindingLayer: 'APPLICATION_ASSET', messageKey: `deploymentInputs.issues.${code}` };
}
