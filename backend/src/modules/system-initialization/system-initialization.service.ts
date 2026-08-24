import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { DatabasePort } from '../../database/database-port.js';
import type { RequestContext } from '../../common/tracing/request-context.js';
import type { AuthService, AuthSessionResponse, AuthCookieSession } from '../security/auth.service.js';
import type { AuditService } from '../audits/audit.service.js';
import type { SupportedLocale, ThemeMode, UserEntity } from '../../persistence/entities/rbac.entity.js';
import type { RBACService } from '../rbac/rbac.service.js';

export type SystemInitializationStatus = 'pending' | 'initializing' | 'initialized';

export interface SystemInitializationInput {
  username: string;
  displayName: string;
  password: string;
  passwordConfirmation: string;
  locale: SupportedLocale;
  theme: ThemeMode;
}

export interface SystemInitializationResult {
  initialized: true;
  user: UserEntity;
  session: AuthSessionResponse;
  cookie: AuthCookieSession;
}

export class SystemInitializationService {
  private initialized?: Promise<void>;

  constructor(
    private readonly db: DatabasePort,
    private readonly auth: AuthService,
    private readonly rbac: RBACService,
    private readonly audit?: AuditService,
  ) {}

  buildSessionSetCookie(cookie: AuthCookieSession): string {
    return this.auth.buildSessionSetCookie(cookie.cookieValue, cookie.expiresAt);
  }

  private async writeAudit(input: Parameters<AuditService['write']>[0]): Promise<void> {
    if (!this.audit) return;
    await this.audit.write(input).catch(() => undefined);
  }

  async getStatus(): Promise<{ initialized: boolean; status: SystemInitializationStatus }> {
    await this.auth.ensureReady();
    await this.ensureStateTable();
    await this.syncLegacyAdminState();
    const state = await this.readState();
    return {
      initialized: state.status === 'INITIALIZED',
      status: toPublicStatus(state.status),
    };
  }

  async initialize(input: SystemInitializationInput, context: RequestContext): Promise<SystemInitializationResult> {
    await this.auth.ensureReady();
    await this.ensureStateTable();
    await this.syncLegacyAdminState();
    const claimToken = randomBytes(24).toString('base64url');
    const claimed = await this.db.transaction(async (tx) => {
      const result = await tx.query<{ id: string }>(
        `update system_initialization_state
            set status = 'INITIALIZING', claim_token = $1, updated_at = now()
          where id = 'singleton' and status = 'PENDING'
        returning id`,
        [claimToken],
      );
      return result.rows.length > 0;
    });
    if (!claimed) {
      const state = await this.readState();
      await this.writeAudit({
        eventType: 'system.initialization.rejected',
        actorType: 'system',
        actorId: 'system',
        action: 'system.initialization.submit',
        resourceType: 'systemInitialization',
        resourceId: 'singleton',
        result: 'failure',
        riskLevel: 'medium',
        context,
        detail: { state: state.status },
      });
      throw new AppError(
        state.status === 'INITIALIZED' ? 'RESOURCE_ALREADY_EXISTS' : 'RESOURCE_VERSION_CONFLICT',
        state.status === 'INITIALIZED' ? '系统已经完成初始化' : '系统初始化正在进行中',
      );
    }

    let initializedStateCommitted = false;
    try {
      await this.writeAudit({
        eventType: 'system.initialization.started',
        actorType: 'system',
        actorId: 'system',
        action: 'system.initialization.start',
        resourceType: 'systemInitialization',
        resourceId: 'singleton',
        result: 'success',
        riskLevel: 'high',
        context,
      });
      const user = await this.auth.createInitialAdmin({
        username: input.username,
        displayName: input.displayName,
        password: input.password,
        locale: input.locale,
        theme: input.theme,
      });
      const completed = await this.db.query(
        `update system_initialization_state
            set status = 'INITIALIZED', claim_token = null, initialized_at = now(), updated_at = now()
          where id = 'singleton' and status = 'INITIALIZING' and claim_token = $1
        returning id`,
        [claimToken],
      );
      if (completed.rows.length !== 1) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '系统初始化状态已发生变化');
      }
      initializedStateCommitted = true;
      const session = await this.auth.currentSession(user.id);
      const cookie = await this.auth.createBrowserSession(user.id, context);
      await this.writeAudit({
        eventType: 'system.initialization.completed',
        actorType: 'user',
        actorId: user.id,
        action: 'system.initialization.complete',
        resourceType: 'systemInitialization',
        resourceId: 'singleton',
        result: 'success',
        riskLevel: 'high',
        context: { requestId: context.requestId, sourceIp: context.ip },
        detail: { username: user.username, locale: input.locale, theme: input.theme },
      });
      return { initialized: true, user, session, cookie };
    } catch (error) {
      if (!initializedStateCommitted) {
        await this.db.query(
          `update system_initialization_state
              set status = 'PENDING', claim_token = null, updated_at = now()
            where id = 'singleton' and status = 'INITIALIZING' and claim_token = $1`,
          [claimToken],
        );
      }
      await this.writeAudit({
        eventType: 'system.initialization.failed',
        actorType: 'system',
        actorId: 'system',
        action: 'system.initialization.fail',
        resourceType: 'systemInitialization',
        resourceId: 'singleton',
        result: 'failure',
        riskLevel: 'high',
        context,
        detail: { reason: error instanceof AppError ? error.errorCode : 'INITIALIZATION_FAILED' },
      });
      throw error;
    }
  }

  private async readState(): Promise<{ status: 'PENDING' | 'INITIALIZING' | 'INITIALIZED' }> {
    const result = await this.db.query<{ status: 'PENDING' | 'INITIALIZING' | 'INITIALIZED' }>(
      `select status from system_initialization_state where id = 'singleton'`,
    );
    return result.rows[0] ?? { status: 'PENDING' };
  }

  private async ensureStateTable(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.db.exec(`
        create table if not exists system_initialization_state (
          id varchar(32) primary key,
          status varchar(32) not null,
          claim_token varchar(128),
          initialized_at timestamptz,
          updated_at timestamptz not null default now(),
          constraint system_initialization_state_singleton check (id = 'singleton'),
          constraint system_initialization_state_status check (status in ('PENDING', 'INITIALIZING', 'INITIALIZED'))
        );
        insert into system_initialization_state (id, status)
        values ('singleton', 'PENDING')
        on conflict (id) do nothing;
      `);
    }
    await this.initialized;
  }

  private async syncLegacyAdminState(): Promise<void> {
    const state = await this.readState();
    if (state.status !== 'PENDING') return;
    // 兼容显式启用旧版 GCAC_INITIAL_ADMIN_PASSWORD 的非向导部署；已有用户即代表系统已经完成首期账号初始化。
    if ((await this.rbac.listUsers()).length === 0) return;
    await this.db.query(
      `update system_initialization_state
          set status = 'INITIALIZED', claim_token = null, initialized_at = coalesce(initialized_at, now()), updated_at = now()
        where id = 'singleton' and status = 'PENDING'`,
    );
  }
}

function toPublicStatus(status: 'PENDING' | 'INITIALIZING' | 'INITIALIZED'): SystemInitializationStatus {
  if (status === 'INITIALIZED') return 'initialized';
  if (status === 'INITIALIZING') return 'initializing';
  return 'pending';
}
