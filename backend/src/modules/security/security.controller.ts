import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import type { Router } from '../../common/http/router.js';
import type { RouteContract } from '../../common/openapi/route-contract.js';
import { parsePageQuery } from '../../common/pagination/pagination.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import type { PermissionPolicyEntity, RoleEntity, SupportedLocale, ThemeMode, UserEntity, UserPreferences, UserRoleEntity } from '../../persistence/entities/rbac.entity.js';
import { SECRET_SCOPE_TYPES, SECRET_TYPES, type RiskLevel, type SecretScopeType, type SecretType, type SecuritySubject } from '../../shared/security-types.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { PresentedAuditLog } from '../audits/audit-presentation.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { RBACService } from '../rbac/rbac.service.js';
import { CryptoService } from '../secrets/crypto.service.js';
import { KeyManager } from '../secrets/key-manager.service.js';
import { SecretService } from '../secrets/secret.service.js';
import { AuthService } from './auth.service.js';
import { ExternalIdentityService, type IdentitySourceTlsMode, type IdentitySourceType } from './external-identity.service.js';
import { ObjectPermissionService, type ObjectRef } from './object-permission.service.js';
import type { AccessEffect, AccessGrantEntity, AccessLevel, GroupEntity, GroupMemberEntity, ObjectSetEntity, ObjectSetKind, ObjectSetMemberEntity, ObjectTypeEntity, PrincipalType, RoleBindingEntity } from '../../persistence/entities/object-permission.entity.js';

const THEME_MODES = ['light', 'dark'] as const;
const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'fr-FR', 'ru-RU', 'pt-BR', 'ko-KR'] as const;
const DEFAULT_USER_PREFERENCES: UserPreferences = { theme: 'light', locale: 'zh-CN', version: 1 };

export interface SecurityServices {
  rbac: RBACService;
  objectPermissions: ObjectPermissionService;
  audit: AuditService;
  approvals: ApprovalService;
  grants: ExecutionGrantService;
  secrets: SecretService;
  auth: AuthService;
  externalIdentity: ExternalIdentityService;
}

export interface AuditPresentationPort {
  present(tenantId: string, auditLogs: AuditLogEntity[]): Promise<PresentedAuditLog[]>;
}

export function createSecurityServices(): SecurityServices {
  const db = new PgliteDatabase();
  const users = new PgDocumentRepository<UserEntity>(db, 'security.users');
  const roles = new PgDocumentRepository<RoleEntity>(db, 'security.roles');
  const userRoles = new PgDocumentRepository<UserRoleEntity & { id: string }>(db, 'security.user_roles');
  const policies = new PgDocumentRepository<PermissionPolicyEntity>(db, 'security.permission_policies');
  const groups = new PgDocumentRepository<GroupEntity>(db, 'security.groups');
  const groupMembers = new PgDocumentRepository<GroupMemberEntity>(db, 'security.group_members');
  const roleBindings = new PgDocumentRepository<RoleBindingEntity>(db, 'security.role_bindings');
  const objectTypes = new PgDocumentRepository<ObjectTypeEntity>(db, 'security.object_types');
  const objectSets = new PgDocumentRepository<ObjectSetEntity>(db, 'security.object_sets');
  const objectSetMembers = new PgDocumentRepository<ObjectSetMemberEntity>(db, 'security.object_set_members');
  const accessGrants = new PgDocumentRepository<AccessGrantEntity>(db, 'security.access_grants');
  const audit = new AuditService();
  const approvals = new ApprovalService(undefined, audit);
  const grants = new ExecutionGrantService();
  const secrets = new SecretService(new CryptoService(new KeyManager()), grants, audit);
  const rbac = new RBACService(users, roles, userRoles, policies, audit);
  const objectPermissions = new ObjectPermissionService(groups, groupMembers, roleBindings, objectTypes, objectSets, objectSetMembers, accessGrants, userRoles, policies, roles, audit);
  const auth = new AuthService(rbac, undefined, audit, undefined, objectPermissions);
  const externalIdentity = new ExternalIdentityService(rbac, auth, audit, secrets);
  return { rbac, objectPermissions, audit, approvals, grants, secrets, auth, externalIdentity };
}

export class SecurityController {
  constructor(
    private readonly services: SecurityServices = createSecurityServices(),
    private readonly auditPresentation?: AuditPresentationPort,
  ) {}

  register(router: Router): void {
    router.post('/api/v1/auth/login', '鐧诲綍', ['Auth'], (request) => this.login(request));
    router.post('/api/v1/auth/external-login', '澶栭儴韬唤婧愮櫥褰?', ['Auth'], (request) => this.externalLogin(request));
    router.get('/api/v1/auth/identity-sources/public', '鑾峰彇鍙敤韬唤婧?', ['Auth'], () => this.listPublicIdentitySources());
    router.post('/api/v1/auth/logout', '閫€鍑虹櫥褰?', ['Auth'], (request) => this.logout(request));
    router.get('/api/v1/auth/me', '鑾峰彇褰撳墠鐢ㄦ埛', ['Auth'], (request) => this.getMe(request));
    router.get('/api/v1/auth/permissions', '鑾峰彇褰撳墠鏉冮檺', ['Auth'], (request) => this.getMyPermissions(request));
    router.get('/api/v1/auth/permission-context', '获取当前对象级权限上下文', ['Auth'], (request) => this.getPermissionContext(request));
    router.put('/api/v1/auth/password', '修改当前用户密码', ['Auth'], (request) => this.changeMyPassword(request));
    router.get('/api/v1/auth/preferences', '获取当前用户偏好', ['Auth'], (request) => this.getMyPreferences(request));
    router.put('/api/v1/auth/preferences', '保存当前用户偏好', ['Auth'], (request) => this.updateMyPreferences(request));
    router.get('/api/v1/secrets', '查询 Secret 元数据列表', ['Security'], (request) => this.listSecrets(request));
    router.post('/api/v1/secrets', '鍒涘缓 Secret', ['Security'], (request) => this.createSecret(request));
    router.get('/api/v1/secrets/metadata', '鏌ヨ Secret 鍏冩暟鎹?', ['Security'], (request) => this.getSecretMetadata(request));
    router.post('/api/v1/approvals', '鍒涘缓瀹℃壒鍗?', ['Security'], (request) => this.createApproval(request));
    router.post('/api/v1/approvals/decide', '瀹℃壒鍐崇瓥', ['Security'], (request) => this.decideApproval(request));
    router.get('/api/v1/audit-events', '鏌ヨ瀹¤浜嬩欢', ['Security'], (request) => this.queryAudits(request));
    router.get('/api/v1/security/users', '鏌ヨ鐢ㄦ埛鍒楄〃', ['Security'], (request) => this.listUsers(request));
    router.post('/api/v1/security/users', '鍒涘缓鐢ㄦ埛', ['Security'], (request) => this.createUser(request));
    router.get('/api/v1/security/groups', '查询用户组列表', ['Security'], (request) => this.listGroups(request));
    router.post('/api/v1/security/groups', '创建本地用户组', ['Security'], (request) => this.createGroup(request));
    router.post('/api/v1/security/groups/lookup-external', '检索身份源用户组', ['Security'], (request) => this.lookupExternalGroup(request));
    router.post('/api/v1/security/groups/external', '创建身份源用户组', ['Security'], (request) => this.createExternalGroup(request));
    router.post('/api/v1/security/users/lookup-external', '检索身份源用户', ['Security'], (request) => this.lookupExternalUser(request));
    router.post('/api/v1/security/users/external', '创建身份源用户', ['Security'], (request) => this.createExternalUser(request));
    router.patch('/api/v1/security/users', '更新用户', ['Security'], (request) => this.updateUser(request));
    router.patch('/api/v1/security/users/status', '淇敼鐢ㄦ埛鐘舵€?', ['Security'], (request) => this.updateUserStatus(request));
    router.post('/api/v1/security/users/roles', '鍒嗛厤鐢ㄦ埛瑙掕壊', ['Security'], (request) => this.assignUserRole(request));
    router.delete('/api/v1/security/users/delete', '删除用户', ['Security'], (request) => this.deleteUser(request));
    router.get('/api/v1/security/roles', '鏌ヨ瑙掕壊鍒楄〃', ['Security'], (request) => this.listRoles(request));
    router.post('/api/v1/security/roles', '鍒涘缓瑙掕壊', ['Security'], (request) => this.createRole(request));
    router.delete('/api/v1/security/roles/delete', '删除角色', ['Security'], (request) => this.deleteRole(request));
    router.get('/api/v1/security/permission-policies', '鏌ヨ鏉冮檺绛栫暐', ['Security'], (request) => this.listPermissionPolicies(request));
    router.post('/api/v1/security/permission-policies', '鍒涘缓鏉冮檺绛栫暐', ['Security'], (request) => this.createPermissionPolicy(request));
    router.get('/api/v1/security/object-types', '查询权限对象类型', ['Security'], (request) => this.listObjectTypes(request));
    router.get('/api/v1/security/object-sets', '查询权限对象集合', ['Security'], (request) => this.listObjectSets(request));
    router.post('/api/v1/security/object-sets', '创建权限对象集合', ['Security'], (request) => this.createObjectSet(request));
    router.post('/api/v1/security/object-set-members', '添加权限对象集合成员', ['Security'], (request) => this.addObjectSetMember(request));
    router.get('/api/v1/security/role-bindings', '查询对象级角色绑定', ['Security'], (request) => this.listRoleBindings(request));
    router.post('/api/v1/security/role-bindings', '创建对象级角色绑定', ['Security'], (request) => this.createRoleBinding(request));
    router.get('/api/v1/security/access-grants', '查询对象级访问授权', ['Security'], (request) => this.listAccessGrants(request));
    router.post('/api/v1/security/access-grants', '创建对象级访问授权', ['Security'], (request) => this.createAccessGrant(request));
    router.post('/api/v1/security/object-capabilities', '批量查询对象级能力', ['Security'], (request) => this.getObjectCapabilities(request));
    router.get('/api/v1/security/identity-sources', '鏌ヨ韬唤婧?', ['Security'], (request) => this.listIdentitySources(request));
    router.post('/api/v1/security/identity-sources', '鍒涘缓韬唤婧?', ['Security'], (request) => this.createIdentitySource(request));
    router.patch('/api/v1/security/identity-sources', '更新身份源', ['Security'], (request) => this.updateIdentitySource(request));
    router.delete('/api/v1/security/identity-sources/delete', '删除身份源', ['Security'], (request) => this.deleteIdentitySource(request));
    router.post('/api/v1/security/identity-sources/test', '娴嬭瘯韬唤婧愯繛鎺?', ['Security'], (request) => this.testIdentitySource(request));
    router.post('/api/v1/security/identity-sources/sync-users', '鍚屾 LDAP 鐢ㄦ埛', ['Security'], (request) => this.syncIdentitySourceUsers(request));
    router.get('/api/v1/security/group-role-mappings', '鏌ヨ澶栭儴缁勮鑹叉槧灏?', ['Security'], (request) => this.listGroupRoleMappings(request));
    router.post('/api/v1/security/group-role-mappings', '鍒涘缓澶栭儴缁勮鑹叉槧灏?', ['Security'], (request) => this.createGroupRoleMapping(request));
  }

  private async login(request: HttpRequest) {
    const body = validateObject(request.body, {
      username: { type: 'string', required: true },
      password: { type: 'string', required: true },
    });
    const username = String(body.username);
    const localUser = await this.services.rbac.findUserByUsername(username);
    if (localUser?.externalSourceId) {
      const session = await this.services.externalIdentity.login({
        sourceId: localUser.externalSourceId,
        username,
        password: String(body.password),
      }, request.context);
      return this.withBrowserSessionCookie(session, request);
    }
    const session = await this.services.auth.login({ username, password: String(body.password) }, request.context);
    return this.withBrowserSessionCookie(session, request);
  }

  private async externalLogin(request: HttpRequest) {
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      username: { type: 'string', required: true },
      password: { type: 'string', required: true },
    });
    const session = await this.services.externalIdentity.login({
      sourceId: String(body.sourceId),
      username: String(body.username),
      password: String(body.password),
    }, request.context);
    return this.withBrowserSessionCookie(session, request);
  }

  private async listPublicIdentitySources() {
    return { items: await this.services.externalIdentity.listPublicSources() };
  }

  private async logout(request: HttpRequest) {
    await this.services.auth.revokeBrowserSession(readHeader(request, 'cookie'));
    const result = await this.services.auth.logout(await this.optionalSubjectFromRequest(request), request.context);
    return {
      headers: { 'Set-Cookie': this.services.auth.buildSessionClearCookie() },
      body: result,
    };
  }

  private async getMe(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const session = await this.services.auth.currentSession(subject.id);
    return { user: session.user, roles: session.user.roles, permissions: session.permissions };
  }

  private async getMyPermissions(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const session = await this.services.auth.currentSession(subject.id);
    return { permissions: session.permissions };
  }

  private async getPermissionContext(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const session = await this.services.auth.currentSession(subject.id);
    const objectPermission = await this.services.objectPermissions.permissionContext(subject);
    return {
      user: session.user,
      roles: session.user.roles,
      permissions: session.permissions,
      objectSets: objectPermission.objectSets,
      roleBindings: objectPermission.roleBindings,
      objectPermissionVersion: objectPermission.version,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  private async changeMyPassword(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const body = validateObject(request.body, {
      currentPassword: { type: 'string', required: true },
      newPassword: { type: 'string', required: true },
    });
    return this.services.auth.changePassword({
      userId: subject.id,
      currentPassword: String(body.currentPassword),
      newPassword: String(body.newPassword),
    }, request.context);
  }

  private async getMyPreferences(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const user = await this.services.rbac.getUser(subject.id);
    if (!user) throw new AppError('RESOURCE_NOT_FOUND', '当前用户不存在');
    return normalizeUserPreferences(user.preferences);
  }

  private async updateMyPreferences(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const body = validateObject(request.body, {
      theme: { type: 'string', required: true, enum: THEME_MODES },
      locale: { type: 'string', required: true, enum: SUPPORTED_LOCALES },
    });
    const preferences: UserPreferences = {
      theme: body.theme as ThemeMode,
      locale: body.locale as SupportedLocale,
      version: 1,
    };
    const user = await this.services.rbac.updateUserPreferences(subject.id, preferences);
    return normalizeUserPreferences(user.preferences);
  }

  private async withBrowserSessionCookie(session: { user: { id: string } }, request: HttpRequest) {
    const cookieSession = await this.services.auth.createBrowserSession(session.user.id, request.context);
    return {
      headers: { 'Set-Cookie': this.services.auth.buildSessionSetCookie(cookieSession.cookieValue, cookieSession.expiresAt) },
      body: session,
    };
  }

  private async createSecret(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      type: { type: 'string', required: true, enum: SECRET_TYPES },
      scopeType: { type: 'string', required: true, enum: SECRET_SCOPE_TYPES },
      plainText: { type: 'string', required: true },
      scopeId: { type: 'string' },
      metadata: { type: 'object' },
    });
    const subject = await this.subjectFromRequest(request);
    await this.services.rbac.assertCan(subject, 'secret.create', {
      type: 'secret',
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));

    return {
      statusCode: 201,
      body: await this.services.secrets.create({
        name: String(body.name),
        type: body.type as SecretType,
        scopeType: body.scopeType as SecretScopeType,
        scopeId: body.scopeId === undefined ? undefined : String(body.scopeId),
        metadata: body.metadata === undefined ? undefined : body.metadata as Record<string, unknown>,
        plainText: String(body.plainText),
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
  }

  private async listSecrets(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.services.rbac.assertCan(subject, 'secret.read', {
      type: 'secret',
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    const type = readOptionalQueryString(request, 'type');
    const scopeType = readOptionalQueryString(request, 'scopeType');
    const workflowCredential = readOptionalQueryString(request, 'workflowCredential');
    const items = (await this.services.secrets.listMetadata()).filter((item) => {
      if (type && item.type !== type) return false;
      if (scopeType && item.scopeType !== scopeType) return false;
      if (workflowCredential === 'true' && item.metadata.workflowCredential !== true) return false;
      return true;
    });
    return page(items);
  }

  private async getSecretMetadata(request: HttpRequest) {
    const id = readQueryString(request, 'id');
    const subject = await this.subjectFromRequest(request);
    await this.services.rbac.assertCan(subject, 'secret.read', {
      type: 'secret',
      id,
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return this.services.secrets.getMetadata(id);
  }

  private async createApproval(request: HttpRequest) {
    const body = validateObject(request.body, {
      operationType: { type: 'string', required: true },
      resourceRefs: { type: 'array', required: true },
      riskLevel: { type: 'string', required: true },
      parameters: { type: 'object', required: true },
      expiresAt: { type: 'string' },
    });
    const subject = await this.subjectFromRequest(request);
    await this.services.rbac.assertCan(subject, 'approval.create', {
      type: 'approval',
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return {
      statusCode: 201,
      body: await this.services.approvals.create({
        operationType: String(body.operationType),
        resourceRefs: body.resourceRefs as Array<{ type: string; id: string }>,
        riskLevel: body.riskLevel as RiskLevel,
        parameters: body.parameters,
        requestedBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
      }, this.securityContext(request, subject)),
    };
  }

  private async decideApproval(request: HttpRequest) {
    const body = validateObject(request.body, {
      approvalId: { type: 'string', required: true },
      decision: { type: 'string', required: true, enum: ['approved', 'rejected'] },
      comment: { type: 'string' },
    });
    const subject = await this.subjectFromRequest(request);
    await this.services.rbac.assertCan(subject, 'approval.decide', {
      type: 'approval',
      id: String(body.approvalId),
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return this.services.approvals.decide({
      approvalId: String(body.approvalId),
      decision: body.decision as 'approved' | 'rejected',
      approverId: subject.id,
      comment: body.comment === undefined ? undefined : String(body.comment),
    }, this.securityContext(request, subject));
  }

  private async queryAudits(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const pageQuery = parsePageQuery(request.query, {
      allowedSortFields: ['createdAt', 'result', 'riskLevel', 'eventType', 'actorId', 'resourceType'],
      defaultPageSize: 50,
      maxPageSize: 200,
    });
    const items = await this.services.audit.queryWithPermission({
      subject,
      query: {
        actorId: readOptionalQueryString(request, 'actorId'),
        eventType: readOptionalQueryString(request, 'eventType'),
        resourceType: readOptionalQueryString(request, 'resourceType'),
        resourceId: readOptionalQueryString(request, 'resourceId'),
        riskLevel: readOptionalQueryString(request, 'riskLevel') as RiskLevel | undefined,
        resourceScope: { tenantId: request.context.tenantId },
      },
      context: this.securityContext(request, subject),
      assertCan: this.services.rbac.assertCan.bind(this.services.rbac),
    });
    const presentedItems = this.auditPresentation
      ? await this.auditPresentation.present(request.context.tenantId ?? '', items)
      : items;
    const sortedItems = sortAuditItems(presentedItems, pageQuery.sort ?? { field: 'createdAt', direction: 'desc' });
    const start = (pageQuery.page - 1) * pageQuery.pageSize;
    return {
      items: sortedItems.slice(start, start + pageQuery.pageSize),
      page: pageQuery.page,
      pageSize: pageQuery.pageSize,
      total: sortedItems.length,
    };
  }

  private async listUsers(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.read', request, 'user');
    const users = await this.services.rbac.listUsers();
    const identitySources = await this.services.externalIdentity.listSources();
    const identitySourceNameById = new Map(identitySources.map((source) => [source.id, source.name]));
    const items = [];
    for (const user of users) {
      const roles = await this.services.rbac.rolesForUser(user.id);
      items.push({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        tenantId: user.tenantId ?? request.context.tenantId ?? 'default',
        tenantName: user.tenantName ?? '\u9ed8\u8ba4\u79df\u6237',
        status: user.status,
        identityProvider: user.identityProvider ?? 'local',
        externalSourceId: user.externalSourceId,
        externalSourceName: user.externalSourceId ? identitySourceNameById.get(user.externalSourceId) : undefined,
        externalId: user.externalId,
        lastSyncedAt: user.lastSyncedAt,
        syncSource: user.syncSource,
        roles: roles.map((role) => ({ id: role.id, code: role.code, name: role.name })),
        roleNames: roles.map((role) => role.name).join(', '),
        updatedAt: user.updatedAt,
      });
    }
    return page(items);
  }

  private async createUser(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      username: { type: 'string', required: true },
      displayName: { type: 'string', required: true },
      email: { type: 'string' },
      password: { type: 'string', required: true },
      tenantId: { type: 'string' },
      tenantName: { type: 'string' },
      roleId: { type: 'string' },
    });
    const user = await this.services.auth.createUserWithPassword({
      id: `user_${String(body.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
      username: String(body.username),
      displayName: String(body.displayName),
      email: body.email === undefined ? undefined : String(body.email),
      password: String(body.password),
      status: 'active',
      tenantId: body.tenantId === undefined ? request.context.tenantId ?? 'default' : String(body.tenantId),
      tenantName: body.tenantName === undefined ? '\u9ed8\u8ba4\u79df\u6237' : String(body.tenantName),
    });
    if (body.roleId) {
      await this.services.rbac.assignRole(user.id, String(body.roleId));
    }
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_CREATED, 'security.user.create', 'user', user.id);
    return { statusCode: 201, body: user };
  }

  private async listGroups(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.read', request, 'group');
    const identitySources = await this.services.externalIdentity.listSources();
    const identitySourceNameById = new Map(identitySources.map((source) => [source.id, source.name]));
    return page((await this.services.objectPermissions.listGroups()).map((group) => ({
      ...group,
      externalSourceName: group.externalSourceId ? identitySourceNameById.get(group.externalSourceId) : undefined,
    })));
  }

  private async createGroup(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'group');
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      code: { type: 'string' },
      tenantId: { type: 'string' },
      enabled: { type: 'boolean' },
    });
    const tenantId = body.tenantId === undefined ? request.context.tenantId ?? 'default' : String(body.tenantId);
    const code = normalizeGroupCode(body.code === undefined ? String(body.name) : String(body.code));
    const existing = (await this.services.objectPermissions.listGroups()).find((group) => group.tenantId === tenantId && group.code === code);
    if (existing) throw new AppError('VALIDATION_FAILED', '用户组编码已存在', { code });
    const group = await this.services.objectPermissions.createGroup({
      tenantId,
      code,
      name: String(body.name).trim(),
      source: 'local',
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });
    await this.writeAudit(request, subject, 'security.group.created', 'security.group.create', 'group', group.id, { after: group });
    return { statusCode: 201, body: group };
  }

  private async lookupExternalGroup(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'group');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      groupName: { type: 'string', required: true },
    });
    return this.services.externalIdentity.lookupGroup({
      sourceId: String(body.sourceId),
      groupName: String(body.groupName),
    }, subject, this.securityContext(request, subject));
  }

  private async createExternalGroup(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'group');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      groupName: { type: 'string', required: true },
      tenantId: { type: 'string' },
      enabled: { type: 'boolean' },
    });
    const profile = await this.services.externalIdentity.lookupGroup({
      sourceId: String(body.sourceId),
      groupName: String(body.groupName),
    }, subject, this.securityContext(request, subject));
    const tenantId = body.tenantId === undefined ? request.context.tenantId ?? 'default' : String(body.tenantId);
    const existing = (await this.services.objectPermissions.listGroups()).find((group) =>
      group.tenantId === tenantId
      && group.externalSourceId === profile.sourceId
      && group.externalRef === profile.externalId,
    );
    if (existing) throw new AppError('VALIDATION_FAILED', '该身份源用户组已存在', { groupId: existing.id });
    const group = await this.services.objectPermissions.createGroup({
      id: `external_group_${profile.sourceId}_${profile.externalId}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      tenantId,
      code: normalizeGroupCode(`${profile.sourceId}_${profile.code || profile.name}`),
      name: profile.name,
      source: profile.identityProvider,
      externalSourceId: profile.sourceId,
      externalRef: profile.externalId,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    });
    await this.writeAudit(request, subject, 'security.group.created', 'security.group.create_external', 'group', group.id, {
      after: group,
      sourceId: profile.sourceId,
      groupName: profile.name,
    });
    return { statusCode: 201, body: group };
  }

  private async lookupExternalUser(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      username: { type: 'string', required: true },
    });
    return this.services.externalIdentity.lookupUser({
      sourceId: String(body.sourceId),
      username: String(body.username),
    }, subject, this.securityContext(request, subject));
  }

  private async createExternalUser(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      username: { type: 'string', required: true },
      roleId: { type: 'string' },
      tenantId: { type: 'string' },
      tenantName: { type: 'string' },
    });
    const user = await this.services.externalIdentity.createLinkedUser({
      sourceId: String(body.sourceId),
      username: String(body.username),
      roleId: body.roleId === undefined ? undefined : String(body.roleId),
      tenantId: body.tenantId === undefined ? request.context.tenantId ?? 'default' : String(body.tenantId),
      tenantName: body.tenantName === undefined ? '默认租户' : String(body.tenantName),
    }, subject, this.securityContext(request, subject));
    return { statusCode: 201, body: user };
  }

  private async updateUser(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      userId: { type: 'string', required: true },
      displayName: { type: 'string' },
      email: { type: 'string' },
      status: { type: 'string', enum: ['active', 'disabled'] },
      roleId: { type: 'string' },
    });
    const userId = String(body.userId);
    if (userId === 'user_admin' && body.status === 'disabled') {
      throw new AppError('VALIDATION_FAILED', '不能禁用内置管理员');
    }
    const user = await this.services.rbac.updateUser(userId, {
      displayName: body.displayName === undefined ? undefined : String(body.displayName),
      email: body.email === undefined ? undefined : String(body.email),
      status: body.status === undefined ? undefined : body.status as 'active' | 'disabled',
    });
    if (body.roleId) {
      await this.services.rbac.assignRole(userId, String(body.roleId));
    }
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_UPDATED, 'security.user.update', 'user', user.id, {
      roleId: body.roleId === undefined ? undefined : String(body.roleId),
      status: user.status,
    });
    return user;
  }

  private async updateUserStatus(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      userId: { type: 'string', required: true },
      status: { type: 'string', required: true, enum: ['active', 'disabled'] },
    });
    const user = await this.services.rbac.updateUserStatus(String(body.userId), body.status as 'active' | 'disabled');
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_STATUS_CHANGED, 'security.user.status', 'user', user.id, { status: user.status });
    return user;
  }

  private async assignUserRole(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      userId: { type: 'string', required: true },
      roleId: { type: 'string', required: true },
    });
    await this.services.rbac.assignRole(String(body.userId), String(body.roleId));
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_ROLE_ASSIGNED, 'security.user.assign_role', 'user', String(body.userId), { roleId: String(body.roleId) });
    return { userId: String(body.userId), roleId: String(body.roleId) };
  }

  private async deleteUser(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      userId: { type: 'string', required: true },
    });
    const userId = String(body.userId);
    if (userId === 'user_admin') {
      throw new AppError('VALIDATION_FAILED', '不能删除内置管理员');
    }
    await this.services.auth.deleteUserCredentials(userId);
    await this.services.rbac.deleteUser(userId);
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_DELETED, 'security.user.delete', 'user', userId);
    return { userId, deleted: true as const };
  }

  private async listRoles(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.role.read', request, 'role');
    const policies = await this.services.rbac.listPolicies();
    const roles = await this.services.rbac.listRoles();
    const items = roles.map((role) => {
      const rolePolicies = policies.filter((policy) => policy.subjectType === 'role' && policy.subjectId === role.id);
      return {
        ...role,
        policyCount: rolePolicies.length,
        permissions: [...new Set(rolePolicies.flatMap((policy) => policy.actions))].sort(),
      };
    });
    return page(items);
  }

  private async createRole(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.role.write', request, 'role');
    const body = validateObject(request.body, {
      code: { type: 'string', required: true },
      name: { type: 'string', required: true },
      description: { type: 'string' },
    });
    const code = String(body.code).trim().toLowerCase();
    const role = await this.services.rbac.createRole({
      id: `role_${code.replace(/[^a-z0-9_]/g, '_')}`,
      code,
      name: String(body.name),
      description: body.description === undefined ? undefined : String(body.description),
      builtin: false,
    });
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_ROLE_CREATED, 'security.role.create', 'role', role.id);
    return { statusCode: 201, body: role };
  }

  private async deleteRole(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.role.write', request, 'role');
    const body = validateObject(request.body, {
      roleId: { type: 'string', required: true },
    });
    const roleId = String(body.roleId);
    const role = await this.services.rbac.getRole(roleId);
    if (!role) {
      throw new AppError('RESOURCE_NOT_FOUND', '角色不存在');
    }
    if (role.builtin) {
      throw new AppError('VALIDATION_FAILED', '不能删除内置角色');
    }
    const objectPermissionCleanup = await this.services.objectPermissions.deleteRoleReferences(roleId);
    await this.services.rbac.deleteRole(roleId);
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_ROLE_DELETED, 'security.role.delete', 'role', roleId, {
      before: role,
      cleanup: objectPermissionCleanup,
    });
    return { roleId, deleted: true as const };
  }

  private async listPermissionPolicies(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.read', request, 'permissionPolicy');
    return page(await this.services.rbac.listPolicies());
  }

  private async createPermissionPolicy(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'permissionPolicy');
    const body = validateObject(request.body, {
      subjectType: { type: 'string', required: true, enum: ['user', 'group', 'role', 'plugin', 'executor'] },
      subjectId: { type: 'string', required: true },
      effect: { type: 'string', required: true, enum: ['allow', 'deny'] },
      actions: { type: 'array', required: true },
      resourceTypes: { type: 'array', required: true },
      scope: { type: 'object', required: true },
    });
    const policy = await this.services.rbac.createPolicy({
      subjectType: body.subjectType as 'user' | 'group' | 'role' | 'plugin' | 'executor',
      subjectId: String(body.subjectId),
      effect: body.effect as 'allow' | 'deny',
      actions: toStringArray(body.actions, 'actions'),
      resourceTypes: toStringArray(body.resourceTypes, 'resourceTypes'),
      scope: body.scope as Record<string, string>,
    });
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_PERMISSION_POLICY_CREATED, 'security.permission.create', 'permissionPolicy', policy.id);
    return { statusCode: 201, body: policy };
  }

  private async listObjectTypes(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.read', request, 'permissionObjectType');
    return page(await this.services.objectPermissions.listObjectTypes());
  }

  private async listObjectSets(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.read', request, 'permissionObjectSet');
    return page(await this.services.objectPermissions.listObjectSets());
  }

  private async createObjectSet(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'permissionObjectSet');
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      kind: { type: 'string', required: true, enum: ['static', 'dynamic'] },
      objectTypes: { type: 'array', required: true },
      conditions: { type: 'object' },
      status: { type: 'string', enum: ['active', 'disabled', 'invalid'] },
    });
    const created = await this.services.objectPermissions.createObjectSet({
      tenantId: request.context.tenantId ?? 'default',
      name: String(body.name),
      kind: body.kind as ObjectSetKind,
      objectTypes: toStringArray(body.objectTypes, 'objectTypes'),
      conditions: body.conditions as Record<string, unknown> | undefined,
      status: (body.status ?? 'active') as 'active' | 'disabled' | 'invalid',
    });
    await this.writeAudit(request, subject, 'security.object_set.created', 'security.object_set.create', 'permissionObjectSet', created.id, { after: created });
    return { statusCode: 201, body: created };
  }

  private async addObjectSetMember(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'permissionObjectSet');
    const body = validateObject(request.body, {
      objectSetId: { type: 'string', required: true },
      objectType: { type: 'string', required: true },
      objectId: { type: 'string', required: true },
    });
    const created = await this.services.objectPermissions.addObjectSetMember({
      objectSetId: String(body.objectSetId),
      objectType: String(body.objectType),
      objectId: String(body.objectId),
      addedBy: subject.id,
    });
    await this.writeAudit(request, subject, 'security.object_set_member.added', 'security.object_set_member.add', 'permissionObjectSet', created.objectSetId, { after: created });
    return { statusCode: 201, body: created };
  }

  private async listRoleBindings(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.read', request, 'permissionRoleBinding');
    return page(await this.services.objectPermissions.listRoleBindings());
  }

  private async createRoleBinding(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'permissionRoleBinding');
    const body = validateObject(request.body, {
      principalType: { type: 'string', required: true, enum: ['user', 'group', 'external_group', 'system', 'plugin', 'executor'] },
      principalId: { type: 'string', required: true },
      roleId: { type: 'string', required: true },
      objectSetId: { type: 'string', required: true },
      effect: { type: 'string', enum: ['allow', 'deny'] },
      enabled: { type: 'boolean' },
      validFrom: { type: 'string' },
      validTo: { type: 'string' },
    });
    const created = await this.services.objectPermissions.createRoleBinding({
      tenantId: request.context.tenantId ?? 'default',
      principalType: body.principalType as PrincipalType,
      principalId: String(body.principalId),
      roleId: String(body.roleId),
      objectSetId: String(body.objectSetId),
      effect: (body.effect ?? 'allow') as AccessEffect,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      validFrom: body.validFrom === undefined ? undefined : String(body.validFrom),
      validTo: body.validTo === undefined ? undefined : String(body.validTo),
    });
    await this.writeAudit(request, subject, 'security.role_binding.created', 'security.role_binding.create', 'permissionRoleBinding', created.id, { after: created });
    return { statusCode: 201, body: created };
  }

  private async listAccessGrants(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.read', request, 'permissionAccessGrant');
    return page(await this.services.objectPermissions.listAccessGrants());
  }

  private async createAccessGrant(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.permission.write', request, 'permissionAccessGrant');
    const body = validateObject(request.body, {
      roleId: { type: 'string', required: true },
      objectSetId: { type: 'string', required: true },
      accessLevel: { type: 'string', required: true, enum: ['read', 'edit', 'control'] },
      effect: { type: 'string', enum: ['allow', 'deny'] },
      constraints: { type: 'object' },
    });
    const created = await this.services.objectPermissions.createAccessGrant({
      roleId: String(body.roleId),
      objectSetId: String(body.objectSetId),
      accessLevel: body.accessLevel as AccessLevel,
      effect: (body.effect ?? 'allow') as AccessEffect,
      constraints: body.constraints as Record<string, unknown> | undefined,
    });
    await this.writeAudit(request, subject, 'security.access_grant.created', 'security.access_grant.create', 'permissionAccessGrant', created.id, { after: created });
    return { statusCode: 201, body: created };
  }

  private async getObjectCapabilities(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    const body = validateObject(request.body, {
      objects: { type: 'array', required: true },
      accessLevels: { type: 'array' },
    });
    const accessLevels = body.accessLevels === undefined ? ['read', 'edit', 'control'] as AccessLevel[] : readAccessLevels(body.accessLevels);
    const objects = readObjectRefs(body.objects);
    const items = [];
    for (const object of objects) {
      const levels: Record<string, unknown> = {};
      for (const accessLevel of accessLevels) {
        levels[accessLevel] = await this.services.objectPermissions.can(subject, accessLevel, object, this.securityContext(request, subject));
      }
      items.push({ object, capabilities: levels });
    }
    return { items };
  }

  private async listIdentitySources(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.read', request, 'identitySource');
    return page(await this.services.externalIdentity.listSources());
  }

  private async createIdentitySource(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.write', request, 'identitySource');
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      type: { type: 'string', required: true, enum: ['active_directory', 'ldap'] },
      url: { type: 'string', required: true },
      baseDn: { type: 'string', required: true },
      userFilter: { type: 'string' },
      groupFilter: { type: 'string' },
      syncUserFilter: { type: 'string' },
      userDnTemplate: { type: 'string' },
      bindDn: { type: 'string' },
      bindPasswordSecretRef: { type: 'string' },
      defaultRoleId: { type: 'string' },
      requireGroupMapping: { type: 'boolean' },
      tlsMode: { type: 'string', enum: ['none', 'starttls', 'ldaps'] },
      userAttributes: { type: 'array' },
      groupAttributes: { type: 'array' },
      enabled: { type: 'boolean' },
    });
    const source = await this.services.externalIdentity.createSource({
      name: String(body.name),
      type: body.type as IdentitySourceType,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      url: String(body.url),
      baseDn: String(body.baseDn),
      userFilter: body.userFilter === undefined ? undefined : String(body.userFilter),
      groupFilter: body.groupFilter === undefined ? undefined : String(body.groupFilter),
      syncUserFilter: body.syncUserFilter === undefined ? undefined : String(body.syncUserFilter),
      userDnTemplate: body.userDnTemplate === undefined ? undefined : String(body.userDnTemplate),
      bindDn: body.bindDn === undefined ? undefined : String(body.bindDn),
      bindPasswordSecretRef: body.bindPasswordSecretRef === undefined ? undefined : String(body.bindPasswordSecretRef),
      defaultRoleId: body.defaultRoleId === undefined ? undefined : String(body.defaultRoleId),
      requireGroupMapping: body.requireGroupMapping === undefined ? true : Boolean(body.requireGroupMapping),
      tlsMode: (body.tlsMode ?? 'ldaps') as IdentitySourceTlsMode,
      userAttributes: body.userAttributes === undefined ? undefined : toStringArray(body.userAttributes, 'userAttributes'),
      groupAttributes: body.groupAttributes === undefined ? undefined : toStringArray(body.groupAttributes, 'groupAttributes'),
    }, subject, request.context);
    return { statusCode: 201, body: source };
  }

  private async updateIdentitySource(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.write', request, 'identitySource');
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
      name: { type: 'string' },
      type: { type: 'string', enum: ['active_directory', 'ldap'] },
      url: { type: 'string' },
      baseDn: { type: 'string' },
      userFilter: { type: 'string' },
      groupFilter: { type: 'string' },
      syncUserFilter: { type: 'string' },
      userDnTemplate: { type: 'string' },
      bindDn: { type: 'string' },
      bindPasswordSecretRef: { type: 'string' },
      defaultRoleId: { type: 'string' },
      requireGroupMapping: { type: 'boolean' },
      tlsMode: { type: 'string', enum: ['none', 'starttls', 'ldaps'] },
      userAttributes: { type: 'array' },
      groupAttributes: { type: 'array' },
      enabled: { type: 'boolean' },
    });
    return this.services.externalIdentity.updateSource(
      String(body.id),
      {
        name: body.name === undefined ? undefined : String(body.name),
        type: body.type as IdentitySourceType | undefined,
        enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
        url: body.url === undefined ? undefined : String(body.url),
        baseDn: body.baseDn === undefined ? undefined : String(body.baseDn),
        userFilter: body.userFilter === undefined ? undefined : String(body.userFilter),
        groupFilter: body.groupFilter === undefined ? undefined : String(body.groupFilter),
        syncUserFilter: body.syncUserFilter === undefined ? undefined : String(body.syncUserFilter),
        userDnTemplate: body.userDnTemplate === undefined ? undefined : String(body.userDnTemplate),
        bindDn: body.bindDn === undefined ? undefined : String(body.bindDn),
        bindPasswordSecretRef: body.bindPasswordSecretRef === undefined ? undefined : String(body.bindPasswordSecretRef),
        defaultRoleId: body.defaultRoleId === undefined ? undefined : String(body.defaultRoleId),
        requireGroupMapping: body.requireGroupMapping === undefined ? undefined : Boolean(body.requireGroupMapping),
        tlsMode: body.tlsMode as IdentitySourceTlsMode | undefined,
        userAttributes: body.userAttributes === undefined ? undefined : toStringArray(body.userAttributes, 'userAttributes'),
        groupAttributes: body.groupAttributes === undefined ? undefined : toStringArray(body.groupAttributes, 'groupAttributes'),
      },
      subject,
      request.context,
    );
  }

  private async deleteIdentitySource(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.write', request, 'identitySource');
    const body = validateObject(request.body, {
      id: { type: 'string', required: true },
    });
    return this.services.externalIdentity.deleteSource(String(body.id), subject, request.context);
  }

  private async testIdentitySource(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.write', request, 'identitySource');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
    });
    return this.services.externalIdentity.testSource(String(body.sourceId), subject.id, this.securityContext(request, subject));
  }

  private async syncIdentitySourceUsers(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.write', request, 'identitySource');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      usernamePrefix: { type: 'string' },
      pageSize: { type: 'number' },
    });
    return this.services.externalIdentity.syncUsers({
      sourceId: String(body.sourceId),
      usernamePrefix: body.usernamePrefix === undefined ? undefined : String(body.usernamePrefix),
      pageSize: body.pageSize === undefined ? undefined : Number(body.pageSize),
    }, subject, this.securityContext(request, subject));
  }

  private async listGroupRoleMappings(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.read', request, 'externalGroupRoleMapping');
    return page(await this.services.externalIdentity.listMappings());
  }

  private async createGroupRoleMapping(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.identity_source.write', request, 'externalGroupRoleMapping');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      externalGroup: { type: 'string', required: true },
      roleId: { type: 'string', required: true },
      enabled: { type: 'boolean' },
    });
    const mapping = await this.services.externalIdentity.createMapping({
      sourceId: String(body.sourceId),
      externalGroup: String(body.externalGroup),
      roleId: String(body.roleId),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    }, subject, request.context);
    return { statusCode: 201, body: mapping };
  }

  private async subjectFromRequest(request: HttpRequest): Promise<SecuritySubject> {
    if (!request.context.actorId) {
      throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    }
    const user = await this.services.rbac.getUser(request.context.actorId);
    return {
      id: request.context.actorId,
      type: 'user',
      roleIds: user ? (await this.services.rbac.rolesForUser(user.id)).map((role) => role.id) : undefined,
      scope: { tenantId: request.context.tenantId },
    };
  }

  private async optionalSubjectFromRequest(request: HttpRequest): Promise<SecuritySubject | undefined> {
    return request.context.actorId ? this.subjectFromRequest(request) : undefined;
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor,
    };
  }

  private async assertSecurityCan(subject: SecuritySubject, action: string, request: HttpRequest, resourceType: string): Promise<void> {
    await this.services.rbac.assertCan(subject, action, {
      type: resourceType,
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
  }

  private async writeAudit(
    request: HttpRequest,
    subject: SecuritySubject,
    eventType: string,
    action: string,
    resourceType: string,
    resourceId?: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    await this.services.audit.write({
      eventType,
      actorType: 'user',
      actorId: subject.id,
      action,
      resourceType,
      resourceId,
      result: 'success',
      riskLevel: 'medium',
      context: this.securityContext(request, subject),
      detail,
    });
  }
}

function page<T>(items: T[]) {
  return { items, page: 1, pageSize: 20, total: items.length };
}

function sortAuditItems<T extends AuditLogEntity>(items: T[], sort: { field: string; direction: 'asc' | 'desc' }): T[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...items].sort((left, right) => compareAuditField(left, right, sort.field) * direction);
}

function compareAuditField(left: AuditLogEntity, right: AuditLogEntity, field: string): number {
  if (field === 'createdAt') return toTime(left.createdAt) - toTime(right.createdAt);
  return String(readAuditField(left, field) ?? '').localeCompare(String(readAuditField(right, field) ?? ''));
}

function readAuditField(item: AuditLogEntity, field: string): unknown {
  return (item as unknown as Record<string, unknown>)[field];
}

function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new AppError('VALIDATION_FAILED', `${field} 蹇呴』鏄瓧绗︿覆鏁扮粍`, { field });
  }
  return value.map((item) => item.trim());
}

function normalizeGroupCode(value: string): string {
  const code = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
  return code || `group_${Date.now().toString(36)}`;
}

function readAccessLevels(value: unknown): AccessLevel[] {
  const values = toStringArray(value, 'accessLevels');
  const allowed = new Set<AccessLevel>(['read', 'edit', 'control']);
  if (!values.every((item): item is AccessLevel => allowed.has(item as AccessLevel))) {
    throw new AppError('VALIDATION_FAILED', 'accessLevels 只能包含 read、edit、control', { field: 'accessLevels' });
  }
  return values;
}

function readObjectRefs(value: unknown): ObjectRef[] {
  if (!Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', 'objects 必须是数组', { field: 'objects' });
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AppError('VALIDATION_FAILED', 'objects 项必须是对象', { field: `objects[${index}]` });
    }
    const record = item as Record<string, unknown>;
    if (typeof record.objectType !== 'string' || record.objectType.trim() === '') {
      throw new AppError('VALIDATION_FAILED', 'objectType 不能为空', { field: `objects[${index}].objectType` });
    }
    return {
      objectType: record.objectType.trim(),
      objectId: typeof record.objectId === 'string' && record.objectId.trim() !== '' ? record.objectId.trim() : undefined,
      tenantId: typeof record.tenantId === 'string' && record.tenantId.trim() !== '' ? record.tenantId.trim() : undefined,
      attributes: record.attributes && typeof record.attributes === 'object' && !Array.isArray(record.attributes)
        ? record.attributes as Record<string, unknown>
        : undefined,
    };
  });
}

function readQueryString(request: HttpRequest, key: string): string {
  const value = readOptionalQueryString(request, key);
  if (!value) throw new AppError('VALIDATION_FAILED', `缂哄皯鏌ヨ鍙傛暟 ${key}`, { field: key });
  return value;
}

function readOptionalQueryString(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeUserPreferences(value: unknown): UserPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_USER_PREFERENCES };
  }
  const record = value as Record<string, unknown>;
  const theme = THEME_MODES.includes(record.theme as ThemeMode) ? record.theme as ThemeMode : DEFAULT_USER_PREFERENCES.theme;
  const locale = SUPPORTED_LOCALES.includes(record.locale as SupportedLocale) ? record.locale as SupportedLocale : DEFAULT_USER_PREFERENCES.locale;
  return { theme, locale, version: 1 };
}

function readHeader(request: HttpRequest, key: string): string | undefined {
  const value = request.headers[key] ?? request.headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function getSecurityRouteContracts(): RouteContract[] {
  return [
    { method: 'POST', path: '/api/v1/auth/login', operationId: 'login', summary: '鐧诲綍', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/auth/external-login', operationId: 'externalLogin', summary: '澶栭儴韬唤婧愮櫥褰?', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/identity-sources/public', operationId: 'listPublicIdentitySources', summary: '鑾峰彇鍙敤韬唤婧?', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/auth/logout', operationId: 'logout', summary: '閫€鍑虹櫥褰?', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/me', operationId: 'getCurrentUser', summary: '鑾峰彇褰撳墠鐢ㄦ埛', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/permissions', operationId: 'getCurrentPermissions', summary: '鑾峰彇褰撳墠鏉冮檺', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/permission-context', operationId: 'getPermissionContext', summary: '获取当前对象级权限上下文', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PUT', path: '/api/v1/auth/password', operationId: 'changeCurrentUserPassword', summary: '修改当前用户密码', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/preferences', operationId: 'getCurrentUserPreferences', summary: '获取当前用户偏好', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PUT', path: '/api/v1/auth/preferences', operationId: 'updateCurrentUserPreferences', summary: '保存当前用户偏好', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/secrets', operationId: 'listSecrets', summary: '查询 Secret 元数据列表', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/secrets', operationId: 'createSecret', summary: '鍒涘缓 Secret', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/secrets/metadata', operationId: 'getSecretMetadata', summary: '鏌ヨ Secret 鍏冩暟鎹?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals', operationId: 'createApproval', summary: '鍒涘缓瀹℃壒鍗?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals/decide', operationId: 'decideApproval', summary: '瀹℃壒鍐崇瓥', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/audit-events', operationId: 'queryAuditEvents', summary: '鏌ヨ瀹¤浜嬩欢', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/users', operationId: 'listSecurityUsers', summary: '鏌ヨ鐢ㄦ埛鍒楄〃', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users', operationId: 'createSecurityUser', summary: '鍒涘缓鐢ㄦ埛', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/groups', operationId: 'listSecurityGroups', summary: '查询用户组列表', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/groups', operationId: 'createSecurityGroup', summary: '创建本地用户组', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/groups/lookup-external', operationId: 'lookupExternalSecurityGroup', summary: '检索身份源用户组', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/groups/external', operationId: 'createExternalSecurityGroup', summary: '创建身份源用户组', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users/lookup-external', operationId: 'lookupExternalSecurityUser', summary: '检索身份源用户', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users/external', operationId: 'createExternalSecurityUser', summary: '创建身份源用户', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/security/users', operationId: 'updateSecurityUser', summary: '更新用户', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/security/users/status', operationId: 'updateSecurityUserStatus', summary: '淇敼鐢ㄦ埛鐘舵€?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users/roles', operationId: 'assignSecurityUserRole', summary: '鍒嗛厤鐢ㄦ埛瑙掕壊', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'DELETE', path: '/api/v1/security/users/delete', operationId: 'deleteSecurityUser', summary: '删除用户', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/roles', operationId: 'listSecurityRoles', summary: '鏌ヨ瑙掕壊鍒楄〃', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/roles', operationId: 'createSecurityRole', summary: '鍒涘缓瑙掕壊', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'DELETE', path: '/api/v1/security/roles/delete', operationId: 'deleteSecurityRole', summary: '删除角色', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/permission-policies', operationId: 'listSecurityPermissionPolicies', summary: '鏌ヨ鏉冮檺绛栫暐', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/permission-policies', operationId: 'createSecurityPermissionPolicy', summary: '鍒涘缓鏉冮檺绛栫暐', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/object-types', operationId: 'listSecurityObjectTypes', summary: '查询权限对象类型', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/object-sets', operationId: 'listSecurityObjectSets', summary: '查询权限对象集合', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/object-sets', operationId: 'createSecurityObjectSet', summary: '创建权限对象集合', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/object-set-members', operationId: 'addSecurityObjectSetMember', summary: '添加权限对象集合成员', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/role-bindings', operationId: 'listSecurityRoleBindings', summary: '查询对象级角色绑定', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/role-bindings', operationId: 'createSecurityRoleBinding', summary: '创建对象级角色绑定', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/access-grants', operationId: 'listSecurityAccessGrants', summary: '查询对象级访问授权', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/access-grants', operationId: 'createSecurityAccessGrant', summary: '创建对象级访问授权', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/object-capabilities', operationId: 'getSecurityObjectCapabilities', summary: '批量查询对象级能力', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/identity-sources', operationId: 'listIdentitySources', summary: '鏌ヨ韬唤婧?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/identity-sources', operationId: 'createIdentitySource', summary: '鍒涘缓韬唤婧?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/security/identity-sources', operationId: 'updateIdentitySource', summary: '更新身份源', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'DELETE', path: '/api/v1/security/identity-sources/delete', operationId: 'deleteIdentitySource', summary: '删除身份源', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/identity-sources/test', operationId: 'testIdentitySource', summary: '娴嬭瘯韬唤婧愯繛鎺?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/identity-sources/sync-users', operationId: 'syncIdentitySourceUsers', summary: '鍚屾 LDAP 鐢ㄦ埛', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/group-role-mappings', operationId: 'listGroupRoleMappings', summary: '鏌ヨ澶栭儴缁勮鑹叉槧灏?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/group-role-mappings', operationId: 'createGroupRoleMapping', summary: '鍒涘缓澶栭儴缁勮鑹叉槧灏?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
  ];
}
