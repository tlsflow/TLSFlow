import { AppError } from '../../../common/errors/app-error.js';
import type { AuditService, WriteAuditInput } from '../../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../../audits/audit-event-types.js';
import type {
  TenantEntity,
  TenantMembershipEntity,
  TenantMembershipSubjectType,
  TenantMembershipType,
  TenantStatus,
  TenantType,
} from '../../../persistence/entities/tenant.entity.js';
import type { CreateTenantRecord, TenantMembershipFilter, TenantRepository } from '../repository/tenant.repository.js';

export interface CreateTenantInput {
  name: string;
  code: string;
  type: TenantType;
  parentId?: string;
  actorId: string;
}

export interface AddTenantMembershipInput {
  subjectType: TenantMembershipSubjectType;
  subjectId: string;
  tenantId: string;
  membershipType: TenantMembershipType;
  actorId: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
}

type TenantAuditWriter = Pick<AuditService, 'write'>;

export class TenantHierarchyService {
  constructor(
    private readonly repository: TenantRepository,
    private readonly audit: TenantAuditWriter,
  ) {}

  async listTenants(): Promise<TenantEntity[]> {
    return this.repository.listTenants();
  }

  async createTenant(input: CreateTenantInput): Promise<TenantEntity> {
    const name = input.name.trim();
    const code = input.code.trim();
    if (!name || !code) {
      throw new AppError('VALIDATION_FAILED', '租户名称和编码不能为空');
    }
    if (await this.repository.getTenantByCode(code)) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '租户编码已存在', { code });
    }

    await this.assertParentShape(input.type, input.parentId);
    const record: CreateTenantRecord = {
      name,
      code,
      type: input.type,
      parentId: input.parentId,
    };
    return this.repository.createTenant(record);
  }

  async setParent(tenantId: string, parentId: string | null): Promise<TenantEntity> {
    const tenant = await this.requireTenant(tenantId);
    if (parentId === null) {
      if (tenant.type === 'COMPANY') {
        throw new AppError('TENANT_PARENT_INVALID', 'COMPANY 必须挂在 GROUP 下', { tenantId });
      }
      return this.repository.updateTenant(tenantId, { parentId: null });
    }

    await this.assertNoCycle(tenantId, parentId);
    await this.assertParentShape(tenant.type, parentId);
    return this.repository.updateTenant(tenantId, { parentId });
  }

  async setStatus(tenantId: string, status: TenantStatus): Promise<TenantEntity> {
    const tenant = await this.requireTenant(tenantId);
    if (status === 'SUSPENDED' && tenant.type === 'GROUP') {
      const activeChildren = (await this.repository.listTenants())
        .filter((item) => item.parentId === tenantId && item.status === 'ACTIVE');
      if (activeChildren.length > 0) {
        throw new AppError('TENANT_PARENT_INVALID', '存在有效子公司时不能停用父租户', { tenantId });
      }
    }
    return this.repository.updateTenant(tenantId, { status });
  }

  async addMembership(input: AddTenantMembershipInput): Promise<TenantMembershipEntity> {
    const tenant = await this.requireTenant(input.tenantId);
    if (tenant.status !== 'ACTIVE') {
      throw new AppError('TENANT_PARENT_INVALID', '停用租户不能新增成员关系', { tenantId: input.tenantId });
    }
    if (!await this.repository.subjectExists(input.subjectType, input.subjectId)) {
      throw new AppError('RESOURCE_NOT_FOUND', '成员主体不存在', {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      });
    }

    const existing = await this.repository.listMemberships({
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      tenantId: input.tenantId,
      status: 'ACTIVE',
    });
    if (existing.length > 0) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', '有效租户成员关系已存在', {
        subjectId: input.subjectId,
        tenantId: input.tenantId,
      });
    }

    const membership = await this.repository.createMembership(input);
    await this.writeAudit({
      eventType: AUDIT_EVENT_TYPES.TENANT_MEMBERSHIP_CREATED,
      actorType: 'user',
      actorId: input.actorId,
      action: 'tenant.membership.create',
      resourceType: 'tenantMembership',
      resourceId: membership.id,
      result: 'success',
      riskLevel: 'medium',
      detail: {
        tenantId: membership.tenantId,
        subjectType: membership.subjectType,
        subjectId: membership.subjectId,
        membershipType: membership.membershipType,
      },
    });
    return membership;
  }

  async revokeMembership(membershipId: string, actorId: string, revokedAt = new Date().toISOString()): Promise<TenantMembershipEntity> {
    const current = (await this.repository.listMemberships()).find((item) => item.id === membershipId);
    if (!current) {
      throw new AppError('RESOURCE_NOT_FOUND', '租户成员关系不存在', { membershipId });
    }
    if (current.status !== 'ACTIVE') {
      throw new AppError('VALIDATION_FAILED', '租户成员关系已撤销', { membershipId });
    }

    const membership = await this.repository.revokeMembership(membershipId, actorId, revokedAt);
    await this.writeAudit({
      eventType: AUDIT_EVENT_TYPES.TENANT_MEMBERSHIP_REVOKED,
      actorType: 'user',
      actorId,
      action: 'tenant.membership.revoke',
      resourceType: 'tenantMembership',
      resourceId: membership.id,
      result: 'success',
      riskLevel: 'medium',
      detail: {
        tenantId: membership.tenantId,
        subjectType: membership.subjectType,
        subjectId: membership.subjectId,
      },
    });
    return membership;
  }

  async listMemberships(filter: TenantMembershipFilter = {}): Promise<TenantMembershipEntity[]> {
    return this.repository.listMemberships({
      ...filter,
      at: filter.at ?? new Date().toISOString(),
    });
  }

  private async requireTenant(tenantId: string): Promise<TenantEntity> {
    const tenant = await this.repository.getTenant(tenantId);
    if (!tenant) {
      throw new AppError('RESOURCE_NOT_FOUND', '租户不存在', { tenantId });
    }
    return tenant;
  }

  private async assertParentShape(type: TenantType, parentId?: string): Promise<void> {
    if (type === 'GROUP') {
      if (parentId) {
        throw new AppError('TENANT_PARENT_INVALID', 'GROUP 不能挂到其他租户下', { parentId });
      }
      return;
    }
    if (!parentId) {
      throw new AppError('TENANT_PARENT_INVALID', 'COMPANY 必须指定 GROUP 父租户');
    }
    const parent = await this.requireTenant(parentId);
    if (parent.type !== 'GROUP' || parent.status !== 'ACTIVE') {
      throw new AppError('TENANT_PARENT_INVALID', 'COMPANY 只能挂到有效 GROUP 下', { parentId });
    }
  }

  private async assertNoCycle(tenantId: string, parentId: string): Promise<void> {
    const visited = new Set<string>([tenantId]);
    let currentId: string | undefined = parentId;
    while (currentId) {
      if (visited.has(currentId)) {
        throw new AppError('TENANT_CYCLE_DETECTED', '租户父子关系不能形成循环', { tenantId, parentId });
      }
      visited.add(currentId);
      currentId = (await this.repository.getTenant(currentId))?.parentId;
    }
  }

  private async writeAudit(input: WriteAuditInput): Promise<void> {
    await this.audit.write({ ...input, failClosed: true });
  }
}
