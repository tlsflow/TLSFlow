import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { applyAutomationMigrations } from './automation-test-migrations.js';
import { AutomationExternalApiService } from './application/automation-external-api.service.js';
import { AutomationExternalApiKeyRepository } from './repository/automation-external-api-key.repository.js';

test('外部自动化 API Key 只保存摘要并可轮换', async () => {
  const db = new PgliteDatabase();
  await applyAutomationMigrations(db);
  const service = new AutomationExternalApiService(new AutomationExternalApiKeyRepository(db), () => new Date('2026-08-27T00:00:00.000Z'));
  const first = await service.issue({ tenantId: 'tenant_external', automationId: 'aut_external', createdBy: 'user_1', executionMode: 'direct' });
  assert.match(first.key, /^ak_/);
  const authenticated = await service.authenticate(first.key);
  assert.equal(authenticated.automationId, 'aut_external');
  const second = await service.issue({ tenantId: 'tenant_external', automationId: 'aut_external', createdBy: 'user_1', executionMode: 'approval' });
  assert.notEqual(first.key, second.key);
  await assert.rejects(() => service.authenticate(first.key), (error: unknown) => (error as { errorCode?: string }).errorCode === 'AUTH_UNAUTHENTICATED');
  assert.equal((await service.authenticate(second.key)).keyHash.length, 64);
  const stored = await db.query<{ key: string }>('select key_hash as key from automation_external_api_keys');
  assert.equal(stored.rows.some((row) => row.key === first.key || row.key === second.key), false);
});
