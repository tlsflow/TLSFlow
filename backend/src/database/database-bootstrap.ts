import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { structuredLogger } from '../common/logging/structured-logger.js';
import type { DatabasePort } from './database-port.js';
import { loadDatabaseConfig, type DatabaseConfig } from './database-config.js';
import { runMigrations, type AppliedMigration } from './migration-runner.js';
import { PgliteDatabase } from './pglite-database.js';
import { PostgresDatabase } from './postgres-database.js';

export interface BootstrappedDatabase {
  db: DatabasePort;
  config: DatabaseConfig;
  appliedMigrations: AppliedMigration[];
}

export interface BootstrapDatabaseOptions {
  applyMigrations?: boolean;
  retryFailedMigrations?: boolean;
}

export async function bootstrapDatabase(
  env: NodeJS.ProcessEnv = process.env,
  options: BootstrapDatabaseOptions = {},
): Promise<BootstrappedDatabase> {
  const config = loadDatabaseConfig(env);
  const db = createDatabase(config);
  const migrationsDir = resolve(process.cwd(), config.migrationsDir);
  let appliedMigrations: AppliedMigration[] = [];

  // 迁移必须由显式脚本触发。热重载启动服务时不能抢跑半成品迁移文件。
  if (options.applyMigrations === true) {
    appliedMigrations = await runMigrations(db, migrationsDir, {
      appliedBy: env.GCAC_MIGRATION_APPLIED_BY ?? 'system',
      checksum: (content) => createHash('sha256').update(content).digest('hex'),
      retryFailedMigrations: options.retryFailedMigrations ?? env.GCAC_RETRY_FAILED_MIGRATIONS === '1',
    });
  }

  structuredLogger.info(options.applyMigrations === true ? '数据库初始化完成' : '数据库连接初始化完成，已跳过自动迁移', {
    backend: config.backend,
    migrationsDir,
    migrationsApplied: options.applyMigrations === true,
    appliedMigrations: appliedMigrations.map((item) => ({ version: item.version, status: item.status })),
  }, { module: 'database' });

  return { db, config, appliedMigrations };
}

function createDatabase(config: DatabaseConfig): DatabasePort {
  if (config.backend === 'memory') return new PgliteDatabase();
  if (config.backend === 'pglite') return new PgliteDatabase();
  if (!config.postgresUrl) {
    throw new Error('PostgreSQL 模式缺少连接配置，请设置 GCAC_DATABASE_URL 或主机/账号/库名环境变量');
  }
  return PostgresDatabase.fromConnectionString(config.postgresUrl);
}
