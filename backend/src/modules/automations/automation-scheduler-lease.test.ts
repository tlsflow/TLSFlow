import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AutomationsRepository } from './repository/automations.repository.js';

test('同一租约窗口只有一个调度实例获得租约', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260721000100_automation_tables.sql'), 'utf8'));
  const repository = new AutomationsRepository(db);
  const until = new Date(Date.now() + 60_000);
  assert.equal(await repository.acquireSchedulerLease('lease_1', 'worker_a', until), true);
  assert.equal(await repository.acquireSchedulerLease('lease_1', 'worker_b', until), false);
});
