export type TenantType = 'GROUP' | 'COMPANY';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED';

export interface TenantEntity {
  id: string;
  name: string;
  code: string;
  type: TenantType;
  parentId?: string;
  status: TenantStatus;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export type TenantMembershipSubjectType = 'user' | 'group' | 'external_group';
export type TenantMembershipType = 'owner' | 'admin' | 'operator' | 'auditor' | 'member';
export type TenantMembershipStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export interface TenantMembershipEntity {
  id: string;
  subjectType: TenantMembershipSubjectType;
  subjectId: string;
  tenantId: string;
  membershipType: TenantMembershipType;
  status: TenantMembershipStatus;
  effectiveFrom: string;
  effectiveUntil?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  revokedAt?: string;
  revokedBy?: string;
  expiredAt?: string;
  version: number;
}
