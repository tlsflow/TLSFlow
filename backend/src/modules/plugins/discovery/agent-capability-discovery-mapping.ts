import { AppError } from '../../../common/errors/app-error.js';

export interface AgentCapabilityDiscoveryMappingV1 {
  apiVersion: 'gcac.agent-discovery-mapping/v1';
  kind: 'AgentCapabilityDiscoveryMapping';
  pluginId: string;
  capabilityKey: string;
  projection: {
    shape: 'web_sites' | 'connectors';
    frameworkType: string;
    displayName: string;
    targetType: string;
    targetTypeWhenFieldPresent?: { field: string; value: string };
    deployCapability: string;
    fallbackHostHeaderToSiteName?: boolean;
  };
}

const namespacePattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_-]*)+$/;

export function validateAgentCapabilityDiscoveryMapping(input: unknown): AgentCapabilityDiscoveryMappingV1 {
  const root = record(input, 'discoveryMapping');
  rejectUnknown(root, new Set(['apiVersion', 'kind', 'pluginId', 'capabilityKey', 'projection']), 'discoveryMapping');
  if (root.apiVersion !== 'gcac.agent-discovery-mapping/v1') fail('discoveryMapping.apiVersion');
  if (root.kind !== 'AgentCapabilityDiscoveryMapping') fail('discoveryMapping.kind');
  const projection = record(root.projection, 'discoveryMapping.projection');
  rejectUnknown(projection, new Set(['shape', 'frameworkType', 'displayName', 'targetType', 'targetTypeWhenFieldPresent', 'deployCapability', 'fallbackHostHeaderToSiteName']), 'discoveryMapping.projection');
  const shape = stringValue(projection.shape, 'discoveryMapping.projection.shape');
  if (shape !== 'web_sites' && shape !== 'connectors') fail('discoveryMapping.projection.shape');
  const frameworkType = namespaceValue(projection.frameworkType, 'discoveryMapping.projection.frameworkType');
  const targetType = namespaceValue(projection.targetType, 'discoveryMapping.projection.targetType');
  const deployCapability = namespaceValue(projection.deployCapability, 'discoveryMapping.projection.deployCapability');
  const targetTypeWhenFieldPresent = projection.targetTypeWhenFieldPresent === undefined
    ? undefined
    : validateTargetTypeOverride(projection.targetTypeWhenFieldPresent);
  if (projection.fallbackHostHeaderToSiteName !== undefined && typeof projection.fallbackHostHeaderToSiteName !== 'boolean') {
    fail('discoveryMapping.projection.fallbackHostHeaderToSiteName');
  }
  return {
    apiVersion: 'gcac.agent-discovery-mapping/v1',
    kind: 'AgentCapabilityDiscoveryMapping',
    pluginId: namespaceValue(root.pluginId, 'discoveryMapping.pluginId'),
    capabilityKey: namespaceValue(root.capabilityKey, 'discoveryMapping.capabilityKey'),
    projection: {
      shape,
      frameworkType,
      displayName: stringValue(projection.displayName, 'discoveryMapping.projection.displayName'),
      targetType,
      targetTypeWhenFieldPresent,
      deployCapability,
      fallbackHostHeaderToSiteName: projection.fallbackHostHeaderToSiteName as boolean | undefined,
    },
  };
}

function validateTargetTypeOverride(value: unknown): { field: string; value: string } {
  const override = record(value, 'discoveryMapping.projection.targetTypeWhenFieldPresent');
  rejectUnknown(override, new Set(['field', 'value']), 'discoveryMapping.projection.targetTypeWhenFieldPresent');
  const field = stringValue(override.field, 'discoveryMapping.projection.targetTypeWhenFieldPresent.field');
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(field)) fail('discoveryMapping.projection.targetTypeWhenFieldPresent.field');
  return { field, value: namespaceValue(override.value, 'discoveryMapping.projection.targetTypeWhenFieldPresent.value') };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path);
  return value.trim();
}

function namespaceValue(value: unknown, path: string): string {
  const normalized = stringValue(value, path);
  if (!namespacePattern.test(normalized)) fail(path);
  return normalized;
}

function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new AppError('VALIDATION_FAILED', 'Agent 发现映射包含未知字段', { path, unknown });
}

function fail(path: string): never {
  throw new AppError('VALIDATION_FAILED', 'Agent 发现映射不合法', { path });
}
