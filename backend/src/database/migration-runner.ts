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
  /** 仅在明确授权时重试 FAILED 迁移；APPLIED 记录始终严格校验 checksum。 */
  retryFailedMigrations?: boolean;
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
  const migrationFiles = files.map((file) => {
    const [version, ...nameParts] = file.replace(/\.sql$/, '').split('_');
    return { file, version, name: nameParts.join('_') };
  });
  const versionCounts = new Map<string, number>();
  for (const migration of migrationFiles) {
    versionCounts.set(migration.version, (versionCounts.get(migration.version) ?? 0) + 1);
  }

  const applied: AppliedMigration[] = [];
  for (const migration of migrationFiles) {
    const { file, version, name } = migration;
    const rawSql = await readFile(join(migrationsDir, file), 'utf8');
    // 迁移文件受 Git 换行策略影响，执行和新记录都基于跨平台稳定的 LF 内容。
    const sql = normalizeMigrationText(rawSql);
    const checksum = options.checksum ? options.checksum(sql) : file;
    const compatibleChecksums = getCompatibleChecksums(rawSql, sql, checksum, options.checksum);
    const duplicateVersion = (versionCounts.get(version) ?? 0) > 1;
    const ordinal = migrationFiles.filter((candidate) => candidate.version === version).indexOf(migration) + 1;
    const legacy = await db.query<{ version: string; name: string; checksum: string; status: string }>(
      'select version, name, checksum, status from schema_migrations where version = $1',
      [version],
    );
    let migrationVersion = version;
    let record: { version: string; name: string; checksum: string; status: string } | undefined = legacy.rows[0];

    if (duplicateVersion && record && record.name !== name) {
      migrationVersion = `${version}_${ordinal}`;
      const disambiguated = await db.query<{ version: string; name: string; checksum: string; status: string }>(
        'select version, name, checksum, status from schema_migrations where version = $1',
        [migrationVersion],
      );
      record = disambiguated.rows[0];
    } else if (duplicateVersion && !record && ordinal > 1) {
      migrationVersion = `${version}_${ordinal}`;
      const disambiguated = await db.query<{ version: string; name: string; checksum: string; status: string }>(
        'select version, name, checksum, status from schema_migrations where version = $1',
        [migrationVersion],
      );
      record = disambiguated.rows[0];
    }

    if (record?.status === 'FAILED' && options.retryFailedMigrations) {
      // 失败迁移的事务内容已回滚，这里只清除失败标记，让同一份迁移重新执行。
      // FAILED 记录的 checksum 只描述上次尝试的内容，修复失败迁移后允许显式重试当前文件。
      await db.query(
        'delete from schema_migrations where version = $1 and status = $2',
        [migrationVersion, 'FAILED'],
      );
      record = undefined;
    }

    if (record) {
      if (!compatibleChecksums.has(record.checksum)) {
        throw new Error(`迁移 ${migrationVersion} checksum 不一致，现有=${record.checksum}，当前=${checksum}`);
      }
      if (record.status === 'APPLIED') {
        applied.push({ version: migrationVersion, name, checksum, status: 'APPLIED' });
        continue;
      }
      throw new Error(`迁移 ${migrationVersion} 之前执行失败，必须先处理失败记录`);
    }

    try {
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query(
          `insert into schema_migrations (version, name, checksum, applied_at, applied_by, status)
           values ($1, $2, $3, now(), $4, 'APPLIED')`,
          [migrationVersion, name, checksum, options.appliedBy ?? 'system'],
        );
        await upsertSchemaVersion(tx, migrationVersion);
      });
      applied.push({ version: migrationVersion, name, checksum, status: 'APPLIED' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await recordMigrationFailure(db, migrationVersion, name, checksum, options.appliedBy ?? 'system', errorMessage);
      applied.push({ version: migrationVersion, name, checksum, status: 'FAILED' });
      throw error;
    }
  }

  return applied;
}

function normalizeMigrationText(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

function getCompatibleChecksums(
  rawSql: string,
  normalizedSql: string,
  canonicalChecksum: string,
  checksum?: (content: string) => string,
): Set<string> {
  if (!checksum) return new Set([canonicalChecksum]);

  // 兼容规范化前已经写入数据库的 CRLF/CR 历史 checksum，但不放宽实际 SQL 内容校验。
  return new Set([
    canonicalChecksum,
    checksum(rawSql),
    checksum(normalizedSql.replace(/\n/g, '\r\n')),
    checksum(normalizedSql.replace(/\n/g, '\r')),
  ]);
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
