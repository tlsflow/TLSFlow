import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { CompatibilityCatalogApplicationService } from './application/compatibility-catalog.application-service.js';

test('兼容性 API 与 Profile 矩阵使用同一来源', () => {
  const service = new CompatibilityCatalogApplicationService(resolve(process.cwd(), '..', 'compatibility'));
  const result = service.list(new Date('2026-07-21T12:00:00.000Z'));
  assert.equal(result.schemaVersion, 'gcac.compatibility-catalog/v1');
  assert.deepEqual(result.items.map((item) => item.profileId), [
    'linux-openrc-nginx',
    'linux-systemd-apache',
    'linux-systemd-nginx',
    'linux-systemd-tomcat-pem',
    'linux-systemd-tomcat-pkcs12',
    'linux-sysv-apache',
    'windows-compatibility-iis',
    'windows-modern-iis',
  ]);
  const linuxNginx = result.items.find((item) => item.profileId === 'linux-systemd-nginx');
  const windowsCompatibility = result.items.find((item) => item.profileId === 'windows-compatibility-iis');
  assert.equal(linuxNginx?.effectiveStatus, 'experimental');
  assert.equal(linuxNginx?.evidenceStatus, 'current');
  assert.equal(windowsCompatibility?.effectiveStatus, 'experimental');
  assert.equal(windowsCompatibility?.evidenceStatus, 'current');
});

test('证据过期后自动降级并返回稳定原因码', () => {
  const service = new CompatibilityCatalogApplicationService(resolve(process.cwd(), '..', 'compatibility'));
  const result = service.list(new Date('2026-11-01T00:00:00.000Z'));
  const linuxNginx = result.items.find((item) => item.profileId === 'linux-systemd-nginx');
  const windowsCompatibility = result.items.find((item) => item.profileId === 'windows-compatibility-iis');
  assert.equal(linuxNginx?.evidenceStatus, 'expired');
  assert.deepEqual(linuxNginx?.reasonCodes, ['COMPATIBILITY_EVIDENCE_EXPIRED']);
  assert.equal(windowsCompatibility?.evidenceStatus, 'expired');
  assert.deepEqual(windowsCompatibility?.reasonCodes, ['COMPATIBILITY_EVIDENCE_EXPIRED']);
});
