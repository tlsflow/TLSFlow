import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { CompatibilityCatalogError } from '../../shared/contracts/adapter-contracts.js';
import { parseCertificationRecord } from './domain/certification-record.schema.js';
import { CompatibilityGovernanceRegistry } from './domain/compatibility-governance-registry.js';
import { parseCompatibilityProfileV2 } from './domain/compatibility-profile-v2.schema.js';
import { assertProfileV1V2Equivalent, projectCompatibilityProfileV2 } from './domain/compatibility-profile-v2.projection.js';
import { parseExecutionRecipe } from './domain/execution-recipe.schema.js';
import { parseRuntimeBaseline } from './domain/runtime-baseline.schema.js';
import { loadCompatibilityCatalog } from './infrastructure/compatibility-catalog.loader.js';

const compatibilityRoot = resolve(process.cwd(), '..', 'compatibility');

describe('兼容性治理对象', () => {
  it('加载全部 v1/v2 对象并保持稳定顺序', () => {
    const catalog = loadCompatibilityCatalog(compatibilityRoot);
    assert.equal(catalog.profiles.length, 8);
    assert.equal(catalog.profilesV2.length, 8);
    assert.equal(catalog.baselines.length, 3);
    assert.equal(catalog.recipes.length, 8);
    assert.equal(catalog.certifications.length, 8);
    assert.deepEqual(catalog.baselines.map((item) => item.baselineId), [
      'linux-go-full-agent',
      'windows-compatibility-agent',
      'windows-modern-agent',
    ]);
  });

  it('四类 Parser 拒绝未知字段和非法引用', () => {
    assert.throws(
      () => parseRuntimeBaseline(readFixture('runtime-baseline.invalid-unknown-field.json')),
      hasCode('COMPATIBILITY_BASELINE_INVALID'),
    );
    assert.throws(
      () => parseExecutionRecipe(readFixture('execution-recipe.invalid-latest-version.json')),
      hasCode('COMPATIBILITY_RECIPE_INVALID'),
    );
    assert.throws(
      () => parseCertificationRecord(readFixture('certification-record.invalid-reference.json')),
      hasCode('COMPATIBILITY_CERTIFICATION_INVALID'),
    );
    assert.throws(
      () => parseCompatibilityProfileV2(readFixture('compatibility-profile-v2.invalid-certification-reference.json')),
      hasCode('COMPATIBILITY_PROFILE_INVALID'),
    );
  });

  it('Registry 拒绝重复身份和缺失版本', () => {
    const catalog = loadCompatibilityCatalog(compatibilityRoot);
    assert.throws(
      () => new CompatibilityGovernanceRegistry({ baselines: [catalog.baselines[0], catalog.baselines[0]] }),
      hasCode('COMPATIBILITY_CATALOG_INVALID'),
    );
    assert.throws(
      () => catalog.governance.getBaseline('linux-go-full-agent@9.0'),
      hasCode('COMPATIBILITY_REFERENCE_VERSION_UNSUPPORTED'),
    );
    assert.throws(
      () => new CompatibilityGovernanceRegistry({ baselines: [catalog.baselines[0], { ...catalog.baselines[0], baselineId: 'linux-go-full-agent-copy' }] }),
      hasCode('COMPATIBILITY_CATALOG_INVALID'),
    );
  });
});

describe('Profile v1/v2 迁移', () => {
  it('全部现有 Profile 保持等价，证据过期后稳定降级', () => {
    const catalog = loadCompatibilityCatalog(compatibilityRoot);
    assert.doesNotThrow(() => assertProfileV1V2Equivalent(catalog.profiles, catalog.profilesV2, catalog.governance));
    const profile = catalog.profilesV2.find((item) => item.profileId === 'linux-systemd-nginx');
    assert.ok(profile);
    const current = projectCompatibilityProfileV2(profile, catalog.governance, new Date('2026-07-22T00:00:00.000Z'));
    const expired = projectCompatibilityProfileV2(profile, catalog.governance, new Date('2026-11-01T00:00:00.000Z'));
    assert.equal(current.evidenceStatus, 'current');
    assert.equal(current.effectiveStatus, 'experimental');
    assert.equal(expired.evidenceStatus, 'expired');
    assert.deepEqual(expired.reasonCodes, ['COMPATIBILITY_EVIDENCE_EXPIRED']);
  });

  it('v1/v2 状态或组合冲突时拒绝发布', () => {
    const catalog = loadCompatibilityCatalog(compatibilityRoot);
    const profile = catalog.profilesV2.find((item) => item.profileId === 'windows-modern-iis');
    assert.ok(profile);
    const changed = { ...profile, declaredStatus: 'supported' as const };
    assert.throws(
      () => assertProfileV1V2Equivalent(catalog.profiles, [changed], catalog.governance),
      hasCode('COMPATIBILITY_PROFILE_V1_V2_CONFLICT'),
    );
  });

  it('迁移工具重复执行无漂移', () => {
    execFileSync(process.execPath, [resolve(process.cwd(), '..', 'scripts', 'migrate-compatibility-profile-v1.mjs'), '--check'], {
      cwd: resolve(process.cwd(), '..'),
      stdio: 'pipe',
    });
  });
});

function hasCode(errorCode: CompatibilityCatalogError['errorCode']) {
  return (error: unknown) => error instanceof CompatibilityCatalogError && error.errorCode === errorCode;
}

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(compatibilityRoot, 'fixtures', 'contracts', name), 'utf8')) as unknown;
}
