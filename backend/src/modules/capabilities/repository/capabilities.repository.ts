import type { PageQuery } from '../../../common/pagination/pagination.js';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type {
  CapabilityDeclaration,
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
  saveDeclaration(input: CapabilityDeclaration): Promise<CapabilityDeclaration>;
  listDeclarations(tenantId: string, query: PageQuery): Promise<PageResult<CapabilityDeclaration>>;
  findDeclarations(tenantId: string, targetType: CapabilityTargetType, targetId: string): Promise<CapabilityDeclaration[]>;
  getDeclaration(tenantId: string, declarationId: string): Promise<CapabilityDeclaration | undefined>;
  saveRequirement(input: CapabilityRequirement): Promise<CapabilityRequirement>;
  listRequirements(query: PageQuery): Promise<PageResult<CapabilityRequirement>>;
  getRequirement(requirementId: string): Promise<CapabilityRequirement | undefined>;
  saveCompatibilityEvaluation(input: CompatibilityEvaluation): Promise<CompatibilityEvaluation>;
  getCompatibilityEvaluation(targetType: CapabilityTargetType, targetId: string): Promise<CompatibilityEvaluation | undefined>;
}

type CapabilityDefinition = (typeof builtInCapabilityDefinitions)[number];
type CapabilityDeclarationRecord = CapabilityDeclaration & IdentifiedEntity;
type CapabilityRequirementRecord = CapabilityRequirement & IdentifiedEntity;
type CompatibilityEvaluationRecord = CompatibilityEvaluation & IdentifiedEntity;

export class PgCapabilitiesRepository implements CapabilitiesRepository {
  readonly moduleName = 'capabilities' as const;

  private readonly definitions = [...builtInCapabilityDefinitions];
  private readonly declarations: PgDocumentRepository<CapabilityDeclarationRecord>;
  private readonly requirements: PgDocumentRepository<CapabilityRequirementRecord>;
  private readonly compatibility: PgDocumentRepository<CompatibilityEvaluationRecord>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
    this.declarations = new PgDocumentRepository(db, 'capabilities:declarations');
    this.requirements = new PgDocumentRepository(db, 'capabilities:requirements');
    this.compatibility = new PgDocumentRepository(db, 'capabilities:compatibility');
  }

  listDefinitions(): CapabilityDefinition[] {
    return [...this.definitions];
  }

  getDefinition(capabilityKey: string): CapabilityDefinition | undefined {
    return this.definitions.find((item) => item.key === capabilityKey || item.aliases.includes(capabilityKey));
  }

  async saveDeclaration(input: CapabilityDeclaration): Promise<CapabilityDeclaration> {
    const existing = await this.getDeclaration(input.tenantId, input.id);
    const id = existing?.id ?? input.id;
    if (!id) throw new AppError('VALIDATION_FAILED', 'CapabilityDeclaration 缺少 id', { field: 'id' });
    return this.declarations.upsert({ ...input, id } as CapabilityDeclarationRecord);
  }

  async listDeclarations(tenantId: string, query: PageQuery): Promise<PageResult<CapabilityDeclaration>> {
    const items = await this.declarations.list((item) => item.tenantId === tenantId);
    return page(items, query, declarationFilter);
  }

  async findDeclarations(tenantId: string, targetType: CapabilityTargetType, targetId: string): Promise<CapabilityDeclaration[]> {
    return (await this.declarations.list((item) => item.tenantId === tenantId && item.targetType === targetType && item.targetId === targetId));
  }

  async getDeclaration(tenantId: string, declarationId: string): Promise<CapabilityDeclaration | undefined> {
    const item = await this.declarations.get(declarationId);
    return item?.tenantId === tenantId ? item : undefined;
  }

  async saveRequirement(input: CapabilityRequirement): Promise<CapabilityRequirement> {
    const existing = await this.requirements.get(input.id);
    if (existing) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '能力需求 ID 已存在', { requirementId: input.id });
    }
    return this.requirements.upsert(input as CapabilityRequirementRecord);
  }

  async listRequirements(query: PageQuery): Promise<PageResult<CapabilityRequirement>> {
    return page(await this.requirements.list(), query, requirementFilter);
  }

  async getRequirement(requirementId: string): Promise<CapabilityRequirement | undefined> {
    return this.requirements.get(requirementId);
  }

  async saveCompatibilityEvaluation(input: CompatibilityEvaluation): Promise<CompatibilityEvaluation> {
    return this.compatibility.upsert({ ...input, id: compatibilityKey(input.targetType, input.targetId) } as CompatibilityEvaluationRecord);
  }

  async getCompatibilityEvaluation(targetType: CapabilityTargetType, targetId: string): Promise<CompatibilityEvaluation | undefined> {
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
