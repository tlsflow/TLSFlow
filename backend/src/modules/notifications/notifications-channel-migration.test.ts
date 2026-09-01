import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';

test('通知渠道迁移允许七类渠道并拒绝未知类型', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-notification-channel-migration-'));
  const pglite = new PGlite(directory);
  const db = new PgliteDatabase(pglite);
  try {
    await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
    const channelTypes = ['email', 'wecom', 'slack', 'feishu', 'dingtalk', 'telegram', 'webhook'];
    for (const [index, type] of channelTypes.entries()) {
      await db.query(
        `insert into notification_channels
          (id, tenant_id, name, type, status, config, secret_refs, created_at, updated_at)
         values ($1, 'tenant-channel-test', $2, $3, 'disabled', '{}'::jsonb, '{}'::jsonb, now(), now())`,
        [`channel-${index}`, `渠道 ${type}`, type],
      );
    }
    const stored = await db.query<{ type: string }>(
      `select type from notification_channels
        where tenant_id = 'tenant-channel-test'
        order by id`,
    );
    assert.deepEqual(stored.rows.map((row) => row.type), channelTypes);
    await assert.rejects(
      () => db.query(
        `insert into notification_channels
          (id, tenant_id, name, type, status, config, secret_refs, created_at, updated_at)
         values ('channel-invalid', 'tenant-channel-test', '未知渠道', 'pagerduty', 'disabled', '{}'::jsonb, '{}'::jsonb, now(), now())`,
      ),
      /notification_channels_type_check/,
    );
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Outbox 迁移会回填历史 queued/retrying 投递', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gcac-notification-outbox-backfill-'));
  const pglite = new PGlite(directory);
  const db = new PgliteDatabase(pglite);
  try {
    await runMigrations(db, join(process.cwd(), 'src/database/migrations'));
    await db.query(`insert into notification_channels
      (id, tenant_id, name, type, status, config, secret_refs, created_at, updated_at)
      values ('legacy-channel-1', 'tenant-backfill', '历史渠道', 'webhook', 'active', '{}'::jsonb, '{}'::jsonb, now(), now())`);
    await db.query(`insert into notification_requests
      (id, tenant_id, source, event_key, event_id, event_type, occurred_at, payload_version, idempotency_key, template_key, context, source_refs, status, created_at, updated_at)
      values ('legacy-request-1', 'tenant-backfill', 'certificate', 'certificate.status:legacy', 'legacy-1', 'certificate.status', now(), 1, 'legacy-idem-1', 'certificate.status', '{}'::jsonb, '{}'::jsonb, 'queued', now(), now())`);
    await db.query(`insert into notification_deliveries
      (id, tenant_id, request_id, channel_id, channel_name_snapshot, channel_type, status, created_at, updated_at, next_attempt_at)
      values ('legacy-delivery-1', 'tenant-backfill', 'legacy-request-1', 'legacy-channel-1', '历史渠道', 'webhook', 'queued', now(), now(), now())`);
    const migration = await readFile(join(process.cwd(), 'src/database/migrations/20260828060000_notification_delivery_outbox.sql'), 'utf8');
    await db.exec(migration);
    const result = await db.query<{ status: string; delivery_id: string; dispatch_generation: number }>(
      `select status, delivery_id, dispatch_generation
         from notification_dispatch_outbox
        where tenant_id = 'tenant-backfill' and delivery_id = 'legacy-delivery-1'`,
    );
    assert.deepEqual(result.rows.map((row) => ({ status: row.status, deliveryId: row.delivery_id, generation: Number(row.dispatch_generation) })), [
      { status: 'queued', deliveryId: 'legacy-delivery-1', generation: 1 },
    ]);
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
