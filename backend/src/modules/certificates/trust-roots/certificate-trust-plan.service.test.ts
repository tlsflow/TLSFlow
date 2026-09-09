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
      findTaskByIdempotencyKey: async () => undefined,
      createFactCollectionRequest: async (_tenantId, _agentId, _requestedBy, requestId) => ({
        requestId,
        payload: signedFactCollectPayload(),
      } as never),
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
  assert.equal(payload?.actionSchemaVersion, '1.0');
  assert.equal(payload?.refreshWebInventory, false);
  assert.equal(payload?.token !== undefined, true);
  assert.equal(payload?.policyDecision !== undefined, true);
  assert.equal(payload?.factKinds, undefined);
  assert.equal(payload?.factRequest, undefined);
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
    agents: {
      findTaskByIdempotencyKey: async () => undefined,
      createFactCollectionRequest: async (_tenantId, _agentId, _requestedBy, requestId) => ({ requestId, payload: signedFactCollectPayload() }),
      enqueueTask: async () => taskEnvelope('task_fact_collect_after_discovery'),
    },
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
    agents: {
      findTaskByIdempotencyKey: async () => undefined,
      createFactCollectionRequest: async () => { throw new Error('不应生成请求'); },
      enqueueTask: async () => { throw new Error('不应提交任务'); },
    },
  });

  await assert.rejects(
    service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_3', certificateVersionId: 'certver_3', requestId: 'request_3' }),
    (error: unknown) => error instanceof AppError
      && (error.details as { code?: string } | undefined)?.code === 'CERTIFICATE_TRUST_ROOT_UNRESOLVED',
  );
});

test('根信任检查复用成功 Receipt 并生成安装或跳过决策', async () => {
  const material = rootMaterial('a'.repeat(64));
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => material,
      discoverRoot: async () => { throw new Error('不应发现'); },
    },
    agents: {
      findTaskByIdempotencyKey: async () => ({
        ...(taskEnvelope('task_fact_collect_succeeded') as unknown as Record<string, unknown>),
        status: 'succeeded',
        result: {
          success: true,
          status: 'SUCCESS',
          detail: {
            factEnvelope: {
              digest: 'b'.repeat(64),
              facts: [{ kind: 'certificate_store', sha256Fingerprint: 'a'.repeat(64), store: 'root', subject: 'CN=Root', thumbprint: 'AA', hasPrivateKey: false }],
            },
          },
        },
      } as never),
      createFactCollectionRequest: async () => { throw new Error('已有 Receipt 时不应重新生成请求'); },
      enqueueTask: async () => { throw new Error('已有 Receipt 时不应重新提交任务'); },
    },
  });

  const result = await service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_1', certificateVersionId: 'certver_1', requestId: 'request_3' });
  assert.equal(result.plan.decision, 'skip');
  assert.equal(result.plan.inspection.status, 'found');
});

test('根信任检查已有活动事实任务时只等待原任务，不重新生成授权或提交任务', async () => {
  let requestCount = 0;
  let enqueueCount = 0;
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => rootMaterial('e'.repeat(64)),
      discoverRoot: async () => { throw new Error('不应发现'); },
    },
    agents: {
      findTaskByIdempotencyKey: async () => ({ ...(taskEnvelope('task_fact_collect_active') as unknown as Record<string, unknown>), status: 'acked' } as never),
      createFactCollectionRequest: async () => { requestCount += 1; throw new Error('已有活动任务时不应重新生成授权'); },
      enqueueTask: async () => { enqueueCount += 1; throw new Error('已有活动任务时不应重复提交'); },
    },
  });

  await assert.rejects(
    service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_1', certificateVersionId: 'certver_active', requestId: 'request_active' }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'EXECUTION_TARGET_UNAVAILABLE'
      && (error.details as { taskId?: string } | undefined)?.taskId === 'task_fact_collect_active'
      && (error.details as { asyncPending?: boolean } | undefined)?.asyncPending === true,
  );
  assert.equal(requestCount, 0);
  assert.equal(enqueueCount, 0);
});

test('历史失败的根信任检查不会阻断新的部署会话', async () => {
  let enqueuedIdempotencyKey: string | undefined;
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => rootMaterial('d'.repeat(64)),
      discoverRoot: async () => { throw new Error('不应发现'); },
    },
    agents: {
      // 历史失败任务使用旧的、无会话摘要的键；新的会话查询到的是新键，因此没有旧任务。
      findTaskByIdempotencyKey: async (_tenantId, _agentId, idempotencyKey) => {
        assert.match(idempotencyKey, /:d{64}:[a-f0-9]{64}$/);
        return undefined;
      },
      createFactCollectionRequest: async (_tenantId, _agentId, _requestedBy, requestId) => ({ requestId, payload: signedFactCollectPayload() }),
      enqueueTask: async (_tenantId, input) => {
        enqueuedIdempotencyKey = input.idempotencyKey;
        return taskEnvelope('task_fact_collect_retry');
      },
    },
  });

  await assert.rejects(
    service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_1', certificateVersionId: 'certver_retry', requestId: 'new-session' }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'EXECUTION_TARGET_UNAVAILABLE'
      && (error.details as { code?: string } | undefined)?.code === 'CERTIFICATE_TRUST_INSPECT_PENDING',
  );
  assert.match(enqueuedIdempotencyKey ?? '', /:d{64}:[a-f0-9]{64}$/);
});

test('根信任检查 Receipt 缺少事实快照时失败关闭', async () => {
  const material = rootMaterial('c'.repeat(64));
  const service = new CertificateTrustPlanService({
    trustRoots: {
      resolveVersionInstallableRoot: async () => material,
      discoverRoot: async () => { throw new Error('不应发现'); },
    },
    agents: {
      findTaskByIdempotencyKey: async () => ({ ...(taskEnvelope('task_fact_collect_invalid') as unknown as Record<string, unknown>), status: 'succeeded', result: { success: true, status: 'SUCCESS', detail: {} } } as never),
      createFactCollectionRequest: async () => { throw new Error('无效 Receipt 时不应重新生成请求'); },
      enqueueTask: async () => { throw new Error('无效 Receipt 时不应重新提交任务'); },
    },
  });

  await assert.rejects(
    service.build({ tenantId: 'tenant_1', actorId: 'tester', agentId: 'agent_1', certificateVersionId: 'certver_invalid_receipt', requestId: 'request_invalid_receipt' }),
    (error: unknown) => error instanceof AppError
      && error.errorCode === 'VALIDATION_FAILED'
      && (error.details as { code?: string } | undefined)?.code === 'CERTIFICATE_TRUST_INSPECT_INVALID',
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

function signedFactCollectPayload(): Record<string, unknown> {
  return {
    actionType: 'agent.fact.collect',
    actionSchemaVersion: '1.0',
    requestId: 'request_fact_collect',
    agentId: 'agent_1',
    tenantId: 'tenant_1',
    pluginId: 'web.nginx',
    pluginVersion: 'plgver_discovery',
    capability: 'application.discover',
    actions: ['filesystem.read', 'process.list', 'service.list'],
    paths: [],
    services: [],
    artifactDigests: [],
    planDigest: 'a'.repeat(64),
    token: { tokenVersion: 'gcac.agent-security/v1' },
    policyDecision: { decisionVersion: 'gcac.agent-security/v1' },
    refreshWebInventory: false,
  };
}
