import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCertificateUpdatePlanTemplate } from '../../../deployment-inputs/certificate-update/certificate-update-plan.service.js';
import {
  createCertificateUpdateSnapshot,
  loadCertificateUpdateContract,
  loadCertificateUpdateResource,
} from '../../../deployment-inputs/certificate-update/certificate-update.test-fixtures.js';

const pluginId = 'web.apache.linux' as const;

test(`${pluginId} 只接受 Linux Apache PEM 并使用 reload`, () => {
  const contract = loadCertificateUpdateContract(pluginId);
  const snapshot = createCertificateUpdateSnapshot(pluginId);
  const plan = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
    snapshot,
    pluginVersionId: `${pluginId}-version-1`,
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  }).plan;

  assert.equal(contract.frameworkType, 'web.apache');
  assert.equal(contract.platform, 'linux');
  assert.equal(contract.artifactKind, 'PEM_FILES');
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.reload'), true);
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.stop' || operation.operationType === 'service.start'), false);
  assert.equal(snapshot.paths.length, 3);
});
