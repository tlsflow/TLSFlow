import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { DeploymentPlansApplicationService } from './application/deployment-plans.application-service.js';
import type { CertificateVersionEntity } from '../certificates/schema/certificates.schema.js';

test('部署计划预检一次返回多个目标的证书产物问题', async () => {
  const certificateVersion = {
    id: 'certver-preflight',
    certificateAssetId: 'certasset-preflight',
    versionNo: 1,
    sans: ['preflight.example.com'],
    issuer: { raw: 'issuer' },
    subject: { raw: 'subject' },
    serialNumber: 'preflight',
    notBefore: '2026-07-01T00:00:00.000Z',
    notAfter: '2026-10-25T00:00:00.000Z',
    fingerprintSha256: 'preflight',
    publicKeyAlgorithm: 'RSA',
    signatureAlgorithm: 'SHA256',
    leafStorageRef: 'storage://preflight',
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    sourceType: 'manual',
    status: 'active',
    createdBy: 'test',
    createdAt: '2026-07-29T00:00:00.000Z',
  } satisfies CertificateVersionEntity;
  const service = new DeploymentPlansApplicationService({
    certificates: {
      getVersion: async (id: string) => id === certificateVersion.id ? certificateVersion : undefined,
    } as never,
    bindings: {
      getCertificateBinding: async () => undefined,
    } as never,
  });

  await assert.rejects(() => service.create({
    name: '聚合预检',
    selectionMode: 'EXPLICIT',
    certificateVersionId: certificateVersion.id,
    idempotencyKey: 'preflight-aggregate',
    actorId: 'user-preflight',
    tenantId: 'tenant-preflight',
    targets: [
      { executorType: 'WORKFLOW', executionTargetId: 'target-1', certificateBindingId: 'missing-binding', strategyPayload: { workflowRequest: {} } },
      { executorType: 'WORKFLOW', executionTargetId: 'target-2', strategyPayload: { workflowRequest: {} } },
    ],
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.errorCode, 'VALIDATION_FAILED');
    const details = error.details as { code?: string; issues?: Array<{ stage: string; targetIndex: number }> };
    assert.equal(details.code, 'DEPLOYMENT_PREFLIGHT_FAILED');
    assert.deepEqual(details.issues?.map((issue) => ({ stage: issue.stage, targetIndex: issue.targetIndex })), [
      { stage: 'TARGET', targetIndex: 0 },
      { stage: 'ARTIFACT', targetIndex: 1 },
    ]);
    return true;
  });
});
