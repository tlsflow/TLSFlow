import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type { DiscoveryResultRecordDto } from '../dto/providers.dto.js';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProvidersRepository {
  readonly moduleName: 'providers';
  createDiscoveryResult(record: DiscoveryResultRecordDto): Promise<DiscoveryResultRecordDto>;
  listDiscoveryResults(tenantId: string, query: PageQuery): Promise<PageResult<DiscoveryResultRecordDto>>;
  getDiscoveryResult(tenantId: string, resultId: string): Promise<DiscoveryResultRecordDto | undefined>;
}

type DiscoveryResultRecord = DiscoveryResultRecordDto & IdentifiedEntity;

export class PgProvidersRepository implements ProvidersRepository {
  readonly moduleName = 'providers' as const;

  private readonly results: PgDocumentRepository<DiscoveryResultRecord>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
    this.results = new PgDocumentRepository(db, 'providers:discoveryResults');
  }

  async createDiscoveryResult(record: DiscoveryResultRecordDto): Promise<DiscoveryResultRecordDto> {
    const existing = await this.results.get(record.id);
    if (existing) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', 'discovery result 已存在', { resultId: record.id });
    }
    return this.results.create(record as DiscoveryResultRecord);
  }

  async listDiscoveryResults(tenantId: string, query: PageQuery): Promise<PageResult<DiscoveryResultRecordDto>> {
    const rows = await this.results.list((item) => item.tenantId === tenantId);
    return page(rows, query, (item, field, expected) => stringField(item, field).includes(expected.toLowerCase()));
  }

  async getDiscoveryResult(tenantId: string, resultId: string): Promise<DiscoveryResultRecordDto | undefined> {
    const result = await this.results.get(resultId);
    return result?.tenantId === tenantId ? result : undefined;
  }
}

function page<T extends object>(items: T[], query: PageQuery, filterFn: (item: T, field: string, expected: string) => boolean): PageResult<T> {
  let filtered = items;
  for (const [field, expected] of Object.entries(query.filter)) {
    filtered = filtered.filter((item) => filterFn(item, field, expected));
  }
  if (query.sort) {
    const { field, direction } = query.sort;
    filtered = [...filtered].sort((left, right) => compareValues(readField(left, field), readField(right, field), direction));
  }
  const start = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(start, start + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  };
}

function readField(item: object, field: string): unknown {
  return (item as Record<string, unknown>)[field];
}

function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const normalizedLeft = left === undefined || left === null ? '' : String(left);
  const normalizedRight = right === undefined || right === null ? '' : String(right);
  const result = normalizedLeft.localeCompare(normalizedRight);
  return direction === 'asc' ? result : -result;
}

function stringField(item: object, field: string): string {
  const value = readField(item, field);
  return value === undefined || value === null ? '' : String(value).toLowerCase();
}
