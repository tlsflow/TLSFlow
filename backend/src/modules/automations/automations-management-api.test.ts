import assert from 'node:assert/strict';
import test from 'node:test';
import { Router } from '../../common/http/router.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { createSecurityServices } from '../security/security.controller.js';
import { AutomationsApplicationService } from './application/automations.application-service.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsController } from './controller/automations.controller.js';
import { AutomationsRepository } from './repository/automations.repository.js';

async function setup() {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const previousKek = process.env.GCAC_SECRET_KEK;
  process.env.GCAC_SECRET_KEK = 'a'.repeat(64);
  let security;
  try {
    security = createSecurityServices();
  } finally {
    if (previousKek === undefined) delete process.env.GCAC_SECRET_KEK;
    else process.env.GCAC_SECRET_KEK = previousKek;
  }
  await security.rbac.createPolicy({ subjectType: 'user', subjectId: 'user_admin', actions: ['automation.*'], resourceTypes: ['automation'], scope: { tenantId: 'tenant_1' }, effect: 'allow' });
  const service = new AutomationsApplicationService(new AutomationsRepository(db), undefined, () => new Date('2026-07-21T00:00:00.000Z'));
  const router = new Router();
  new AutomationsController(service, security).register(router);
  return { router, security };
}

function request(method: string, path: string, body?: unknown, actorId = 'user_admin'): HttpRequest {
  return { method, path, query: {}, headers: {}, body, context: { requestId: 'req_1', traceId: 'trace_1', tenantId: 'tenant_1', actorId } };
}

const createBody = {
  name: '生产证书更新', trigger: { type: 'on_demand' as const }, targetResolver: { type: 'certificate_version_targets' as const, assetIds: ['asset_1'] },
  actions: [{ type: 'send_notification' as const, position: 1, config: { templateKey: 'automation.result', eventKey: 'completed' } }],
  guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: true },
};

test('CRUD、复制、启停和软删除均写入审计', async () => {
  const { router, security } = await setup();
  const createResponse = await router.match('POST', '/api/v1/automations')!.handler(request('POST', '/api/v1/automations', createBody)) as { body: { id: string; version: number } };
  const id = createResponse.body.id;
  await router.match('PATCH', `/api/v1/automations/${id}`)!.handler(request('PATCH', `/api/v1/automations/${id}`, { expectedVersion: 1, name: '更新后的名称', configuration: { trigger: createBody.trigger, targetResolver: createBody.targetResolver, actions: createBody.actions, guardrails: createBody.guardrails } }));
  const copied = await router.match('POST', `/api/v1/automations/${id}/actions/copy`)!.handler(request('POST', `/api/v1/automations/${id}/actions/copy`)) as { body: { id: string } };
  assert.notEqual(copied.body.id, id);
  await router.match('POST', `/api/v1/automations/${id}/actions/enable`)!.handler(request('POST', `/api/v1/automations/${id}/actions/enable`, { expectedVersion: 2 }));
  await router.match('POST', `/api/v1/automations/${id}/actions/disable`)!.handler(request('POST', `/api/v1/automations/${id}/actions/disable`, { expectedVersion: 3 }));
  await router.match('DELETE', `/api/v1/automations/${id}`)!.handler(request('DELETE', `/api/v1/automations/${id}`, { expectedVersion: 4 }));
  const events = await security.audit.query({ resourceType: 'automation' });
  assert.deepEqual(events.map((event) => event.eventType), ['automation.created', 'automation.updated', 'automation.copied', 'automation.enabled', 'automation.disabled', 'automation.deleted']);
});

test('无权限用户无法读取或创建自动化', async () => {
  const { router } = await setup();
  await assert.rejects(() => router.match('GET', '/api/v1/automations')!.handler(request('GET', '/api/v1/automations', undefined, 'user_denied')) as Promise<unknown>);
  await assert.rejects(() => router.match('POST', '/api/v1/automations')!.handler(request('POST', '/api/v1/automations', createBody, 'user_denied')) as Promise<unknown>);
});

test('一次性自动化启用时写入固定执行时间，过期时间被拒绝', async () => {
  const { router } = await setup();
  const onceBody = { ...createBody, name: '一次性证书更新', trigger: { type: 'once' as const, runAt: '2026-07-23T01:00:00.000Z' } };
  const created = await router.match('POST', '/api/v1/automations')!.handler(request('POST', '/api/v1/automations', onceBody)) as { body: { id: string; version: number } };
  const enabled = await router.match('POST', `/api/v1/automations/${created.body.id}/actions/enable`)!.handler(request('POST', `/api/v1/automations/${created.body.id}/actions/enable`, { expectedVersion: created.body.version })) as { nextRunAt?: string };
  assert.equal(enabled.nextRunAt, onceBody.trigger.runAt);

  const expiredBody = { ...createBody, name: '过期一次性证书更新', trigger: { type: 'once' as const, runAt: '2026-07-20T01:00:00.000Z' } };
  const expired = await router.match('POST', '/api/v1/automations')!.handler(request('POST', '/api/v1/automations', expiredBody)) as { body: { id: string; version: number } };
  await assert.rejects(() => router.match('POST', `/api/v1/automations/${expired.body.id}/actions/enable`)!.handler(request('POST', `/api/v1/automations/${expired.body.id}/actions/enable`, { expectedVersion: expired.body.version })) as Promise<unknown>);
});
