import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type {
  CapabilityDeclaration,
  CapabilityDefinition,
  CapabilityRequirement,
  CompatibilityEvaluation,
} from '../../../shared/contracts/capability-contracts.js';
import type { CapabilityTargetType } from '../../../shared/enums/core.enums.js';
import { builtInCapabilityDefinitions } from '../schema/capabilities.schema.js';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CapabilitiesRepository {
  readonly moduleName: 'capabilities';
  listDefinitions(): CapabilityDefinition[];
  getDefinition(capabilityKey: string): CapabilityDefinition | undefined;
  saveDeclaration(input: CapabilityDeclaration): CapabilityDeclaration;
  listDeclarations(tenantId: string, query: PageQuery): PageResult<CapabilityDeclaration>;
  findDeclarations(tenantId: string, targetType: CapabilityTargetType, targetId: string): CapabilityDeclaration[];
  getDeclaration(tenantId: string, declarationId: string): CapabilityDeclaration | undefined;
  saveRequirement(input: CapabilityRequirement): CapabilityRequirement;
  listRequirements(query: PageQuery): PageResult<CapabilityRequirement>;
  getRequirement(requirementId: string): CapabilityRequirement | undefined;
  saveCompatibilityEvaluation(input: CompatibilityEvaluation): CompatibilityEvaluation;
  getCompatibilityEvaluation(targetType: CapabilityTargetType, targetId: string): CompatibilityEvaluation | undefined;
}

export class InMemoryCapabilitiesRepository implements CapabilitiesRepository {
  readonly moduleName = 'capabilities' as const;
  private readonly definitions = [...builtInCapabilityDefinitions];
  private readonly declarations = new Map<string, CapabilityDeclaration>();
  private readonly requirements = new Map<string, CapabilityRequirement>();
  private readonly compatibility = new Map<string, CompatibilityEvaluation>();

  listDefinitions(): CapabilityDefinition[] {
    return [...this.definitions];
  }

  getDefinition(capabilityKey: string): CapabilityDefinition | undefined {
    return this.definitions.find((item) => item.key === capabilityKey || item.aliases.includes(capabilityKey));
  }

  saveDeclaration(input: CapabilityDeclaration): CapabilityDeclaration {
    const existing = this.getDeclaration(input.tenantId, input.id);
    const id = existing?.id ?? input.id ?? newId('capdecl');
    const next = { ...input, id };
    this.declarations.set(id, next);
    return next;
  }

  listDeclarations(tenantId: string, query: PageQuery): PageResult<CapabilityDeclaration> {
    const items = [...this.declarations.values()].filter((item) => item.tenantId === tenantId);
    return page(items, query, declarationFilter);
  }

  findDeclarations(tenantId: string, targetType: CapabilityTargetType, targetId: string): CapabilityDeclaration[] {
    return [...this.declarations.values()].filter((item) => item.tenantId === tenantId && item.targetType === targetType && item.targetId === targetId);
  }

  getDeclaration(tenantId: string, declarationId: string): CapabilityDeclaration | undefined {
    const item = this.declarations.get(declarationId);
    return item?.tenantId === tenantId ? item : undefined;
  }

  saveRequirement(input: CapabilityRequirement): CapabilityRequirement {
    if (this.requirements.has(input.id)) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '能力需求 ID 已存在', { requirementId: input.id });
    }
    this.requirements.set(input.id, input);
    return input;
  }

  listRequirements(query: PageQuery): PageResult<CapabilityRequirement> {
    return page([...this.requirements.values()], query, requirementFilter);
  }

  getRequirement(requirementId: string): CapabilityRequirement | undefined {
    return this.requirements.get(requirementId);
  }

  saveCompatibilityEvaluation(input: CompatibilityEvaluation): CompatibilityEvaluation {
    this.compatibility.set(compatibilityKey(input.targetType, input.targetId), input);
    return input;
  }

  getCompatibilityEvaluation(targetType: CapabilityTargetType, targetId: string): CompatibilityEvaluation | undefined {
    return this.compatibility.get(compatibilityKey(targetType, targetId));
  }
}

function compatibilityKey(targetType: CapabilityTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

function page<T>(items: T[], query: PageQuery, matcher: (item: T, query: PageQuery) => boolean): PageResult<T> {
  const filtered = items.filter((item) => matcher(item, query));
  const sorted = sortItems(filtered, query);
  const offset = (query.page - 1) * query.pageSize;
  return {
    items: sorted.slice(offset, offset + query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: filtered.length,
  };
}

function sortItems<T>(items: T[], query: PageQuery): T[] {
  if (!query.sort) return items;
  const { field, direction } = query.sort;
  return [...items].sort((left, right) => compareValues((left as any)[field], (right as any)[field], direction));
}

function compareValues(left: unknown, right: unknown, direction: 'asc' | 'desc'): number {
  const leftValue = left === undefined ? '' : left;
  const rightValue = right === undefined ? '' : right;
  const result = String(leftValue).localeCompare(String(rightValue), 'zh-Hans-CN', { numeric: true });
  return direction === 'asc' ? result : result * -1;
}

function declarationFilter(item: CapabilityDeclaration, query: PageQuery): boolean {
  const filter = query.filter;
  if (filter.targetType && item.targetType !== filter.targetType) return false;
  if (filter.targetId && item.targetId !== filter.targetId) return false;
  if (filter.capabilityKey && item.capabilityKey !== filter.capabilityKey) return false;
  if (filter.source && item.source !== filter.source) return false;
  if (filter.status && item.status !== filter.status) return false;
  return true;
}

function requirementFilter(item: CapabilityRequirement, query: PageQuery): boolean {
  const filter = query.filter;
  if (filter.ownerType && item.ownerType !== filter.ownerType) return false;
  if (filter.ownerId && item.ownerId !== filter.ownerId) return false;
  if (filter.riskLevel && item.riskLevel !== filter.riskLevel) return false;
  return true;
}
