import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabasePort } from '../../database/database-port.js';

const migrationFiles = [
  '20260823000000_unified_current_baseline.sql',
  '20260827120000_automation_external_api.sql',
];

const appliedDatabases = new WeakSet<object>();

export async function applyAutomationMigrations(db: DatabasePort): Promise<void> {
  if (appliedDatabases.has(db)) return;
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(process.cwd(), 'src/database/migrations', file), 'utf8'));
  }
  appliedDatabases.add(db);
}
