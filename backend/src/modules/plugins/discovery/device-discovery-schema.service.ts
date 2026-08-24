import { AppError } from '../../../common/errors/app-error.js';
import type { StandardDeviceDiscoveryV1 } from './device-discovery.dto.js';

const limits = { capabilities: 100, frameworks: 200, sites: 5000, certificates: 10000, certificateBindings: 20000, warnings: 500 } as const;
const forbiddenKeyPattern = /(password|secret|token|private[_-]?key|authorization|cookie)/i;

export class DeviceDiscoverySchemaService {
  validate(value: unknown): StandardDeviceDiscoveryV1 {
    if (!isRecord(value) || value.apiVersion !== 'gcac.device-discovery/v1' || !isRecord(value.device)) {
      throw new AppError('VALIDATION_FAILED', '设备发现结果 Schema 不合法');
    }
    const result = value as unknown as StandardDeviceDiscoveryV1;
    requireStableKey(result.device.stableKey, 'device.stableKey');
    for (const [collectionName, maximum] of Object.entries(limits)) {
      const collection = result[collectionName as keyof typeof limits];
      if (!Array.isArray(collection)) {
        throw new AppError('VALIDATION_FAILED', '设备发现集合类型不合法', {
          collection: collectionName,
          expectedType: 'array',
          actualType: describeType(collection),
          maximum,
        });
      }
      if (collection.length > maximum) {
        throw new AppError('VALIDATION_FAILED', '设备发现对象数量越界', {
          collection: collectionName,
          expectedType: 'array',
          actualType: 'array',
          actualCount: collection.length,
          maximum,
        });
      }
    }
    assertUnique(result.frameworks, 'frameworks');
    assertUnique(result.sites, 'sites');
    assertUnique(result.certificates, 'certificates');
    assertUnique(result.certificateBindings, 'certificateBindings');
    const frameworkKeys = new Set(result.frameworks.map((item) => item.stableKey));
    const siteKeys = new Set(result.sites.map((item) => item.stableKey));
    const certificateKeys = new Set(result.certificates.map((item) => item.stableKey));
    for (const site of result.sites) {
      if (site.frameworkStableKey && !frameworkKeys.has(site.frameworkStableKey)) invalidRelation('site.frameworkStableKey', site.frameworkStableKey);
    }
    for (const binding of result.certificateBindings) {
      if (!siteKeys.has(binding.siteStableKey)) invalidRelation('binding.siteStableKey', binding.siteStableKey);
      if (!certificateKeys.has(binding.certificateStableKey)) invalidRelation('binding.certificateStableKey', binding.certificateStableKey);
    }
    assertNoSecrets(result);
    return structuredClone(result);
  }
}

function assertUnique(items: Array<{ stableKey: string }>, collection: string) {
  const keys = new Set<string>();
  for (const item of items) {
    requireStableKey(item.stableKey, `${collection}.stableKey`);
    if (keys.has(item.stableKey)) throw new AppError('VALIDATION_FAILED', '设备发现稳定键重复', { collection, stableKey: item.stableKey });
    keys.add(item.stableKey);
  }
}

function requireStableKey(value: string, path: string) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)) {
    throw new AppError('VALIDATION_FAILED', '设备发现稳定键不合法', { path });
  }
}

function invalidRelation(path: string, stableKey: string): never {
  throw new AppError('VALIDATION_FAILED', '设备发现父子关系不存在', { path, stableKey });
}

function assertNoSecrets(value: unknown, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) throw new AppError('VALIDATION_FAILED', '设备发现结果包含敏感字段', { path: `${path}.${key}` });
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
