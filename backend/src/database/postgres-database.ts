import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { structuredLogger } from '../common/logging/structured-logger.js';
import type { DatabasePort, QueryResult } from './database-port.js';

// PostgreSQL 适配器只暴露 DatabasePort，业务层不直接接触 pg。
export class PostgresDatabase implements DatabasePort {
  constructor(private readonly pool: Pool) {
    // pg 对空闲客户端的错误会通过连接池发出；没有监听器时 Node 会将其视为未处理的 error 事件。
    this.pool.on('error', (error: Error) => {
      structuredLogger.warn('PostgreSQL 连接池客户端错误', {
        error: error.message,
        stack: error.stack,
        code: (error as NodeJS.ErrnoException).code,
      }, { module: 'database' });
    });
  }

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
    // 借出客户端时，pg-pool 会暂时移除自己的 idle error 监听器；事务期间必须保留监听器，
    // 否则网络断开可能直接触发 Client 的未处理 error 事件并终止整个 Node 进程。
    const onClientError = (error: Error) => {
      structuredLogger.warn('PostgreSQL 事务客户端错误', {
        error: error.message,
        stack: error.stack,
        code: (error as NodeJS.ErrnoException).code,
      }, { module: 'database' });
    };
    client.on('error', onClientError);
    try {
      await client.query('begin');
      const tx = new PostgresTransaction(client);
      const result = await work(tx);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch (rollbackError: unknown) {
        structuredLogger.warn('PostgreSQL 事务回滚失败', {
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        }, { module: 'database' });
      }
      throw error;
    } finally {
      client.release();
      client.removeListener('error', onClientError);
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
