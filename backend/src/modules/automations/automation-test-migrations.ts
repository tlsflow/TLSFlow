import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabasePort } from '../../database/database-port.js';

const migrationFiles = [
  '20260721000100_automation_tables.sql',
  '20260807000100_automation_platform_extensions.sql',
  '20260807000300_automation_run_execution_options.sql',
];

export async function applyAutomationMigrations(db: DatabasePort): Promise<void> {
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(process.cwd(), 'src/database/migrations', file), 'utf8'));
  }
}
