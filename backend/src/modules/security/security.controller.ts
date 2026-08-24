import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import type { Router } from '../../common/http/router.js';
import type { RouteContract } from '../../common/openapi/route-contract.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { RiskLevel, SecretScopeType, SecretType, SecuritySubject } from '../../shared/security-types.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { RBACService } from '../rbac/rbac.service.js';
import { CryptoService } from '../secrets/crypto.service.js';
import { KeyManager } from '../secrets/key-manager.service.js';
import { SecretService } from '../secrets/secret.service.js';
import { AuthService } from './auth.service.js';
import { ExternalIdentityService, type IdentitySourceTlsMode, type IdentitySourceType } from './external-identity.service.js';

export interface SecurityServices {
  rbac: RBACService;
  audit: AuditService;
  approvals: ApprovalService;
  secrets: SecretService;
  auth: AuthService;
  externalIdentity: ExternalIdentityService;
}

export function createSecurityServices(): SecurityServices {
  const audit = new AuditService();
  const approvals = new ApprovalService(undefined, audit);
  const grants = new ExecutionGrantService();
  const secrets = new SecretService(new CryptoService(new KeyManager()), grants, audit);
  const rbac = new RBACService(undefined, undefined, undefined, undefined, audit);
  const auth = new AuthService(rbac, undefined, audit);
  const externalIdentity = new ExternalIdentityService(rbac, auth, audit, secrets);
  return { rbac, audit, approvals, secrets, auth, externalIdentity };
}

export class SecurityController {
  constructor(private readonly services: SecurityServices = createSecurityServices()) {}

  register(router: Router): void {
    router.post('/api/v1/auth/login', '鐧诲綍', ['Auth'], (request) => this.login(request));
    router.post('/api/v1/auth/external-login', '澶栭儴韬唤婧愮櫥褰?', ['Auth'], (request) => this.externalLogin(request));
    router.get('/api/v1/auth/identity-sources/public', '鑾峰彇鍙敤韬唤婧?', ['Auth'], () => this.listPublicIdentitySources());
    router.post('/api/v1/auth/logout', '閫€鍑虹櫥褰?', ['Auth'], (request) => this.logout(request));
    router.get('/api/v1/auth/me', '鑾峰彇褰撳墠鐢ㄦ埛', ['Auth'], (request) => this.getMe(request));
    router.get('/api/v1/auth/permissions', '鑾峰彇褰撳墠鏉冮檺', ['Auth'], (request) => this.getMyPermissions(request));
    router.post('/api/v1/secrets', '鍒涘缓 Secret', ['Security'], (request) => this.createSecret(request));
    router.get('/api/v1/secrets/metadata', '鏌ヨ Secret 鍏冩暟鎹?', ['Security'], (request) => this.getSecretMetadata(request));
    router.post('/api/v1/approvals', '鍒涘缓瀹℃壒鍗?', ['Security'], (request) => this.createApproval(request));
    router.post('/api/v1/approvals/decide', '瀹℃壒鍐崇瓥', ['Security'], (request) => this.decideApproval(request));
    router.get('/api/v1/audit-events', '鏌ヨ瀹¤浜嬩欢', ['Security'], (request) => this.queryAudits(request));
    router.get('/api/v1/security/users', '鏌ヨ鐢ㄦ埛鍒楄〃', ['Security'], (request) => this.listUsers(request));
    router.post('/api/v1/security/users', '鍒涘缓鐢ㄦ埛', ['Security'], (request) => this.createUser(request));
    router.patch('/api/v1/security/users', '更新用户', ['Security'], (request) => this.updateUser(request));
    router.patch('/api/v1/security/users/status', '淇敼鐢ㄦ埛鐘舵€?', ['Security'], (request) => this.updateUserStatus(request));
    router.post('/api/v1/security/users/roles', '鍒嗛厤鐢ㄦ埛瑙掕壊', ['Security'], (request) => this.assignUserRole(request));
    router.delete('/api/v1/security/users/delete', '删除用户', ['Security'], (request) => this.deleteUser(request));
    router.get('/api/v1/security/roles', '鏌ヨ瑙掕壊鍒楄〃', ['Security'], (request) => this.listRoles(request));
    router.post('/api/v1/security/roles', '鍒涘缓瑙掕壊', ['Security'], (request) => this.createRole(request));
    router.get('/api/v1/security/permission-policies', '鏌ヨ鏉冮檺绛栫暐', ['Security'], (request) => this.listPermissionPolicies(request));
    router.post('/api/v1/security/permission-policies', '鍒涘缓鏉冮檺绛栫暐', ['Security'], (request) => this.createPermissionPolicy(request));
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
    return this.services.auth.login({ username: String(body.username), password: String(body.password) }, request.context);
  }

  private async externalLogin(request: HttpRequest) {
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      username: { type: 'string', required: true },
      password: { type: 'string', required: true },
    });
    return this.services.externalIdentity.login({
      sourceId: String(body.sourceId),
      username: String(body.username),
      password: String(body.password),
    }, request.context);
  }

  private async listPublicIdentitySources() {
    return { items: await this.services.externalIdentity.listPublicSources() };
  }

  private async logout(request: HttpRequest) {
    return this.services.auth.logout(await this.optionalSubjectFromRequest(request), request.context);
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

  private async createSecret(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      type: { type: 'string', required: true },
      scopeType: { type: 'string', required: true },
      plainText: { type: 'string', required: true },
      scopeId: { type: 'string' },
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
        plainText: String(body.plainText),
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
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
    return {
      items,
      page: 1,
      pageSize: 200,
      total: (await this.services.audit.query()).length,
    };
  }

  private async listUsers(request: HttpRequest) {
    const subject = await this.subjectFromRequest(request);
    await this.assertSecurityCan(subject, 'security.user.read', request, 'user');
    const users = await this.services.rbac.listUsers();
    const items = [];
    for (const user of users) {
      const roles = await this.services.rbac.rolesForUser(user.id);
      items.push({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        tenantId: user.tenantId ?? request.context.tenantId ?? 'default',
        tenantName: user.tenantName ?? '榛樿绉熸埛',
        status: user.status,
        identityProvider: user.identityProvider ?? 'local',
        externalSourceId: user.externalSourceId,
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
      password: { type: 'string', required: true },
      tenantId: { type: 'string' },
      tenantName: { type: 'string' },
      roleId: { type: 'string' },
    });
    const user = await this.services.auth.createUserWithPassword({
      id: `user_${String(body.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
      username: String(body.username),
      displayName: String(body.displayName),
      password: String(body.password),
      status: 'active',
      tenantId: body.tenantId === undefined ? request.context.tenantId ?? 'default' : String(body.tenantId),
      tenantName: body.tenantName === undefined ? '榛樿绉熸埛' : String(body.tenantName),
    });
    if (body.roleId) {
      await this.services.rbac.assignRole(user.id, String(body.roleId));
    }
    await this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_CREATED, 'security.user.create', 'user', user.id);
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
      throw new AppError('AUTH_UNAUTHENTICATED', '缂哄皯 actor 涓婁笅鏂?');
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

function toStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim() !== '')) {
    throw new AppError('VALIDATION_FAILED', `${field} 蹇呴』鏄瓧绗︿覆鏁扮粍`, { field });
  }
  return value.map((item) => item.trim());
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

export function getSecurityRouteContracts(): RouteContract[] {
  return [
    { method: 'POST', path: '/api/v1/auth/login', operationId: 'login', summary: '鐧诲綍', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/auth/external-login', operationId: 'externalLogin', summary: '澶栭儴韬唤婧愮櫥褰?', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/identity-sources/public', operationId: 'listPublicIdentitySources', summary: '鑾峰彇鍙敤韬唤婧?', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/auth/logout', operationId: 'logout', summary: '閫€鍑虹櫥褰?', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/me', operationId: 'getCurrentUser', summary: '鑾峰彇褰撳墠鐢ㄦ埛', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/permissions', operationId: 'getCurrentPermissions', summary: '鑾峰彇褰撳墠鏉冮檺', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/secrets', operationId: 'createSecret', summary: '鍒涘缓 Secret', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/secrets/metadata', operationId: 'getSecretMetadata', summary: '鏌ヨ Secret 鍏冩暟鎹?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals', operationId: 'createApproval', summary: '鍒涘缓瀹℃壒鍗?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals/decide', operationId: 'decideApproval', summary: '瀹℃壒鍐崇瓥', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/audit-events', operationId: 'queryAuditEvents', summary: '鏌ヨ瀹¤浜嬩欢', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/users', operationId: 'listSecurityUsers', summary: '鏌ヨ鐢ㄦ埛鍒楄〃', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users', operationId: 'createSecurityUser', summary: '鍒涘缓鐢ㄦ埛', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/security/users', operationId: 'updateSecurityUser', summary: '更新用户', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/security/users/status', operationId: 'updateSecurityUserStatus', summary: '淇敼鐢ㄦ埛鐘舵€?', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users/roles', operationId: 'assignSecurityUserRole', summary: '鍒嗛厤鐢ㄦ埛瑙掕壊', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'DELETE', path: '/api/v1/security/users/delete', operationId: 'deleteSecurityUser', summary: '删除用户', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/roles', operationId: 'listSecurityRoles', summary: '鏌ヨ瑙掕壊鍒楄〃', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/roles', operationId: 'createSecurityRole', summary: '鍒涘缓瑙掕壊', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/permission-policies', operationId: 'listSecurityPermissionPolicies', summary: '鏌ヨ鏉冮檺绛栫暐', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/permission-policies', operationId: 'createSecurityPermissionPolicy', summary: '鍒涘缓鏉冮檺绛栫暐', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
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
