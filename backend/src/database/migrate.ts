import { structuredLogger } from '../common/logging/structured-logger.js';
import { loadEnvFile } from '../config/load-env.js';
import type { DatabasePort } from './database-port.js';
import { bootstrapDatabase } from './database-bootstrap.js';

loadEnvFile();

void migrate().catch((error: unknown) => {
  structuredLogger.error('数据库迁移脚本执行失败', {
    error: error instanceof Error ? error.message : String(error),
  }, { module: 'database' });
  process.exitCode = 1;
});

async function migrate(): Promise<void> {
  const database = await bootstrapDatabase(process.env, { applyMigrations: true });

  try {
    structuredLogger.info('数据库迁移脚本执行完成', {
      backend: database.config.backend,
      appliedMigrations: database.appliedMigrations.map((item) => ({ version: item.version, status: item.status })),
    }, { module: 'database' });
  } finally {
    await closeDatabase(database.db);
  }
}

async function closeDatabase(db: DatabasePort): Promise<void> {
  const close = (db as { close?: () => Promise<void> }).close;
  if (typeof close === 'function') {
    await close.call(db);
  }
}
