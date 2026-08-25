import { createRequire } from 'node:module';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import type { DatabasePort, QueryResult } from './database-port.js';

const require = createRequire(import.meta.url);

// PGlite 适配只暴露 DatabasePort。业务层不应该知道底层库的具体 API。
export class PgliteDatabase implements DatabasePort {
  private db: PGlite | undefined;
  private readonly dataDir: string | undefined;

  constructor(dataDirOrDatabase: string | PGlite | undefined = process.env.GCAC_PGLITE_DATA_DIR) {
    if (typeof dataDirOrDatabase === 'string' || dataDirOrDatabase === undefined) {
      this.dataDir = dataDirOrDatabase;
      return;
    }
    this.db = dataDirOrDatabase;
  }

  async close(): Promise<void> {
    await this.db?.close();
  }

  async exec(sql: string): Promise<void> {
    await this.getDatabase().exec(sql);
  }

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<TRow>> {
    const result = await this.getDatabase().query<TRow>(sql, params);
    return { rows: result.rows };
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    return this.getDatabase().transaction((tx) => work(new PgliteTransaction(tx)));
  }

  private getDatabase(): PGlite {
    if (this.db) return this.db;
    this.db = createPglite(this.dataDir);
    return this.db;
  }
}

function createPglite(dataDir: string | undefined): PGlite {
  // PGlite 携带约 1.2 GiB 的 WASM 外部内存。标准版使用 PostgreSQL，必须等到
  // small/PGlite 真正执行 SQL 时再加载，避免仅导入 Backend 就分配整块 WASM 内存。
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
  const normalized = dataDir?.trim();
  return normalized ? new PGlite({ dataDir: normalized }) : new PGlite();
}

class PgliteTransaction implements DatabasePort {
  constructor(private readonly tx: Transaction) {}

  async exec(sql: string): Promise<void> {
    await this.tx.exec(sql);
  }

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<TRow>> {
    const result = await this.tx.query<TRow>(sql, params);
    return { rows: result.rows };
  }

  async transaction<T>(_work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    throw new Error('不支持在事务中嵌套 transaction()，请复用当前 tx');
  }
}
