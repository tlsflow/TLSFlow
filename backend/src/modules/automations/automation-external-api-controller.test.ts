import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import { Router } from '../../common/http/router.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createSecurityServices } from '../security/security.controller.js';
import { AutomationTargetResolverRegistry } from './application/automation-target-resolver.registry.js';
import { AutomationsApplicationService } from './application/automations.application-service.js';
import { AutomationExternalApiService } from './application/automation-external-api.service.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsController } from './controller/automations.controller.js';
import { AutomationExternalApiKeyRepository } from './repository/automation-external-api-key.repository.js';
import { AutomationsRepository } from './repository/automations.repository.js';

function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): HttpRequest {
  return {
    method,
    path,
    query: {},
    headers,
    body,
    context: { requestId: `req-${method}-${path}`, traceId: 'trace-external-api', tenantId: 'tenant_external', actorId: 'user_external' },
  };
}

test('外部 API 运行闭环固定为直接执行并可查询，重复幂等键不重复入队且不创建内部审批', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-28T00:00:00.000Z';
  await repository.createAutomation({
    id: 'aut_external_controller',
    tenantId: 'tenant_external',
    name: '外部入口自动化',
    status: 'draft',
    currentVersion: 1,
    createdBy: 'user_external',
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  await repository.createVersion({
    id: 'autv_external_controller',
    tenantId: 'tenant_external',
    automationId: 'aut_external_controller',
    version: 1,
    trigger: { type: 'api' },
    externalApi: { executionMode: 'approval' },
    filters: [{ field: 'event.domains', operator: 'contains_any', value: ['example.com'] }],
    targetResolver: { type: 'certificate_version_targets' },
    actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'result', eventKey: 'completed' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: true },
    checksum: 'c'.repeat(64),
    createdBy: 'user_external',
    createdAt: now,
  });

  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({
    type: 'certificate_version_targets',
    validate: () => undefined,
    resolve: async (input) => [{
      target: {
        certificateId: 'certificate-1',
        certificateName: 'example.com',
        certificateVersionId: input.triggerContext?.certificateVersionId,
        assetId: 'application-1',
        assetName: '应用 1',
        environment: 'production',
        tags: [],
      },
      executable: true,
    }],
  });
  const enqueuedRuns: string[] = [];
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), {
    resolverRegistry,
    tasks: {
      enqueue: async (input: { payload?: Record<string, unknown> }) => {
        enqueuedRuns.push(String(input.payload?.runId));
        return { id: `task-${enqueuedRuns.length}` } as never;
      },
    },
  });
  const security = createSecurityServices();
  await security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_external',
    actions: ['automation.*'],
    resourceTypes: ['automation'],
    scope: { tenantId: 'tenant_external' },
    effect: 'allow',
  });
  let approvalCreates = 0;
  const approvals = security.approvals as unknown as { create: (...args: unknown[]) => Promise<unknown> };
  const originalCreate = approvals.create.bind(security.approvals);
  approvals.create = async (...args: unknown[]) => {
    approvalCreates += 1;
    return originalCreate(...args);
  };
  const externalApi = new AutomationExternalApiService(new AutomationExternalApiKeyRepository(db), () => new Date(now));
  const router = new Router();
  new AutomationsController(service, security, undefined, externalApi).register(router);

  const enabled = await router.match('POST', '/api/v1/automations/aut_external_controller/actions/enable')!.handler(
    request('POST', '/api/v1/automations/aut_external_controller/actions/enable', { expectedVersion: 1 }),
  ) as { externalApiKey: string; externalApiExecutionMode: string };
  assert.equal(enabled.externalApiExecutionMode, 'direct');
  const apiHeaders = { 'x-automation-api-key': enabled.externalApiKey, 'idempotency-key': 'enterprise-run-1' };
  const first = await router.match('POST', '/api/v1/automation-external/aut_external_controller/run')!.handler(
    request('POST', '/api/v1/automation-external/aut_external_controller/run', { certificateVersionId: 'cert-version-1' }, apiHeaders),
  ) as { statusCode: number; body: { id: string; status: string; approvalId?: string; triggerContext?: { sourceType?: string; certificateVersionId?: string } } };
  assert.equal(first.statusCode, 201);
  assert.equal(first.body.status, 'queued');
  assert.equal(first.body.approvalId, undefined);
  assert.equal(first.body.triggerContext?.sourceType, 'external_api');
  assert.equal(first.body.triggerContext?.certificateVersionId, 'cert-version-1');

  const repeated = await router.match('POST', '/api/v1/automation-external/aut_external_controller/run')!.handler(
    request('POST', '/api/v1/automation-external/aut_external_controller/run', { certificateVersionId: 'cert-version-1' }, apiHeaders),
  ) as { body: { id: string } };
  assert.equal(repeated.body.id, first.body.id);
  assert.deepEqual(enqueuedRuns, [first.body.id]);
  assert.equal(approvalCreates, 0);

  const queried = await router.match('GET', `/api/v1/automation-runs/${first.body.id}`)!.handler(
    request('GET', `/api/v1/automation-runs/${first.body.id}`),
  ) as { id: string; triggerContext?: { sourceType?: string } };
  assert.equal(queried.id, first.body.id);
  assert.equal(queried.triggerContext?.sourceType, 'external_api');
});

test('外部 API 拒绝不存在、跨租户和域名不匹配的证书版本', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-28T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_external_validation', tenantId: 'tenant_external', name: '外部校验', status: 'active', currentVersion: 1, createdBy: 'user_external', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'autv_external_validation',
    tenantId: 'tenant_external',
    automationId: 'aut_external_validation',
    version: 1,
    trigger: { type: 'api' },
    filters: [{ field: 'event.domains', operator: 'contains_any', value: ['example.com'] }],
    targetResolver: { type: 'certificate_version_targets' },
    actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'result', eventKey: 'completed' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'v'.repeat(64),
    createdBy: 'user_external',
    createdAt: now,
  });
  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({
    type: 'certificate_version_targets',
    validate: () => undefined,
    resolve: async (input) => {
      const certificateVersionId = input.triggerContext?.certificateVersionId;
      if (certificateVersionId === 'wrong-domain') throw new AppError('VALIDATION_FAILED', '证书版本不属于自动化预设域名');
      if (certificateVersionId === 'missing-version' || certificateVersionId === 'cross-tenant-version') {
        return [{ target: { certificateId: 'missing', certificateName: 'missing', certificateVersionId, tags: [] }, executable: false, excludedReason: 'missing_version' }];
      }
      return [{ target: { certificateId: 'certificate-1', certificateName: 'example.com', certificateVersionId, assetId: 'application-1', tags: [] }, executable: true }];
    },
  });
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry });
  const externalApi = new AutomationExternalApiService(new AutomationExternalApiKeyRepository(db), () => new Date(now));
  const issued = await externalApi.issue({ tenantId: 'tenant_external', automationId: 'aut_external_validation', createdBy: 'user_external', executionMode: 'direct' });
  const router = new Router();
  new AutomationsController(service, undefined, undefined, externalApi).register(router);
  const run = async (certificateVersionId: string, path = '/api/v1/automation-external/aut_external_validation/run') => router.match('POST', path)!.handler(
    request('POST', path, { certificateVersionId }, { 'x-automation-api-key': issued.key, 'idempotency-key': `key-${certificateVersionId}` }),
  );

  await assert.rejects(() => run('missing-version'), (error: unknown) => error instanceof AppError && error.errorCode === 'RESOURCE_NOT_FOUND');
  await assert.rejects(() => run('cross-tenant-version'), (error: unknown) => error instanceof AppError && error.errorCode === 'RESOURCE_NOT_FOUND');
  await assert.rejects(() => run('wrong-domain'), (error: unknown) => error instanceof AppError && error.errorCode === 'VALIDATION_FAILED');
  await assert.rejects(() => run('valid-version', '/api/v1/automation-external/another-automation/run'), (error: unknown) => error instanceof AppError && error.errorCode === 'AUTH_UNAUTHENTICATED');
});
