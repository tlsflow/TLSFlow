import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeDeploymentInputPersistencePayload } from './application/deployment-input-persistence-sanitizer.js';

test('持久化脱敏器递归删除运行材料与敏感引用并保留快照 Ref', () => {
  const payload = sanitizeDeploymentInputPersistencePayload({
    actionType: 'agent.atomic_plan.execute',
    deploymentInputSnapshotRef: {
      apiVersion: 'gcac.deployment-input-snapshot/v1',
      snapshotId: 'dpis_1',
      revision: 1,
      resolvedSha256: 'a'.repeat(64),
    },
    effectiveInputBindings: { credentials: { management: { secretRef: 'secret://password' } } },
    workflowRequest: {
      workflowVersionId: 'wfv_1',
      inputBindings: { variables: { password: 'plain-password' } },
      nested: { pfxBase64: 'plain-pfx', privateKeyPem: 'plain-key', harmless: 'kept' },
    },
    deploymentArtifact: { privateKeyPem: 'plain-key' },
  });

  assert.equal(payload.actionType, 'agent.atomic_plan.execute');
  assert.deepEqual(payload.deploymentInputSnapshotRef, {
    apiVersion: 'gcac.deployment-input-snapshot/v1',
    snapshotId: 'dpis_1',
    revision: 1,
    resolvedSha256: 'a'.repeat(64),
  });
  assert.equal(JSON.stringify(payload).includes('secret://password'), false);
  assert.equal(JSON.stringify(payload).includes('plain-password'), false);
  assert.equal(JSON.stringify(payload).includes('plain-pfx'), false);
  assert.equal(JSON.stringify(payload).includes('plain-key'), false);
  assert.equal((payload.workflowRequest as any).workflowVersionId, 'wfv_1');
  assert.equal((payload.workflowRequest as any).nested.harmless, 'kept');
});
