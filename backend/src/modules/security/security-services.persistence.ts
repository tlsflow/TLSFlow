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

type StoredSecretVersion = SecretVersionEntity & { dekIv: string; dekAuthTag: string };
type StoredUserRole = UserRoleEntity & { id: string };

export interface PersistedSecurityServicesBundle {
  services: SecurityServices;
  flushers: Array<{ flush: () => Promise<void> }>;
}

export function createPersistedSecurityServices(db: DatabasePort): PersistedSecurityServicesBundle {
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
  const groups = new PgDocumentRepository<GroupEntity>(db, 'security.groups');
  const groupMembers = new PgDocumentRepository<GroupMemberEntity>(db, 'security.group_members');
  const roleBindings = new PgDocumentRepository<RoleBindingEntity>(db, 'security.role_bindings');
  const objectTypes = new PgDocumentRepository<ObjectTypeEntity>(db, 'security.object_types');
  const objectSets = new PgDocumentRepository<ObjectSetEntity>(db, 'security.object_sets');
  const objectSetMembers = new PgDocumentRepository<ObjectSetMemberEntity>(db, 'security.object_set_members');
  const accessGrants = new PgDocumentRepository<AccessGrantEntity>(db, 'security.access_grants');
  const tenantIdentity = new TenantIdentityService(db);

  const audit = new AuditService(auditLogs);
  const approvals = new ApprovalService(approvalsRepo, audit, {
    allowSelfApproval: process.env.GCAC_APPROVAL_ALLOW_SELF_APPROVAL === 'true',
  });
  const grants = new ExecutionGrantService(executionGrants);
  const secrets = new SecretService(new CryptoService(new KeyManager()), grants, audit, secretsRepo, secretVersions);
  const rbac = new RBACService(users, roles, userRoles, policies, audit);
  const objectPermissions = new ObjectPermissionService(groups, groupMembers, roleBindings, objectTypes, objectSets, objectSetMembers, accessGrants, userRoles, policies, roles, audit);
  const auth = new AuthService(rbac, authCredentials, audit, authBrowserSessions, objectPermissions, tenantIdentity);
  const externalIdentity = new ExternalIdentityService(rbac, auth, audit, secrets, undefined, identitySources, externalGroupRoleMappings);

  return {
    services: { rbac, objectPermissions, audit, approvals, grants, secrets, auth, externalIdentity },
    flushers: [],
  };
}
