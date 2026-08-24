import { AppError } from '../../../common/errors/app-error.js';
import type { DeploymentInputContractV1 } from '../dto/deployment-input-contract.dto.js';
import {
  emptyInputBindingsV1,
  INPUT_BINDINGS_API_VERSION,
  type DeploymentArtifactBindingV1,
  type DeploymentConnectionBindingV1,
  type DeploymentCredentialBindingV1,
  type InputBindingsV1,
} from '../dto/input-bindings.dto.js';
import type { DeploymentBindingLayerV1, EffectiveInputBindingV1 } from '../domain/deployment-input-provenance.js';

type PersistentBindingLayer = Exclude<DeploymentBindingLayerV1, 'EXECUTION'>;

export interface VersionedInputBindingLayerV1 {
  pluginVersionId: string;
  inputBindings: InputBindingsV1;
}

export interface ResolveEffectiveBindingRequest {
  contract: DeploymentInputContractV1;
  deviceDefault?: VersionedInputBindingLayerV1;
  targetOverride?: VersionedInputBindingLayerV1;
  assetOverride?: VersionedInputBindingLayerV1;
  executionOverride?: VersionedInputBindingLayerV1;
}

export interface EffectiveBindingIssueV1 {
  code: 'INPUT_BINDING_VERSION_MISMATCH' | 'INPUT_BINDING_SLOT_UNDECLARED' | 'INPUT_BINDING_FIXED_OVERRIDE_FORBIDDEN' | 'INPUT_BINDING_FIELD_UNDECLARED';
  layer: DeploymentBindingLayerV1;
  path: string;
  pluginVersionId: string;
}

export interface ResolvedEffectiveBindingV1 extends EffectiveInputBindingV1 {
  pluginVersionId: string;
  inheritedLayers: PersistentBindingLayer[];
}

interface NamedLayer {
  layer: DeploymentBindingLayerV1;
  value: VersionedInputBindingLayerV1;
}

const PERSISTENT_LAYERS: Array<{ layer: PersistentBindingLayer; key: 'deviceDefault' | 'targetOverride' | 'assetOverride' }> = [
  { layer: 'DEVICE', key: 'deviceDefault' },
  { layer: 'MANAGED_TARGET', key: 'targetOverride' },
  { layer: 'APPLICATION_ASSET', key: 'assetOverride' },
];

export class EffectiveBindingResolver {
  resolve(request: ResolveEffectiveBindingRequest): ResolvedEffectiveBindingV1 {
    const persistentLayers = PERSISTENT_LAYERS.flatMap(({ layer, key }) => {
      const value = request[key];
      return value ? [{ layer, value }] : [];
    });
    const selectedLayer = persistentLayers.at(-1);
    if (!selectedLayer) {
      throw new AppError('VALIDATION_FAILED', '缺少可确定插件版本的持久化 Binding 层');
    }

    const pluginVersionId = selectedLayer.value.pluginVersionId;
    const matchingLayers = persistentLayers.filter((item) => item.value.pluginVersionId === pluginVersionId);
    const layers: NamedLayer[] = [...matchingLayers];
    if (request.executionOverride) layers.push({ layer: 'EXECUTION', value: request.executionOverride });

    const issues = this.validateLayers(request.contract, pluginVersionId, layers);
    if (issues.length > 0) {
      throw new AppError('VALIDATION_FAILED', '输入 Binding 不符合插件输入契约', { issues });
    }

    const effective = emptyInputBindingsV1();
    const provenance: EffectiveInputBindingV1['provenance'] = {};
    for (const item of layers) this.mergeLayer(effective, provenance, item);

    return {
      pluginVersionId,
      inputBindings: effective,
      provenance,
      inheritedLayers: matchingLayers.map((item) => item.layer as PersistentBindingLayer),
    };
  }

  private validateLayers(
    contract: DeploymentInputContractV1,
    pluginVersionId: string,
    layers: NamedLayer[],
  ): EffectiveBindingIssueV1[] {
    const issues: EffectiveBindingIssueV1[] = [];
    for (const { layer, value } of layers) {
      if (value.pluginVersionId !== pluginVersionId) {
        issues.push({ code: 'INPUT_BINDING_VERSION_MISMATCH', layer, path: 'pluginVersionId', pluginVersionId: value.pluginVersionId });
        continue;
      }
      if (value.inputBindings.apiVersion !== INPUT_BINDINGS_API_VERSION) {
        issues.push({ code: 'INPUT_BINDING_FIELD_UNDECLARED', layer, path: 'apiVersion', pluginVersionId });
        continue;
      }
      this.validateSlots(contract, value.inputBindings, layer, pluginVersionId, issues);
    }
    return issues;
  }

  private validateSlots(
    contract: DeploymentInputContractV1,
    bindings: InputBindingsV1,
    layer: DeploymentBindingLayerV1,
    pluginVersionId: string,
    issues: EffectiveBindingIssueV1[],
  ): void {
    for (const [slot, value] of Object.entries(bindings.variables)) {
      if (isEmptyObject(value)) continue;
      const definition = contract.variables[slot];
      if (!definition) issues.push(issue('INPUT_BINDING_SLOT_UNDECLARED', layer, `variables.${slot}`, pluginVersionId));
      else if (definition.bindingPolicy === 'fixed') issues.push(issue('INPUT_BINDING_FIXED_OVERRIDE_FORBIDDEN', layer, `variables.${slot}`, pluginVersionId));
    }
    for (const [slot, value] of Object.entries(bindings.connections)) {
      if (isEmptyObject(value)) continue;
      const definition = contract.connections[slot];
      if (!definition) {
        issues.push(issue('INPUT_BINDING_SLOT_UNDECLARED', layer, `connections.${slot}`, pluginVersionId));
        continue;
      }
      for (const path of connectionLeafPaths(value)) {
        if (!isDeclaredConnectionPath(definition, path)) issues.push(issue('INPUT_BINDING_FIELD_UNDECLARED', layer, `connections.${slot}.${path}`, pluginVersionId));
        else if (connectionField(definition, path)?.bindingPolicy === 'fixed') issues.push(issue('INPUT_BINDING_FIXED_OVERRIDE_FORBIDDEN', layer, `connections.${slot}.${path}`, pluginVersionId));
      }
    }
    validateShallowSlots(bindings.credentials, contract.credentials, 'credentials', layer, pluginVersionId, issues);
    validateShallowSlots(bindings.artifacts, contract.artifacts, 'artifacts', layer, pluginVersionId, issues);
  }

  private mergeLayer(
    effective: InputBindingsV1,
    provenance: EffectiveInputBindingV1['provenance'],
    item: NamedLayer,
  ): void {
    mergeVariables(effective.variables, item.value.inputBindings.variables, provenance, item.layer);
    mergeConnections(effective.connections, item.value.inputBindings.connections, provenance, item.layer);
    mergeShallowSlots(effective.credentials, item.value.inputBindings.credentials, provenance, item.layer, 'credentials');
    mergeShallowSlots(effective.artifacts, item.value.inputBindings.artifacts, provenance, item.layer, 'artifacts');
  }
}

function validateShallowSlots<T>(
  values: Record<string, T>,
  definitions: Record<string, unknown>,
  group: 'credentials' | 'artifacts',
  layer: DeploymentBindingLayerV1,
  pluginVersionId: string,
  issues: EffectiveBindingIssueV1[],
): void {
  for (const [slot, value] of Object.entries(values)) {
    if (isEmptyObject(value)) continue;
    if (!definitions[slot]) issues.push(issue('INPUT_BINDING_SLOT_UNDECLARED', layer, `${group}.${slot}`, pluginVersionId));
  }
}

function mergeVariables(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  provenance: EffectiveInputBindingV1['provenance'],
  layer: DeploymentBindingLayerV1,
): void {
  for (const [slot, value] of Object.entries(source)) {
    if (isEmptyObject(value)) continue;
    target[slot] = clone(value);
    provenance[`variables.${slot}`] = layer;
  }
}

function mergeConnections(
  target: Record<string, DeploymentConnectionBindingV1>,
  source: Record<string, DeploymentConnectionBindingV1>,
  provenance: EffectiveInputBindingV1['provenance'],
  layer: DeploymentBindingLayerV1,
): void {
  for (const [slot, value] of Object.entries(source)) {
    if (isEmptyObject(value)) continue;
    const current = target[slot] ?? {};
    target[slot] = mergeConnection(current, value, `connections.${slot}`, provenance, layer);
  }
}

function mergeConnection(
  target: DeploymentConnectionBindingV1,
  source: DeploymentConnectionBindingV1,
  path: string,
  provenance: EffectiveInputBindingV1['provenance'],
  layer: DeploymentBindingLayerV1,
): DeploymentConnectionBindingV1 {
  const result = clone(target);
  for (const [field, value] of Object.entries(source)) {
    if (value === undefined || isEmptyObject(value)) continue;
    if (isPlainObject(value)) {
      const current = isPlainObject(result[field as keyof DeploymentConnectionBindingV1])
        ? result[field as keyof DeploymentConnectionBindingV1] as Record<string, unknown>
        : {};
      (result as Record<string, unknown>)[field] = mergeConnectionObject(current, value, `${path}.${field}`, provenance, layer);
      continue;
    }
    (result as Record<string, unknown>)[field] = clone(value);
    provenance[`${path}.${field}`] = layer;
  }
  return result;
}

function mergeConnectionObject(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  path: string,
  provenance: EffectiveInputBindingV1['provenance'],
  layer: DeploymentBindingLayerV1,
): Record<string, unknown> {
  const result = clone(target);
  for (const [field, value] of Object.entries(source)) {
    if (value === undefined || isEmptyObject(value)) continue;
    result[field] = clone(value);
    provenance[`${path}.${field}`] = layer;
  }
  return result;
}

function mergeShallowSlots<T extends DeploymentCredentialBindingV1 | DeploymentArtifactBindingV1>(
  target: Record<string, T>,
  source: Record<string, T>,
  provenance: EffectiveInputBindingV1['provenance'],
  layer: DeploymentBindingLayerV1,
  group: 'credentials' | 'artifacts',
): void {
  for (const [slot, value] of Object.entries(source)) {
    if (isEmptyObject(value)) continue;
    target[slot] = clone(value);
    provenance[`${group}.${slot}`] = layer;
    for (const leaf of leafPaths(value)) provenance[`${group}.${slot}.${leaf}`] = layer;
  }
}

function connectionLeafPaths(value: DeploymentConnectionBindingV1): string[] {
  return leafPaths(value);
}

function leafPaths(value: unknown, prefix = ''): string[] {
  if (!isPlainObject(value)) return prefix ? [prefix] : [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || isEmptyObject(child)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child)) paths.push(...leafPaths(child, path));
    else paths.push(path);
  }
  return paths;
}

function isDeclaredConnectionPath(definition: DeploymentInputContractV1['connections'][string], path: string): boolean {
  return connectionField(definition, path) !== undefined;
}

function connectionField(definition: DeploymentInputContractV1['connections'][string], path: string) {
  if (path === 'host') return definition.host;
  if (path === 'port') return definition.port;
  if (path === 'username') return definition.username;
  if (path === 'tls.verifyPeer') return definition.tls?.verifyPeer;
  if (path === 'tls.serverName') return definition.tls?.serverName;
  if (path === 'hostKey.expectedFingerprint') return definition.hostKey?.expectedFingerprint;
  return undefined;
}

function issue(
  code: EffectiveBindingIssueV1['code'],
  layer: DeploymentBindingLayerV1,
  path: string,
  pluginVersionId: string,
): EffectiveBindingIssueV1 {
  return { code, layer, path, pluginVersionId };
}

function isEmptyObject(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value).length === 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
