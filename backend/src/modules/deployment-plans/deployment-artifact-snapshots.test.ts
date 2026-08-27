import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactSnapshotsFromDeploymentArtifact } from './application/deployment-plans.application-service.js';

test('直接生成的证书产物按插件合同槽位投影并保留指纹', () => {
  const snapshots = artifactSnapshotsFromDeploymentArtifact({
    certificateVersionId: 'certver_test',
    certificateFormatId: 'certfmt_test',
    format: 'pem',
    containsPrivateKey: true,
    artifactRef: 'artifact://test',
    artifactSha256: 'sha256:' + 'a'.repeat(64),
    expectedFingerprintSha256: 'b'.repeat(64),
    certificatePem: '-----BEGIN CERTIFICATE-----\\nleaf\\n-----END CERTIFICATE-----\\n',
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
    files: [],
    warnings: [],
  }, ['certificate']);

  assert.deepEqual(Object.keys(snapshots), ['certificate']);
  assert.equal(snapshots.certificate.outputs.fingerprintSha256, 'b'.repeat(64));
  assert.match(String(snapshots.certificate.outputs.leafPem), /BEGIN CERTIFICATE/);
  assert.match(String(snapshots.certificate.outputs.certificatePem), /BEGIN CERTIFICATE/);
});

test('没有插件合同槽位时保留历史 certificateArtifact 兼容键', () => {
  const snapshots = artifactSnapshotsFromDeploymentArtifact({
    certificateVersionId: 'certver_test',
    certificateFormatId: 'certfmt_test',
    format: 'pem',
    containsPrivateKey: true,
    certificatePem: '-----BEGIN CERTIFICATE-----\\nleaf\\n-----END CERTIFICATE-----\\n',
    privateKeyPem: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----\\n',
    files: [],
    warnings: [],
  });

  assert.deepEqual(Object.keys(snapshots), ['certificateArtifact']);
});

test('Tomcat KeyStore 运行材料不携带 PFX 密码', () => {
  const snapshots = artifactSnapshotsFromDeploymentArtifact({
    certificateVersionId: 'certver_test',
    certificateFormatId: 'certfmt_test',
    format: 'pfx',
    containsPrivateKey: true,
    pfxBase64: 'cA==',
    pfxPassword: 'tomcat-current-password',
    sourceKeyStorePassword: 'artifact-default-password',
    files: [],
    warnings: [],
  }, ['certificateArtifact'], { includePfxPassword: false });

  assert.equal(snapshots.certificateArtifact.outputs.pfxBase64, 'cA==');
  assert.equal('pfxPassword' in snapshots.certificateArtifact.outputs, false);
  assert.equal(JSON.stringify(snapshots).includes('tomcat-current-password'), false);
  assert.equal(JSON.stringify(snapshots).includes('artifact-default-password'), false);
});

test('IIS 运行材料仍保留声明的 PFX 密码输出', () => {
  const snapshots = artifactSnapshotsFromDeploymentArtifact({
    certificateVersionId: 'certver_test',
    certificateFormatId: 'certfmt_test',
    format: 'pfx',
    containsPrivateKey: true,
    pfxBase64: 'cA==',
    pfxPassword: 'iis-pfx-password',
    files: [],
    warnings: [],
  }, ['certificateArtifact'], { includePfxPassword: true });

  assert.equal(snapshots.certificateArtifact.outputs.pfxPassword, 'iis-pfx-password');
});
