import { AppError } from '../../common/errors/app-error.js';
import type { TenantEntity, TenantMembershipEntity } from '../../persistence/entities/tenant.entity.js';
import type { GroupEntity } from '../../persistence/entities/object-permission.entity.js';
import type { UserEntity } from '../../persistence/entities/rbac.entity.js';
import type { TenantMode, TenantScope } from '../../shared/security-types.js';
import type { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { TenantHierarchyService } from './domain/tenant.domain-service.js';

const MAX_TENANTS = 1_000;
const MAX_ADMINISTRATORS_PER_TENANT = 50;

export interface TenantAdministratorSummary {
  membershipId: string;
  subjectType: 'user' | 'group' | 'external_group';
  subjectId: string;
  displayName: string;
  username?: string;
  membershipType: 'owner' | 'admin';
  status: 'ACTIVE';
  effectiveFrom: string;
  effectiveUntil?: string;
}

export interface TenantArchitectureNode {
  id: string;
  name: string;
  code: string;
  type: 'GROUP' | 'COMPANY';
  parentId?: string;
  status: 'ACTIVE' | 'SUSPENDED';
  current: boolean;
  administrators: TenantAdministratorSummary[];
  administratorsTruncated?: boolean;
  children: TenantArchitectureNode[];
}

export interface TenantArchitectureResponse {
  mode: TenantMode;
  currentTenantId: string;
  contextVersion: string;
  managementScope?: TenantScope;
  roots: TenantArchitectureNode[];
}

type HierarchyPort = Pick<TenantHierarchyService, 'listTenants' | 'listMemberships'>;
type UserPort = { list(predicate?: (entity: UserEntity) => boolean): Promise<UserEntity[]> };
type GroupPort = { list(predicate?: (entity: GroupEntity) => boolean): Promise<GroupEntity[]> };
type AuditPort = Pick<AuditService, 'write'>;

export class TenantArchitectureService {
  constructor(
    private readonly hierarchy: HierarchyPort,
    private readonly users: UserPort,
    private readonly groups: GroupPort,
    private readonly audit: AuditPort,
  ) {}

  async getArchitecture(input: {
    actorId: string;
    mode: TenantMode;
    currentTenantId: string;
    contextVersion: string;
    managementScope?: TenantScope;
  }): Promise<TenantArchitectureResponse> {
    if (!input.actorId.trim()) throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    if (input.mode === 'single') {
      const response: TenantArchitectureResponse = {
        mode: 'single',
        currentTenantId: input.currentTenantId,
        contextVersion: input.contextVersion,
        roots: [],
      };
      if (input.managementScope) response.managementScope = input.managementScope;
      await this.writeQueryAudit(input, 0, 0);
      return response;
    }

    const allTenants = await this.hierarchy.listTenants();
    if (allTenants.length > MAX_TENANTS) {
      throw new AppError('VALIDATION_FAILED', '租户架构数量超过单次返回上限', { limit: MAX_TENANTS });
    }
    const allowedIds = new Set(input.managementScope?.tenantIds ?? (input.managementScope?.rootTenantId ? [input.managementScope.rootTenantId] : []));
    if (allowedIds.size === 0) {
      await this.writeQueryAudit(input, 0, 0);
      return {
        mode: input.mode,
        currentTenantId: input.currentTenantId,
        contextVersion: input.contextVersion,
        ...(input.managementScope ? { managementScope: input.managementScope } : {}),
        roots: [],
      };
    }

    const tenants = allTenants.filter((tenant) => allowedIds.has(tenant.id));
    const memberships = await this.hierarchy.listMemberships({ status: 'ACTIVE', at: new Date().toISOString() });
    const [users, groups] = await Promise.all([this.users.list(), this.groups.list()]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const { administratorsByTenant, truncatedTenantIds } = this.buildAdministrators(memberships, allowedIds, userById, groupById);
    const nodes = tenants.map((tenant) => this.toNode(
      tenant,
      input.currentTenantId,
      administratorsByTenant.get(tenant.id) ?? [],
      truncatedTenantIds.has(tenant.id),
    ));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const roots: TenantArchitectureNode[] = [];
    for (const node of nodes) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    sortNodes(roots);
    const administratorCount = [...administratorsByTenant.values()].reduce((sum, items) => sum + items.length, 0);
    await this.writeQueryAudit(input, tenants.length, administratorCount);
    return {
      mode: input.mode,
      currentTenantId: input.currentTenantId,
      contextVersion: input.contextVersion,
      managementScope: input.managementScope,
      roots,
    };
  }

  private buildAdministrators(
    memberships: TenantMembershipEntity[],
    allowedIds: Set<string>,
    users: Map<string, UserEntity>,
    groups: Map<string, GroupEntity>,
  ): { administratorsByTenant: Map<string, TenantAdministratorSummary[]>; truncatedTenantIds: Set<string> } {
    const result = new Map<string, TenantAdministratorSummary[]>();
    const truncatedTenantIds = new Set<string>();
    for (const membership of memberships) {
      if (!allowedIds.has(membership.tenantId) || (membership.membershipType !== 'owner' && membership.membershipType !== 'admin')) continue;
      const summary = membership.subjectType === 'user'
        ? this.userSummary(membership, users.get(membership.subjectId))
        : this.groupSummary(membership, groups.get(membership.subjectId));
      if (!summary) continue;
      const items = result.get(membership.tenantId) ?? [];
      if (items.length < MAX_ADMINISTRATORS_PER_TENANT) items.push(summary);
      else truncatedTenantIds.add(membership.tenantId);
      result.set(membership.tenantId, items);
    }
    return { administratorsByTenant: result, truncatedTenantIds };
  }

  private userSummary(membership: TenantMembershipEntity, user?: UserEntity): TenantAdministratorSummary | undefined {
    if (!user || user.status !== 'active') return undefined;
    return {
      membershipId: membership.id,
      subjectType: 'user',
      subjectId: membership.subjectId,
      displayName: user.displayName,
      username: user.username,
      membershipType: membership.membershipType as 'owner' | 'admin',
      status: 'ACTIVE',
      effectiveFrom: membership.effectiveFrom,
      effectiveUntil: membership.effectiveUntil,
    };
  }

  private groupSummary(membership: TenantMembershipEntity, group?: GroupEntity): TenantAdministratorSummary | undefined {
    if (!group || !group.enabled) return undefined;
    return {
      membershipId: membership.id,
      subjectType: membership.subjectType,
      subjectId: membership.subjectId,
      displayName: group.name,
      membershipType: membership.membershipType as 'owner' | 'admin',
      status: 'ACTIVE',
      effectiveFrom: membership.effectiveFrom,
      effectiveUntil: membership.effectiveUntil,
    };
  }

  private toNode(tenant: TenantEntity, currentTenantId: string, administrators: TenantAdministratorSummary[], administratorsTruncated: boolean): TenantArchitectureNode {
    return {
      id: tenant.id,
      name: tenant.name,
      code: tenant.code,
      type: tenant.type,
      parentId: tenant.parentId,
      status: tenant.status,
      current: tenant.id === currentTenantId,
      administrators,
      ...(administratorsTruncated ? { administratorsTruncated: true } : {}),
      children: [],
    };
  }

  private async writeQueryAudit(input: { actorId: string; currentTenantId: string; managementScope?: TenantScope }, tenantCount: number, administratorCount: number): Promise<void> {
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.TENANT_ARCHITECTURE_QUERIED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'tenant.architecture.read',
      resourceType: 'tenantArchitecture',
      resourceId: input.currentTenantId,
      result: 'success',
      riskLevel: 'low',
      detail: {
        scopeType: input.managementScope?.type,
        rootTenantId: input.managementScope?.rootTenantId,
        tenantCount,
        administratorCount,
      },
      context: { tenantId: input.currentTenantId },
      failClosed: true,
    });
  }
}

function sortNodes(nodes: TenantArchitectureNode[]): void {
  nodes.sort((left, right) => left.code.localeCompare(right.code));
  for (const node of nodes) sortNodes(node.children);
}
