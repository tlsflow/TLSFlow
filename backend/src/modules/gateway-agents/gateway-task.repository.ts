import type { DatabasePort } from '../../database/database-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { IdentifiedEntity, RepositoryPort } from '../../persistence/repositories/repository-port.js';
import type { GatewayEvidence, GatewayTask } from './gateway-agent.types.js';

/**
 * GatewayTaskService 需要同步的内存接口，但生产数据必须在启动前从正式文档仓储恢复。
 * 该适配器只负责把已加载的 PostgreSQL 文档镜像为同步仓储，并串行化写入。
 */
export class DurableGatewayRepository<T extends IdentifiedEntity> implements RepositoryPort<T> {
  private readonly rows: Map<string, T>;
  private pending: Promise<void> = Promise.resolve();
  private lastError?: Error;

  private constructor(private readonly source: PgDocumentRepository<T>, rows: T[]) {
    this.rows = new Map(rows.map((row) => [row.id, structuredClone(row)]));
  }

  static async create<T extends IdentifiedEntity>(db: DatabasePort, namespace: string): Promise<DurableGatewayRepository<T>> {
    const source = new PgDocumentRepository<T>(db, namespace);
    return new DurableGatewayRepository(source, await source.list());
  }

  create(entity: T): T {
    this.assertHealthy();
    if (this.rows.has(entity.id)) throw new Error(`entity already exists: ${entity.id}`);
    return this.save(entity);
  }

  upsert(entity: T): T {
    this.assertHealthy();
    return this.save(entity);
  }

  get(id: string): T | undefined {
    this.assertHealthy();
    const row = this.rows.get(id);
    return row ? structuredClone(row) : undefined;
  }

  getOrThrow(id: string): T {
    const row = this.get(id);
    if (!row) throw new Error(`entity not found: ${id}`);
    return row;
  }

  list(predicate: (entity: T) => boolean = () => true): T[] {
    this.assertHealthy();
    return [...this.rows.values()].filter(predicate).map((row) => structuredClone(row));
  }

  update(id: string, patch: Partial<T>): T {
    this.assertHealthy();
    const current = this.getOrThrow(id);
    return this.save({ ...current, ...structuredClone(patch), id } as T);
  }

  clear(): void {
    this.assertHealthy();
    this.rows.clear();
    this.enqueue(() => this.source.clear());
  }

  async flush(): Promise<void> {
    await this.pending;
    this.assertHealthy();
  }

  private save(entity: T): T {
    const snapshot = structuredClone(entity);
    this.rows.set(snapshot.id, snapshot);
    this.enqueue(() => this.source.upsert(snapshot).then(() => undefined));
    return structuredClone(snapshot);
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
    if (this.lastError) throw new Error(`Gateway durable repository failed: ${this.lastError.message}`);
  }
}

export interface DurableGatewayTaskRepositories {
  tasks: DurableGatewayRepository<GatewayTask>;
  evidence: DurableGatewayRepository<GatewayEvidence>;
  flush(): Promise<void>;
}

export async function createDurableGatewayTaskRepositories(db: DatabasePort): Promise<DurableGatewayTaskRepositories> {
  const [tasks, evidence] = await Promise.all([
    DurableGatewayRepository.create<GatewayTask>(db, 'gateway:tasks'),
    DurableGatewayRepository.create<GatewayEvidence>(db, 'gateway:evidence'),
  ]);
  return {
    tasks,
    evidence,
    async flush() {
      await Promise.all([tasks.flush(), evidence.flush()]);
    },
  };
}
