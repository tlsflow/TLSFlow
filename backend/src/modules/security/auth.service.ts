import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext } from '../../common/tracing/request-context.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity } from '../../persistence/entities/rbac.entity.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { AuditService } from '../audits/audit.service.js';
import type { RBACService } from '../rbac/rbac.service.js';

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

interface PasswordCredential {
  userId: string;
  passwordHash: string;
  salt: string;
}

interface TokenPayload {
  userId: string;
  tenantId: string;
  issuedAt: number;
  nonce: string;
}

const DEFAULT_TENANT_ID = 'default';
const DEFAULT_TENANT_NAME = '默认租户';
const DEFAULT_ADMIN_PASSWORD = 'admin12345';
const TOKEN_SECRET = 'gcac-dev-session-secret-change-before-production';

export class AuthService {
  private readonly credentials = new Map<string, PasswordCredential>();

  constructor(
    private readonly rbac: RBACService,
    private readonly audit?: AuditService,
  ) {
    this.seedDefaultAdmin();
  }

  login(input: { username: string; password: string }, context: RequestContext): AuthSessionResponse {
    const user = this.rbac.findUserByUsername(input.username);
    const credential = user ? this.credentials.get(user.id) : undefined;
    if (!user || !credential || !this.verifyPassword(input.password, credential)) {
      this.audit?.write({
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
      throw new AppError('AUTH_UNAUTHENTICATED', '用户名或密码错误');
    }

    if (user.status !== 'active') {
      throw new AppError('AUTH_FORBIDDEN', '用户已被禁用');
    }

    const session = this.createSession(user);
    this.audit?.write({
      eventType: AUDIT_EVENT_TYPES.AUTH_LOGIN_SUCCESS,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'authSession',
      result: 'success',
      riskLevel: 'low',
      context: { requestId: context.requestId, sourceIp: context.ip, actor: this.subjectForUser(user) },
    });
    return session;
  }

  logout(subject: SecuritySubject | undefined, context: RequestContext): { success: true } {
    if (subject) {
      this.audit?.write({
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

  createUserWithPassword(input: Omit<UserEntity, 'createdAt' | 'updatedAt'> & { password: string }): UserEntity {
    const user = this.rbac.createUser(input);
    this.credentials.set(user.id, this.hashPassword(user.id, input.password));
    return user;
  }

  currentSession(userId: string): AuthSessionResponse {
    const user = this.rbac.getUser(userId);
    if (!user || user.status !== 'active') {
      throw new AppError('AUTH_UNAUTHENTICATED', '登录状态已失效');
    }
    return this.createSession(user);
  }

  parseAuthorizationHeader(authorization: string | undefined): { actorId: string; tenantId: string } | undefined {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    const token = authorization.slice('Bearer '.length).trim();
    const payload = this.verifyToken(token);
    return payload ? { actorId: payload.userId, tenantId: payload.tenantId } : undefined;
  }

  private createSession(user: UserEntity): AuthSessionResponse {
    const token = this.signToken({
      userId: user.id,
      tenantId: user.tenantId ?? DEFAULT_TENANT_ID,
      issuedAt: Date.now(),
      nonce: randomBytes(8).toString('hex'),
    });
    return {
      token,
      user: this.toAuthenticatedUser(user),
      permissions: this.rbac.permissionsForSubject(this.subjectForUser(user)),
    };
  }

  private toAuthenticatedUser(user: UserEntity): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      tenantId: user.tenantId ?? DEFAULT_TENANT_ID,
      tenantName: user.tenantName ?? DEFAULT_TENANT_NAME,
      status: user.status,
      roles: this.rbac.rolesForUser(user.id).map((role) => ({ id: role.id, code: role.code, name: role.name })),
    };
  }

  private subjectForUser(user: UserEntity): SecuritySubject {
    return {
      id: user.id,
      type: 'user',
      roleIds: this.rbac.rolesForUser(user.id).map((role) => role.id),
      scope: { tenantId: user.tenantId ?? DEFAULT_TENANT_ID },
    };
  }

  private seedDefaultAdmin(): void {
    const adminRole: RoleEntity = {
      id: 'role_admin',
      code: 'admin',
      name: '系统管理员',
      description: '拥有全部控制台权限的内置管理员角色',
      builtin: true,
    };
    const auditorRole: RoleEntity = {
      id: 'role_auditor',
      code: 'auditor',
      name: '审计员',
      description: '只能查看审计和只读安全信息',
      builtin: true,
    };
    this.rbac.createRoleIfAbsent(adminRole);
    this.rbac.createRoleIfAbsent(auditorRole);
    const admin = this.rbac.createUserIfAbsent({
      id: 'user_admin',
      username: 'admin',
      displayName: '系统管理员',
      status: 'active',
      tenantId: DEFAULT_TENANT_ID,
      tenantName: DEFAULT_TENANT_NAME,
    });
    if (!this.rbac.userHasRole(admin.id, adminRole.id)) this.rbac.assignRole(admin.id, adminRole.id);
    const policy: Omit<PermissionPolicyEntity, 'id'> & { id: string } = {
      id: 'policy_admin_all',
      subjectType: 'role',
      subjectId: adminRole.id,
      effect: 'allow',
      actions: ['*'],
      resourceTypes: ['*'],
      scope: { tenantId: '*' },
    };
    this.rbac.createPolicyIfAbsent(policy);
    if (!this.credentials.has(admin.id)) {
      this.credentials.set(admin.id, this.hashPassword(admin.id, DEFAULT_ADMIN_PASSWORD));
    }
  }

  private hashPassword(userId: string, password: string): PasswordCredential {
    const salt = randomBytes(16).toString('hex');
    return { userId, salt, passwordHash: this.digestPassword(password, salt) };
  }

  private verifyPassword(password: string, credential: PasswordCredential): boolean {
    const expected = Buffer.from(credential.passwordHash, 'hex');
    const actual = Buffer.from(this.digestPassword(password, credential.salt), 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private digestPassword(password: string, salt: string): string {
    return createHmac('sha256', salt).update(password).digest('hex');
  }

  private signToken(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  private verifyToken(token: string): TokenPayload | undefined {
    const [body, signature] = token.split('.');
    if (!body || !signature) return undefined;
    const expected = createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) return undefined;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      return undefined;
    }
  }
}
