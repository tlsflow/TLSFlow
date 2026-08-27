import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationEventDeliveryService } from './application/automation-event-delivery.service.js';
import { AutomationsApplicationService } from './application/automations.application-service.js';
import { AutomationTriggerRegistry } from './application/automation-trigger-registry.js';
import { AutomationTargetResolverRegistry } from './application/automation-target-resolver.registry.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationsRepository } from './repository/automations.repository.js';

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
