import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import type {
  TenantEntity,
  TenantMembershipEntity,
} from '../../persistence/entities/tenant.entity.js';
import type {
  AccessibleTenant,
  TenantContext,
  TenantMode,
} from '../../shared/security-types.js';
import type { TenantHierarchyService } from './domain/tenant.domain-service.js';
import type { TenantMembershipFilter } from './repository/tenant.repository.js';
import type { TenantIdentityResolver } from './tenant-identity.service.js';
import { TenantScopeService } from './tenant-scope.service.js';

export interface TenantContextStateEntity {
  id: string;
  actorId: string;
  homeTenantId: string;
  currentTenantId: string;
  version: string;
  updatedAt: string;
}

type TenantHierarchyPort = Pick<TenantHierarchyService, 'listTenants' | 'listMemberships'>;

/**
 * 计算并保存当前租户上下文。
 *
 * 这个服务只处理“用户能进入哪些租户”和“当前请求进入哪个租户”。
 * 它会把成员关系整理成结构化租户范围，但不把成员关系直接翻译成
 * 业务对象权限。
 */
export class TenantContextService {
  private readonly memoryStates = new Map<string, TenantContextStateEntity>();
  private readonly scope = new TenantScopeService();

  constructor(
    private readonly tenantIdentity: TenantIdentityResolver,
    private readonly hierarchy: TenantHierarchyPort,
    private readonly states?: AsyncRepositoryPort<TenantContextStateEntity>,
    private readonly configuredMode: TenantMode = readTenantMode(),
  ) {}

  get mode(): TenantMode {
    return this.configuredMode;
  }

  async initialize(actorId: string, homeTenantIdentifier?: string): Promise<TenantContext> {
    this.assertActor(actorId);
    const existing = await this.readState(actorId);
    const tenants = await this.hierarchy.listTenants();
    const memberships = await this.accessibleForUser(actorId);
    if (this.mode === 'single') {
      const defaultTenantId = await this.tenantIdentity.resolveDefault();
      if (existing && existing.currentTenantId === defaultTenantId && existing.homeTenantId === defaultTenantId) {
        return this.toContext(existing, [defaultTenantId], { type: 'SELF', rootTenantId: defaultTenantId, tenantIds: [defaultTenantId] });
      }
      return this.saveState({
        actorId,
        homeTenantId: defaultTenantId,
        currentTenantId: defaultTenantId,
        version: newContextVersion(),
      }, [defaultTenantId], { type: 'SELF', rootTenantId: defaultTenantId, tenantIds: [defaultTenantId] });
    }

    const accessibleTenantIds = this.scope.resolveAccessibleTenantIds(memberships, tenants);
    if (accessibleTenantIds.length === 0) {
      throw new AppError('TENANT_MEMBERSHIP_REQUIRED', '用户没有有效租户成员关系', { actorId });
    }
    if (existing && accessibleTenantIds.includes(existing.currentTenantId)) {
      return this.toContext(existing, accessibleTenantIds, this.scope.resolveManagementScope(existing.currentTenantId, memberships, tenants));
    }

    const homeTenantId = homeTenantIdentifier
      ? await this.resolveTenantIdentifier(homeTenantIdentifier)
      : undefined;
    const currentTenantId = homeTenantId && accessibleTenantIds.includes(homeTenantId)
      ? homeTenantId
      : accessibleTenantIds[0]!;
    return this.saveState({
      actorId,
      homeTenantId: homeTenantId && accessibleTenantIds.includes(homeTenantId)
        ? homeTenantId
        : currentTenantId,
      currentTenantId,
      version: newContextVersion(),
    }, accessibleTenantIds, this.scope.resolveManagementScope(currentTenantId, memberships, tenants));
  }

  async resolve(
    actorId: string,
    assertedTenantId?: string,
    expectedVersion?: string,
  ): Promise<TenantContext> {
    this.assertActor(actorId);
    const context = await this.initialize(actorId, assertedTenantId);
    if (expectedVersion && context.version !== expectedVersion) {
      throw new AppError('TENANT_CONTEXT_STALE', '租户上下文版本已失效', {
        actorId,
        expectedVersion,
        currentVersion: context.version,
      });
    }
    if (this.mode === 'hierarchical' && assertedTenantId) {
      const asserted = await this.resolveTenantIdentifier(assertedTenantId);
      if (asserted !== context.currentTenantId) {
        throw new AppError('TENANT_CONTEXT_INVALID', '认证上下文中的当前租户无效', {
          actorId,
          tenantId: asserted,
        });
      }
    }
    return context;
  }

  async listAccessibleTenants(actorId: string, homeTenantIdentifier?: string): Promise<AccessibleTenant[]> {
    this.assertActor(actorId);
    const context = await this.initialize(actorId, homeTenantIdentifier);
    const tenants = await this.hierarchy.listTenants();
    if (this.mode === 'single') {
      const tenant = tenants.find((item) => item.id === context.currentTenantId);
      if (!tenant) {
        throw new AppError('TENANT_CONTEXT_INVALID', '默认租户记录不存在', {
          tenantId: context.currentTenantId,
        });
      }
      return [this.toAccessibleTenant(tenant, {
        membershipType: 'owner',
        status: 'ACTIVE',
        scopeType: 'SELF',
      }, context)];
    }

    const memberships = await this.accessibleForUser(actorId);
    return this.scope.resolveAccessibleTenants(memberships, tenants, context);
  }

  async switchTenant(input: {
    actorId: string;
    tenantId: string;
    expectedVersion: string;
  }): Promise<TenantContext> {
    this.assertActor(input.actorId);
    if (!input.expectedVersion.trim()) {
      throw new AppError('TENANT_CONTEXT_STALE', '缺少租户上下文版本');
    }

    const current = await this.resolve(input.actorId, undefined, input.expectedVersion);
    const targetTenantId = await this.resolveTenantIdentifier(input.tenantId);
    if (this.mode === 'single') {
      if (targetTenantId !== current.currentTenantId) {
        throw new AppError('TENANT_SCOPE_DENIED', '单租户模式不允许切换到非默认租户', {
          tenantId: targetTenantId,
        });
      }
      return this.saveState({
        actorId: input.actorId,
        homeTenantId: current.homeTenantId,
        currentTenantId: current.currentTenantId,
        version: newContextVersion(),
      }, [current.currentTenantId], {
        type: 'SELF',
        rootTenantId: current.currentTenantId,
        tenantIds: [current.currentTenantId],
      });
    }

    const accessible = await this.accessibleForUser(input.actorId);
    const tenants = await this.hierarchy.listTenants();
    const target = this.scope.resolveAccessibleTenants(accessible, tenants, current)
      .find((item) => item.tenantId === targetTenantId);
    if (!target?.canSwitch) {
      throw new AppError('TENANT_MEMBERSHIP_REQUIRED', '用户没有目标租户的有效成员关系', {
        tenantId: targetTenantId,
      });
    }
    return this.saveState({
      actorId: input.actorId,
      homeTenantId: current.homeTenantId,
      currentTenantId: targetTenantId,
      version: newContextVersion(),
    }, this.scope.resolveAccessibleTenantIds(accessible, tenants), this.scope.resolveManagementScope(targetTenantId, accessible, tenants));
  }

  private async accessibleForUser(actorId: string): Promise<TenantMembershipEntity[]> {
    const filter: TenantMembershipFilter = {
      subjectType: 'user',
      subjectId: actorId,
      status: 'ACTIVE',
      at: new Date().toISOString(),
    };
    const memberships = await this.hierarchy.listMemberships(filter);
    const tenants = new Map((await this.hierarchy.listTenants()).map((tenant) => [tenant.id, tenant]));
    return memberships.filter((membership) => {
      const tenant = tenants.get(membership.tenantId);
      return tenant?.status === 'ACTIVE';
    });
  }

  private async resolveTenantIdentifier(identifier: string): Promise<string> {
    try {
      return await this.tenantIdentity.resolve(identifier);
    } catch (error) {
      if (error instanceof AppError && error.errorCode === 'AUTH_FORBIDDEN') {
        throw new AppError('TENANT_NOT_FOUND', '租户不存在或不可用', { tenantIdentifier: identifier });
      }
      throw error;
    }
  }

  private async readState(actorId: string): Promise<TenantContextStateEntity | undefined> {
    return this.states ? this.states.get(actorId) : this.memoryStates.get(actorId);
  }

  private async saveState(
    input: Omit<TenantContextStateEntity, 'id' | 'updatedAt'>,
    accessibleTenantIds: string[],
    managementScope?: TenantContext['managementScope'],
  ): Promise<TenantContext> {
    const state: TenantContextStateEntity = {
      ...input,
      id: input.actorId,
      updatedAt: new Date().toISOString(),
    };
    if (this.states) await this.states.upsert(state);
    else this.memoryStates.set(state.actorId, state);
    return this.toContext(state, accessibleTenantIds, managementScope);
  }

  private toContext(state: TenantContextStateEntity, accessibleTenantIds: string[], managementScope?: TenantContext['managementScope']): TenantContext {
    return {
      mode: this.mode,
      actorId: state.actorId,
      currentTenantId: state.currentTenantId,
      homeTenantId: state.homeTenantId,
      accessibleTenantIds: [...new Set(accessibleTenantIds)],
      managementScope,
      version: state.version,
    };
  }

  private toAccessibleTenant(
    tenant: TenantEntity,
    membership: Pick<TenantMembershipEntity, 'membershipType' | 'status'> & { scopeType?: 'SELF' | 'SUBTREE' | 'EXPLICIT' | 'SYSTEM' },
    context: TenantContext,
  ): AccessibleTenant {
    return {
      tenantId: tenant.id,
      name: tenant.name,
      code: tenant.code,
      type: tenant.type,
      parentTenantId: tenant.parentId,
      membershipType: membership.membershipType,
      membershipStatus: membership.status,
      current: tenant.id === context.currentTenantId,
      canSwitch: true,
      mode: context.mode,
      scopeType: membership.scopeType,
    };
  }

  private assertActor(actorId: string): void {
    if (!actorId.trim()) {
      throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    }
  }
}

function newContextVersion(): string {
  return `ctx_${randomUUID()}`;
}

function readTenantMode(): TenantMode {
  return process.env.GCAC_TENANT_MODE === 'hierarchical' ? 'hierarchical' : 'single';
}
