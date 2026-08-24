import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { CertificateTrustPlanService } from './application/certificate-trust-plan.service.js';

function agentTask(id: string) {
  return {
    id,
    tenantId: 'tenant_1',
    agentId: 'agt_test',
    executionRunId: 'run_test',
    executionStepId: 'step_test',
    idempotencyKey: `idem:${id}`,
    payload: {},
    status: 'acked',
    leaseId: `direct:${id}`,
    ackedAt: '2026-08-07T00:00:00.000Z',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    requestId: 'req_test',
  } as const;
}

test('CertificateTrustPlanService 在宿主已信任根证书时返回 skip', async () => {
  let enqueueCount = 0;
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => ({
        root: {
          id: 'trustroot_1',
          fingerprintSha256: 'abc123',
          certificateArtifactRef: 'artifact://trust-root/abc123',
          subject: { raw: 'CN=Root' },
          issuer: { raw: 'CN=Root' },
          serialNumber: '01',
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2036-01-01T00:00:00.000Z',
          basicConstraints: { ca: true },
          validationStatus: 'verified',
          createdAt: '2026-08-07T00:00:00.000Z',
          updatedAt: '2026-08-07T00:00:00.000Z',
        },
        certificatePem: '-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----\n',
      }),
      discoverRoot: async () => {
        throw new Error('should not discover');
      },
    },
    agents: {
      enqueueDirectTask: async () => {
        enqueueCount += 1;
        return agentTask('task_1');
      },
      executeTaskDirect: async () => ({
        task: {} as never,
        success: true,
        detail: {
          status: 'found',
          fingerprintSha256: 'abc123',
          certificatePem: '-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----\n',
        },
      }),
    },
  });

  const result = await service.build({
    tenantId: 'tenant_1',
    actorId: 'tester',
    agentId: 'agt_1',
    certificateVersionId: 'certver_1',
    requestId: 'req_1',
  });

  assert.equal(enqueueCount, 1);
  assert.equal(result.plan.decision, 'skip');
  assert.equal(result.plan.reasonCode, 'root_already_trusted');
  assert.equal(result.plan.fingerprintSha256, 'abc123');
});

test('CertificateTrustPlanService 在宿主缺根时返回 install，并允许先触发定向发现', async () => {
  let resolveCount = 0;
  let discoverCount = 0;
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => {
        resolveCount += 1;
        if (resolveCount === 1) return undefined;
        return {
          root: {
            id: 'trustroot_2',
            fingerprintSha256: 'def456',
            certificateArtifactRef: 'artifact://trust-root/def456',
            subject: { raw: 'CN=Root2' },
            issuer: { raw: 'CN=Root2' },
            serialNumber: '02',
            notBefore: '2026-01-01T00:00:00.000Z',
            notAfter: '2036-01-01T00:00:00.000Z',
            basicConstraints: { ca: true },
            validationStatus: 'verified',
            createdAt: '2026-08-07T00:00:00.000Z',
            updatedAt: '2026-08-07T00:00:00.000Z',
          },
          certificatePem: '-----BEGIN CERTIFICATE-----\nROOT2\n-----END CERTIFICATE-----\n',
        };
      },
      discoverRoot: async () => {
        discoverCount += 1;
        return {
          status: 'found',
          fingerprintSha256: 'def456',
          root: {
            id: 'trustroot_2',
            fingerprintSha256: 'def456',
            certificateArtifactRef: 'artifact://trust-root/def456',
            subject: { raw: 'CN=Root2' },
            issuer: { raw: 'CN=Root2' },
            serialNumber: '02',
            notBefore: '2026-01-01T00:00:00.000Z',
            notAfter: '2036-01-01T00:00:00.000Z',
            basicConstraints: { ca: true },
            validationStatus: 'verified',
            createdAt: '2026-08-07T00:00:00.000Z',
            updatedAt: '2026-08-07T00:00:00.000Z',
          },
        };
      },
    },
    agents: {
      enqueueDirectTask: async () => agentTask('task_2'),
      executeTaskDirect: async () => ({
        task: {} as never,
        success: true,
        detail: { status: 'not_found', fingerprintSha256: 'def456' },
      }),
    },
  });

  const result = await service.build({
    tenantId: 'tenant_1',
    actorId: 'tester',
    agentId: 'agt_2',
    certificateVersionId: 'certver_2',
    requestId: 'req_2',
  });

  assert.equal(discoverCount, 1);
  assert.equal(result.plan.decision, 'install');
  assert.equal(result.plan.reasonCode, 'root_missing_install_required');
  assert.equal(result.plan.certificatePem.includes('ROOT2'), true);
});

test('CertificateTrustPlanService 对 inspect 指纹不一致失败关闭', async () => {
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => ({
        root: {
          id: 'trustroot_3',
          fingerprintSha256: 'abc123',
          certificateArtifactRef: 'artifact://trust-root/abc123',
          subject: { raw: 'CN=Root3' },
          issuer: { raw: 'CN=Root3' },
          serialNumber: '03',
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2036-01-01T00:00:00.000Z',
          basicConstraints: { ca: true },
          validationStatus: 'verified',
          createdAt: '2026-08-07T00:00:00.000Z',
          updatedAt: '2026-08-07T00:00:00.000Z',
        },
        certificatePem: '-----BEGIN CERTIFICATE-----\nROOT3\n-----END CERTIFICATE-----\n',
      }),
      discoverRoot: async () => {
        throw new Error('should not discover');
      },
    },
    agents: {
      enqueueDirectTask: async () => agentTask('task_3'),
      executeTaskDirect: async () => ({
        task: {} as never,
        success: true,
        detail: { status: 'found', fingerprintSha256: 'ffff' },
      }),
    },
  });

  await assert.rejects(() => service.build({
    tenantId: 'tenant_1',
    actorId: 'tester',
    agentId: 'agt_3',
    certificateVersionId: 'certver_3',
    requestId: 'req_3',
  }), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal((error.details as { code?: string } | undefined)?.code, 'CERTIFICATE_TRUST_INSPECT_MISMATCH');
    return true;
  });
});
