import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCertificateUpdatePlanTemplate } from '../../../deployment-inputs/certificate-update/certificate-update-plan.service.js';
import {
  createCertificateUpdateSnapshot,
  loadCertificateUpdateContract,
  loadCertificateUpdateResource,
} from '../../../deployment-inputs/certificate-update/certificate-update.test-fixtures.js';

const pluginId = 'app.tomcat.linux' as const;

test(`${pluginId} 以单一 KeyStore 文件执行 restart`, () => {
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
  assert.equal(contract.platform, 'linux');
  assert.equal(contract.artifactKind, 'KEYSTORE');
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.stop'), true);
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.start'), true);
  assert.equal(plan.operations.some((operation) => operation.operationType === 'service.reload'), false);
  assert.deepEqual(snapshot.paths, ['/opt/gcac/tomcat/conf/confirmed.keystore']);
  assert.equal(snapshot.keystoreType, 'PKCS12');
  assert.equal(snapshot.keyAlias, 'server');
  assert.deepEqual(snapshot.secretRefs, ['secret://certificate/tomcat-password']);
});
