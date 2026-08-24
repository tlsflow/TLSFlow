import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCertificateUpdatePlanTemplate } from '../../../deployment-inputs/certificate-update/certificate-update-plan.service.js';
import {
  createCertificateUpdateSnapshot,
  loadCertificateUpdateContract,
  loadCertificateUpdateResource,
} from '../../../deployment-inputs/certificate-update/certificate-update.test-fixtures.js';

const pluginId = 'app.tomcat.windows' as const;

test(`${pluginId} 以单一 KeyStore 文件执行 Windows restart`, () => {
  const contract = loadCertificateUpdateContract(pluginId);
  const snapshot = createCertificateUpdateSnapshot(pluginId);
  const plan = compileCertificateUpdatePlanTemplate({
    templateText: loadCertificateUpdateResource(pluginId, 'agent-plans/deploy.json'),
    snapshot,
    pluginVersionId: `${pluginId}-version-1`,
    agentId: 'agent-1',
    tenantId: 'tenant-1',
  }).plan;

  assert.equal(contract.frameworkType, 'app.tomcat');
  assert.equal(contract.platform, 'windows');
  assert.equal(contract.artifactKind, 'KEYSTORE');
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.stop'), true);
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.start'), true);
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.reload'), false);
  assert.equal(snapshot.paths.length, 1);
  assert.equal(snapshot.paths[0]?.startsWith('C:/Program Files/GCAC/'), true);
  assert.equal(snapshot.keystoreType, 'PKCS12');
  assert.equal(snapshot.keyAlias, 'server');
});
