import { AppError } from '../../../common/errors/app-error.js';
import type { StandardDeviceDiscoveryV2 } from './device-discovery.dto.js';

const limits = { capabilities: 100, frameworks: 200, sites: 5000, managedTargets: 10000, certificates: 10000, certificateBindings: 20000, warnings: 500 } as const;
const forbiddenKeyPattern = /(password|secret|token|private[_-]?key|authorization|cookie)/i;
const allowedPathKeys = new Set(['privateKeyPath']);
const executionLocations = new Set(['AGENT', 'CONTROL_PLANE', 'GATEWAY']);

export class DeviceDiscoverySchemaService {
  validate(value: unknown): StandardDeviceDiscoveryV2 {
    if (!isRecord(value) || !isRecord(value.device)) throw invalidSchema();
    if (value.apiVersion !== 'gcac.device-discovery/v2') {
      throw new AppError('VALIDATION_FAILED', '仅支持 gcac.device-discovery/v2', { code: 'DISCOVERY_SCHEMA_UNSUPPORTED', apiVersion: value.apiVersion });
    }
    const result = value as unknown as StandardDeviceDiscoveryV2;
    requireStableKey(result.device.stableKey, 'device.stableKey');
    for (const [collectionName, maximum] of Object.entries(limits)) assertCollection(result, collectionName as keyof typeof limits, maximum);
    assertUnique(result.frameworks, 'frameworks');
    assertUnique(result.sites, 'sites');
    assertUnique(result.managedTargets, 'managedTargets');
    assertUnique(result.certificates, 'certificates');
    assertUnique(result.certificateBindings, 'certificateBindings');
    const frameworkKeys = new Set(result.frameworks.map((item) => item.stableKey));
    const siteKeys = new Set(result.sites.map((item) => item.stableKey));
    const targetKeys = new Set(result.managedTargets.map((item) => item.stableKey));
    const certificateKeys = new Set(result.certificates.map((item) => item.stableKey));
    for (const framework of result.frameworks) requireNamespace(framework.frameworkType, 'framework.frameworkType');
    for (const site of result.sites) {
      requireNamespace(site.siteType, 'site.siteType');
      if (!frameworkKeys.has(site.frameworkStableKey)) invalidRelation('site.frameworkStableKey', site.frameworkStableKey);
    }
    for (const target of result.managedTargets) {
      requireNamespace(target.targetType, 'managedTarget.targetType');
      requireStableKey(target.targetKey, 'managedTarget.targetKey');
      if (target.frameworkStableKey && !frameworkKeys.has(target.frameworkStableKey)) invalidRelation('managedTarget.frameworkStableKey', target.frameworkStableKey);
      if (target.siteStableKey && !siteKeys.has(target.siteStableKey)) invalidRelation('managedTarget.siteStableKey', target.siteStableKey);
      if (target.siteStableKey && target.frameworkStableKey) {
        const site = result.sites.find((item) => item.stableKey === target.siteStableKey)!;
        if (site.frameworkStableKey !== target.frameworkStableKey) invalidRelation('managedTarget.frameworkStableKey', target.frameworkStableKey);
      }
      if (!Array.isArray(target.supportedCapabilities) || target.supportedCapabilities.length === 0) throw invalidField('managedTarget.supportedCapabilities');
      if (!Array.isArray(target.executionLocations) || target.executionLocations.length === 0 || target.executionLocations.some((item) => !executionLocations.has(item))) throw invalidField('managedTarget.executionLocations');
    }
    for (const binding of result.certificateBindings) {
      if (!targetKeys.has(binding.managedTargetStableKey)) invalidRelation('binding.managedTargetStableKey', binding.managedTargetStableKey);
      if (!certificateKeys.has(binding.certificateStableKey)) invalidRelation('binding.certificateStableKey', binding.certificateStableKey);
    }
    assertNoSecrets(result);
    return structuredClone(result);
  }
}

function assertCollection(result: StandardDeviceDiscoveryV2, collectionName: keyof typeof limits, maximum: number) {
  const collection = result[collectionName];
  if (!Array.isArray(collection)) throw new AppError('VALIDATION_FAILED', '设备发现集合类型不合法', { collection: collectionName, expectedType: 'array', actualType: describeType(collection), maximum });
  if (collection.length > maximum) throw new AppError('VALIDATION_FAILED', '设备发现对象数量越界', { collection: collectionName, expectedType: 'array', actualType: 'array', actualCount: collection.length, maximum });
}

function assertUnique(items: Array<{ stableKey: string }>, collection: string) { const keys = new Set<string>(); for (const item of items) { requireStableKey(item.stableKey, `${collection}.stableKey`); if (keys.has(item.stableKey)) throw new AppError('VALIDATION_FAILED', '设备发现稳定键重复', { collection, stableKey: item.stableKey }); keys.add(item.stableKey); } }
function requireStableKey(value: string, path: string) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)) throw invalidField(path); }
function requireNamespace(value: string, path: string) { if (typeof value !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value)) throw invalidField(path); }
function invalidRelation(path: string, stableKey: string): never {
  throw new AppError('VALIDATION_FAILED', '设备发现父子关系不存在', { code: 'DISCOVERY_RELATION_INVALID', path, stableKey });
}
function invalidSchema(): never { throw new AppError('VALIDATION_FAILED', '设备发现结果 Schema 不合法', { code: 'DISCOVERY_SCHEMA_INVALID' }); }
function invalidField(path: string): never { throw new AppError('VALIDATION_FAILED', '设备发现字段不合法', { code: 'DISCOVERY_SCHEMA_INVALID', path }); }
function assertNoSecrets(value: unknown, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key) && !allowedPathKeys.has(key)) {
      throw new AppError('VALIDATION_FAILED', '设备发现结果包含敏感字段', { path: `${path}.${key}` });
    }
    if (allowedPathKeys.has(key) && !isSafePathValue(child)) {
      throw new AppError('VALIDATION_FAILED', '设备发现结果包含敏感字段', { path: `${path}.${key}` });
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}
function isSafePathValue(value: unknown): boolean {
  return typeof value === 'string'
    && value.trim().length > 0
    && !/[\r\n]/.test(value)
    && !/-----BEGIN [^-]*PRIVATE KEY-----/i.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function describeType(value: unknown): string { if (value === null) return 'null'; if (Array.isArray(value)) return 'array'; return typeof value; }
