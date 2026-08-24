import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLatestDeployableCertificateVersion } from './application/certificate-version-selection.js';
import type { CertificateVersionEntity } from '../certificates/schema/certificates.schema.js';

test('LATEST_AUTO 只在种子证书资产内选择可部署版本', () => {
  const now = Date.parse('2026-07-29T00:00:00.000Z');
  const versions = [
    version('other-newest', 'asset-other', '2027-01-01T00:00:00.000Z'),
    version('selected-old', 'asset-selected', '2026-09-01T00:00:00.000Z'),
    version('selected-latest', 'asset-selected', '2026-10-25T00:00:00.000Z'),
    { ...version('selected-invalid', 'asset-selected', '2026-12-01T00:00:00.000Z'), deployable: false },
  ];

  assert.equal(selectLatestDeployableCertificateVersion(versions, 'asset-selected', now)?.id, 'selected-latest');
});

function version(id: string, certificateAssetId: string, notAfter: string): CertificateVersionEntity {
  return {
    id,
    certificateAssetId,
    versionNo: 1,
    sans: [],
    issuer: { raw: 'issuer' },
    subject: { raw: 'subject' },
    serialNumber: id,
    notBefore: '2026-07-01T00:00:00.000Z',
    notAfter,
    fingerprintSha256: id,
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'SHA256',
    leafStorageRef: `storage://${id}`,
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-07-29T00:00:00.000Z',
  };
}
