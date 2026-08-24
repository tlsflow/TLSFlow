import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationsApplicationService } from './application/automations.application-service.js';
import { AutomationTargetSelector } from './application/automation-target-selector.js';
import { AutomationsRepository } from './repository/automations.repository.js';

test('按需运行固化版本和目标快照，并由幂等键复用同一运行', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260721000100_automation_tables.sql'), 'utf8'));
  const repository = new AutomationsRepository(db);
  const now = '2026-07-21T00:00:00.000Z';
  await repository.createAutomation({ id: 'aut_run', tenantId: 'tenant_1', name: '批量更新', status: 'active', currentVersion: 1, createdBy: 'u1', createdAt: now, updatedAt: now, version: 1 });
  await repository.createVersion({ id: 'autv_run', tenantId: 'tenant_1', automationId: 'aut_run', version: 1, trigger: { type: 'on_demand' }, targetSelector: {}, actions: [{ type: 'send_notification', position: 1, config: { templateKey: 'result', eventKey: 'done' } }], guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false }, checksum: 'b'.repeat(64), createdBy: 'u1', createdAt: now });
  const targetSelector = new AutomationTargetSelector({ getVersion: async () => ({ id: 'v1', certificateAssetId: 'c1', notAfter: '2026-07-22T00:00:00.000Z', deployable: true }), getAsset: async () => ({ id: 'c1', name: 'cert', status: 'ACTIVE', tags: [] }) } as never, { listCertificateBindings: async () => ({ page: 1, pageSize: 5000, total: 1, items: [{ id: 'b1', tenantId: 'tenant_1', serviceAssetId: 's1', serviceInstanceId: 'i', bindingKey: 'b', bindingType: 'FILE', verifyMethod: 'TLS_CONNECT', status: 'MANAGED', targetCertificateVersionId: 'v1', metadata: {}, createdAt: now, updatedAt: now, version: 1 }] }) } as never, { getServiceAsset: async () => ({ id: 's1', address: 'a', environment: 'production' }), getHost: async () => undefined } as never, undefined, () => new Date(now));
  const service = new AutomationsApplicationService(repository, undefined, () => new Date(now), targetSelector);
  const first = await service.createOnDemandRun('tenant_1', 'u1', 'aut_run', 'manual-key', 1);
  const second = await service.createOnDemandRun('tenant_1', 'u1', 'aut_run', 'manual-key', 1);
  assert.equal(first.id, second.id);
  assert.equal(first.automationVersion, 1);
  assert.equal((await repository.listRunTargets(first.id, 'tenant_1')).length, 1);
  await repository.updateAutomation('aut_run', 'tenant_1', { name: '新名称', currentVersion: 1, updatedAt: now });
  assert.equal((await repository.getRun(first.id, 'tenant_1'))?.automationNameSnapshot, '批量更新');
});
