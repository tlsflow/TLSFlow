import assert from 'node:assert/strict';
import test from 'node:test';
import { BuiltinUnifiedPluginLoader } from './builtin-plugins/builtin-unified-plugin-loader.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { DeviceDiscoverySchemaService } from './discovery/device-discovery-schema.service.js';
import type { WorkflowMockStepOutput } from '../workflow-templates/dto/workflow-templates.dto.js';
import { enrichWorkflowCertificateMaterial } from '../certificates/artifacts/workflow-certificate-material.js';
import { createHash } from 'node:crypto';

function fixtureCredential() {
  return {
    credentialId: 'cred_fixture',
    kind: 'USERNAME_PASSWORD',
    username: 'fixture',
    secretRefs: { password: 'secret://password/fixture-secret#v1' },
  };
}

test('Citrix ADC 连接测试识别版本且不泄漏认证值', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/connection-test.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    userVariables: {
      deviceHost: '10.0.0.1', managementPort: 443, tlsVerify: false,
      credential: fixtureCredential(),
    },
    mockResponses: { readVersion: { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } } },
  });
  assert.equal(result.status, 'success');
  assert.equal(result.stepResults[0]?.extracted.productVersion, 'NetScaler NS13.1: Build 55.29.nc');
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC 13.1 脱敏 Fixture 生成标准发现对象', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/discover.json']!);
  const fixture = JSON.parse(pluginPackage.resources['discovery-mappings/nitro-13.1.json']!) as { mockResponses: Record<string, WorkflowMockStepOutput> };
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    userVariables: {
      deviceHost: '10.0.0.1',
      managementPort: 443,
      tlsVerify: true,
      credential: fixtureCredential(),
    },
    mockResponses: fixture.mockResponses,
  });
  const discovery = result.stepResults.at(-1)?.extracted.discovery;
  const validated = new DeviceDiscoverySchemaService().validate(discovery);
  assert.deepEqual(validated.sites.map((site) => site.stableKey), ['LB:lb-one', 'VPN:vpn-one', 'CS:cs-one', 'GSLB:gslb-one']);
  assert.equal(validated.certificates[0]?.stableKey, 'CERT:leaf-one');
  assert.deepEqual(validated.certificateBindings.map((binding) => binding.siteStableKey), ['LB:lb-one', 'VPN:vpn-one', 'CS:cs-one', 'GSLB:gslb-one']);
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('统一证书材料生成 Base64 和有序中间证书数组', () => {
  const material = enrichWorkflowCertificateMaterial({
    certificateVersionId: 'cert-version-1',
    certificateFormatId: 'format-1',
    fingerprintSha256: 'AA:BB',
    files: [
      { key: 'public', role: 'public_certificate', content: 'LEAF\n' },
      { key: 'private', role: 'private_key', content: 'PRIVATE\n' },
      { key: 'chain', role: 'certificate_chain', content: '-----BEGIN CERTIFICATE-----\nONE\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nTWO\n-----END CERTIFICATE-----\n' },
    ],
  });
  assert.equal(material.leafPemBase64, Buffer.from('LEAF\n').toString('base64'));
  assert.equal(material.privateKeyPemBase64, Buffer.from('PRIVATE\n').toString('base64'));
  assert.deepEqual((material.orderedIntermediates as Array<Record<string, unknown>>).map((item) => ({ sequence: item.sequence, nextSequence: item.nextSequence, hasNext: item.hasNext })), [
    { sequence: 1, nextSequence: 2, hasNext: true },
    { sequence: 2, nextSequence: undefined, hasNext: false },
  ]);
  assert.equal(material.fingerprintSha256, 'aabb');
  assert.equal(Object.hasOwn(material.deploymentMetadata as object, 'password'), false);
});

test('统一证书材料可从 fullchain 派生叶子证书和有序中间链', () => {
  const leaf = '-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----\n';
  const intermediate = '-----BEGIN CERTIFICATE-----\nINTERMEDIATE\n-----END CERTIFICATE-----\n';
  const material = enrichWorkflowCertificateMaterial({
    certificateVersionId: 'cert-version-fullchain',
    certificateFormatId: 'format-fullchain',
    files: [
      { key: 'fullchain', role: 'public_certificate', content: `${leaf}${intermediate}` },
      { key: 'private', role: 'private_key', content: 'PRIVATE\n' },
    ],
  });

  assert.equal(material.leafPem, leaf);
  assert.equal(material.orderedChainPem, intermediate);
  assert.deepEqual((material.orderedIntermediates as Array<Record<string, unknown>>).map((item) => item.pem), [intermediate]);
});

test('Citrix ADC 部署先验证新绑定再解绑旧证书，全部写操作后才保存', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    userVariables: deploymentVariables(),
    mockResponses: deploymentResponses(),
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.stepResults.map((item) => item.name).slice(-5), [
    'bindTargets', 'removeOldBindings', 'saveConfiguration', 'verifyCertificateControlPlane', 'verifyTlsHandshakes',
  ]);
  const remove = result.stepResults.find((item) => item.name === 'removeOldBindings')?.children?.[0];
  assert.match(JSON.stringify(remove?.plan), /args=certkeyname:old-cert/);
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC systemfile 接受 200 且绑定失败时不执行保存', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.uploadLeafCertificate = { statusCode: 200, body: {} };
  responses.uploadPrivateKey = { statusCode: 200, body: {} };
  responses.bindNewCertificate = { statusCode: 500, body: { errorcode: 999, message: 'fixture failure' } };
  responses.rollbackReadCurrentVersion = responses.preflight;
  responses.rollbackRestoreOldBinding = { statusCode: 201, body: { errorcode: 0 } };
  responses.rollbackReadBindingsAfterRestore = { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }] } };
  responses.rollbackRemoveNewBinding = { statusCode: 200, body: { errorcode: 0 } };
  responses.rollbackReadFinalBindings = responses.rollbackReadBindingsAfterRestore;
  responses.rollbackSaveConfiguration = { statusCode: 200, body: { errorcode: 0 } };
  responses.rollbackVerifyPreviousTlsHandshake = { statusCode: 200, body: { remoteCertificateSha256: 'bb'.repeat(32) } };
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    userVariables: deploymentVariables(),
    mockResponses: responses,
  });
  assert.equal(result.status, 'rolled_back');
  assert.equal(result.stepResults.some((item) => item.name === 'saveConfiguration'), false);
  assert.equal(result.stepResults.find((item) => item.name === 'uploadLeafCertificate')?.status, 'success');
  assert.equal(result.stepResults.find((item) => item.name === 'uploadPrivateKey')?.status, 'success');
  assert.equal(result.rollbackResults.every((item) => item.status !== 'failed'), true);
});

test('Citrix ADC 自动补偿失败时不得伪装为已回滚', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-deploy.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = deploymentResponses();
  responses.bindNewCertificate = { statusCode: 500, body: { errorcode: 999 } };
  responses.rollbackReadCurrentVersion = responses.preflight;
  responses.rollbackRestoreOldBinding = { statusCode: 500, body: { errorcode: 998 } };
  const result = await workflows.testRun({ templateVersionId: version.id, mode: 'mock', userVariables: deploymentVariables(), mockResponses: responses });
  assert.equal(result.status, 'failed');
  assert.equal(result.rollbackResults.some((item) => item.status === 'failed'), true);
});

test('Citrix ADC 回滚恢复旧绑定、移除新绑定并验证集合语义等价', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-rollback.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const snapshot = recoverySnapshot();
  const result = await workflows.testRun({
    templateVersionId: version.id,
    mode: 'mock',
    userVariables: recoveryVariables(snapshot),
    mockResponses: recoveryResponses(),
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(result.stepResults.map((item) => item.name).slice(-4), [
    'compareFinalBindings', 'requireFinalBindingsEquivalent', 'saveConfiguration', 'verifyPreviousTlsHandshakes',
  ]);
  const remove = result.stepResults.find((item) => item.name === 'removeNewBindings')?.children?.[0];
  assert.match(JSON.stringify(remove?.plan), /args=certkeyname:gcac-leaf-20260724/);
  assert.equal(JSON.stringify(result).includes('fixture-only'), false);
});

test('Citrix ADC 回滚快照哈希损坏时在首个写操作前停止', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-rollback.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const snapshot = recoverySnapshot();
  const variables = recoveryVariables(snapshot);
  variables.recoverySnapshotHash = '00'.repeat(32);
  const result = await workflows.testRun({ templateVersionId: version.id, mode: 'mock', userVariables: variables, mockResponses: recoveryResponses() });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.stepResults.map((item) => item.name), ['verifyRecoverySnapshot']);
  assert.equal(result.stepResults.some((item) => item.name === 'restoreOldBindings'), false);
});

test('Citrix ADC 回滚设备版本漂移时在首个写操作前停止', async () => {
  const pluginPackage = (await new BuiltinUnifiedPluginLoader().loadPackages())[0]!;
  const content = JSON.parse(pluginPackage.resources['workflows/certificate-rollback.json']!);
  const workflows = new WorkflowTemplatesApplicationService();
  const { version } = await workflows.createTemplate({ content });
  const responses = recoveryResponses();
  responses.readCurrentVersion = { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS14.1: Build 1.0.nc' } } };
  const snapshot = recoverySnapshot();
  const result = await workflows.testRun({ templateVersionId: version.id, mode: 'mock', userVariables: recoveryVariables(snapshot), mockResponses: responses });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.stepResults.map((item) => item.name), ['verifyRecoverySnapshot', 'readCurrentVersion', 'verifyDeviceVersion']);
  assert.equal(result.stepResults.some((item) => item.name === 'restoreOldBindings'), false);
});

function deploymentVariables(): Record<string, unknown> {
  return {
    deviceHost: '10.0.0.1', managementPort: 443, tlsVerify: false,
    credential: fixtureCredential(),
    certificateKeyName: 'gcac-leaf-20260724',
    certificate: {
      leafPemBase64: Buffer.from('leaf').toString('base64'),
      privateKeyPemBase64: Buffer.from('private').toString('base64'),
      fingerprintSha256: 'aa'.repeat(32),
      orderedIntermediates: [
        { sequence: 1, nextSequence: 2, hasNext: true, pemBase64: Buffer.from('ca-1').toString('base64') },
        { sequence: 2, hasNext: false, pemBase64: Buffer.from('ca-2').toString('base64') },
      ],
    },
    targetVirtualServers: [{ name: 'lb-one', sniCertificate: false, verifyHost: '192.0.2.10', serverName: 'lb.example.com', previousFingerprintSha256: 'bb'.repeat(32) }],
  };
}

function deploymentResponses(): Record<string, WorkflowMockStepOutput> {
  return {
    preflight: { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } },
    readOldBindings: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }] } },
    readOldCertKey: { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: 'old-cert', cert: '/nsconfig/ssl/old.pem', key: '/nsconfig/ssl/old.key', linkcertkeyname: 'old-ca', status: 'Valid' }] } },
    uploadLeafCertificate: { statusCode: 201, body: {} },
    uploadPrivateKey: { statusCode: 201, body: {} },
    uploadIntermediate: { statusCode: 201, body: {} },
    createIntermediateCertKey: { statusCode: 201, body: { errorcode: 0 } },
    linkIntermediateCertKey: { statusCode: 200, body: { errorcode: 0 } },
    createLeafCertKey: { statusCode: 201, body: { errorcode: 0 } },
    linkLeafCertKey: { statusCode: 200, body: { errorcode: 0 } },
    bindNewCertificate: { statusCode: 201, body: { errorcode: 0 } },
    verifyNewBinding: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [{ vservername: 'lb-one', certkeyname: 'gcac-leaf-20260724' }] } },
    removeOldBinding: { statusCode: 200, body: { errorcode: 0 } },
    saveConfiguration: { statusCode: 200, body: { errorcode: 0 } },
    verifyCertificateControlPlane: { statusCode: 200, body: { errorcode: 0, sslcertkey: [{ certkey: 'gcac-leaf-20260724', status: 'Valid', linkcertkeyname: 'gcac-leaf-20260724-ca-1' }] } },
  };
}

function recoverySnapshot(): Record<string, unknown> {
  return {
    deviceVersion: 'NetScaler NS13.1: Build 55.29.nc',
    versionResponse: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } },
    bindings: [{ vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 }],
    certkeys: [{ resource: [{ certkey: 'old-cert', cert: '/nsconfig/ssl/old.pem', key: '/nsconfig/ssl/old.key', linkcertkeyname: 'old-ca', status: 'Valid' }], sharedBindings: [{ vservername: 'lb-one', certkeyname: 'old-cert' }] }],
    targets: [{ name: 'lb-one', verifyHost: '192.0.2.10', serverName: 'lb.example.com', previousFingerprintSha256: 'bb'.repeat(32) }],
    newCertificateKeyName: 'gcac-leaf-20260724',
    targetFingerprintSha256: 'aa'.repeat(32),
  };
}

function recoveryVariables(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    deviceHost: '10.0.0.1', managementPort: 443, tlsVerify: false,
    credential: fixtureCredential(),
    recoverySnapshot: snapshot,
    recoverySnapshotHash: createHash('sha256').update(stableJson(snapshot)).digest('hex'),
  };
}

function recoveryResponses(): Record<string, WorkflowMockStepOutput> {
  const oldBinding = { vservername: 'lb-one', certkeyname: 'old-cert', snicert: false, priority: 1 };
  return {
    readCurrentVersion: { statusCode: 200, body: { errorcode: 0, nsversion: { version: 'NetScaler NS13.1: Build 55.29.nc' } } },
    restoreOldBinding: { statusCode: 201, body: { errorcode: 0 } },
    readBindingsAfterRestore: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [oldBinding, { vservername: 'lb-one', certkeyname: 'gcac-leaf-20260724', snicert: false, priority: 2 }] } },
    removeNewBinding: { statusCode: 200, body: { errorcode: 0 } },
    readFinalBindings: { statusCode: 200, body: { errorcode: 0, sslvserver_sslcertkey_binding: [oldBinding] } },
    saveConfiguration: { statusCode: 200, body: { errorcode: 0 } },
    verifyPreviousTlsHandshake: { statusCode: 200, body: { remoteCertificateSha256: 'bb'.repeat(32) } },
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
