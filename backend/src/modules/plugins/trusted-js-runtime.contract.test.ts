import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTrustedJsRunnerRequest } from './runtime/trusted-js-runtime.contract.js';

const hash = `sha256:${'a'.repeat(64)}`;

test('Trusted JS Runner 请求必须显式绑定身份、三类制品摘要、能力、租户和 GrantRefs', () => {
  const request = validateTrustedJsRunnerRequest({
    pluginVersionId: 'plugin-version-1', pluginId: 'plugin.test', pluginVersion: '1.0.0', tenantId: 'tenant-1',
    packageHash: hash, manifestHash: hash, resourceHash: hash, capability: 'test.echo',
    executionId: 'execution-1', executionStepId: 'step-1', input: { value: 'hello' }, grantRefs: ['grant-1'],
  });
  assert.equal(request.pluginVersionId, 'plugin-version-1');
  assert.equal(request.pluginId, 'plugin.test');
  assert.equal(request.capability, 'test.echo');
  assert.deepEqual(request.grantRefs, ['grant-1']);
  assert.equal('providerKey' in request, false);
  assert.equal('supportedProducts' in request, false);
  assert.equal('supportedOperations' in request, false);
  assert.equal('frameworkType' in request, false);
});

test('Trusted JS Runner 请求缺少真实绑定或包含重复 GrantRefs 时失败关闭', () => {
  assert.throws(() => validateTrustedJsRunnerRequest({
    pluginVersionId: 'plugin-version-1', pluginId: 'plugin.test', pluginVersion: '1.0.0', tenantId: 'tenant-1',
    packageHash: hash, manifestHash: hash, capability: 'test.echo', executionId: 'execution-1',
    executionStepId: 'step-1', input: {}, grantRefs: [],
  }), /resourceHash/);
  assert.throws(() => validateTrustedJsRunnerRequest({
    pluginVersionId: 'plugin-version-1', pluginId: 'plugin.test', pluginVersion: '1.0.0', tenantId: 'tenant-1',
    packageHash: hash, manifestHash: hash, resourceHash: hash, capability: 'test.echo', executionId: 'execution-1',
    executionStepId: 'step-1', input: {}, grantRefs: ['grant-1', 'grant-1'],
  }), /重复引用/);
  assert.throws(() => validateTrustedJsRunnerRequest({
    pluginVersionId: 'plugin-version-1', pluginId: 'plugin.test', pluginVersion: '1.0.0', tenantId: 'tenant-1',
    packageHash: 'package', manifestHash: hash, resourceHash: hash, capability: 'test.echo', executionId: 'execution-1',
    executionStepId: 'step-1', input: {}, grantRefs: [],
  }), /sha256/);
});
