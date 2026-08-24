import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import jsonata from 'jsonata';
import { DeviceDiscoverySchemaService } from './discovery/device-discovery-schema.service.js';

const packageRoot = new URL('./builtin-plugins/device-chaitin-safeline-waf/', import.meta.url);

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(path, packageRoot), 'utf8')) as Record<string, any>;
}

test('SafeLine 发现把 API 版本投影到标准 softwareVersion 并发现 Site/MovePilot', async () => {
  const manifest = readJson('manifest.json');
  const workflow = readJson('workflows/discover.json');
  const fixture = readJson('fixtures/safeline-v1.json');
  assert.equal(manifest.version, '0.1.10');
  assert.equal(workflow.metadata?.version, '0.1.10');

  const siteExpression = workflow.steps.find((step: Record<string, any>) => step.name === 'projectSites')
    ?.transform?.outputs?.discovery?.expression;
  const base = await jsonata(siteExpression).evaluate({
    deviceHost: '10.255.0.99',
    system: fixture.system.data,
    sites: fixture.sites.data.data,
    certificates: fixture.certificates.data.nodes,
  });
  const expression = workflow.steps.find((step: Record<string, any>) => step.name === 'projectDiscovery')
    ?.transform?.outputs?.discovery?.expression;
  const result = await jsonata(expression).evaluate({
    system: fixture.system.data,
    deviceHost: '10.255.0.99',
    base,
  });
  const validated = new DeviceDiscoverySchemaService().validate(result);

  assert.equal(validated.device.softwareVersion, '9.1.0');
  assert.equal(validated.device.metadata?.version, '9.1.0');
  assert.deepEqual(validated.frameworks.map((item) => item.displayName), ['Site']);
  assert.deepEqual(validated.sites.map((item) => item.displayName), ['Default', 'MovePilot']);
  assert.deepEqual(validated.managedTargets.map((item) => item.targetKey), ['Default', 'site:55']);
  assert.equal(validated.managedTargets[0].targetType, 'tls.binding');
  assert.equal(validated.managedTargets[0].metadata?.abstract, true);
  assert.equal(validated.certificateBindings[0].managedTargetStableKey, 'target:default');
});

test('SafeLine 设备展示版本使用宿主标准字段', () => {
  const presentation = readJson('presentations/device.json');
  const versionField = presentation.overview
    .flatMap((group: Record<string, any>) => group.fields as Array<Record<string, any>>)
    .find((field: Record<string, any>) => field.key === 'version');
  assert.equal(versionField?.valuePath, 'softwareVersion');
});

test('SafeLine 证书部署复用已有证书并为 Default 目标生成带 id 的 upsert', async () => {
  const workflow = readJson('workflows/certificate-deploy.json');
  assert.equal(workflow.metadata?.version, '0.1.10');
  assert.equal(workflow.steps.some((step: Record<string, any>) => step.name === 'requireDefaultCertificateMaterial'), false);
  const match = workflow.steps.find((step: Record<string, any>) => step.name === 'matchExistingCertificate');
  const matchExpression = match?.transform?.outputs?.existingCertificateId?.expression;
  const certificate = '-----BEGIN CERTIFICATE-----\nSAME\n-----END CERTIFICATE-----';
  const input = {
    certificates: [{ id: 34 }],
    details: [{ outputs: [{ name: 'readCertificate', extracted: { certificateId: 0, crt: certificate, key: 'PRIVATE' } }] }],
    fingerprint: 'sha256:unused',
    leaf: certificate,
    chain: '',
    defaultTargetSelected: false,
    defaultCertificateId: 34,
  };
  assert.equal(await jsonata(matchExpression).evaluate(input), 34);

  const request = workflow.steps.find((step: Record<string, any>) => step.name === 'buildCertificateRequest');
  const payloadExpression = request?.transform?.outputs?.payload?.expression;
  const existingPayload = await jsonata(payloadExpression).evaluate({ existingCertificateId: 34, defaultTargetSelected: true, crt: certificate, key: 'PRIVATE' });
  assert.equal(existingPayload.id, 34);
  assert.equal(existingPayload.type, 2);
  const newPayload = await jsonata(payloadExpression).evaluate({ existingCertificateId: '', defaultTargetSelected: false, crt: certificate, key: 'PRIVATE' });
  assert.equal(Object.hasOwn(newPayload, 'id'), false);

  const directRead = workflow.steps.find((step: Record<string, any>) => step.name === 'readDefaultCertificate');
  const readDetails = workflow.steps.find((step: Record<string, any>) => step.name === 'readCertificateDetails');
  const readCertificate = readDetails?.foreach?.steps?.find((step: Record<string, any>) => step.name === 'readCertificate');
  assert.equal(directRead?.request?.url, '/api/open/cert/{{steps.selectTargets.extracted.defaultCertificateId}}');
  assert.equal(directRead?.when?.variable, 'steps.selectTargets.extracted.defaultTargetSelected');
  assert.equal(directRead?.extract?.find((item: Record<string, any>) => item.name === 'certificateId')?.optional, true);
  assert.equal(readCertificate?.extract?.find((item: Record<string, any>) => item.name === 'certificateId')?.optional, true);
  assert.equal(directRead?.extract?.find((item: Record<string, any>) => item.name === 'key')?.sensitive, true);

  const verify = workflow.steps.find((step: Record<string, any>) => step.name === 'verifyUploadedCertificate');
  const certificateAssertion = verify?.assert?.find((item: Record<string, any>) => item.type === 'jsonPath');
  assert.equal(certificateAssertion?.path, '$.data.manual.crt');
  assert.equal(certificateAssertion?.equals, '{{steps.normalizeCertificate.extracted.crt}}');
});

test('SafeLine Default 证书仅在旧材料可回读时备份，仍支持原证书 ID 回滚', async () => {
  const workflow = readJson('workflows/certificate-deploy.json');
  const match = workflow.steps.find((step: Record<string, any>) => step.name === 'matchExistingCertificate');
  const snapshot = workflow.steps.find((step: Record<string, any>) => step.name === 'buildCertificateSnapshot');
  const oldCertificate = '-----BEGIN CERTIFICATE-----\nOLD\n-----END CERTIFICATE-----';
  const oldPrivateKey = '-----BEGIN PRIVATE KEY-----\nOLD_PRIVATE\n-----END PRIVATE KEY-----';
  const newCertificate = '-----BEGIN CERTIFICATE-----\nNEW\n-----END CERTIFICATE-----';
  const details = [{ outputs: [{ name: 'readCertificate', extracted: { certificateId: 34, crt: oldCertificate, key: oldPrivateKey } }] }];
  const matchInput = {
    certificates: [{ id: 34, sha256: 'sha256:' + 'aa'.repeat(32) }],
    details,
    fingerprint: 'sha256:' + 'bb'.repeat(32),
    leaf: newCertificate,
    chain: '',
    defaultTargetSelected: true,
    defaultCertificateId: 34,
  };
  const changedExpression = match?.transform?.outputs?.defaultCertificateChanged?.expression;
  assert.equal(await jsonata(changedExpression).evaluate(matchInput), true);

  const snapshotInput = {
    certificateId: 34,
    details,
    defaultCertificate: { certificateId: 34, crt: oldCertificate, key: oldPrivateKey },
    defaultTargetSelected: true,
    defaultCertificateChanged: true,
    certificateSnapshot: { id: 34, crt: oldCertificate, key: oldPrivateKey, restoreRequired: true },
  };
  const snapshotExpression = snapshot?.transform?.outputs?.certificateSnapshot?.expression;
  const snapshotResult = await jsonata(snapshotExpression).evaluate(snapshotInput);
  assert.equal(snapshotResult.restoreRequired, true);
  const unusableSnapshot = await jsonata(snapshotExpression).evaluate({
    ...snapshotInput,
    defaultCertificate: { certificateId: 34, crt: oldCertificate, key: 'PRIVATE' },
  });
  assert.equal(unusableSnapshot.restoreRequired, false);
  const backupExpression = snapshot?.transform?.outputs?.defaultBackupAvailable?.expression;
  assert.equal(await jsonata(backupExpression).evaluate({
    ...snapshotInput,
    certificateSnapshot: snapshotResult,
  }), true);
  assert.equal(await jsonata(backupExpression).evaluate({
    ...snapshotInput,
    defaultTargetSelected: false,
    certificateSnapshot: snapshotResult,
  }), false);
  const backup = workflow.steps.find((step: Record<string, any>) => step.name === 'backupDefaultCertificate');
  assert.equal(backup?.when?.variable, 'steps.buildCertificateSnapshot.extracted.defaultBackupAvailable');
  assert.equal(backup?.extract?.find((item: Record<string, any>) => item.name === 'backupCreated')?.value, true);

  const rollback = workflow.rollback as Array<Record<string, any>>;
  const readBackup = rollback.find((step) => step.name === 'readBackupCertificate');
  const restore = rollback.find((step) => step.name === 'restoreCertificate');
  const deleteBackup = rollback.find((step) => step.name === 'deleteBackupCertificate');
  assert.equal(readBackup?.when?.variable, 'steps.backupDefaultCertificate.extracted.backupCreated');
  assert.equal(restore?.request?.body?.id, '{{steps.selectTargets.extracted.defaultCertificateId}}');
  assert.equal(restore?.request?.body?.manual?.key, '{{steps.readBackupCertificate.extracted.key}}');
  assert.equal(deleteBackup?.request?.url, '/api/open/cert/{{steps.backupDefaultCertificate.extracted.certificateId}}');
  assert.equal(rollback.find((step) => step.name === 'verifyRecoverySnapshot')?.when?.exists, true);
  assert.equal(rollback.find((step) => step.name === 'restoreSites')?.when?.exists, true);
});

test('SafeLine 站点完整响应使用 content 敏感槽，避免 icon Base64 进入工作流结果', async () => {
  for (const workflowName of ['workflows/certificate-deploy.json', 'workflows/certificate-verify.json', 'workflows/discover.json']) {
    const workflow = readJson(workflowName);
    const readSites = workflow.steps.find((step: Record<string, any>) => step.name === 'readSites');
    assert.equal(readSites?.extract?.find((item: Record<string, any>) => item.name === 'content')?.path, '$.data.data');
    assert.equal(readSites?.extract?.some((item: Record<string, any>) => item.name === 'sites'), false);
  }
  const deploy = readJson('workflows/certificate-deploy.json');
  const readCurrentSite = (deploy.rollback as Array<Record<string, any>>)
    .find((step) => step.name === 'restoreSites')?.foreach?.steps?.find((step: Record<string, any>) => step.name === 'readCurrentSite');
  assert.equal(readCurrentSite?.extract?.find((item: Record<string, any>) => item.name === 'content')?.path, '$.data');

  const selectTargets = deploy.steps.find((step: Record<string, any>) => step.name === 'selectTargets');
  const selectedExpression = selectTargets?.transform?.outputs?.selected?.expression;
  const selected = await jsonata(selectedExpression).evaluate({
    sites: [{ id: 55, cert_id: 34, icon: 'data:image/png;base64,VERY_LARGE_IMAGE', comment: 'MovePilot', ports: ['4455_ssl'], server_names: ['wechatapi.jacksonz.cn'], upstreams: ['http://10.0.0.1:3000'] }],
    targets: [{ metadata: { safeLineSiteId: 55 } }],
    system: { cert_id: 34 },
  });
  assert.equal(Object.hasOwn(selected[0].site, 'icon'), false);
});
