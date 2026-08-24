export interface QueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
  rows: TRow[];
}

export interface DatabasePort {
  exec(sql: string): Promise<void>;
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<TRow>>;
  transaction<T>(work: (tx: DatabasePort) => Promise<T>): Promise<T>;
}

export async function scalar<T>(db: DatabasePort, sql: string, params?: unknown[]): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, params);
  const row = result.rows[0];
  if (!row) {
    throw new Error('查询必须返回一行');
  }
  return Object.values(row)[0];
}
