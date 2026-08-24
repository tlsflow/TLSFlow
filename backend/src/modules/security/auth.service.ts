import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext } from '../../common/tracing/request-context.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AuthPasswordCredentialEntity } from '../../persistence/entities/auth-credential.entity.js';
import type { PermissionPolicyEntity, RoleEntity, UserEntity } from '../../persistence/entities/rbac.entity.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
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
const DEFAULT_TENANT_NAME = '\u9ed8\u8ba4\u79df\u6237';
const DEFAULT_ADMIN_PASSWORD = 'admin12345';
const TOKEN_SECRET = 'gcac-dev-session-secret-change-before-production';

export class AuthService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultCredentialsRepository(): AsyncRepositoryPort<AuthPasswordCredentialEntity> {
    return new PgDocumentRepository<AuthPasswordCredentialEntity>(AuthService.defaultDb, 'security.auth_password_credentials');
  }

  private readonly seedReady: Promise<void>;

  constructor(
    private readonly rbac: RBACService,
    private readonly credentials: AsyncRepositoryPort<AuthPasswordCredentialEntity> = AuthService.createDefaultCredentialsRepository(),
    private readonly audit?: AuditService,
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

  async createUserWithPassword(input: Omit<UserEntity, 'createdAt' | 'updatedAt'> & { password: string }): Promise<UserEntity> {
    await this.seedReady;
    const user = await this.rbac.createUser(input);
    await this.credentials.upsert(this.hashPassword(user.id, input.password));
    return user;
  }

  async deleteUserCredentials(userId: string): Promise<void> {
    await this.credentials.delete(userId);
  }

  async currentSession(userId: string): Promise<AuthSessionResponse> {
    await this.seedReady;
    const user = await this.rbac.getUser(userId);
    if (!user || user.status !== 'active') {
      throw new AppError('AUTH_UNAUTHENTICATED', '\u5f53\u524d\u767b\u5f55\u72b6\u6001\u65e0\u6548');
    }
    return this.createSession(user);
  }

  parseAuthorizationHeader(authorization: string | undefined): { actorId: string; tenantId: string } | undefined {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    const token = authorization.slice('Bearer '.length).trim();
    const payload = this.verifyToken(token);
    return payload ? { actorId: payload.userId, tenantId: payload.tenantId } : undefined;
  }

  private async createSession(user: UserEntity): Promise<AuthSessionResponse> {
    const token = this.signToken({
      userId: user.id,
      tenantId: user.tenantId ?? DEFAULT_TENANT_ID,
      issuedAt: Date.now(),
      nonce: randomBytes(8).toString('hex'),
    });
    const subject = await this.subjectForUser(user);
    return {
      token,
      user: await this.toAuthenticatedUser(user),
      permissions: await this.rbac.permissionsForSubject(subject),
    };
  }

  private async toAuthenticatedUser(user: UserEntity): Promise<AuthenticatedUser> {
    const roles = await this.rbac.rolesForUser(user.id);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      tenantId: user.tenantId ?? DEFAULT_TENANT_ID,
      tenantName: user.tenantName ?? DEFAULT_TENANT_NAME,
      status: user.status,
      roles: roles.map((role) => ({ id: role.id, code: role.code, name: role.name })),
    };
  }

  private async subjectForUser(user: UserEntity): Promise<SecuritySubject> {
    const roles = await this.rbac.rolesForUser(user.id);
    return {
      id: user.id,
      type: 'user',
      roleIds: roles.map((role) => role.id),
      scope: { tenantId: user.tenantId ?? DEFAULT_TENANT_ID },
    };
  }

  private async seedDefaultAdmin(): Promise<void> {
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
      tenantId: DEFAULT_TENANT_ID,
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
      await this.credentials.upsert(this.hashPassword(admin.id, DEFAULT_ADMIN_PASSWORD));
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
