import { PGlite } from '@electric-sql/pglite';
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
    await this.exec('begin');
    try {
      const result = await work(this);
      await this.exec('commit');
      return result;
    } catch (error) {
      await this.exec('rollback');
      throw error;
    }
  }
}
