import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import type { CapabilityDeclaration, CapabilityRequirement } from '../../shared/contracts/capability-contracts.js';
import { CompatibilityCatalogError, type AdapterKind, type AdapterManifest } from '../../shared/contracts/adapter-contracts.js';
import { AdapterRegistry } from './domain/adapter-registry.js';
import { AdapterResolver } from './domain/adapter-resolver.js';
import { parseAdapterManifest } from './domain/adapter-manifest.schema.js';
import { CompatibilityCatalogResolver } from './domain/compatibility-catalog.resolver.js';
import { buildCompatibilityMatrix } from './domain/compatibility-matrix.js';
import { parseCompatibilityProfile } from './domain/compatibility-profile.schema.js';
import { loadCompatibilityCatalog } from './infrastructure/compatibility-catalog.loader.js';

describe('Adapter Manifest 与 Registry', () => {
  it('拒绝非法类型和重复注册', () => {
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

  it('列表和版本查询不依赖注册顺序', () => {
    const first = parseAdapterManifest(manifest('product.one', 'product', 'agent.full.online', 10, '1.0'));
    const second = parseAdapterManifest(manifest('product.one', 'product', 'agent.full.online', 10, '2.0'));
    const registry = new AdapterRegistry([second, first]);
    assert.deepEqual(registry.list('product').map((item) => item.version), ['2.0', '1.0']);
    assert.equal(registry.get('product', 'product.one')?.version, '2.0');
    assert.equal(registry.get('product', 'product.one', '1.0')?.version, '1.0');
  });
});

describe('Adapter Resolver', () => {
  it('相同输入在不同注册顺序下得到稳定结果', () => {
    const low = parseAdapterManifest(manifest('transport.low', 'transport', 'agent.task.receive', 10));
    const high = parseAdapterManifest(manifest('transport.high', 'transport', 'agent.task.receive', 20));
    const declarations = [declaration('agent.task.receive')];
    const left = new AdapterResolver(new AdapterRegistry([low, high])).resolve(request(['transport'], declarations));
    const right = new AdapterResolver(new AdapterRegistry([high, low])).resolve(request(['transport'], declarations));
    assert.equal(left.status, 'resolved');
    assert.equal(left.selected.transport?.adapterId, 'transport.high');
    assert.equal(right.selected.transport?.adapterId, 'transport.high');
  });

  it('不静默选择同级候选', () => {
    const left = parseAdapterManifest(manifest('transport.left', 'transport', 'agent.task.receive', 10));
    const right = parseAdapterManifest(manifest('transport.right', 'transport', 'agent.task.receive', 10));
    const result = new AdapterResolver(new AdapterRegistry([right, left])).resolve(request(['transport'], [declaration('agent.task.receive')]));
    assert.equal(result.status, 'ambiguous');
    assert.deepEqual(result.conflicts[0]?.adapterIds, ['transport.left@1.0', 'transport.right@1.0']);
  });

  it('缺少能力时返回 blocked 和解释', () => {
    const adapter = parseAdapterManifest(manifest('verifier.tls', 'verifier', 'tls.remote_probe', 10));
    const result = new AdapterResolver(new AdapterRegistry([adapter])).resolve(request(['verifier'], []));
    assert.equal(result.status, 'blocked');
    assert.equal(result.missingCapabilities[0]?.capabilityKey, 'tls.remote_probe');
    assert.ok(result.evidence.some((item) => item.code === 'ADAPTER_NOT_FOUND'));
  });
});

describe('Compatibility Profile 与目录', () => {
  it('拒绝没有证据的非 unsupported Profile', () => {
    assert.throws(
      () => parseCompatibilityProfile({
        ...profile(),
        evidence: [],
      }),
      (error: unknown) => error instanceof CompatibilityCatalogError && error.errorCode === 'COMPATIBILITY_PROFILE_INVALID',
    );
  });

  it('仅通过目录、Profile 和 Capability 解析 Windows IIS 组合', () => {
    const root = resolve(process.cwd(), '..', 'compatibility');
    const catalog = loadCompatibilityCatalog(root);
    const profileItem = catalog.profiles.find((item) => item.profileId === 'windows-modern-iis');
    assert.ok(profileItem);
    const declarations = [
      declaration('agent.full.online'),
      declaration('agent.task.receive'),
      declaration('tls.local_verify'),
      declaration('windows.certstore.import_pfx'),
      declaration('iis.binding.update'),
      declaration('service.restart'),
      declaration('tls.remote_probe'),
      declaration('rollback.restore'),
    ];
    const result = new CompatibilityCatalogResolver(new AdapterResolver(catalog.registry))
      .resolve(profileItem, declarations, '1.0');
    assert.equal(result.resolution.status, 'resolved');
    assert.equal(result.resolution.selected.product?.adapterId, 'product.iis-apphost');
    assert.equal(result.resolution.selected.transport?.adapterId, 'transport.agent-local');
  });

  it('兼容版 Windows IIS Profile 仅凭 Capability 解析相同产品组合', () => {
    const root = resolve(process.cwd(), '..', 'compatibility');
    const catalog = loadCompatibilityCatalog(root);
    const profileItem = catalog.profiles.find((item) => item.profileId === 'windows-compatibility-iis');
    assert.ok(profileItem);
    const declarations = [
      declaration('agent.full.online'),
      declaration('runtime.windows.compatibility_agent'),
      declaration('agent.task.receive'),
      declaration('tls.local_verify'),
      declaration('windows.certstore.import_pfx'),
      declaration('iis.binding.update'),
      declaration('service.restart'),
      declaration('tls.remote_probe'),
      declaration('rollback.restore'),
    ];
    const result = new CompatibilityCatalogResolver(new AdapterResolver(catalog.registry))
      .resolve(profileItem, declarations, '1.0');
    assert.equal(result.resolution.status, 'resolved');
    assert.equal(result.resolution.selected.product?.adapterId, 'product.iis-apphost');
    assert.equal(result.resolution.selected.certificate_store?.adapterId, 'certificate-store.windows');
  });

  it('Profile 能力不满足时在进入适配器选择前阻断', () => {
    const root = resolve(process.cwd(), '..', 'compatibility');
    const catalog = loadCompatibilityCatalog(root);
    const profileItem = catalog.profiles.find((item) => item.profileId === 'windows-modern-iis');
    assert.ok(profileItem);
    const result = new CompatibilityCatalogResolver(new AdapterResolver(catalog.registry))
      .resolve(profileItem, [declaration('agent.full.online')], '1.0');
    assert.equal(result.resolution.status, 'blocked');
    assert.equal(result.resolution.missingCapabilities[0]?.capabilityKey, 'iis.binding.update');
  });

  it('矩阵是 Profile 的稳定投影', () => {
    const root = resolve(process.cwd(), '..', 'compatibility');
    const catalog = loadCompatibilityCatalog(root);
    const matrix = buildCompatibilityMatrix([...catalog.profiles].reverse());
    assert.deepEqual(matrix.map((item) => item.profileId), ['windows-compatibility-iis', 'windows-modern-iis']);
    assert.equal(matrix[1]?.composition.product, 'product.iis-apphost');
    assert.deepEqual(matrix[1]?.evidenceReferences, ['backend/src/modules/compatibility-catalog/compatibility-catalog.test.ts']);
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

function request(requiredKinds: AdapterKind[], declarations: CapabilityDeclaration[]) {
  return { actionSchemaVersion: '1.0', requiredKinds, declarations };
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

function declaration(capabilityKey: string): CapabilityDeclaration {
  return {
    id: `declaration.${capabilityKey}`,
    tenantId: 'default',
    targetType: 'execution_target',
    targetId: 'target_1',
    capabilityKey,
    originalCapabilityKey: capabilityKey,
    value: true,
    parameters: {},
    source: 'agent_report',
    confidence: 100,
    riskLevel: 'low',
    status: 'active',
  };
}
