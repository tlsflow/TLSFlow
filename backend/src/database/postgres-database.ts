import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { DatabasePort, QueryResult } from './database-port.js';

// PostgreSQL 适配器只暴露 DatabasePort，业务层不直接接触 pg。
export class PostgresDatabase implements DatabasePort {
  constructor(private readonly pool: Pool) {}

  static fromConnectionString(connectionString: string): PostgresDatabase {
    return new PostgresDatabase(new Pool({ connectionString }));
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<TRow>> {
    const result = await this.pool.query<QueryResultRow>(sql, params);
    return { rows: result.rows as TRow[] };
  }

  async transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const tx = new PostgresTransaction(client);
      const result = await work(tx);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgresTransaction implements DatabasePort {
  constructor(private readonly client: PoolClient) {}

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<TRow>> {
    const result = await this.client.query<QueryResultRow>(sql, params);
    return { rows: result.rows as TRow[] };
  }

  async transaction<T>(_work: (tx: DatabasePort) => Promise<T>): Promise<T> {
    throw new Error('不支持在事务中嵌套 transaction()，请复用当前 tx');
  }
}
