import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationEventDeliveryService } from './application/automation-event-delivery.service.js';
import { AutomationsApplicationService } from './application/automations.application-service.js';
import { AutomationTriggerRegistry } from './application/automation-trigger-registry.js';
import { AutomationTargetResolverRegistry } from './application/automation-target-resolver.registry.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsRepository } from './repository/automations.repository.js';
import type { TaskEnqueueInput, TaskRun } from '../tasks/task.types.js';

test('证书新版本事件会创建投递并落成自动化运行', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-07T08:00:00.000Z';
  await repository.createAutomation({
    id: 'aut_event',
    tenantId: 'tenant_1',
    name: '证书事件部署',
    status: 'active',
    currentVersion: 1,
    createdBy: 'user_1',
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  await repository.createVersion({
    id: 'autv_event',
    tenantId: 'tenant_1',
    automationId: 'aut_event',
    version: 1,
    trigger: { type: 'certificate_version_created', sources: ['external_source'] },
    filters: [],
    targetResolver: { type: 'certificate_version_targets' },
    approvalStage: undefined,
    actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'automation.result', eventKey: 'completed' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 'c'.repeat(64),
    createdBy: 'user_1',
    createdAt: now,
  });

  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({
    type: 'certificate_version_targets',
    validate: () => undefined,
    resolve: async () => [{
      target: { certificateId: 'cert_asset_1', certificateName: 'example.com', certificateVersionId: 'cert_ver_1', assetId: 'asset_1', assetName: 'Asset 1', environment: 'production', tags: [] },
      executable: true,
    }],
  });
  const automations = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry });
  const deliveryService = new AutomationEventDeliveryService(repository, automations, new AutomationTriggerRegistry(), undefined, () => new Date(now));
  const [deliveryId] = await deliveryService.publishCertificateVersionCreated({
    eventType: 'certificate.version.created',
    tenantId: 'tenant_1',
    eventId: 'evt_1',
    certificateAssetId: 'cert_asset_1',
    certificateVersionId: 'cert_ver_1',
    sourceType: 'acme_issue',
    domains: ['example.com'],
    tags: ['prod'],
    occurredAt: now,
  });

  assert.ok(deliveryId);
  await deliveryService.processDelivery('tenant_1', deliveryId!);
  const deliveries = await repository.listDeliveries('tenant_1', 'aut_event');
  const run = deliveries[0]?.runId ? await repository.getRun(deliveries[0].runId!, 'tenant_1') : undefined;
  assert.equal(deliveries[0]?.status, 'run_created');
  assert.equal(run?.triggerContext?.certificateVersionId, 'cert_ver_1');
});

test('证书事件配置部署时间时先创建等待中的统一任务并计算次日时刻', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-07T08:00:00.000Z';
  await repository.createAutomation({ id: 'aut_wait', tenantId: 'tenant_1', name: '等待部署', status: 'active', currentVersion: 1, createdBy: 'u', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({ id: 'autv_wait', tenantId: 'tenant_1', automationId: 'aut_wait', version: 1, trigger: { type: 'certificate_version_created', deploymentSchedule: { hour: 2, minute: 0, timeZone: 'Asia/Shanghai' } }, filters: [], targetResolver: { type: 'certificate_version_targets' }, approvalStage: undefined, actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'x', eventKey: 'completed' } }], guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false }, checksum: 'c'.repeat(64), createdBy: 'u', createdAt: now });
  const resolverRegistry = new AutomationTargetResolverRegistry();
  resolverRegistry.register({ type: 'certificate_version_targets', validate: () => undefined, resolve: async () => [{ target: { certificateId: 'c', certificateName: 'example.com', certificateVersionId: 'v', assetId: 'a', assetName: 'App', tags: [] }, executable: true }] });
  const queued: TaskEnqueueInput[] = [];
  const tasks = { enqueue: async (input: TaskEnqueueInput): Promise<TaskRun> => { queued.push(input); return {} as TaskRun; } };
  const automations = new AutomationsApplicationService(repository, undefined, () => new Date(now), { resolverRegistry, tasks });
  const deliveryService = new AutomationEventDeliveryService(repository, automations, new AutomationTriggerRegistry(), undefined, () => new Date(now));
  const [deliveryId] = await deliveryService.publishCertificateVersionCreated({ eventType: 'certificate.version.created', tenantId: 'tenant_1', eventId: 'evt', certificateAssetId: 'c', certificateVersionId: 'v', sourceType: 'acme_issue', domains: ['example.com'], tags: [], occurredAt: now });
  await deliveryService.processDelivery('tenant_1', deliveryId!);
  const run = (await repository.listRuns('tenant_1', 'aut_wait'))[0];
  assert.equal(run?.scheduledAt, '2026-08-07T18:00:00.000Z');
  assert.equal(queued[0]?.initialStatus, 'WAITING_RESULT');
  assert.equal(queued[0]?.availableAt, '2026-08-07T18:00:00.000Z');
});

test('专属证书事件只投递到明确绑定所属应用的自动化计划', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-07T08:00:00.000Z';
  for (const [id, assetIds] of [
    ['aut_unbound', undefined],
    ['aut_other_application', ['application_other']],
    ['aut_bound_application', ['application_dedicated']],
  ] as const) {
    await repository.createAutomation({ id, tenantId: 'tenant_1', name: id, status: 'active', currentVersion: 1, createdBy: 'u', createdAt: now, updatedAt: now, version: 1 });
    await repository.createVersion({
      id: `${id}_v1`,
      tenantId: 'tenant_1',
      automationId: id,
      version: 1,
      trigger: { type: 'certificate_version_created', sources: ['manual_import'] },
      filters: [],
      targetResolver: { type: 'certificate_version_targets', ...(assetIds ? { assetIds: [...assetIds] } : {}) },
      approvalStage: undefined,
      actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'x', eventKey: 'completed' } }],
      guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false },
      checksum: id.padEnd(64, '_'),
      createdBy: 'u',
      createdAt: now,
    });
  }
  const automations = new AutomationsApplicationService(repository, undefined, () => new Date(now));
  const deliveryService = new AutomationEventDeliveryService(repository, automations, new AutomationTriggerRegistry(), undefined, () => new Date(now));

  const deliveryIds = await deliveryService.publishCertificateVersionCreated({
    eventType: 'certificate.version.created',
    tenantId: 'tenant_1',
    eventId: 'evt_dedicated',
    certificateAssetId: 'cert_dedicated',
    certificateVersionId: 'version_dedicated',
    applicationAssetId: 'application_dedicated',
    sourceType: 'manual_import',
    domains: ['dedicated.example.test'],
    tags: [],
    occurredAt: now,
  });

  assert.equal(deliveryIds.length, 1);
  const deliveries = await repository.listDeliveries('tenant_1');
  assert.equal(deliveries[0]?.automationId, 'aut_bound_application');
});

test('未明确授权自动化的专属证书事件不会创建投递或自动化运行', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const repository = new AutomationsRepository(db);
  const now = '2026-08-07T08:00:00.000Z';
  await repository.createAutomation({ id: 'aut_suppressed', tenantId: 'tenant_1', name: '专属证书自动化', status: 'active', currentVersion: 1, createdBy: 'u', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({
    id: 'aut_suppressed_v1',
    tenantId: 'tenant_1',
    automationId: 'aut_suppressed',
    version: 1,
    trigger: { type: 'certificate_version_created', sources: ['manual_import'] },
    filters: [],
    targetResolver: { type: 'certificate_version_targets', assetIds: ['application_dedicated'] },
    approvalStage: undefined,
    actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'x', eventKey: 'completed' } }],
    guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false },
    checksum: 's'.repeat(64),
    createdBy: 'u',
    createdAt: now,
  });
  const automations = new AutomationsApplicationService(repository, undefined, () => new Date(now));
  const deliveryService = new AutomationEventDeliveryService(repository, automations, new AutomationTriggerRegistry(), undefined, () => new Date(now));

  const deliveryIds = await deliveryService.publishCertificateVersionCreated({
    eventType: 'certificate.version.created',
    tenantId: 'tenant_1',
    eventId: 'evt_suppressed',
    certificateAssetId: 'cert_dedicated',
    certificateVersionId: 'version_suppressed',
    applicationAssetId: 'application_dedicated',
    automationEligible: false,
    sourceType: 'manual_import',
    domains: ['dedicated.example.test'],
    tags: [],
    occurredAt: now,
  });

  assert.deepEqual(deliveryIds, []);
  assert.deepEqual(await repository.listDeliveries('tenant_1'), []);
  assert.deepEqual(await repository.listRuns('tenant_1', 'aut_suppressed'), []);
});
