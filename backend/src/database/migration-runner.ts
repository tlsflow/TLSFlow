import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabasePort } from './database-port.js';

export interface AppliedMigration {
  version: string;
  name: string;
}

export async function runMigrations(db: DatabasePort, migrationsDir = join(process.cwd(), 'src/database/migrations')): Promise<AppliedMigration[]> {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: AppliedMigration[] = [];
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await db.exec(sql);
    const [version, ...nameParts] = file.replace(/\\.sql$/, '').split('_');
    applied.push({ version, name: nameParts.join('_') });
  }
  return applied;
}
