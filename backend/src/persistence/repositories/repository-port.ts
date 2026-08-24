export interface IdentifiedEntity {
  id: string;
}

// RepositoryPort 是业务服务能知道的唯一持久化契约。
// 具体是内存、PGlite 还是 PostgreSQL，不应该泄漏到领域服务里。
export interface RepositoryPort<T extends IdentifiedEntity> {
  create(entity: T): T;
  upsert(entity: T): T;
  get(id: string): T | undefined;
  getOrThrow(id: string): T;
  list(predicate?: (entity: T) => boolean): T[];
  update(id: string, patch: Partial<T>): T;
  clear(): void;
}
