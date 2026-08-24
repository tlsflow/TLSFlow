import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IdentifiedEntity, RepositoryPort } from './repository-port.js';

// 文件型 RepositoryPort：用于当前同步业务仓储在没有可用异步 DB 仓储前的非易失落地。
// 这不是把生产关系表伪装成已接入；它只提供清晰、可替换、可测试的持久化端口实现。
export class FileJsonRepository<T extends IdentifiedEntity> implements RepositoryPort<T> {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) this.writeRows([]);
  }

  create(entity: T): T {
    const rows = this.readRows();
    if (rows.some((row) => row.id === entity.id)) {
      throw new Error(`entity already exists: ${entity.id}`);
    }
    rows.push(structuredClone(entity));
    this.writeRows(rows);
    return this.getOrThrow(entity.id);
  }

  upsert(entity: T): T {
    const rows = this.readRows();
    const index = rows.findIndex((row) => row.id === entity.id);
    if (index >= 0) rows[index] = structuredClone(entity);
    else rows.push(structuredClone(entity));
    this.writeRows(rows);
    return this.getOrThrow(entity.id);
  }

  get(id: string): T | undefined {
    const row = this.readRows().find((item) => item.id === id);
    return row ? structuredClone(row) : undefined;
  }

  getOrThrow(id: string): T {
    const row = this.get(id);
    if (!row) throw new Error(`entity not found: ${id}`);
    return row;
  }

  list(predicate: (entity: T) => boolean = () => true): T[] {
    return this.readRows().filter(predicate).map((row) => structuredClone(row));
  }

  update(id: string, patch: Partial<T>): T {
    const rows = this.readRows();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new Error(`entity not found: ${id}`);
    rows[index] = { ...rows[index], ...patch } as T;
    this.writeRows(rows);
    return this.getOrThrow(id);
  }

  clear(): void {
    this.writeRows([]);
  }

  private readRows(): T[] {
    const raw = readFileSync(this.filePath, 'utf8').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`repository file must contain an array: ${this.filePath}`);
    }
    return parsed as T[];
  }

  private writeRows(rows: T[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.filePath);
  }
}

export class FileJsonRepositoryFactory {
  constructor(private readonly baseDir: string) {}

  collection<T extends IdentifiedEntity>(name: string): RepositoryPort<T> {
    return new FileJsonRepository<T>(join(this.baseDir, `${name}.json`));
  }
}
