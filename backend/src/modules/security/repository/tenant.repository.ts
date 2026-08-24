import type { DatabasePort } from '../../../database/database-port.js';
import type {
  TenantEntity,
  TenantMembershipEntity,
  TenantMembershipStatus,
  TenantMembershipSubjectType,
  TenantMembershipType,
  TenantStatus,
  TenantType,
} from '../../../persistence/entities/tenant.entity.js';

export interface CreateTenantRecord {
  name: string;
  code: string;
  type: TenantType;
  parentId?: string;
  status?: TenantStatus;
  settings?: Record<string, unknown>;
}

export interface CreateTenantMembershipRecord {
  subjectType: TenantMembershipSubjectType;
  subjectId: string;
  tenantId: string;
  membershipType: TenantMembershipType;
  effectiveFrom?: string;
  effectiveUntil?: string;
  createdBy?: string;
}

export interface TenantMembershipFilter {
  subjectType?: TenantMembershipSubjectType;
  subjectId?: string;
  tenantId?: string;
  status?: TenantMembershipStatus;
  at?: string;
}

export interface TenantRepository {
  getTenant(id: string): Promise<TenantEntity | undefined>;
  getTenantByCode(code: string): Promise<TenantEntity | undefined>;
  listTenants(): Promise<TenantEntity[]>;
  createTenant(input: CreateTenantRecord): Promise<TenantEntity>;
  updateTenant(id: string, patch: { parentId?: string | null; status?: TenantStatus }): Promise<TenantEntity>;
  listMemberships(filter?: TenantMembershipFilter): Promise<TenantMembershipEntity[]>;
  createMembership(input: CreateTenantMembershipRecord): Promise<TenantMembershipEntity>;
  revokeMembership(id: string, actorId: string, revokedAt: string): Promise<TenantMembershipEntity>;
  expireMemberships(expiredAt: string): Promise<TenantMembershipEntity[]>;
  subjectExists(subjectType: TenantMembershipSubjectType, subjectId: string): Promise<boolean>;
}

type TenantRow = Record<string, unknown> & {
  id: string;
  name: string;
  code: string;
  type: TenantType;
  parentId: string | null;
  status: TenantStatus;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
};

type MembershipRow = Record<string, unknown> & {
  id: string;
  subjectType: TenantMembershipSubjectType;
  subjectId: string;
  tenantId: string;
  membershipType: TenantMembershipType;
  status: TenantMembershipStatus;
  effectiveFrom: string;
  effectiveUntil: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  expiredAt: string | null;
  version: number;
};

export class PgTenantRepository implements TenantRepository {
  constructor(private readonly db: DatabasePort) {}

  async getTenant(id: string): Promise<TenantEntity | undefined> {
    const result = await this.db.query<TenantRow>(`select ${tenantColumns()} from tenants where id = $1::uuid and deleted_at is null`, [id]);
    return result.rows[0] ? mapTenant(result.rows[0]) : undefined;
  }

  async getTenantByCode(code: string): Promise<TenantEntity | undefined> {
    const result = await this.db.query<TenantRow>(`select ${tenantColumns()} from tenants where code = $1 and deleted_at is null`, [code]);
    return result.rows[0] ? mapTenant(result.rows[0]) : undefined;
  }

  async listTenants(): Promise<TenantEntity[]> {
    const result = await this.db.query<TenantRow>(`select ${tenantColumns()} from tenants where deleted_at is null order by code`);
    return result.rows.map(mapTenant);
  }

  async createTenant(input: CreateTenantRecord): Promise<TenantEntity> {
    const result = await this.db.query<TenantRow>(
      `insert into tenants (name, code, tenant_type, parent_id, status, settings)
       values ($1, $2, $3, $4::uuid, $5, $6::jsonb)
       returning ${tenantColumns()}`,
      [
        input.name,
        input.code,
        input.type,
        input.parentId ?? null,
        input.status ?? 'ACTIVE',
        JSON.stringify(input.settings ?? {}),
      ],
    );
    return mapTenant(result.rows[0]);
  }

  async updateTenant(id: string, patch: { parentId?: string | null; status?: TenantStatus }): Promise<TenantEntity> {
    const assignments: string[] = [];
    const params: unknown[] = [id];
    if (patch.parentId !== undefined) {
      params.push(patch.parentId);
      assignments.push(`parent_id = $${params.length}::uuid`);
    }
    if (patch.status !== undefined) {
      params.push(patch.status);
      assignments.push(`status = $${params.length}`);
    }
    assignments.push('updated_at = now()', 'version = version + 1');
    const result = await this.db.query<TenantRow>(
      `update tenants
          set ${assignments.join(', ')}
        where id = $1::uuid
        returning ${tenantColumns()}`,
      params,
    );
    return mapTenant(result.rows[0]);
  }

  async listMemberships(filter: TenantMembershipFilter = {}): Promise<TenantMembershipEntity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    addCondition(filter.subjectType, 'subject_type = $PARAM', conditions, params);
    addCondition(filter.subjectId, 'subject_id = $PARAM', conditions, params);
    addCondition(filter.tenantId, 'tenant_id = $PARAM::uuid', conditions, params);
    addCondition(filter.status, 'status = $PARAM', conditions, params);
    if (filter.at && filter.status !== 'REVOKED' && filter.status !== 'EXPIRED') {
      params.push(filter.at);
      conditions.push(`effective_from <= $${params.length}::timestamptz and (effective_until is null or effective_until > $${params.length}::timestamptz)`);
    }

    const result = await this.db.query<MembershipRow>(
      `select ${membershipColumns()} from tenant_memberships${conditions.length > 0 ? ` where ${conditions.join(' and ')}` : ''} order by created_at`,
      params,
    );
    return result.rows.map(mapMembership);
  }

  async createMembership(input: CreateTenantMembershipRecord): Promise<TenantMembershipEntity> {
    const result = await this.db.query<MembershipRow>(
      `insert into tenant_memberships (
          subject_type, subject_id, tenant_id, membership_type,
          effective_from, effective_until, created_by
        )
        values ($1, $2, $3::uuid, $4, coalesce($5::timestamptz, now()), $6::timestamptz, $7)
        returning ${membershipColumns()}`,
      [
        input.subjectType,
        input.subjectId,
        input.tenantId,
        input.membershipType,
        input.effectiveFrom ?? null,
        input.effectiveUntil ?? null,
        input.createdBy ?? null,
      ],
    );
    return mapMembership(result.rows[0]);
  }

  async revokeMembership(id: string, actorId: string, revokedAt: string): Promise<TenantMembershipEntity> {
    const result = await this.db.query<MembershipRow>(
      `update tenant_memberships
          set status = \'REVOKED\',
              updated_at = $2::timestamptz,
              updated_by = $3,
              revoked_at = $2::timestamptz,
              revoked_by = $3,
              version = version + 1
        where id = $1::uuid
          and status = \'ACTIVE\'
        returning ${membershipColumns()}`,
      [id, revokedAt, actorId],
    );
    return mapMembership(result.rows[0]);
  }

  async expireMemberships(expiredAt: string): Promise<TenantMembershipEntity[]> {
    const result = await this.db.query<MembershipRow>(
      `update tenant_memberships
          set status = 'EXPIRED',
              updated_at = $1::timestamptz,
              expired_at = effective_until,
              version = version + 1
        where status = 'ACTIVE'
          and effective_until is not null
          and effective_until <= $1::timestamptz
        returning ${membershipColumns()}`,
      [expiredAt],
    );
    return result.rows.map(mapMembership);
  }

  async subjectExists(subjectType: TenantMembershipSubjectType, subjectId: string): Promise<boolean> {
    const namespace = subjectType === 'user'
      ? 'security.users'
      : subjectType === 'group' || subjectType === 'external_group'
        ? 'security.groups'
        : undefined;
    if (!namespace) return false;

    const table = await this.db.query<{ exists: boolean }>(
      `select to_regclass('public.pg_documents') is not null as exists`,
    );
    if (!table.rows[0]?.exists) return false;

    const result = await this.db.query<{ exists: boolean }>(
      `select exists(
        select 1
          from pg_documents
         where namespace = $1 and document_id = $2
      ) as exists`,
      [namespace, subjectId],
    );
    return result.rows[0]?.exists === true;
  }
}

function tenantColumns(): string {
  return `id::text as id, name, code, tenant_type as type,
    parent_id::text as "parentId", status, settings,
    created_at::text as "createdAt", updated_at::text as "updatedAt",
    deleted_at::text as "deletedAt", version`;
}

function membershipColumns(): string {
  return `id::text as id, subject_type as "subjectType", subject_id as "subjectId",
    tenant_id::text as "tenantId", membership_type as "membershipType", status,
    effective_from::text as "effectiveFrom", effective_until::text as "effectiveUntil",
    created_at::text as "createdAt", updated_at::text as "updatedAt",
    created_by as "createdBy", updated_by as "updatedBy",
    revoked_at::text as "revokedAt", revoked_by as "revokedBy",
    expired_at::text as "expiredAt", version`;
}

function addCondition(value: string | undefined, template: string, conditions: string[], params: unknown[]): void {
  if (value === undefined) return;
  params.push(value);
  conditions.push(template.replace('$PARAM', `$${params.length}`));
}

function mapTenant(row: TenantRow): TenantEntity {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    parentId: row.parentId ?? undefined,
    status: row.status,
    settings: row.settings ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? undefined,
    version: row.version,
  };
}

function mapMembership(row: MembershipRow): TenantMembershipEntity {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    tenantId: row.tenantId,
    membershipType: row.membershipType,
    status: row.status,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy ?? undefined,
    updatedBy: row.updatedBy ?? undefined,
    revokedAt: row.revokedAt ?? undefined,
    revokedBy: row.revokedBy ?? undefined,
    expiredAt: row.expiredAt ?? undefined,
    version: row.version,
  };
}
