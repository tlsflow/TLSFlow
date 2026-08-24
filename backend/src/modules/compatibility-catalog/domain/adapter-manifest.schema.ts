import { CapabilityRiskLevels } from '../../../shared/enums/core.enums.js';
import {
  ADAPTER_MANIFEST_API_VERSION,
  AdapterKinds,
  CompatibilityCatalogError,
  type AdapterManifest,
} from '../../../shared/contracts/adapter-contracts.js';
import { CapabilitiesDomainService } from '../../capabilities/domain/capabilities.domain-service.js';

const capabilities = new CapabilitiesDomainService();

export function parseAdapterManifest(input: unknown): AdapterManifest {
  const value = requireRecord(input, 'Adapter Manifest');
  if (value.apiVersion !== ADAPTER_MANIFEST_API_VERSION) invalid('apiVersion 只支持 gcac.adapter/v1');
  const adapterId = requireIdentifier(value, 'adapterId');
  const version = requireVersion(value, 'version');
  const kind = requireEnum(value, 'kind', AdapterKinds);
  const requirements = capabilities.normalizeRequirement(value.requirements as AdapterManifest['requirements']);
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts.map((item, index) => normalizeConflict(requirements, item, index))
    : invalid('conflicts 必须是数组');
  return {
    apiVersion: ADAPTER_MANIFEST_API_VERSION,
    adapterId,
    version,
    kind,
    consumes: requireStringArray(value, 'consumes'),
    produces: requireStringArray(value, 'produces'),
    requirements,
    conflicts,
    priority: requireInteger(value, 'priority', -1000, 1000),
    riskLevel: requireEnum(value, 'riskLevel', CapabilityRiskLevels),
    supportedOperationSchemas: requireVersionArray(value, 'supportedOperationSchemas'),
    deprecated: optionalBoolean(value, 'deprecated'),
    replacedBy: optionalString(value, 'replacedBy'),
  };
}

function normalizeConflict(requirement: AdapterManifest['requirements'], input: unknown, index: number) {
  const normalized = capabilities.normalizeRequirement({
    ...requirement,
    id: `${requirement.id}:conflict:${index}`,
    requiredAll: [input as AdapterManifest['conflicts'][number]],
    optional: [],
    anyOfGroups: [],
    forbidden: [],
  });
  return normalized.requiredAll[0];
}

function requireRecord(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(`${field} 必须是对象`);
  return input as Record<string, unknown>;
}

function requireIdentifier(input: Record<string, unknown>, field: string): string {
  const value = requireString(input, field);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value)) invalid(`${field} 格式无效`);
  return value;
}

function requireVersion(input: Record<string, unknown>, field: string): string {
  const value = requireString(input, field);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(value)) invalid(`${field} 必须使用数字版本`);
  return value;
}

function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') invalid(`${field} 必须是非空字符串`);
  return value;
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  if (input[field] === undefined) return undefined;
  return requireString(input, field);
}

function optionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(`${field} 必须是布尔值`);
  return value;
}

function requireStringArray(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) invalid(`${field} 必须是非空字符串数组`);
  return [...new Set(value)].sort();
}

function requireVersionArray(input: Record<string, unknown>, field: string): string[] {
  const values = requireStringArray(input, field);
  if (values.length === 0 || values.some((item) => !/^\d+\.\d+(?:\.\d+)?$/.test(item))) invalid(`${field} 必须包含有效数字版本`);
  return values;
}

function requireInteger(input: Record<string, unknown>, field: string, minimum: number, maximum: number): number {
  const value = input[field];
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(`${field} 必须位于 ${minimum}-${maximum}`);
  return value as number;
}

function requireEnum<T extends string>(input: Record<string, unknown>, field: string, values: readonly T[]): T {
  const value = input[field];
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(`${field} 不在允许范围内`);
  return value as T;
}

function invalid(message: string): never {
  throw new CompatibilityCatalogError('ADAPTER_MANIFEST_INVALID', message);
}
