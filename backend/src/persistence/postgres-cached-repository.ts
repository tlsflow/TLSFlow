import type { DatabasePort } from '../database/database-port.js';
import type { IdentifiedEntity, RepositoryPort } from './repositories/repository-port.js';

export interface FlushablePersistence {
  flush(): Promise<void>;
}

export class PostgresCachedRepository<T extends IdentifiedEntity> implements RepositoryPort<T>, FlushablePersistence {
  private readonly rows: Map<string, T>;
  private pending: Promise<void> = Promise.resolve();
  private lastError?: Error;

  private constructor(
    private readonly db: DatabasePort,
    private readonly namespace: string,
    seedRows: T[],
  ) {
    this.rows = new Map(seedRows.map((row) => [row.id, structuredClone(row)]));
  }

  static async create<T extends IdentifiedEntity>(
    db: DatabasePort,
    namespace: string,
  ): Promise<PostgresCachedRepository<T>> {
    const result = await db.query<{ document_id: string; payload: T }>(
      'select document_id, payload from app_documents where namespace = $1 order by updated_at asc',
      [namespace],
    );
    const rows = result.rows.map((row) => ({ ...row.payload, id: row.document_id }));
    return new PostgresCachedRepository<T>(db, namespace, rows);
  }

  create(entity: T): T {
    this.assertHealthy();
    if (this.rows.has(entity.id)) {
      throw new Error(`entity already exists: ${entity.id}`);
    }
    const snapshot = structuredClone(entity);
    this.rows.set(snapshot.id, snapshot);
    this.enqueuePersist(snapshot);
    return structuredClone(snapshot);
  }

  upsert(entity: T): T {
    this.assertHealthy();
    const snapshot = structuredClone(entity);
    this.rows.set(snapshot.id, snapshot);
    this.enqueuePersist(snapshot);
    return structuredClone(snapshot);
  }

  get(id: string): T | undefined {
    this.assertHealthy();
    const row = this.rows.get(id);
    return row ? structuredClone(row) : undefined;
  }

  getOrThrow(id: string): T {
    const row = this.get(id);
    if (!row) {
      throw new Error(`entity not found: ${id}`);
    }
    return row;
  }

  list(predicate: (entity: T) => boolean = () => true): T[] {
    this.assertHealthy();
    return [...this.rows.values()].filter(predicate).map((row) => structuredClone(row));
  }

  update(id: string, patch: Partial<T>): T {
    this.assertHealthy();
    const current = this.rows.get(id);
    if (!current) {
      throw new Error(`entity not found: ${id}`);
    }
    const merged = { ...current, ...structuredClone(patch) } as T;
    this.rows.set(id, merged);
    this.enqueuePersist(merged);
    return structuredClone(merged);
  }

  clear(): void {
    this.assertHealthy();
    this.rows.clear();
    this.enqueue(async () => {
      await this.db.query('delete from app_documents where namespace = $1', [this.namespace]);
    });
  }

  async flush(): Promise<void> {
    await this.pending;
    this.assertHealthy();
  }

  private enqueuePersist(entity: T): void {
    const payload = structuredClone(entity);
    this.enqueue(async () => {
      await this.db.query(
        `insert into app_documents (namespace, document_id, payload, updated_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (namespace, document_id)
         do update set payload = excluded.payload, updated_at = excluded.updated_at`,
        [this.namespace, payload.id, JSON.stringify(payload)],
      );
    });
  }

  private enqueue(work: () => Promise<void>): void {
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        try {
          await work();
        } catch (error) {
          this.lastError = error instanceof Error ? error : new Error(String(error));
          throw this.lastError;
        }
      });
  }

  private assertHealthy(): void {
    if (this.lastError) {
      throw new Error(`postgres cached repository ${this.namespace} failed: ${this.lastError.message}`);
    }
  }
}

export class PostgresCachedRepositoryFactory {
  constructor(private readonly db: DatabasePort, private readonly prefix = 'core') {}

  async collection<T extends IdentifiedEntity>(name: string): Promise<PostgresCachedRepository<T>> {
    return PostgresCachedRepository.create<T>(this.db, `${this.prefix}:${name}`);
  }
}
