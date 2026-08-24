import type { DatabasePort } from '../../database/database-port.js';
import type { IdentifiedEntity } from './repository-port.js';
import type { AsyncRepositoryPort } from './async-repository-port.js';

// 正式 PostgreSQL JSONB 仓储。
// 不做内存镜像，不需要 flush，数据库就是唯一事实源。
export class PgDocumentRepository<T extends IdentifiedEntity> implements AsyncRepositoryPort<T> {
  private initialized?: Promise<void>;

  constructor(
    private readonly db: DatabasePort,
    private readonly namespace: string,
  ) {}

  // 需要直接执行精确 SQL 的领域仓储必须先等待这里，避免跳过 pg_documents 的懒初始化。
  async initialize(): Promise<void> {
    await this.ensureTable();
  }

  async create(entity: T): Promise<T> {
    await this.ensureTable();
    const existing = await this.get(entity.id);
    if (existing) {
      throw new Error(`entity already exists: ${entity.id}`);
    }
    const payload = serializeJsonb(entity);
    await this.db.query(
      `insert into pg_documents (namespace, document_id, payload, updated_at)
       values ($1, $2, $3::jsonb, now())`,
      [this.namespace, entity.id, payload],
    );
    return structuredClone(entity);
  }

  async upsert(entity: T): Promise<T> {
    await this.ensureTable();
    const payload = serializeJsonb(entity);
    await this.db.query(
      `insert into pg_documents (namespace, document_id, payload, updated_at)
       values ($1, $2, $3::jsonb, now())
       on conflict (namespace, document_id)
       do update set payload = excluded.payload, updated_at = excluded.updated_at`,
      [this.namespace, entity.id, payload],
    );
    return structuredClone(entity);
  }

  async compareAndSwap(id: string, expectedVersion: number, entity: T): Promise<boolean> {
    await this.ensureTable();
    const payload = serializeJsonb(entity);
    const result = await this.db.query<{ document_id: string }>(
      `update pg_documents
          set payload = $3::jsonb,
              updated_at = now()
        where namespace = $1
          and document_id = $2
          and payload->>'version' = $4
      returning document_id`,
      [this.namespace, id, payload, String(expectedVersion)],
    );
    return result.rows.length > 0;
  }

  async get(id: string): Promise<T | undefined> {
    await this.ensureTable();
    const result = await this.db.query<{ document_id: string; payload: T }>(
      `select document_id, payload
         from pg_documents
        where namespace = $1 and document_id = $2`,
      [this.namespace, id],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return structuredClone({ ...row.payload, id: row.document_id });
  }

  async getOrThrow(id: string): Promise<T> {
    const row = await this.get(id);
    if (!row) {
      throw new Error(`entity not found: ${id}`);
    }
    return row;
  }

  async list(predicate: (entity: T) => boolean = () => true): Promise<T[]> {
    await this.ensureTable();
    const result = await this.db.query<{ document_id: string; payload: T }>(
      `select document_id, payload
         from pg_documents
        where namespace = $1
        order by updated_at asc`,
      [this.namespace],
    );
    return result.rows
      .map((row) => structuredClone({ ...row.payload, id: row.document_id }))
      .filter(predicate);
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const current = await this.getOrThrow(id);
    const next = { ...current, ...structuredClone(patch), id } as T;
    await this.upsert(next);
    return next;
  }

  async delete(id: string): Promise<void> {
    await this.ensureTable();
    await this.db.query(
      `delete from pg_documents
        where namespace = $1 and document_id = $2`,
      [this.namespace, id],
    );
  }

  async clear(): Promise<void> {
    await this.ensureTable();
    await this.db.query('delete from pg_documents where namespace = $1', [this.namespace]);
  }

  private async ensureTable(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.db.exec(`
        create table if not exists pg_documents (
          namespace varchar(128) not null,
          document_id varchar(128) not null,
          payload jsonb not null,
          updated_at timestamptz not null default now(),
          primary key (namespace, document_id)
        );
        create index if not exists idx_pg_documents_namespace_updated
          on pg_documents (namespace, updated_at desc);
      `);
    }
    await this.initialized;
  }
}

function serializeJsonb(value: unknown): string {
  // PostgreSQL JSONB 不接受 U+0000；外部 Agent 上报的 UTF-16 文本不能让整个请求退化为 500。
  const serialized = JSON.stringify(value, (_key, item: unknown) => typeof item === 'string' ? item.replace(/\u0000/g, '\uFFFD') : item);
  if (serialized === undefined) throw new Error('JSONB payload 不能为空');
  return serialized;
}
