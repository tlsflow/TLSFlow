import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { DiscoveryResultRecordDto } from '../dto/providers.dto.js';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProvidersRepository {
  readonly moduleName: 'providers';
  createDiscoveryResult(record: DiscoveryResultRecordDto): DiscoveryResultRecordDto;
  listDiscoveryResults(tenantId: string, query: PageQuery): PageResult<DiscoveryResultRecordDto>;
  getDiscoveryResult(tenantId: string, resultId: string): DiscoveryResultRecordDto | undefined;
}

export class InMemoryProvidersRepository implements ProvidersRepository {
  readonly moduleName = 'providers' as const;
  private readonly results = new Map<string, DiscoveryResultRecordDto>();

  createDiscoveryResult(record: DiscoveryResultRecordDto): DiscoveryResultRecordDto {
    if (this.results.has(record.id)) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', 'discovery result 已存在', { resultId: record.id });
    }
    this.results.set(record.id, record);
    return record;
  }

  listDiscoveryResults(tenantId: string, query: PageQuery): PageResult<DiscoveryResultRecordDto> {
    return page(
      [...this.results.values()].filter((item) => item.tenantId === tenantId),
      query,
      (item, field, expected) => stringField(item, field).includes(expected.toLowerCase()),
    );
  }

  getDiscoveryResult(tenantId: string, resultId: string): DiscoveryResultRecordDto | undefined {
    const result = this.results.get(resultId);
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
