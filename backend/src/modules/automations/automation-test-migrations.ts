import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabasePort } from '../../database/database-port.js';

const migrationFiles = [
  '20260721000100_automation_tables.sql',
  '20260807000100_automation_platform_extensions.sql',
  '20260807000300_automation_run_execution_options.sql',
  '20260809000400_automation_canonical_target_resolver.sql',
];

const appliedDatabases = new WeakSet<object>();

export async function applyAutomationMigrations(db: DatabasePort): Promise<void> {
  if (appliedDatabases.has(db)) return;
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(process.cwd(), 'src/database/migrations', file), 'utf8'));
  }
  appliedDatabases.add(db);
}
