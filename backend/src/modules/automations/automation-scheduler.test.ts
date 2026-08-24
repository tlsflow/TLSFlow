import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationScheduler, cronMatches, nextCronOccurrence } from './application/automation-scheduler.js';
import { AutomationsRepository } from './repository/automations.repository.js';

test('Cron 按目标时区匹配并计算下一次触发', () => {
  const trigger = { type: 'schedule' as const, cron: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' };
  const now = new Date('2026-07-20T00:00:00.000Z');
  assert.equal(cronMatches(trigger.cron, new Date('2026-07-20T01:00:00.000Z'), trigger.timeZone), true);
  assert.equal(nextCronOccurrence(trigger, now)?.toISOString(), '2026-07-20T01:00:00.000Z');
});

test('不合法时区由 Intl 直接拒绝', () => {
  assert.throws(() => cronMatches('0 0 * * *', new Date(), 'Invalid/Zone'));
});

test('Cron 下一次时间遵守生效起止范围', () => {
  const trigger = { type: 'schedule' as const, cron: '0 9 * * *', timeZone: 'Asia/Shanghai', startsAt: '2026-07-23T00:00:00.000Z', endsAt: '2026-07-23T02:00:00.000Z' };
  assert.equal(nextCronOccurrence(trigger, new Date('2026-07-22T00:00:00.000Z'))?.toISOString(), '2026-07-23T01:00:00.000Z');
  assert.equal(nextCronOccurrence({ ...trigger, endsAt: '2026-07-23T00:30:00.000Z' }, new Date('2026-07-22T00:00:00.000Z')), undefined);
});

test('到期扫描使用 schedule 幂等键并更新下一次运行时间', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260721000100_automation_tables.sql'), 'utf8'));
  const repository = new AutomationsRepository(db);
  const now = new Date(Date.now() + 60_000);
  const scheduledAt = new Date(now.getTime() - 60_000).toISOString();
  await repository.createAutomation({ id: 'automation_schedule', tenantId: 'tenant_schedule', name: 'Scheduled', status: 'active', currentVersion: 1, nextRunAt: scheduledAt, createdBy: 'user_1', createdAt: scheduledAt, updatedAt: scheduledAt, version: 1 });
  await repository.createVersion({ id: 'version_schedule', tenantId: 'tenant_schedule', automationId: 'automation_schedule', version: 1, trigger: { type: 'schedule', cron: '* * * * *', timeZone: 'Asia/Shanghai' }, targetSelector: {}, actions: [], guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false }, checksum: 'a'.repeat(64), createdBy: 'user_1', createdAt: scheduledAt });
  const calls: unknown[][] = [];
  const service = { createOnDemandRun: async (...args: unknown[]) => { calls.push(args); return { id: 'run_schedule' }; } };
  const scheduler = new AutomationScheduler(repository, service as never, { execute: async () => undefined }, 'worker_schedule', { now: () => now });
  assert.deepEqual(await scheduler.scan('tenant_schedule'), ['run_schedule']);
  assert.deepEqual(calls[0], ['tenant_schedule', 'system_scheduler', 'automation_schedule', `schedule:automation_schedule:${scheduledAt}`, 1, { triggerType: 'schedule', scheduledAt }]);
  const updated = await repository.getAutomationOrThrow('automation_schedule', 'tenant_schedule');
  assert.equal(updated.lastRunAt, scheduledAt);
  assert.ok(updated.nextRunAt && new Date(updated.nextRunAt) > now);
});

test('一次性计划到期后只创建一次运行并清空下次运行时间', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260721000100_automation_tables.sql'), 'utf8'));
  const repository = new AutomationsRepository(db);
  const now = new Date('2026-07-23T02:00:00.000Z');
  const scheduledAt = '2026-07-23T01:00:00.000Z';
  await repository.createAutomation({ id: 'automation_once', tenantId: 'tenant_once', name: 'Once', status: 'active', currentVersion: 1, nextRunAt: scheduledAt, createdBy: 'user_1', createdAt: scheduledAt, updatedAt: scheduledAt, version: 1 });
  await repository.createVersion({ id: 'version_once', tenantId: 'tenant_once', automationId: 'automation_once', version: 1, trigger: { type: 'once', runAt: scheduledAt }, targetSelector: {}, actions: [], guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false }, checksum: 'b'.repeat(64), createdBy: 'user_1', createdAt: scheduledAt });
  const calls: unknown[][] = [];
  const service = { createOnDemandRun: async (...args: unknown[]) => { calls.push(args); return { id: 'run_once' }; } };
  const scheduler = new AutomationScheduler(repository, service as never, { execute: async () => undefined }, 'worker_once', { now: () => now });
  assert.deepEqual(await scheduler.scan('tenant_once'), ['run_once']);
  assert.deepEqual(calls[0], ['tenant_once', 'system_scheduler', 'automation_once', `once:automation_once:${scheduledAt}`, 1, { triggerType: 'schedule', scheduledAt }]);
  const updated = await repository.getAutomationOrThrow('automation_once', 'tenant_once');
  assert.equal(updated.lastRunAt, scheduledAt);
  assert.equal(updated.nextRunAt, undefined);
});
