import { PGlite, type Transaction } from '@electric-sql/pglite';
import type { DatabasePort, QueryResult } from './database-port.js';

// PGlite 适配只暴露 DatabasePort。业务层不应该知道底层库的具体 API。
export class PgliteDatabase implements DatabasePort {
  constructor(private readonly db = new PGlite()) {}

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<TRow>> {
    const result = await this.db.query<TRow>(sql, params);
    return { rows: result.rows };
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(new PgliteTransaction(tx)));
  }
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
