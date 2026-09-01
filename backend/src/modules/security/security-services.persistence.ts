import type { DatabasePort } from '../../database/database-port.js';
import type { ApprovalRequestEntity } from '../../persistence/entities/approval.entity.js';
import type { AuthBrowserSessionEntity, AuthPasswordCredentialEntity } from '../../persistence/entities/auth-credential.entity.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import type { ExecutionGrantEntity } from '../../persistence/entities/execution-grant.entity.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import type {
  AccessGrantEntity,
  GroupEntity,
  GroupMemberEntity,
  ObjectSetEntity,
  ObjectSetMemberEntity,
  ObjectTypeEntity,
  RoleBindingEntity,
} from '../../persistence/entities/object-permission.entity.js';
import type { SecretEntity, SecretVersionEntity } from '../../persistence/entities/secret.entity.js';
import type { BusinessPermissionGrantEntity, BusinessPermissionRelationEntity } from '../../persistence/entities/business-permission.entity.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { AuditService } from '../audits/audit.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { RBACService } from '../rbac/rbac.service.js';
import { CryptoService } from '../secrets/crypto.service.js';
import { KeyManager } from '../secrets/key-manager.service.js';
import { SecretService } from '../secrets/secret.service.js';
import { AuthService } from './auth.service.js';
import { ExternalIdentityService, type ExternalGroupRoleMapping, type IdentitySource } from './external-identity.service.js';
import type { SecurityServices } from './security.controller.js';
import { ObjectPermissionService } from './object-permission.service.js';
import { TenantIdentityService } from './tenant-identity.service.js';
import { PgTenantRepository } from './repository/tenant.repository.js';
import { TenantHierarchyService } from './domain/tenant.domain-service.js';
import { TenantContextService, type TenantContextStateEntity } from './tenant-context.service.js';
import { TenantModeService, type TenantModeBatchEntity, type TenantModeStateEntity } from './tenant-mode.service.js';
import { BusinessPermissionResolver } from './business-permission.resolver.js';
import { createBusinessPermissionRelationProjector } from './business-permission.relation-projector.js';
import { TenantArchitectureService } from './tenant-architecture.service.js';
import type { TenantMode } from '../../shared/security-types.js';

type StoredSecretVersion = SecretVersionEntity & { dekIv: string; dekAuthTag: string };
type StoredUserRole = UserRoleEntity & { id: string };

export interface PersistedSecurityServicesBundle {
  services: SecurityServices;
  flushers: Array<{ flush: () => Promise<void> }>;
}

export function createPersistedSecurityServices(db: DatabasePort, options: { initialTenantMode?: TenantMode } = {}): PersistedSecurityServicesBundle {
  const auditLogs = new PgDocumentRepository<AuditLogEntity>(db, 'security.audit_logs');
  const approvalsRepo = new PgDocumentRepository<ApprovalRequestEntity>(db, 'security.approval_requests');
  const executionGrants = new PgDocumentRepository<ExecutionGrantEntity>(db, 'security.execution_grants');
  const secretsRepo = new PgDocumentRepository<SecretEntity>(db, 'security.secrets');
  const secretVersions = new PgDocumentRepository<StoredSecretVersion>(db, 'security.secret_versions');
  const users = new PgDocumentRepository<UserEntity>(db, 'security.users');
  const roles = new PgDocumentRepository<RoleEntity>(db, 'security.roles');
  const userRoles = new PgDocumentRepository<StoredUserRole>(db, 'security.user_roles');
  const policies = new PgDocumentRepository<PermissionPolicyEntity>(db, 'security.permission_policies');
  const authCredentials = new PgDocumentRepository<AuthPasswordCredentialEntity>(db, 'security.auth_password_credentials');
  const authBrowserSessions = new PgDocumentRepository<AuthBrowserSessionEntity>(db, 'security.auth_browser_sessions');
  const identitySources = new PgDocumentRepository<IdentitySource>(db, 'security.identity_sources');
  const externalGroupRoleMappings = new PgDocumentRepository<ExternalGroupRoleMapping>(db, 'security.external_group_role_mappings');
  const tenantContextStates = new PgDocumentRepository<TenantContextStateEntity>(db, 'security.tenant_context_states');
  const tenantModeStates = new PgDocumentRepository<TenantModeStateEntity>(db, 'security.tenant_mode_states');
  const tenantModeBatches = new PgDocumentRepository<TenantModeBatchEntity>(db, 'security.tenant_mode_batches');
  const groups = new PgDocumentRepository<GroupEntity>(db, 'security.groups');
  const groupMembers = new PgDocumentRepository<GroupMemberEntity>(db, 'security.group_members');
  const roleBindings = new PgDocumentRepository<RoleBindingEntity>(db, 'security.role_bindings');
  const objectTypes = new PgDocumentRepository<ObjectTypeEntity>(db, 'security.object_types');
  const objectSets = new PgDocumentRepository<ObjectSetEntity>(db, 'security.object_sets');
  const objectSetMembers = new PgDocumentRepository<ObjectSetMemberEntity>(db, 'security.object_set_members');
  const accessGrants = new PgDocumentRepository<AccessGrantEntity>(db, 'security.access_grants');
  const businessPermissionGrants = new PgDocumentRepository<BusinessPermissionGrantEntity>(db, 'security.business_permission_grants');
  const businessPermissionRelations = new PgDocumentRepository<BusinessPermissionRelationEntity>(db, 'security.business_permission_relations');
  const tenantIdentity = new TenantIdentityService(db);
  const tenantRepository = new PgTenantRepository(db);

  const audit = new AuditService(auditLogs, undefined, () => resolveUnambiguousDefaultTenant(db, tenantIdentity), db);
  const approvals = new ApprovalService(approvalsRepo, audit, {
    allowSelfApproval: process.env.GCAC_APPROVAL_ALLOW_SELF_APPROVAL === 'true',
  });
  const grants = new ExecutionGrantService(executionGrants);
  const secrets = new SecretService(new CryptoService(new KeyManager()), grants, audit, secretsRepo, secretVersions);
  const rbac = new RBACService(users, roles, userRoles, policies, audit);
  const objectPermissions = new ObjectPermissionService(groups, groupMembers, roleBindings, objectTypes, objectSets, objectSetMembers, accessGrants, userRoles, policies, roles, audit);
  const businessPermissions = new BusinessPermissionResolver(
    businessPermissionGrants,
    businessPermissionRelations,
    objectPermissions,
    {
      ...createBusinessPermissionRelationProjector(db),
      isTenantAdministrator: async ({ subject, tenantId }) => {
        if (subject.type !== 'user') return false;
        const tenant = await tenantRepository.getTenant(tenantId);
        if (!tenant || tenant.status !== 'ACTIVE') return false;
        const memberships = await tenantRepository.listMemberships({
          subjectType: 'user',
          subjectId: subject.id,
          tenantId,
          status: 'ACTIVE',
          at: new Date().toISOString(),
        });
        return memberships.some((membership) => membership.membershipType === 'owner' || membership.membershipType === 'admin');
      },
    },
  );
  rbac.attachBusinessPermissionResolver(businessPermissions);
  objectPermissions.attachBusinessPermissionResolver(businessPermissions);
  const tenantHierarchy = new TenantHierarchyService(tenantRepository, audit);
  const tenantMode = new TenantModeService(db, tenantModeStates, tenantModeBatches, audit, tenantHierarchy, objectPermissions, options.initialTenantMode ?? 'single');
  const tenantContext = new TenantContextService(tenantIdentity, tenantHierarchy, tenantContextStates, tenantMode);
  tenantMode.attachTenantContext(tenantContext);
  const tenantArchitecture = new TenantArchitectureService(tenantHierarchy, users, groups, audit);
  const auth = new AuthService(rbac, authCredentials, audit, authBrowserSessions, objectPermissions, tenantIdentity, tenantContext);
  const externalIdentity = new ExternalIdentityService(rbac, auth, audit, secrets, undefined, identitySources, externalGroupRoleMappings);

  return {
    services: { rbac, objectPermissions, businessPermissions, audit, approvals, grants, secrets, auth, externalIdentity, tenantHierarchy, tenantContext, tenantMode, tenantArchitecture },
    flushers: [],
  };
}

async function resolveUnambiguousDefaultTenant(db: DatabasePort, tenantIdentity: TenantIdentityService): Promise<string> {
  const result = await db.query<{ count: string }>(
    `select count(*)::text as count
       from tenants
      where status = 'ACTIVE'
        and deleted_at is null`,
  );
  if (result.rows[0]?.count !== '1') {
    throw new Error('后台审计缺少租户上下文，当前不是唯一活动租户环境');
  }
  return tenantIdentity.resolveDefault();
}
