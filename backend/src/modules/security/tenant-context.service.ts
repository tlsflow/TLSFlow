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
 * 它不计算 SELF、SUBTREE、EXPLICIT、SYSTEM，也不把成员关系转换成
 * 业务对象权限。
 */
export class TenantContextService {
  private readonly memoryStates = new Map<string, TenantContextStateEntity>();

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
    if (this.mode === 'single') {
      const defaultTenantId = await this.tenantIdentity.resolveDefault();
      if (existing && existing.currentTenantId === defaultTenantId && existing.homeTenantId === defaultTenantId) {
        return this.toContext(existing, [defaultTenantId]);
      }
      return this.saveState({
        actorId,
        homeTenantId: defaultTenantId,
        currentTenantId: defaultTenantId,
        version: newContextVersion(),
      });
    }

    const accessible = await this.accessibleForUser(actorId);
    if (accessible.length === 0) {
      throw new AppError('TENANT_MEMBERSHIP_REQUIRED', '用户没有有效租户成员关系', { actorId });
    }
    if (existing && accessible.some((item) => item.tenantId === existing.currentTenantId)) {
      return this.toContext(existing, accessible.map((item) => item.tenantId));
    }

    const homeTenantId = homeTenantIdentifier
      ? await this.resolveTenantIdentifier(homeTenantIdentifier)
      : undefined;
    const currentTenantId = homeTenantId && accessible.some((item) => item.tenantId === homeTenantId)
      ? homeTenantId
      : accessible[0]!.tenantId;
    return this.saveState({
      actorId,
      homeTenantId: homeTenantId && accessible.some((item) => item.tenantId === homeTenantId)
        ? homeTenantId
        : currentTenantId,
      currentTenantId,
      version: newContextVersion(),
    });
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
    const byId = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    if (this.mode === 'single') {
      const tenant = byId.get(context.currentTenantId);
      if (!tenant) {
        throw new AppError('TENANT_CONTEXT_INVALID', '默认租户记录不存在', {
          tenantId: context.currentTenantId,
        });
      }
      return [this.toAccessibleTenant(tenant, {
        membershipType: 'owner',
        status: 'ACTIVE',
      }, context)];
    }

    const memberships = await this.accessibleForUser(actorId);
    return memberships.flatMap((membership) => {
      const tenant = byId.get(membership.tenantId);
      return tenant ? [this.toAccessibleTenant(tenant, membership, context)] : [];
    });
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
      });
    }

    const accessible = await this.accessibleForUser(input.actorId);
    if (!accessible.some((membership) => membership.tenantId === targetTenantId)) {
      throw new AppError('TENANT_MEMBERSHIP_REQUIRED', '用户没有目标租户的有效成员关系', {
        tenantId: targetTenantId,
      });
    }
    return this.saveState({
      actorId: input.actorId,
      homeTenantId: current.homeTenantId,
      currentTenantId: targetTenantId,
      version: newContextVersion(),
    });
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

  private async saveState(input: Omit<TenantContextStateEntity, 'id' | 'updatedAt'>): Promise<TenantContext> {
    const state: TenantContextStateEntity = {
      ...input,
      id: input.actorId,
      updatedAt: new Date().toISOString(),
    };
    if (this.states) await this.states.upsert(state);
    else this.memoryStates.set(state.actorId, state);
    return this.toContext(state, await this.accessibleTenantIds(state));
  }

  private async accessibleTenantIds(state: TenantContextStateEntity): Promise<string[]> {
    if (this.mode === 'single') return [state.currentTenantId];
    return (await this.accessibleForUser(state.actorId)).map((item) => item.tenantId);
  }

  private toContext(state: TenantContextStateEntity, accessibleTenantIds: string[]): TenantContext {
    return {
      mode: this.mode,
      actorId: state.actorId,
      currentTenantId: state.currentTenantId,
      homeTenantId: state.homeTenantId,
      accessibleTenantIds: [...new Set(accessibleTenantIds)],
      version: state.version,
    };
  }

  private toAccessibleTenant(
    tenant: TenantEntity,
    membership: Pick<TenantMembershipEntity, 'membershipType' | 'status'>,
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
      mode: context.mode,
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
