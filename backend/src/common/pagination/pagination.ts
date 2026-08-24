import { AppError } from '../errors/app-error.js';

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface PageQuery {
  page: number;
  pageSize: number;
  sort?: SortSpec;
  filter: Record<string, string>;
}

export interface PageQueryOptions {
  allowedSortFields?: readonly string[];
  allowedFilterFields?: readonly string[];
  defaultPageSize?: number;
  maxPageSize?: number;
}

function readSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: string | undefined, fallback: number, field: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError('VALIDATION_FAILED', `${field} 必须是正整数`, { field, value });
  }
  return parsed;
}

export function parsePageQuery(raw: Record<string, string | string[] | undefined>, options: PageQueryOptions = {}): PageQuery {
  const defaultPageSize = options.defaultPageSize ?? 20;
  const maxPageSize = options.maxPageSize ?? 200;
  const page = parsePositiveInt(readSingle(raw.page), 1, 'page');
  const pageSize = parsePositiveInt(readSingle(raw.pageSize), defaultPageSize, 'pageSize');
  if (pageSize > maxPageSize) {
    throw new AppError('VALIDATION_FAILED', `pageSize 不能超过 ${maxPageSize}`, { field: 'pageSize', max: maxPageSize });
  }
  const sortValue = readSingle(raw.sort);
  const sort = sortValue ? parseSort(sortValue, options.allowedSortFields ?? []) : undefined;
  const filter = parseFilter(raw, options.allowedFilterFields ?? []);
  return { page, pageSize, sort, filter };
}

function parseSort(value: string, allowedFields: readonly string[]): SortSpec {
  const [field, direction = 'asc'] = value.split(':');
  if (!field || !['asc', 'desc'].includes(direction)) {
    throw new AppError('VALIDATION_FAILED', 'sort 格式必须是 field:asc 或 field:desc', { field: 'sort', value });
  }
  if (allowedFields.length > 0 && !allowedFields.includes(field)) {
    throw new AppError('VALIDATION_FAILED', 'sort 字段不在白名单内', { field: 'sort', value });
  }
  return { field, direction: direction as SortSpec['direction'] };
}

function parseFilter(raw: Record<string, string | string[] | undefined>, allowedFields: readonly string[]): Record<string, string> {
  const filter: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const match = key.match(/^filter\[([^\]]+)]$/);
    if (!match) continue;
    const field = match[1];
    if (allowedFields.length > 0 && !allowedFields.includes(field)) {
      throw new AppError('VALIDATION_FAILED', 'filter 字段不在白名单内', { field, allowedFields });
    }
    const singleValue = readSingle(value);
    if (singleValue !== undefined) filter[field] = singleValue;
  }
  return filter;
}
