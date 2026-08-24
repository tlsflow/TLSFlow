import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import type { CapabilityRequirement } from '../../shared/contracts/capability-contracts.js';
import { CompatibilityCatalogError, type AdapterKind } from '../../shared/contracts/adapter-contracts.js';
import { AdapterRegistry } from './domain/adapter-registry.js';
import { parseAdapterManifest } from './domain/adapter-manifest.schema.js';
import { buildCompatibilityMatrix } from './domain/compatibility-matrix.js';
import { parseCompatibilityProfile } from './domain/compatibility-profile.schema.js';
import { loadCompatibilityCatalog } from './infrastructure/compatibility-catalog.loader.js';

describe('Compatibility Catalog 生产发布链', () => {
  it('Adapter Manifest 拒绝非法类型和重复注册', () => {
    assert.throws(
      () => parseAdapterManifest({ ...manifest('product.one', 'product', 'agent.full.online'), kind: 'windows' }),
      (error: unknown) => error instanceof CompatibilityCatalogError && error.errorCode === 'ADAPTER_MANIFEST_INVALID',
    );
    const parsed = parseAdapterManifest(manifest('product.one', 'product', 'agent.full.online'));
    assert.throws(
      () => new AdapterRegistry([parsed, parsed]),
      (error: unknown) => error instanceof CompatibilityCatalogError && error.errorCode === 'ADAPTER_REGISTRATION_CONFLICT',
    );
  });

  it('Registry 列表和版本查询不依赖注册顺序', () => {
    const first = parseAdapterManifest(manifest('product.one', 'product', 'agent.full.online', 10, '1.0'));
    const second = parseAdapterManifest(manifest('product.one', 'product', 'agent.full.online', 10, '2.0'));
    const registry = new AdapterRegistry([second, first]);
    assert.deepEqual(registry.list('product').map((item) => item.version), ['2.0', '1.0']);
    assert.equal(registry.get('product', 'product.one')?.version, '2.0');
    assert.equal(registry.get('product', 'product.one', '1.0')?.version, '1.0');
  });

  it('Profile 拒绝没有证据的非 unsupported 状态', () => {
    assert.throws(
      () => parseCompatibilityProfile({ ...profile(), evidence: [] }),
      (error: unknown) => error instanceof CompatibilityCatalogError && error.errorCode === 'COMPATIBILITY_PROFILE_INVALID',
    );
  });

  it('目录矩阵是 Profile 的稳定只读投影', () => {
    const catalog = loadCompatibilityCatalog(resolve(process.cwd(), '..', 'compatibility'));
    const matrix = buildCompatibilityMatrix([...catalog.profiles].reverse());
    assert.deepEqual(matrix.map((item) => item.profileId), [
      'linux-openrc-nginx',
      'linux-systemd-apache',
      'linux-systemd-nginx',
      'linux-systemd-tomcat-pem',
      'linux-systemd-tomcat-pkcs12',
      'linux-sysv-apache',
      'windows-compatibility-iis',
      'windows-modern-iis',
    ]);
    assert.equal(matrix.find((item) => item.profileId === 'linux-systemd-nginx')?.composition.product, 'product.nginx');
    assert.equal(matrix.find((item) => item.profileId === 'windows-modern-iis')?.composition.product, 'product.iis-apphost');
  });
});

function manifest(adapterId: string, kind: AdapterKind, capabilityKey: string, priority = 10, version = '1.0'): Record<string, unknown> {
  return {
    apiVersion: 'gcac.adapter/v1',
    adapterId,
    version,
    kind,
    consumes: [],
    produces: [],
    requirements: requirement(`${adapterId}.requirement`, capabilityKey),
    conflicts: [],
    priority,
    riskLevel: 'low',
    supportedOperationSchemas: ['1.0'],
  };
}

function profile(): Record<string, unknown> {
  return {
    apiVersion: 'gcac.compatibility/v1',
    profileId: 'example.profile',
    version: '1.0',
    status: 'experimental',
    match: requirement('example.profile.match', 'agent.full.online'),
    composition: { product: 'product.one' },
    automation: 'full',
    rollbackRequired: true,
    verificationRequired: true,
    limitations: [],
    evidence: [{ evidenceId: 'fixture.example', type: 'fixture', status: 'passed', reference: 'fixture/example', observedAt: '2026-07-21T00:00:00.000Z' }],
  };
}

function requirement(id: string, capabilityKey: string): CapabilityRequirement {
  return {
    id,
    ownerType: 'provider_action',
    ownerId: id,
    requiredAll: [{ capabilityKey, operator: 'equals', expected: true, reason: '测试要求', riskIfMissing: '测试阻断' }],
    optional: [],
    anyOfGroups: [],
    forbidden: [],
    minConfidence: 80,
    allowManual: false,
    riskLevel: 'high',
  };
}
