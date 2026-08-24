import assert from 'node:assert/strict';
import test from 'node:test';
import { getNetscalerCapabilityProfile, assertNetscalerCapability } from './netscaler-nitro.capabilities.js';
import { NetscalerNitroError } from './netscaler-nitro.errors.js';
import { parseNetscalerVersion } from './netscaler-nitro.version.js';
import { NetscalerSupportedVersions } from './netscaler.types.js';

const samples = [
  ['10.5', 'NetScaler NS10.5: Build 70.12.nc'],
  ['11.1', 'NetScaler NS11.1: Build 65.25.nc'],
  ['12.1', 'NetScaler NS12.1: Build 65.35.nc'],
  ['13.0', 'NetScaler NS13.0: Build 92.21.nc'],
  ['13.1', 'NetScaler NS13.1: Build 53.17.nc'],
  ['14.1', 'NetScaler NS14.1: Build 21.57.nc'],
] as const;

for (const [expected, raw] of samples) {
  test(`解析 NetScaler ${expected} 版本和 Build`, () => {
    const version = parseNetscalerVersion(raw);
    assert.equal(version.normalized, expected);
    assert.match(version.build ?? '', /\.nc$/);
  });
}

test('六个目标版本都有唯一能力矩阵', () => {
  const mappings = NetscalerSupportedVersions.map((normalized) => {
    const [major, minor] = normalized.split('.').map(Number);
    return getNetscalerCapabilityProfile({ major, minor, normalized, raw: normalized });
  });
  assert.deepEqual(mappings.map((item) => item.supportTier), ['COMPATIBLE', 'COMPATIBLE', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED']);
  assert.deepEqual(mappings.map((item) => item.fieldMappingVersion), NetscalerSupportedVersions);
});

test('10.5 禁止创建重绑，11.1 降级 VPN/GSLB 发现', () => {
  const ten = getNetscalerCapabilityProfile(parseNetscalerVersion('NS10.5: Build 70.12.nc'));
  const eleven = getNetscalerCapabilityProfile(parseNetscalerVersion('NS11.1: Build 65.25.nc'));
  assert.equal(ten.deployment.updateSslCertKey, true);
  assert.equal(ten.deployment.addSslCertKey, false);
  assert.equal(eleven.discovery.vpnVirtualServer, false);
  assert.equal(eleven.discovery.gslbVirtualServer, false);
});

test('未知版本严格只读并返回稳定能力缺失错误', () => {
  const version = parseNetscalerVersion('NetScaler NS15.0: Build 1.0.nc');
  const capability = getNetscalerCapabilityProfile(version);
  assert.equal(capability.supportTier, 'READ_ONLY');
  assert.ok(Object.values(capability.deployment).every((value) => value === false));
  assert.throws(
    () => assertNetscalerCapability(capability, 'deployment', 'updateSslCertKey'),
    (error: unknown) => error instanceof NetscalerNitroError && error.code === 'NETSCALER_CAPABILITY_MISSING',
  );
});

test('无法解析的版本仍保留原文且不冒充最新版本', () => {
  const version = parseNetscalerVersion('unknown firmware');
  assert.equal(version.major, 0);
  assert.equal(version.minor, 0);
  assert.equal(version.normalized, undefined);
  assert.equal(version.raw, 'unknown firmware');
});
