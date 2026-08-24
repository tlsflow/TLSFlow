import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertTrustedJsHostApiAccess,
  validateTrustedJsConnectionResult,
  validateTrustedJsDiscoveryPayload,
  validateTrustedJsOperationResult,
} from './runtime/trusted-js-runtime.contract.js';

test('TRUSTED_JS Host API 会拒绝未授权能力访问', () => {
  assert.doesNotThrow(() => assertTrustedJsHostApiAccess('audit.record', []));
  assert.doesNotThrow(() => assertTrustedJsHostApiAccess('http.request', ['network.connect']));
  assert.throws(() => assertTrustedJsHostApiAccess('artifact.readCertificateMaterial', []), /权限未授权/);
});

test('TRUSTED_JS 连接结果合同要求显式 ok 字段', () => {
  const result = validateTrustedJsConnectionResult({ ok: true, warnings: ['latency'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, ['latency']);
  assert.throws(() => validateTrustedJsConnectionResult({ warnings: [] }), /必须是布尔值/);
});

test('TRUSTED_JS 发现结果必须是标准发现结构且不得带敏感字段', () => {
  const discovery = validateTrustedJsDiscoveryPayload({
    apiVersion: 'gcac.device-discovery/v2',
    device: { stableKey: 'cloud.aliyun:asset-1', displayName: 'Aliyun', productFamily: 'cloud.aliyun', managementAddress: 'aliyun.console' },
    capabilities: [{ key: 'certificate.deploy', available: true }],
    frameworks: [{ stableKey: 'framework:cdn', frameworkType: 'cloud.aliyun.cdn', displayName: 'CDN' }],
    sites: [{ stableKey: 'site:example.com', frameworkStableKey: 'framework:cdn', siteType: 'cloud.cdn.domain', displayName: 'example.com', addresses: ['example.com'], port: 443, protocol: 'HTTPS' }],
    managedTargets: [{ stableKey: 'target:example.com', frameworkStableKey: 'framework:cdn', siteStableKey: 'site:example.com', targetType: 'cloud.cdn.domain', targetKey: 'example.com', supportedCapabilities: ['certificate.deploy'], executionLocations: ['CONTROL_PLANE'] }],
    certificates: [],
    certificateBindings: [],
    warnings: [],
  });
  assert.equal(discovery.apiVersion, 'gcac.device-discovery/v2');
  assert.throws(() => validateTrustedJsDiscoveryPayload({
    ...discovery,
    device: { ...discovery.device, secretToken: 'boom' },
  }), /敏感字段/);
});

test('TRUSTED_JS 操作结果必须返回标准状态与字段', () => {
  const result = validateTrustedJsOperationResult({
    operationId: 'op-1',
    providerKey: 'cloud.aliyun',
    operationKey: 'certificate.deploy',
    status: 'SUCCESS',
    resultSummary: { certificateId: 'cert-1' },
    asyncOperation: { taskId: 'task-1', status: 'RUNNING' },
  });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.asyncOperation?.taskId, 'task-1');
  assert.throws(() => validateTrustedJsOperationResult({
    operationId: 'op-2',
    providerKey: 'cloud.aliyun',
    operationKey: 'certificate.deploy',
    status: 'UNKNOWN',
  }), /状态不受支持/);
});
