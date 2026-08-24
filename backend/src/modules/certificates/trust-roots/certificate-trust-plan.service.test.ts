import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { CertificateTrustPlanService } from './application/certificate-trust-plan.service.js';
import type { RootCertificateRecordDto } from './dto/trust-roots.dto.js';

test('根信任检查只提交 agent.fact.collect，不再直连执行', async () => {
  let payload: Record<string, unknown> | undefined;
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => rootMaterial('abc123'),
      discoverRoot: async () => { throw new Error('不应发现'); },
    },
    agents: {
      enqueueTask: async (_tenantId, input) => {
        payload = input.payload;
        return taskEnvelope('task_fact_collect');
      },
    },
  });

  await assert.rejects(
    service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_1', certificateVersionId: 'certver_1', requestId: 'request_1' }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'EXECUTION_TARGET_UNAVAILABLE'
      && (error.details as { code?: string } | undefined)?.code === 'CERTIFICATE_TRUST_INSPECT_PENDING'
      && (error.details as { asyncPending?: boolean } | undefined)?.asyncPending === true,
  );
  assert.equal(payload?.actionType, 'agent.fact.collect');
  assert.deepEqual(payload?.factKinds, ['certificate_store']);
  assert.equal((payload?.factRequest as Record<string, unknown>).store, 'root');
});

test('根信任检查发现阶段完成后仍必须等待 Agent v2 Receipt', async () => {
  let resolveCount = 0;
  let discoverCount = 0;
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => {
        resolveCount += 1;
        return resolveCount === 1 ? undefined : rootMaterial('def456');
      },
      discoverRoot: async () => {
        discoverCount += 1;
        return { status: 'found', fingerprintSha256: 'def456', root: rootMaterial('def456').root } as never;
      },
    },
    agents: { enqueueTask: async () => taskEnvelope('task_fact_collect_after_discovery') },
  });

  await assert.rejects(
    service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_2', certificateVersionId: 'certver_2', requestId: 'request_2' }),
    (error: unknown) => error instanceof AppError
      && (error.details as { code?: string } | undefined)?.code === 'CERTIFICATE_TRUST_INSPECT_PENDING',
  );
  assert.equal(discoverCount, 1);
});

test('根信任检查无法发现根证书时失败关闭', async () => {
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => undefined,
      discoverRoot: async () => ({ status: 'not_found', fingerprintSha256: 'unknown', failureCode: 'ROOT_NOT_FOUND' } as never),
    },
    agents: { enqueueTask: async () => { throw new Error('不应提交任务'); } },
  });

  await assert.rejects(
    service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_3', certificateVersionId: 'certver_3', requestId: 'request_3' }),
    (error: unknown) => error instanceof AppError
      && (error.details as { code?: string } | undefined)?.code === 'CERTIFICATE_TRUST_ROOT_UNRESOLVED',
  );
});

function rootMaterial(fingerprintSha256: string): { root: RootCertificateRecordDto; certificatePem: string } {
  return {
    root: {
      id: `trustroot_${fingerprintSha256}`,
      fingerprintSha256,
      certificateArtifactRef: `artifact://trust-root/${fingerprintSha256}`,
      subject: { raw: 'CN=Root' },
      issuer: { raw: 'CN=Root' },
      serialNumber: '01',
      notBefore: '2026-01-01T00:00:00.000Z',
      notAfter: '2036-01-01T00:00:00.000Z',
      basicConstraints: { ca: true },
      validationStatus: 'verified',
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    } as RootCertificateRecordDto,
    certificatePem: '-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----\n',
  };
}

function taskEnvelope(id: string) {
  return {
    id,
    tenantId: 'tenant_1',
    agentId: 'agent_1',
    executionRunId: 'run_test',
    executionStepId: 'step_test',
    idempotencyKey: `idem:${id}`,
    payload: {},
    status: 'queued',
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    requestId: 'request_test',
  } as never;
}
