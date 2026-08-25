import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceWorkflowCredentialHealthAdapter } from './credential-health.adapter.js';
import { aggregateCredentialHealth, classifyCredentialHealthError } from './credential-health.types.js';

test('凭据健康状态按业务优先级聚合', () => {
  assert.equal(aggregateCredentialHealth({ profileStatus: 'disabled', deviceCount: 2, results: [{ resultStatus: 'VALID' }] }), 'DISABLED');
  assert.equal(aggregateCredentialHealth({ profileStatus: 'active', deviceCount: 0, results: [] }), 'UNUSED');
  assert.equal(aggregateCredentialHealth({ profileStatus: 'active', deviceCount: 2, results: [{ resultStatus: 'UNREACHABLE' }, { resultStatus: 'ERROR' }] }), 'ERROR');
  assert.equal(aggregateCredentialHealth({ profileStatus: 'active', deviceCount: 2, results: [{ resultStatus: 'UNREACHABLE' }, { resultStatus: 'VALID' }] }), 'UNREACHABLE');
  assert.equal(aggregateCredentialHealth({ profileStatus: 'active', deviceCount: 2, results: [{ resultStatus: 'VALID' }, { resultStatus: 'VALID' }] }), 'VALID');
});

test('凭据检测错误分类不会把网络失败误报为密码错误', () => {
  assert.equal(classifyCredentialHealthError(new Error('connect ETIMEDOUT 10.0.0.1')).status, 'UNREACHABLE');
  assert.equal(classifyCredentialHealthError(Object.assign(new Error('插件返回 HTTP 401'), { errorCode: 'PLUGIN_CAPABILITY_EXECUTION_FAILED' })).reasonCode, 'PASSWORD_INVALID');
  assert.equal(classifyCredentialHealthError(new Error('SecretService decrypt failed')).reasonCode, 'SECRET_UNREADABLE');
  assert.equal(classifyCredentialHealthError(new Error('HTTP_NON_SUCCESS_STATUS status=503')).reasonCode, 'REMOTE_SERVICE_ERROR');
});

test('插件未返回标准结果时失败关闭，不默认判定有效', async () => {
  const adapter = new DeviceWorkflowCredentialHealthAdapter({ executeCapability: async () => ({ stepResults: [{ extracted: { productVersion: '1.0' } }] }) });
  const result = await adapter.check({ tenantId: 'tenant', credentialId: 'credential', profileVersion: 1, generation: 1, device: { id: 'device', displayName: '设备', address: '192.0.2.1', port: 443, deviceFamily: 'fixture', credentialId: 'credential', version: 1 } });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.reasonCode, 'CHECK_RESULT_INVALID');
});

test('适配器读取嵌套的标准健康输出并拒绝缺失 apiVersion 的结果', async () => {
  const nested = new DeviceWorkflowCredentialHealthAdapter({ executeCapability: async () => ({ output: { credentialHealth: { apiVersion: 'gcac.credential-health-result/v1', status: 'VALID', summary: '认证成功' } } }) });
  const input = { tenantId: 'tenant', credentialId: 'credential', profileVersion: 1, generation: 1, device: { id: 'device', displayName: '设备', address: '192.0.2.1', port: 443, deviceFamily: 'fixture', credentialId: 'credential', version: 1 } };
  assert.equal((await nested.check(input)).status, 'VALID');
  const missingVersion = new DeviceWorkflowCredentialHealthAdapter({ executeCapability: async () => ({ credentialHealth: { status: 'VALID' } }) });
  assert.equal((await missingVersion.check(input)).reasonCode, 'CHECK_RESULT_INVALID');
});
