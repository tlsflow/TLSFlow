import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentInputSnapshotService } from './application/deployment-input-snapshot.service.js';

test('部署输入快照保留可重放引用并对外提供脱敏审计视图', () => {
  const secretRef = 'secret://credential-version/password';
  const privateKeyRef = 'artifact://certificate/private-key';
  const resolved = {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: { application: { id: 'asset-1' } },
    variables: { target: 'site.example.com', password: 'runtime-secret', pfxBase64: 'runtime-pfx' },
    connections: { management: { transport: 'https', host: 'host.example.com' } },
    credentials: { management: { credentialId: 'credential-1', secretRefs: { password: secretRef } } },
    artifacts: { certificate: { outputs: { certificate: 'artifact://certificate/leaf', privateKey: privateKeyRef } } },
    provenance: {
      'variables.target': { source: 'binding', bindingLayer: 'APPLICATION_ASSET' },
      'credentials.management': { source: 'credential_snapshot', bindingLayer: 'DEVICE' },
    },
    sensitivePaths: ['variables.password', 'credentials.management', 'artifacts.certificate.outputs.privateKey'],
    issues: [],
    executable: true,
    resolvedSha256: 'a'.repeat(64),
  } as any;

  const contract = { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} } as any;
  const effectiveBinding = { inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} }, provenance: {} } as any;
  const snapshot = new DeploymentInputSnapshotService().build(resolved, {
    assignmentId: 'assignment-1',
    pluginVersionId: 'plugin-version-1',
    pluginBindingId: 'binding-1',
  }, contract, effectiveBinding, '2026-07-30T00:00:00.000Z');

  assert.equal(snapshot.apiVersion, 'gcac.deployment-input-snapshot/v1');
  assert.match(String(snapshot.input.variables.password), /^\[REDACTED/);
  assert.equal(snapshot.input.credentials.management, '[REDACTED]');
  assert.match(String((snapshot.input.artifacts.certificate as any).outputs.privateKey), /^\[REDACTED/);
  assert.match(String(snapshot.input.variables.pfxBase64), /^\[REDACTED/);
  assert.equal(JSON.stringify(snapshot.input).includes('runtime-secret'), false);
  assert.equal(JSON.stringify(snapshot.input).includes('runtime-pfx'), false);
  assert.equal('resolvedInput' in snapshot, false);
  assert.equal(snapshot.resolvedDeploymentInput.credentials.management?.secretRefs?.password, secretRef);
  assert.equal(snapshot.resolvedDeploymentInput.artifacts.certificate.outputs.privateKey, privateKeyRef);
  assert.deepEqual(snapshot.contract, contract);
  assert.deepEqual(snapshot.effectiveBinding, effectiveBinding);
  assert.deepEqual(snapshot.identity, { assignmentId: 'assignment-1', pluginVersionId: 'plugin-version-1', pluginBindingId: 'binding-1' });
  assert.equal(snapshot.sources['variables.target']?.bindingLayer, 'APPLICATION_ASSET');
  assert.equal(snapshot.redaction.sensitivePathCount, 3);
});
