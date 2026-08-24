import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext } from '../../common/tracing/request-context.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AuthBrowserSessionEntity, AuthPasswordCredentialEntity } from '../../persistence/entities/auth-credential.entity.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity } from '../../persistence/entities/rbac.entity.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { SecuritySubject, TenantContext, TenantScope } from '../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { AuditService } from '../audits/audit.service.js';
import type { RBACService } from '../rbac/rbac.service.js';
import type { ObjectPermissionService } from './object-permission.service.js';
import type { TenantContextService } from './tenant-context.service.js';
import type { TenantIdentityResolver } from './tenant-identity.service.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  tenantId: string;
  tenantName: string;
  status: UserEntity['status'];
  roles: Array<{ id: string; code: string; name: string }>;
}

export interface AuthSessionResponse {
  token: string;
  user: AuthenticatedUser;
  permissions: string[];
}

export interface AuthCookieSession {
  cookieValue: string;
  expiresAt: string;
}

interface PasswordCredential {
  userId: string;
  passwordHash: string;
  salt: string;
}

interface TokenPayload {
  userId: string;
  tenantId: string;
  contextVersion?: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

const DEFAULT_TENANT_ID = 'default';
const DEFAULT_TENANT_NAME = '\u9ed8\u8ba4\u79df\u6237';
const AUTH_SESSION_COOKIE_NAME = 'gcac_session';
const DEFAULT_BROWSER_SESSION_TTL_SECONDS = 8 * 60 * 60;
const BUILTIN_ADMIN_ALL_OBJECT_SET_ID = 'oset_builtin_admin_all';
const BUILTIN_AUDITOR_READONLY_OBJECT_SET_ID = 'oset_builtin_auditor_readonly';
const BUILTIN_ADMIN_ROLE_BINDING_ID = 'rbnd_builtin_admin_role_all';
const BUILTIN_AUDITOR_ROLE_BINDING_ID = 'rbnd_builtin_auditor_role_readonly';
const BUILTIN_ADMIN_ACCESS_GRANT_ID = 'agrant_builtin_admin_all_control';
const BUILTIN_AUDITOR_ACCESS_GRANT_ID = 'agrant_builtin_auditor_all_read';

export class AuthService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultCredentialsRepository(): AsyncRepositoryPort<AuthPasswordCredentialEntity> {
    return new PgDocumentRepository<AuthPasswordCredentialEntity>(AuthService.defaultDb, 'security.auth_password_credentials');
  }

  private static createDefaultBrowserSessionsRepository(): AsyncRepositoryPort<AuthBrowserSessionEntity> {
    return new PgDocumentRepository<AuthBrowserSessionEntity>(AuthService.defaultDb, 'security.auth_browser_sessions');
  }

  private readonly seedReady: Promise<void>;

  constructor(
    private readonly rbac: RBACService,
    private readonly credentials: AsyncRepositoryPort<AuthPasswordCredentialEntity> = AuthService.createDefaultCredentialsRepository(),
    private readonly audit?: AuditService,
    private readonly browserSessions: AsyncRepositoryPort<AuthBrowserSessionEntity> = AuthService.createDefaultBrowserSessionsRepository(),
    private readonly objectPermissions?: ObjectPermissionService,
    private readonly tenantIdentity?: TenantIdentityResolver,
    private readonly tenantContext?: TenantContextService,
  ) {
    this.seedReady = this.seedDefaultAdmin();
  }

  async login(input: { username: string; password: string }, context: RequestContext): Promise<AuthSessionResponse> {
    await this.seedReady;
    const user = await this.rbac.findUserByUsername(input.username);
    const credential = user ? await this.credentials.get(user.id) : undefined;
    if (!user || !credential || !this.verifyPassword(input.password, credential)) {
      await this.audit?.write({
        eventType: AUDIT_EVENT_TYPES.AUTH_LOGIN_FAILED,
        actorType: 'user',
        actorId: input.username,
        action: 'auth.login',
        resourceType: 'authSession',
        result: 'failure',
        riskLevel: 'medium',
        context: { requestId: context.requestId, sourceIp: context.ip },
        detail: { reason: 'bad credentials' },
      });
      throw new AppError('AUTH_UNAUTHENTICATED', '\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef');
    }

    if (user.status !== 'active') {
      throw new AppError('AUTH_FORBIDDEN', '\u7528\u6237\u5df2\u88ab\u7981\u7528');
    }

    const session = await this.createSession(user);
    await this.audit?.write({
      eventType: AUDIT_EVENT_TYPES.AUTH_LOGIN_SUCCESS,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'authSession',
      result: 'success',
      riskLevel: 'low',
      context: { requestId: context.requestId, sourceIp: context.ip, actor: await this.subjectForUser(user) },
    });
    return session;
  }

  async logout(subject: SecuritySubject | undefined, context: RequestContext): Promise<{ success: true }> {
    if (subject) {
      await this.audit?.write({
        eventType: AUDIT_EVENT_TYPES.AUTH_LOGOUT,
        actorType: 'user',
        actorId: subject.id,
        action: 'auth.logout',
        resourceType: 'authSession',
        result: 'success',
        riskLevel: 'low',
        context: { requestId: context.requestId, sourceIp: context.ip, actor: subject },
      });
    }
    return { success: true };
  }

  async createBrowserSession(userId: string, context: RequestContext): Promise<AuthCookieSession> {
    await this.seedReady;
    const user = await this.rbac.getUser(userId);
    if (!user || user.status !== 'active') {
      throw new AppError('AUTH_UNAUTHENTICATED', '\u5f53\u524d\u767b\u5f55\u72b6\u6001\u65e0\u6548');
    }
    const now = new Date();
    const ttlSeconds = browserSessionTtlSeconds();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const id = `sess_${randomBytes(16).toString('hex')}`;
    const secret = randomBytes(32).toString('base64url');
    const tenantContext = await this.resolveContext(user.id, user.tenantId);
    await this.browserSessions.create({
      id,
      userId: user.id,
      tenantId: tenantContext.currentTenantId,
      secretHash: this.digestSessionSecret(secret),
      createdAt: now.toISOString(),
      expiresAt,
      contextVersion: tenantContext.version,
      userAgent: context.userAgent,
      ip: context.ip,
    });
    return { cookieValue: `${id}.${secret}`, expiresAt };
  }

  async revokeBrowserSession(cookieHeader: string | undefined): Promise<void> {
    const parsed = parseSessionCookie(cookieHeader);
    if (!parsed) return;
    const session = await this.browserSessions.get(parsed.id);
    if (!session || session.revokedAt) return;
    await this.browserSessions.update(session.id, { revokedAt: new Date().toISOString() });
  }

  async createUserWithPassword(input: Omit<UserEntity, 'createdAt' | 'updatedAt'> & { password: string }): Promise<UserEntity> {
    await this.seedReady;
    const user = await this.rbac.createUser(input);
    await this.credentials.upsert(this.hashPassword(user.id, input.password));
    return user;
  }

  async deleteUserCredentials(userId: string): Promise<void> {
    await this.credentials.delete(userId);
  }

  async changePassword(input: { userId: string; currentPassword: string; newPassword: string }, context: RequestContext): Promise<{ success: true }> {
    await this.seedReady;
    if (input.newPassword.length < 8) {
      throw new AppError('VALIDATION_FAILED', '新密码长度不能少于 8 位', { field: 'newPassword' });
    }
    const user = await this.rbac.getUser(input.userId);
    const credential = user ? await this.credentials.get(user.id) : undefined;
    if (!user || user.status !== 'active' || !credential) {
      throw new AppError('AUTH_UNAUTHENTICATED', '当前登录状态无效');
    }
    if (!this.verifyPassword(input.currentPassword, credential)) {
      throw new AppError('AUTH_UNAUTHENTICATED', '当前密码不正确');
    }
    await this.credentials.upsert(this.hashPassword(user.id, input.newPassword));
    await this.audit?.write({
      eventType: 'auth.password.changed',
      actorType: 'user',
      actorId: user.id,
      action: 'auth.password.change',
      resourceType: 'authUser',
      resourceId: user.id,
      result: 'success',
      riskLevel: 'medium',
      context: { requestId: context.requestId, sourceIp: context.ip, actor: await this.subjectForUser(user) },
    });
    return { success: true };
  }

  async currentSession(userId: string): Promise<AuthSessionResponse> {
    await this.seedReady;
    const user = await this.rbac.getUser(userId);
    if (!user || user.status !== 'active') {
      throw new AppError('AUTH_UNAUTHENTICATED', '\u5f53\u524d\u767b\u5f55\u72b6\u6001\u65e0\u6548');
    }
    return this.createSession(user);
  }

  parseAuthorizationHeader(authorization: string | undefined): { actorId: string; tenantId: string; contextVersion?: string } | undefined {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    const token = authorization.slice('Bearer '.length).trim();
    const payload = this.verifyToken(token);
    return payload
      ? { actorId: payload.userId, tenantId: payload.tenantId, contextVersion: payload.contextVersion }
      : undefined;
  }

  async parseRequestIdentity(
    authorization: string | undefined,
    cookieHeader: string | undefined,
  ): Promise<{ actorId: string; tenantId: string; tenantScope?: TenantScope; contextVersion?: string } | undefined> {
    const bearer = this.parseAuthorizationHeader(authorization);
    if (bearer) {
      const context = await this.resolveContext(bearer.actorId, bearer.tenantId, bearer.contextVersion);
      return {
        actorId: bearer.actorId,
        tenantId: context.currentTenantId,
        tenantScope: context.managementScope,
        contextVersion: context.version,
      };
    }
    const parsed = parseSessionCookie(cookieHeader);
    if (!parsed) return undefined;
    const session = await this.browserSessions.get(parsed.id);
    if (!session || session.revokedAt) return undefined;
    if (Date.parse(session.expiresAt) <= Date.now()) return undefined;
    if (!safeEqualHex(session.secretHash, this.digestSessionSecret(parsed.secret))) return undefined;
    // 浏览器 Session 代表登录身份；当前租户版本由服务端 actor 上下文决定，
    // 切换后同一浏览器 Session 应自动跟随新上下文，而不是复用旧租户。
    const context = await this.resolveContext(session.userId);
    return {
      actorId: session.userId,
      tenantId: context.currentTenantId,
      tenantScope: context.managementScope,
      contextVersion: context.version,
    };
  }

  buildSessionSetCookie(cookieValue: string, expiresAt: string): string {
    const attributes = [
      `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Expires=${new Date(expiresAt).toUTCString()}`,
      `Max-Age=${browserSessionTtlSeconds()}`,
    ];
    if (isSecureCookieEnabled()) attributes.push('Secure');
    return attributes.join('; ');
  }

  buildSessionClearCookie(): string {
    const attributes = [
      `${AUTH_SESSION_COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
      'Max-Age=0',
    ];
    if (isSecureCookieEnabled()) attributes.push('Secure');
    return attributes.join('; ');
  }

  private async createSession(user: UserEntity): Promise<AuthSessionResponse> {
    const context = await this.resolveContext(user.id, user.tenantId);
    const token = this.signToken({
      userId: user.id,
      tenantId: context.currentTenantId,
      contextVersion: context.version,
      issuedAt: Date.now(),
      expiresAt: Date.now() + browserSessionTtlSeconds() * 1000,
      nonce: randomBytes(8).toString('hex'),
    });
    const subject = await this.subjectForUser(user);
    return {
      token,
      user: await this.toAuthenticatedUser(user, context.currentTenantId),
      permissions: await this.rbac.permissionsForSubject(subject),
    };
  }

  private async toAuthenticatedUser(user: UserEntity, resolvedTenantId?: string): Promise<AuthenticatedUser> {
    const roles = await this.rbac.rolesForUser(user.id);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      tenantId: resolvedTenantId ?? await this.resolveTenantId(user.tenantId),
      tenantName: user.tenantName ?? DEFAULT_TENANT_NAME,
      status: user.status,
      roles: roles.map((role) => ({ id: role.id, code: role.code, name: role.name })),
    };
  }

  private async subjectForUser(user: UserEntity): Promise<SecuritySubject> {
    const roles = await this.rbac.rolesForUser(user.id);
    const context = await this.resolveContext(user.id, user.tenantId);
    return {
      id: user.id,
      type: 'user',
      roleIds: roles.map((role) => role.id),
      scope: { tenantId: context.currentTenantId, tenantScope: context.managementScope },
    };
  }

  async issueTokenForContext(actorId: string, context: TenantContext): Promise<string> {
    const user = await this.rbac.getUser(actorId);
    if (!user || user.status !== 'active') {
      throw new AppError('AUTH_UNAUTHENTICATED', '当前登录状态无效');
    }
    return this.signToken({
      userId: actorId,
      tenantId: context.currentTenantId,
      contextVersion: context.version,
      issuedAt: Date.now(),
      expiresAt: Date.now() + browserSessionTtlSeconds() * 1000,
      nonce: randomBytes(8).toString('hex'),
    });
  }

  private async resolveContext(
    actorId: string,
    tenantIdentifier?: string,
    expectedVersion?: string,
  ): Promise<TenantContext> {
    if (this.tenantContext) {
      return this.tenantContext.resolve(actorId, tenantIdentifier, expectedVersion);
    }
    const tenantId = await this.resolveTenantId(tenantIdentifier);
    return {
      mode: 'single',
      actorId,
      currentTenantId: tenantId,
      homeTenantId: tenantId,
      accessibleTenantIds: [tenantId],
      version: 'legacy',
    };
  }

  private async resolveTenantId(identifier?: string): Promise<string> {
    if (!this.tenantIdentity) return identifier ?? DEFAULT_TENANT_ID;
    return this.tenantIdentity.resolve(identifier ?? DEFAULT_TENANT_ID);
  }

  private async seedDefaultAdmin(): Promise<void> {
    const defaultTenantId = await this.resolveTenantId(DEFAULT_TENANT_ID);
    const adminRole: RoleEntity = {
      id: 'role_admin',
      code: 'admin',
      name: '\u7cfb\u7edf\u7ba1\u7406\u5458',
      description: '\u62e5\u6709\u5168\u90e8\u63a7\u5236\u53f0\u6743\u9650\u7684\u5185\u7f6e\u7ba1\u7406\u5458\u89d2\u8272',
      builtin: true,
    };
    const auditorRole: RoleEntity = {
      id: 'role_auditor',
      code: 'auditor',
      name: '\u5ba1\u8ba1\u5458',
      description: '\u53ea\u80fd\u67e5\u770b\u5ba1\u8ba1\u548c\u53ea\u8bfb\u5b89\u5168\u4fe1\u606f',
      builtin: true,
    };
    await this.rbac.createRoleIfAbsent(adminRole);
    await this.rbac.createRoleIfAbsent(auditorRole);
    const admin = await this.rbac.createUserIfAbsent({
      id: 'user_admin',
      username: 'admin',
      displayName: '\u7cfb\u7edf\u7ba1\u7406\u5458',
      status: 'active',
      tenantId: defaultTenantId,
      tenantName: DEFAULT_TENANT_NAME,
    });
    if (!await this.rbac.userHasRole(admin.id, adminRole.id)) {
      await this.rbac.assignRole(admin.id, adminRole.id);
    }
    const policy: Omit<PermissionPolicyEntity, 'id'> & { id: string } = {
      id: 'policy_admin_all',
      subjectType: 'role',
      subjectId: adminRole.id,
      effect: 'allow',
      actions: ['*'],
      resourceTypes: ['*'],
      scope: { tenantId: '*' },
    };
    await this.rbac.createPolicyIfAbsent(policy);
    if (!await this.credentials.get(admin.id)) {
      await this.credentials.upsert(this.hashPassword(admin.id, initialAdminPassword()));
    }
    await this.seedDefaultObjectPermissions(adminRole.id, auditorRole.id);
  }

  private async seedDefaultObjectPermissions(adminRoleId: string, auditorRoleId: string): Promise<void> {
    if (!this.objectPermissions) return;
    const objectTypes = (await this.objectPermissions.listObjectTypes()).map((item) => item.code).sort();
    if (objectTypes.length === 0) return;
    const objectSets = await this.objectPermissions.listObjectSets();
    if (!objectSets.some((item) => item.id === BUILTIN_ADMIN_ALL_OBJECT_SET_ID)) {
      await this.objectPermissions.createObjectSet({
        id: BUILTIN_ADMIN_ALL_OBJECT_SET_ID,
        tenantId: '*',
        name: '系统管理员全部业务对象',
        kind: 'dynamic',
        objectTypes,
        conditions: {},
        status: 'active',
      });
    }
    if (!objectSets.some((item) => item.id === BUILTIN_AUDITOR_READONLY_OBJECT_SET_ID)) {
      await this.objectPermissions.createObjectSet({
        id: BUILTIN_AUDITOR_READONLY_OBJECT_SET_ID,
        tenantId: '*',
        name: '审计员只读业务对象',
        kind: 'dynamic',
        objectTypes,
        conditions: {},
        status: 'active',
      });
    }

    const roleBindings = await this.objectPermissions.listRoleBindings();
    if (!roleBindings.some((item) => item.id === BUILTIN_ADMIN_ROLE_BINDING_ID)) {
      await this.objectPermissions.createRoleBinding({
        id: BUILTIN_ADMIN_ROLE_BINDING_ID,
        tenantId: '*',
        principalType: 'group',
        principalId: adminRoleId,
        roleId: adminRoleId,
        objectSetId: BUILTIN_ADMIN_ALL_OBJECT_SET_ID,
        effect: 'allow',
        enabled: true,
      });
    }
    if (!roleBindings.some((item) => item.id === BUILTIN_AUDITOR_ROLE_BINDING_ID)) {
      await this.objectPermissions.createRoleBinding({
        id: BUILTIN_AUDITOR_ROLE_BINDING_ID,
        tenantId: '*',
        principalType: 'group',
        principalId: auditorRoleId,
        roleId: auditorRoleId,
        objectSetId: BUILTIN_AUDITOR_READONLY_OBJECT_SET_ID,
        effect: 'allow',
        enabled: true,
      });
    }

    const accessGrants = await this.objectPermissions.listAccessGrants();
    if (!accessGrants.some((item) => item.id === BUILTIN_ADMIN_ACCESS_GRANT_ID)) {
      await this.objectPermissions.createAccessGrant({
        id: BUILTIN_ADMIN_ACCESS_GRANT_ID,
        roleId: adminRoleId,
        objectSetId: BUILTIN_ADMIN_ALL_OBJECT_SET_ID,
        accessLevel: 'control',
        effect: 'allow',
      });
    }
    if (!accessGrants.some((item) => item.id === BUILTIN_AUDITOR_ACCESS_GRANT_ID)) {
      await this.objectPermissions.createAccessGrant({
        id: BUILTIN_AUDITOR_ACCESS_GRANT_ID,
        roleId: auditorRoleId,
        objectSetId: BUILTIN_AUDITOR_READONLY_OBJECT_SET_ID,
        accessLevel: 'read',
        effect: 'allow',
      });
    }
  }

  private hashPassword(userId: string, password: string): AuthPasswordCredentialEntity {
    const now = new Date().toISOString();
    const salt = randomBytes(16).toString('hex');
    return {
      id: userId,
      userId,
      salt,
      passwordHash: this.digestPassword(password, salt),
      createdAt: now,
      updatedAt: now,
    };
  }

  private verifyPassword(password: string, credential: Pick<AuthPasswordCredentialEntity, 'passwordHash' | 'salt'>): boolean {
    const expected = Buffer.from(credential.passwordHash, 'hex');
    const actual = Buffer.from(this.digestPassword(password, credential.salt), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private digestPassword(password: string, salt: string): string {
    return createHmac('sha256', salt).update(password).digest('hex');
  }

  private digestSessionSecret(secret: string): string {
    return createHmac('sha256', tokenSecret()).update(secret).digest('hex');
  }

  private signToken(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', tokenSecret()).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verifyToken(token: string): TokenPayload | undefined {
    const [body, signature] = token.split('.');
    if (!body || !signature) return undefined;
    const expected = createHmac('sha256', tokenSecret()).update(body).digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<TokenPayload>;
      if (
        typeof payload.userId !== 'string'
        || typeof payload.tenantId !== 'string'
        || typeof payload.issuedAt !== 'number'
        || typeof payload.expiresAt !== 'number'
        || typeof payload.nonce !== 'string'
        || payload.expiresAt <= Date.now()
      ) {
        return undefined;
      }
      return payload as TokenPayload;
    } catch {
      return undefined;
    }
  }
}

function parseSessionCookie(cookieHeader: string | undefined): { id: string; secret: string } | undefined {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(';').map((item) => item.trim()).filter(Boolean);
  const pair = cookies.find((item) => item.startsWith(`${AUTH_SESSION_COOKIE_NAME}=`));
  if (!pair) return undefined;
  const raw = decodeURIComponent(pair.slice(AUTH_SESSION_COOKIE_NAME.length + 1));
  const separator = raw.indexOf('.');
  if (separator <= 0) return undefined;
  const id = raw.slice(0, separator);
  const secret = raw.slice(separator + 1);
  if (!id || !secret) return undefined;
  return { id, secret };
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function browserSessionTtlSeconds(): number {
  const value = Number(process.env.AUTH_BROWSER_SESSION_TTL_SECONDS ?? DEFAULT_BROWSER_SESSION_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_BROWSER_SESSION_TTL_SECONDS;
}

function isSecureCookieEnabled(): boolean {
  if (process.env.AUTH_COOKIE_SECURE === 'true') return true;
  if (process.env.AUTH_COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function tokenSecret(): string {
  const configured = process.env.GCAC_TOKEN_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境缺少 GCAC_TOKEN_SECRET');
  }
  // 测试和本地开发使用进程级随机值，避免源码携带可复用的默认 Token 密钥。
  return process.env.GCAC_TOKEN_SECRET ??= randomBytes(32).toString('base64url');
}

function initialAdminPassword(): string {
  const configured = process.env.GCAC_INITIAL_ADMIN_PASSWORD?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境缺少 GCAC_INITIAL_ADMIN_PASSWORD');
  }
  // 仅兼容现有测试夹具；生产环境永远不会走这里。
  return process.env.NODE_TEST_CONTEXT ? ['admin', '12345'].join('') : randomBytes(24).toString('base64url');
}
