import { AppError } from '../../common/errors/app-error.js';
import type { Router } from '../../common/http/router.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import type { RouteContract } from '../../common/openapi/route-contract.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { RiskLevel, SecretScopeType, SecretType, SecuritySubject } from '../../shared/security-types.js';
import { RBACService } from '../rbac/rbac.service.js';
import { AuditService } from '../audits/audit.service.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { SecretService } from '../secrets/secret.service.js';
import { CryptoService } from '../secrets/crypto.service.js';
import { KeyManager } from '../secrets/key-manager.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { AuthService } from './auth.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
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
  const auth = new AuthService(rbac, audit);
  const externalIdentity = new ExternalIdentityService(rbac, auth, audit);
  return { rbac, audit, approvals, secrets, auth, externalIdentity };
}

export class SecurityController {
  constructor(private readonly services: SecurityServices = createSecurityServices()) {}

  register(router: Router): void {
    router.post('/api/v1/auth/login', '登录', ['Auth'], (request) => this.login(request));
    router.post('/api/v1/auth/external-login', '外部身份源登录', ['Auth'], (request) => this.externalLogin(request));
    router.get('/api/v1/auth/identity-sources/public', '获取可用身份源', ['Auth'], () => this.listPublicIdentitySources());
    router.post('/api/v1/auth/logout', '退出登录', ['Auth'], (request) => this.logout(request));
    router.get('/api/v1/auth/me', '获取当前用户', ['Auth'], (request) => this.getMe(request));
    router.get('/api/v1/auth/permissions', '获取当前权限', ['Auth'], (request) => this.getMyPermissions(request));
    router.post('/api/v1/secrets', '创建 Secret', ['Security'], (request) => this.createSecret(request));
    router.get('/api/v1/secrets/metadata', '查询 Secret 元数据', ['Security'], (request) => this.getSecretMetadata(request));
    router.post('/api/v1/approvals', '创建审批单', ['Security'], (request) => this.createApproval(request));
    router.post('/api/v1/approvals/decide', '审批决策', ['Security'], (request) => this.decideApproval(request));
    router.get('/api/v1/audit-events', '查询审计事件', ['Security'], (request) => this.queryAudits(request));
    router.get('/api/v1/security/users', '查询用户列表', ['Security'], (request) => this.listUsers(request));
    router.post('/api/v1/security/users', '创建用户', ['Security'], (request) => this.createUser(request));
    router.patch('/api/v1/security/users/status', '修改用户状态', ['Security'], (request) => this.updateUserStatus(request));
    router.post('/api/v1/security/users/roles', '分配用户角色', ['Security'], (request) => this.assignUserRole(request));
    router.get('/api/v1/security/roles', '查询角色列表', ['Security'], (request) => this.listRoles(request));
    router.post('/api/v1/security/roles', '创建角色', ['Security'], (request) => this.createRole(request));
    router.get('/api/v1/security/permission-policies', '查询权限策略', ['Security'], (request) => this.listPermissionPolicies(request));
    router.post('/api/v1/security/permission-policies', '创建权限策略', ['Security'], (request) => this.createPermissionPolicy(request));
    router.get('/api/v1/security/identity-sources', '查询身份源', ['Security'], (request) => this.listIdentitySources(request));
    router.post('/api/v1/security/identity-sources', '创建身份源', ['Security'], (request) => this.createIdentitySource(request));
    router.post('/api/v1/security/identity-sources/test', '测试身份源连接', ['Security'], (request) => this.testIdentitySource(request));
    router.get('/api/v1/security/group-role-mappings', '查询外部组角色映射', ['Security'], (request) => this.listGroupRoleMappings(request));
    router.post('/api/v1/security/group-role-mappings', '创建外部组角色映射', ['Security'], (request) => this.createGroupRoleMapping(request));
  }

  private login(request: HttpRequest) {
    const body = validateObject(request.body, {
      username: { type: 'string', required: true },
      password: { type: 'string', required: true },
    });
    return this.services.auth.login({ username: String(body.username), password: String(body.password) }, request.context);
  }

  private externalLogin(request: HttpRequest) {
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

  private listPublicIdentitySources() {
    return { items: this.services.externalIdentity.listPublicSources() };
  }

  private logout(request: HttpRequest) {
    return this.services.auth.logout(this.optionalSubjectFromRequest(request), request.context);
  }

  private getMe(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    const session = this.services.auth.currentSession(subject.id);
    return { user: session.user, roles: session.user.roles, permissions: session.permissions };
  }

  private getMyPermissions(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    const session = this.services.auth.currentSession(subject.id);
    return { permissions: session.permissions };
  }

  private createSecret(request: HttpRequest) {
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      type: { type: 'string', required: true },
      scopeType: { type: 'string', required: true },
      plainText: { type: 'string', required: true },
      scopeId: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'secret.create', {
      type: 'secret',
      scope: { tenantId: request.context.tenantId, ownerId: subject.id },
    }, this.securityContext(request, subject));

    return {
      statusCode: 201,
      body: this.services.secrets.create({
        name: String(body.name),
        type: body.type as SecretType,
        scopeType: body.scopeType as SecretScopeType,
        scopeId: body.scopeId === undefined ? undefined : String(body.scopeId),
        plainText: String(body.plainText),
        createdBy: subject.id,
      }, this.securityContext(request, subject)),
    };
  }

  private getSecretMetadata(request: HttpRequest) {
    const id = readQueryString(request, 'id');
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'secret.read', {
      type: 'secret',
      id,
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return this.services.secrets.getMetadata(id);
  }

  private createApproval(request: HttpRequest) {
    const body = validateObject(request.body, {
      operationType: { type: 'string', required: true },
      resourceRefs: { type: 'array', required: true },
      riskLevel: { type: 'string', required: true },
      parameters: { type: 'object', required: true },
      expiresAt: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'approval.create', {
      type: 'approval',
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
    return {
      statusCode: 201,
      body: this.services.approvals.create({
        operationType: String(body.operationType),
        resourceRefs: body.resourceRefs as Array<{ type: string; id: string }>,
        riskLevel: body.riskLevel as RiskLevel,
        parameters: body.parameters,
        requestedBy: subject.id,
        expiresAt: body.expiresAt === undefined ? undefined : String(body.expiresAt),
      }, this.securityContext(request, subject)),
    };
  }

  private decideApproval(request: HttpRequest) {
    const body = validateObject(request.body, {
      approvalId: { type: 'string', required: true },
      decision: { type: 'string', required: true, enum: ['approved', 'rejected'] },
      comment: { type: 'string' },
    });
    const subject = this.subjectFromRequest(request);
    this.services.rbac.assertCan(subject, 'approval.decide', {
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

  private queryAudits(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    return {
      items: this.services.audit.queryWithPermission({
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
      }),
      page: 1,
      pageSize: 200,
      total: this.services.audit.query().length,
    };
  }

  private listUsers(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.user.read', request, 'user');
    const rolesByUser = new Map<string, ReturnType<RBACService['rolesForUser']>>();
    const items = this.services.rbac.listUsers().map((user) => {
      const roles = this.services.rbac.rolesForUser(user.id);
      rolesByUser.set(user.id, roles);
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        tenantId: user.tenantId ?? request.context.tenantId ?? 'default',
        tenantName: user.tenantName ?? '默认租户',
        status: user.status,
        roles: roles.map((role) => ({ id: role.id, code: role.code, name: role.name })),
        roleNames: roles.map((role) => role.name).join(', '),
        updatedAt: user.updatedAt,
      };
    });
    return page(items);
  }

  private createUser(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      username: { type: 'string', required: true },
      displayName: { type: 'string', required: true },
      password: { type: 'string', required: true },
      tenantId: { type: 'string' },
      tenantName: { type: 'string' },
      roleId: { type: 'string' },
    });
    const user = this.services.auth.createUserWithPassword({
      id: `user_${String(body.username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
      username: String(body.username),
      displayName: String(body.displayName),
      password: String(body.password),
      status: 'active',
      tenantId: body.tenantId === undefined ? request.context.tenantId ?? 'default' : String(body.tenantId),
      tenantName: body.tenantName === undefined ? '默认租户' : String(body.tenantName),
    });
    if (body.roleId) this.services.rbac.assignRole(user.id, String(body.roleId));
    this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_CREATED, 'security.user.create', 'user', user.id);
    return { statusCode: 201, body: user };
  }

  private updateUserStatus(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      userId: { type: 'string', required: true },
      status: { type: 'string', required: true, enum: ['active', 'disabled'] },
    });
    const user = this.services.rbac.updateUserStatus(String(body.userId), body.status as 'active' | 'disabled');
    this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_STATUS_CHANGED, 'security.user.status', 'user', user.id, { status: user.status });
    return user;
  }

  private assignUserRole(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.user.write', request, 'user');
    const body = validateObject(request.body, {
      userId: { type: 'string', required: true },
      roleId: { type: 'string', required: true },
    });
    this.services.rbac.assignRole(String(body.userId), String(body.roleId));
    this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_USER_ROLE_ASSIGNED, 'security.user.assign_role', 'user', String(body.userId), { roleId: String(body.roleId) });
    return { userId: String(body.userId), roleId: String(body.roleId) };
  }

  private listRoles(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.role.read', request, 'role');
    const policies = this.services.rbac.listPolicies();
    const items = this.services.rbac.listRoles().map((role) => {
      const rolePolicies = policies.filter((policy) => policy.subjectType === 'role' && policy.subjectId === role.id);
      return {
        ...role,
        policyCount: rolePolicies.length,
        permissions: [...new Set(rolePolicies.flatMap((policy) => policy.actions))].sort(),
      };
    });
    return page(items);
  }

  private createRole(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.role.write', request, 'role');
    const body = validateObject(request.body, {
      code: { type: 'string', required: true },
      name: { type: 'string', required: true },
      description: { type: 'string' },
    });
    const code = String(body.code).trim().toLowerCase();
    const role = this.services.rbac.createRole({
      id: `role_${code.replace(/[^a-z0-9_]/g, '_')}`,
      code,
      name: String(body.name),
      description: body.description === undefined ? undefined : String(body.description),
      builtin: false,
    });
    this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_ROLE_CREATED, 'security.role.create', 'role', role.id);
    return { statusCode: 201, body: role };
  }

  private listPermissionPolicies(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.permission.read', request, 'permissionPolicy');
    return page(this.services.rbac.listPolicies());
  }

  private createPermissionPolicy(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.permission.write', request, 'permissionPolicy');
    const body = validateObject(request.body, {
      subjectType: { type: 'string', required: true, enum: ['user', 'group', 'role', 'plugin', 'executor'] },
      subjectId: { type: 'string', required: true },
      effect: { type: 'string', required: true, enum: ['allow', 'deny'] },
      actions: { type: 'array', required: true },
      resourceTypes: { type: 'array', required: true },
      scope: { type: 'object', required: true },
    });
    const policy = this.services.rbac.createPolicy({
      subjectType: body.subjectType as 'user' | 'group' | 'role' | 'plugin' | 'executor',
      subjectId: String(body.subjectId),
      effect: body.effect as 'allow' | 'deny',
      actions: toStringArray(body.actions, 'actions'),
      resourceTypes: toStringArray(body.resourceTypes, 'resourceTypes'),
      scope: body.scope as Record<string, string>,
    });
    this.writeAudit(request, subject, AUDIT_EVENT_TYPES.SECURITY_PERMISSION_POLICY_CREATED, 'security.permission.create', 'permissionPolicy', policy.id);
    return { statusCode: 201, body: policy };
  }

  private listIdentitySources(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.identity_source.read', request, 'identitySource');
    return page(this.services.externalIdentity.listSources());
  }

  private createIdentitySource(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.identity_source.write', request, 'identitySource');
    const body = validateObject(request.body, {
      name: { type: 'string', required: true },
      type: { type: 'string', required: true, enum: ['active_directory', 'ldap'] },
      url: { type: 'string', required: true },
      baseDn: { type: 'string', required: true },
      userFilter: { type: 'string' },
      groupFilter: { type: 'string' },
      userDnTemplate: { type: 'string' },
      bindDn: { type: 'string' },
      bindPasswordSecretRef: { type: 'string' },
      defaultRoleId: { type: 'string' },
      requireGroupMapping: { type: 'boolean' },
      tlsMode: { type: 'string', enum: ['none', 'starttls', 'ldaps'] },
      enabled: { type: 'boolean' },
    });
    const source = this.services.externalIdentity.createSource({
      name: String(body.name),
      type: body.type as IdentitySourceType,
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
      url: String(body.url),
      baseDn: String(body.baseDn),
      userFilter: body.userFilter === undefined ? undefined : String(body.userFilter),
      groupFilter: body.groupFilter === undefined ? undefined : String(body.groupFilter),
      userDnTemplate: body.userDnTemplate === undefined ? undefined : String(body.userDnTemplate),
      bindDn: body.bindDn === undefined ? undefined : String(body.bindDn),
      bindPasswordSecretRef: body.bindPasswordSecretRef === undefined ? undefined : String(body.bindPasswordSecretRef),
      defaultRoleId: body.defaultRoleId === undefined ? undefined : String(body.defaultRoleId),
      requireGroupMapping: body.requireGroupMapping === undefined ? true : Boolean(body.requireGroupMapping),
      tlsMode: (body.tlsMode ?? 'ldaps') as IdentitySourceTlsMode,
    }, subject, request.context);
    return { statusCode: 201, body: source };
  }

  private async testIdentitySource(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.identity_source.write', request, 'identitySource');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
    });
    return this.services.externalIdentity.testSource(String(body.sourceId));
  }

  private listGroupRoleMappings(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.identity_source.read', request, 'externalGroupRoleMapping');
    return page(this.services.externalIdentity.listMappings());
  }

  private createGroupRoleMapping(request: HttpRequest) {
    const subject = this.subjectFromRequest(request);
    this.assertSecurityCan(subject, 'security.identity_source.write', request, 'externalGroupRoleMapping');
    const body = validateObject(request.body, {
      sourceId: { type: 'string', required: true },
      externalGroup: { type: 'string', required: true },
      roleId: { type: 'string', required: true },
      enabled: { type: 'boolean' },
    });
    const mapping = this.services.externalIdentity.createMapping({
      sourceId: String(body.sourceId),
      externalGroup: String(body.externalGroup),
      roleId: String(body.roleId),
      enabled: body.enabled === undefined ? true : Boolean(body.enabled),
    }, subject, request.context);
    return { statusCode: 201, body: mapping };
  }

  private subjectFromRequest(request: HttpRequest): SecuritySubject {
    if (!request.context.actorId) {
      throw new AppError('AUTH_UNAUTHENTICATED', '缺少 actor 上下文');
    }
    const user = this.services.rbac.getUser(request.context.actorId);
    return {
      id: request.context.actorId,
      type: 'user',
      roleIds: user ? this.services.rbac.rolesForUser(user.id).map((role) => role.id) : undefined,
      scope: { tenantId: request.context.tenantId },
    };
  }

  private optionalSubjectFromRequest(request: HttpRequest): SecuritySubject | undefined {
    return request.context.actorId ? this.subjectFromRequest(request) : undefined;
  }

  private securityContext(request: HttpRequest, actor: SecuritySubject) {
    return {
      requestId: request.context.requestId,
      sourceIp: request.context.ip,
      actor,
    };
  }

  private assertSecurityCan(subject: SecuritySubject, action: string, request: HttpRequest, resourceType: string): void {
    this.services.rbac.assertCan(subject, action, {
      type: resourceType,
      scope: { tenantId: request.context.tenantId },
    }, this.securityContext(request, subject));
  }

  private writeAudit(request: HttpRequest, subject: SecuritySubject, eventType: string, action: string, resourceType: string, resourceId?: string, detail?: Record<string, unknown>): void {
    this.services.audit.write({
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
    throw new AppError('VALIDATION_FAILED', `${field} 必须是字符串数组`, { field });
  }
  return value.map((item) => item.trim());
}

function readQueryString(request: HttpRequest, key: string): string {
  const value = readOptionalQueryString(request, key);
  if (!value) throw new AppError('VALIDATION_FAILED', `缺少查询参数 ${key}`, { field: key });
  return value;
}

function readOptionalQueryString(request: HttpRequest, key: string): string | undefined {
  const value = request.query[key];
  return Array.isArray(value) ? value[0] : value;
}

export function getSecurityRouteContracts(): RouteContract[] {
  return [
    { method: 'POST', path: '/api/v1/auth/login', operationId: 'login', summary: '登录', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/auth/external-login', operationId: 'externalLogin', summary: '外部身份源登录', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/identity-sources/public', operationId: 'listPublicIdentitySources', summary: '获取可用身份源', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/auth/logout', operationId: 'logout', summary: '退出登录', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/me', operationId: 'getCurrentUser', summary: '获取当前用户', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/auth/permissions', operationId: 'getCurrentPermissions', summary: '获取当前权限', tags: ['Auth'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/secrets', operationId: 'createSecret', summary: '创建 Secret', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/secrets/metadata', operationId: 'getSecretMetadata', summary: '查询 Secret 元数据', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals', operationId: 'createApproval', summary: '创建审批单', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/approvals/decide', operationId: 'decideApproval', summary: '审批决策', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/audit-events', operationId: 'queryAuditEvents', summary: '查询审计事件', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/users', operationId: 'listSecurityUsers', summary: '查询用户列表', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users', operationId: 'createSecurityUser', summary: '创建用户', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'PATCH', path: '/api/v1/security/users/status', operationId: 'updateSecurityUserStatus', summary: '修改用户状态', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/users/roles', operationId: 'assignSecurityUserRole', summary: '分配用户角色', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/roles', operationId: 'listSecurityRoles', summary: '查询角色列表', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/roles', operationId: 'createSecurityRole', summary: '创建角色', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/permission-policies', operationId: 'listSecurityPermissionPolicies', summary: '查询权限策略', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/permission-policies', operationId: 'createSecurityPermissionPolicy', summary: '创建权限策略', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/identity-sources', operationId: 'listIdentitySources', summary: '查询身份源', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/identity-sources', operationId: 'createIdentitySource', summary: '创建身份源', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/identity-sources/test', operationId: 'testIdentitySource', summary: '测试身份源连接', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'GET', path: '/api/v1/security/group-role-mappings', operationId: 'listGroupRoleMappings', summary: '查询外部组角色映射', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/security/group-role-mappings', operationId: 'createGroupRoleMapping', summary: '创建外部组角色映射', tags: ['Security'], responseSchema: { type: 'object', additionalProperties: true } },
  ];
}
