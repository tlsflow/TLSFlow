import { AppError } from '../../common/errors/app-error.js';
import type { TenantEntity, TenantMembershipEntity, TenantMembershipType } from '../../persistence/entities/tenant.entity.js';
import type {
  AccessibleTenant,
  ResourceOwnerType,
  TenantContext,
  TenantMode,
  TenantScope,
  TenantScopeFilter,
  TenantScopeType,
} from '../../shared/security-types.js';

type TenantIndex = Map<string, TenantEntity>;

export interface TenantScopedResource {
  tenantId?: string;
  ownerType?: ResourceOwnerType;
}

/**
 * 计算租户范围和可访问租户列表。
 *
 * 成员关系只决定进入和治理边界，业务对象仍需独立通过 RBAC/ObjectSet。
 * `SYSTEM` 只匹配系统资源，`GROUP` 资源默认不通过租户层级自动共享。
 */
export class TenantScopeService {
  resolveAccessibleTenantIds(memberships: TenantMembershipEntity[], tenants: TenantEntity[]): string[] {
    const tenantById = this.buildTenantIndex(tenants);
    const ids = new Set<string>();
    for (const membership of memberships) {
      for (const tenantId of this.resolveMembershipTenantIds(membership, tenantById)) {
        ids.add(tenantId);
      }
    }
    return [...ids];
  }

  resolveManagementScope(
    currentTenantId: string,
    memberships: TenantMembershipEntity[],
    tenants: TenantEntity[],
  ): TenantScope {
    const tenantById = this.buildTenantIndex(tenants);
    const currentTenant = tenantById.get(currentTenantId);
    if (!currentTenant) {
      throw new AppError('TENANT_SCOPE_DENIED', '当前租户不在有效租户范围内', { tenantId: currentTenantId });
    }

    const directMembership = memberships.find((membership) => membership.tenantId === currentTenantId && membership.status === 'ACTIVE');
    if (directMembership && currentTenant.type === 'GROUP' && allowsSubtree(directMembership.membershipType)) {
      return this.normalize({ type: 'SUBTREE', rootTenantId: currentTenantId }, tenants);
    }
    return this.normalize({ type: 'SELF', rootTenantId: currentTenantId }, tenants);
  }

  normalize(scope: TenantScope, tenants: TenantEntity[], currentTenantId?: string): TenantScope {
    const tenantById = this.buildTenantIndex(tenants);
    if (scope.type === 'SYSTEM') return { type: 'SYSTEM' };

    if (scope.type === 'SELF') {
      const rootTenantId = scope.rootTenantId ?? currentTenantId;
      if (!rootTenantId) {
        throw new AppError('TENANT_SCOPE_DENIED', 'SELF 范围缺少根租户', { scope });
      }
      this.requireActiveTenant(rootTenantId, tenantById);
      return { type: 'SELF', rootTenantId, tenantIds: [rootTenantId] };
    }

    if (scope.type === 'SUBTREE') {
      const rootTenantId = scope.rootTenantId;
      if (!rootTenantId) {
        throw new AppError('TENANT_SCOPE_DENIED', 'SUBTREE 范围缺少根租户', { scope });
      }
      const root = this.requireActiveTenant(rootTenantId, tenantById);
      if (root.type !== 'GROUP') {
        throw new AppError('TENANT_SCOPE_DENIED', '只有 GROUP 租户可以声明 SUBTREE 范围', { rootTenantId });
      }
      return {
        type: 'SUBTREE',
        rootTenantId,
        tenantIds: this.collectSubtreeTenantIds(rootTenantId, tenantById),
      };
    }

    const tenantIds = [...new Set(scope.tenantIds ?? [])];
    if (tenantIds.length === 0) {
      throw new AppError('TENANT_SCOPE_DENIED', 'EXPLICIT 范围必须包含有效租户', { tenantIds });
    }
    for (const tenantId of tenantIds) this.requireActiveTenant(tenantId, tenantById);
    return { type: 'EXPLICIT', tenantIds };
  }

  allowsResource(scope: TenantScope, resource: TenantScopedResource): boolean {
    const ownerType = resource.ownerType ?? (resource.tenantId ? 'TENANT' : undefined);
    if (scope.type === 'SYSTEM') return ownerType === 'SYSTEM';
    if (ownerType !== 'TENANT' || !resource.tenantId) return false;
    return (scope.tenantIds ?? (scope.rootTenantId ? [scope.rootTenantId] : [])).includes(resource.tenantId);
  }

  toFilter(scope: TenantScope): TenantScopeFilter {
    if (scope.type === 'SYSTEM') return { ownerTypes: ['SYSTEM'] };
    return {
      tenantIds: [...(scope.tenantIds ?? (scope.rootTenantId ? [scope.rootTenantId] : []))],
      ownerTypes: ['TENANT'],
    };
  }

  resolveAccessibleTenants(
    memberships: TenantMembershipEntity[],
    tenants: TenantEntity[],
    context: TenantContext,
  ): AccessibleTenant[] {
    const tenantById = this.buildTenantIndex(tenants);
    const entries = new Map<string, { priority: number; tenant: AccessibleTenant }>();
    for (const membership of memberships) {
      for (const tenantId of this.resolveMembershipTenantIds(membership, tenantById)) {
        const tenant = tenantById.get(tenantId);
        if (!tenant || tenant.status !== 'ACTIVE') continue;
        const direct = tenant.id === membership.tenantId;
        const entry: AccessibleTenant = {
          tenantId: tenant.id,
          name: tenant.name,
          code: tenant.code,
          type: tenant.type,
          parentTenantId: tenant.parentId,
          membershipType: membership.membershipType,
          membershipStatus: membership.status,
          current: tenant.id === context.currentTenantId,
          canSwitch: direct,
          mode: context.mode,
          scopeType: this.scopeTypeForAccessibleTenant(membership, tenant, context, direct),
        };
        const existing = entries.get(tenant.id);
        const priority = (tenant.id === context.currentTenantId ? 4 : 0) + (direct ? 2 : 0);
        if (!existing || priority > existing.priority) {
          entries.set(tenant.id, { priority, tenant: entry });
        }
      }
    }

    return [...entries.values()]
      .map((item) => item.tenant)
      .sort((left, right) => left.code.localeCompare(right.code));
  }

  private scopeTypeForAccessibleTenant(
    membership: TenantMembershipEntity,
    tenant: TenantEntity,
    context: TenantContext,
    direct: boolean,
  ): TenantScopeType {
    if (tenant.id === context.currentTenantId) {
      if (tenant.type === 'GROUP' && allowsSubtree(membership.membershipType)) return 'SUBTREE';
      return 'SELF';
    }
    if (direct) return 'EXPLICIT';
    return 'SUBTREE';
  }

  private resolveMembershipTenantIds(membership: TenantMembershipEntity, tenantById: TenantIndex): string[] {
    const tenant = tenantById.get(membership.tenantId);
    if (!tenant || tenant.status !== 'ACTIVE') return [];
    if (tenant.type === 'GROUP' && allowsSubtree(membership.membershipType)) {
      return this.collectSubtreeTenantIds(tenant.id, tenantById);
    }
    return [tenant.id];
  }

  private collectSubtreeTenantIds(rootTenantId: string, tenantById: TenantIndex): string[] {
    const root = tenantById.get(rootTenantId);
    if (!root || root.status !== 'ACTIVE' || root.type !== 'GROUP') return [];
    return [
      root.id,
      ...[...tenantById.values()]
        .filter((tenant) => tenant.parentId === root.id && tenant.type === 'COMPANY' && tenant.status === 'ACTIVE')
        .map((tenant) => tenant.id),
    ];
  }

  private requireActiveTenant(tenantId: string | undefined, tenantById: TenantIndex): TenantEntity {
    const tenant = tenantId ? tenantById.get(tenantId) : undefined;
    if (!tenant) {
      throw new AppError('TENANT_SCOPE_DENIED', '租户范围包含不存在或停用的租户', { tenantId });
    }
    return tenant;
  }

  private buildTenantIndex(tenants: TenantEntity[]): TenantIndex {
    return new Map(tenants.filter((tenant) => tenant.status === 'ACTIVE').map((tenant) => [tenant.id, tenant] as const));
  }
}

function allowsSubtree(membershipType: TenantMembershipType): boolean {
  return membershipType === 'owner' || membershipType === 'admin' || membershipType === 'operator';
}
