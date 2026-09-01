import { AppError } from '../errors/app-error.js';
import type { ResourceOwnerType, TenantScopeFilter } from '../../shared/security-types.js';

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

export interface PageQuery {
  page: number;
  pageSize: number;
  sort?: SortSpec;
  filter: Record<string, string>;
  authorization?: PageAuthorizationFilter;
}

export interface PageAuthorizationFilter extends TenantScopeFilter {
  unrestricted?: boolean;
  empty?: boolean;
  objectIdField?: string;
  objectIds?: string[];
  dynamicConditions?: Record<string, unknown>[];
  deniedObjectIds?: string[];
  deniedDynamicConditions?: Record<string, unknown>[];
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

export function withAuthorization(query: PageQuery, authorization: PageAuthorizationFilter): PageQuery {
  return { ...query, authorization };
}

export function applyAuthorizationFilter<T extends object>(items: T[], query: PageQuery): T[] {
  const authorization = query.authorization;
  if (!authorization) return items;
  // unrestricted 表示调用方已通过 RBAC 获得当前租户内的全量读取能力。
  // 列表读模型不一定携带 ownerType（设备摘要就是如此），不能再用 SYSTEM
  // 所有权标签把租户内记录全部误过滤；显式 deny 仍在下方统一保留。
  const scopedItems = authorization.unrestricted
    ? items
    : items.filter((item) => matchesTenantScopeFilter(item, authorization));
  if (authorization.empty) return [];

  const allowedIds = new Set(authorization.objectIds ?? []);
  const allowedConditions = authorization.dynamicConditions ?? [];
  const deniedIds = new Set(authorization.deniedObjectIds ?? []);
  const deniedConditions = authorization.deniedDynamicConditions ?? [];
  const objectIdField = authorization.objectIdField ?? 'id';

  return scopedItems.filter((item) => {
    const id = readObjectField(item, objectIdField);
    const allowed = authorization.unrestricted === true
      || (typeof id === 'string' && allowedIds.has(id))
      || allowedConditions.some((condition) => conditionMatches(item, condition));
    if (!allowed) return false;
    if (typeof id === 'string' && deniedIds.has(id)) return false;
    return !deniedConditions.some((condition) => conditionMatches(item, condition));
  });
}

function matchesTenantScopeFilter(item: object, authorization: TenantScopeFilter): boolean {
  const declaredOwnerType = readObjectField(item, 'ownerType') ?? readObjectField(item, 'owner_type');
  const tenantId = readObjectField(item, 'tenantId') ?? readObjectField(item, 'tenant_id');
  const ownerType = typeof declaredOwnerType === 'string'
    ? declaredOwnerType
    : typeof tenantId === 'string'
      ? 'TENANT'
      : undefined;
  if (authorization.ownerTypes !== undefined && !authorization.ownerTypes.includes(ownerType as ResourceOwnerType)) return false;
  if (authorization.tenantIds !== undefined && ownerType !== 'SYSTEM') {
    if (typeof tenantId !== 'string' || !authorization.tenantIds.includes(tenantId)) return false;
  }
  return true;
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

function conditionMatches(item: object, condition: Record<string, unknown>): boolean {
  for (const [field, expected] of Object.entries(condition)) {
    if (expected === undefined || expected === null || expected === '*') continue;
    const actual = readConditionField(item, field);
    if (Array.isArray(expected)) {
      if (Array.isArray(actual)) {
        if (!actual.some((value) => expected.includes(value))) return false;
      } else if (!expected.includes(actual)) {
        return false;
      }
      continue;
    }
    if (Array.isArray(actual)) {
      if (!actual.includes(expected)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function readConditionField(item: object, field: string): unknown {
  if (field === 'assetTag' || field === 'tag') {
    const tags = readObjectField(item, 'tags');
    if (Array.isArray(tags)) return tags;
  }
  return readObjectField(item, field);
}

function readObjectField(item: object, field: string): unknown {
  return (item as Record<string, unknown>)[field];
}
