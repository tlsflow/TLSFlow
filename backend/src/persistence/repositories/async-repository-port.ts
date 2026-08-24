import type { IdentifiedEntity } from './repository-port.js';

export interface AsyncRepositoryPort<T extends IdentifiedEntity> {
  create(entity: T): Promise<T>;
  upsert(entity: T): Promise<T>;
  get(id: string): Promise<T | undefined>;
  getOrThrow(id: string): Promise<T>;
  list(predicate?: (entity: T) => boolean): Promise<T[]>;
  update(id: string, patch: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
