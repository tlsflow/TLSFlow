import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabasePort } from './database-port.js';

export interface AppliedMigration {
  version: string;
  name: string;
  checksum: string;
  status: 'APPLIED' | 'FAILED';
}

export interface MigrationRunnerOptions {
  appliedBy?: string;
  checksum?: (content: string) => string;
}

export async function runMigrations(
  db: DatabasePort,
  migrationsDir = join(process.cwd(), 'src/database/migrations'),
  options: MigrationRunnerOptions = {},
): Promise<AppliedMigration[]> {
  await ensureMigrationTables(db);
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied: AppliedMigration[] = [];
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const checksum = options.checksum ? options.checksum(sql) : file;
    const [version, ...nameParts] = file.replace(/\.sql$/, '').split('_');
    const name = nameParts.join('_');
    const existing = await db.query<{ version: string; checksum: string; status: string }>(
      'select version, checksum, status from schema_migrations where version = $1',
      [version],
    );
    const record = existing.rows[0];

    if (record) {
      if (record.checksum !== checksum) {
        throw new Error(`迁移 ${version} checksum 不一致，现有=${record.checksum}，当前=${checksum}`);
      }
      if (record.status === 'APPLIED') {
        applied.push({ version, name, checksum, status: 'APPLIED' });
        continue;
      }
      throw new Error(`迁移 ${version} 之前执行失败，必须先处理失败记录`);
    }

    try {
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query(
          `insert into schema_migrations (version, name, checksum, applied_at, applied_by, status)
           values ($1, $2, $3, now(), $4, 'APPLIED')`,
          [version, name, checksum, options.appliedBy ?? 'system'],
        );
        await upsertSchemaVersion(tx, version);
      });
      applied.push({ version, name, checksum, status: 'APPLIED' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await recordMigrationFailure(db, version, name, checksum, options.appliedBy ?? 'system', errorMessage);
      applied.push({ version, name, checksum, status: 'FAILED' });
      throw error;
    }
  }

  return applied;
}

async function ensureMigrationTables(db: DatabasePort): Promise<void> {
  await db.exec(`
    create table if not exists schema_migrations (
      version varchar(32) primary key,
      name varchar(255) not null,
      checksum char(64) not null,
      applied_at timestamptz not null default now(),
      applied_by varchar(128),
      status varchar(32) not null,
      error_message text
    );
  `);

  await db.exec(`
    create table if not exists schema_version_state (
      id varchar(64) primary key,
      current_version varchar(32) not null,
      target_version varchar(32),
      updated_at timestamptz not null default now()
    );
  `);
}

async function upsertSchemaVersion(db: DatabasePort, version: string): Promise<void> {
  const existing = await db.query<{ id: string }>(
    'select id from schema_version_state where id = $1',
    ['current'],
  );

  if (existing.rows[0]) {
    await db.query(
      'update schema_version_state set current_version = $1, target_version = null, updated_at = now() where id = $2',
      [version, 'current'],
    );
    return;
  }

  await db.query(
    'insert into schema_version_state (id, current_version, target_version, updated_at) values ($1, $2, null, now())',
    ['current', version],
  );
}

async function recordMigrationFailure(
  db: DatabasePort,
  version: string,
  name: string,
  checksum: string,
  appliedBy: string,
  errorMessage: string,
): Promise<void> {
  const existing = await db.query<{ version: string }>(
    'select version from schema_migrations where version = $1',
    [version],
  );

  if (existing.rows[0]) {
    await db.query(
      'update schema_migrations set status = $1, error_message = $2, applied_at = now(), applied_by = $3 where version = $4',
      ['FAILED', errorMessage, appliedBy, version],
    );
    return;
  }

  await db.query(
    `insert into schema_migrations (version, name, checksum, applied_at, applied_by, status, error_message)
     values ($1, $2, $3, now(), $4, 'FAILED', $5)`,
    [version, name, checksum, appliedBy, errorMessage],
  );
}
