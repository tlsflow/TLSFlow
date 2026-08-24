import type { IdentifiedEntity, RepositoryPort } from './repository-port.js';

// 测试和开发期内存实现。生产实现必须实现 RepositoryPort，而不是让服务知道 MemoryRepository。
export class MemoryRepository<T extends IdentifiedEntity> implements RepositoryPort<T> {
  private readonly rows = new Map<string, T>();

  create(entity: T): T {
    if (this.rows.has(entity.id)) {
      throw new Error(`entity already exists: ${entity.id}`);
    }
    this.rows.set(entity.id, structuredClone(entity));
    return this.getOrThrow(entity.id);
  }

  upsert(entity: T): T {
    this.rows.set(entity.id, structuredClone(entity));
    return this.getOrThrow(entity.id);
  }

  get(id: string): T | undefined {
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
    return [...this.rows.values()].filter(predicate).map((row) => structuredClone(row));
  }

  update(id: string, patch: Partial<T>): T {
    const current = this.getOrThrow(id);
    const next = { ...current, ...patch } as T;
    this.rows.set(id, structuredClone(next));
    return this.getOrThrow(id);
  }

  clear(): void {
    this.rows.clear();
  }
}
