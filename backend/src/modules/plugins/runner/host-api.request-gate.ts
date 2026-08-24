import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { HostApiMethodDefinition } from './protocol/host-api.registry.js';
import type { PluginRunnerError } from './protocol/protocol.types.js';

export type HostApiRequestStatus = 'IN_FLIGHT' | 'COMPLETED' | 'UNKNOWN';

export interface HostApiRequestOutcome {
  ok: boolean;
  output?: Record<string, unknown>;
  error?: PluginRunnerError;
}

export interface HostApiRequestAdmission {
  key: string;
  requestFingerprint: string;
  requestId: string;
  method: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  pluginVersionId: string;
  capability: string;
  expiresAt: string;
}

export type HostApiRequestClaimResult =
  | { status: 'ACQUIRED' }
  | { status: 'COMPLETED'; outcome: HostApiRequestOutcome }
  | { status: 'IN_FLIGHT' }
  | { status: 'UNKNOWN'; outcome?: HostApiRequestOutcome }
  | { status: 'EXPIRED'; outcome?: HostApiRequestOutcome }
  | { status: 'CONFLICT' };

export type HostApiRequestCompleteResult = 'COMMITTED' | 'LATE' | 'CONFLICT';
export type HostApiRequestExpireResult = 'EXPIRED' | 'ALREADY_TERMINAL' | 'CONFLICT';

/**
 * 宿主必须提供持久化实现。claim 必须在数据库唯一约束或等价原子事务内完成，
 * 不能用进程内 Map 代替，否则 Runner 重启后会重新执行同一个写请求。
 */
export interface PluginRunnerHostApiRequestStore {
  /** 必须由数据库唯一键和原子事务实现，成功后请求才获得唯一消费权。 */
  claim(admission: HostApiRequestAdmission): Promise<HostApiRequestClaimResult>;
  complete(admission: HostApiRequestAdmission, outcome: HostApiRequestOutcome): Promise<HostApiRequestCompleteResult>;
  /** 将仍在消费中的请求收敛为 UNKNOWN；迟到 complete 必须返回 LATE。 */
  expire(admission: HostApiRequestAdmission, error: PluginRunnerError): Promise<HostApiRequestExpireResult>;
}

interface PersistedHostApiRequestRecord {
  requestFingerprint: string;
  status: HostApiRequestStatus;
  expiresAt: string;
  outcome?: HostApiRequestOutcome;
}

/**
 * 生产 Host API 请求账本。
 *
 * 请求键使用 pg_documents 的主键，并在事务内通过 ON CONFLICT 抢占消费权，
 * 这样 Runner 重启或多宿主并发时不会因为进程内 Map 丢失写请求状态。
 */
export class PgPluginRunnerHostApiRequestStore implements PluginRunnerHostApiRequestStore {
  private initialized?: Promise<void>;

  constructor(
    private readonly db: DatabasePort,
    private readonly namespace = 'plugins:runner-host-api-requests',
  ) {}

  async claim(admission: HostApiRequestAdmission): Promise<HostApiRequestClaimResult> {
    await this.ensureTable();
    return this.db.transaction(async (tx) => {
      const inserted = await tx.query<{ document_id: string }>(
        `insert into pg_documents (namespace, document_id, payload, updated_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (namespace, document_id) do nothing
         returning document_id`,
        [this.namespace, admission.key, JSON.stringify(this.initialRecord(admission))],
      );
      if (inserted.rows.length > 0) return { status: 'ACQUIRED' } as const;

      const existing = await this.getForUpdate(tx, admission.key);
      if (!existing) throw new AppError('PLUGIN_OPERATION_UNKNOWN_STATE', 'Host API 请求账本记录消失，拒绝继续执行');
      if (existing.requestFingerprint !== admission.requestFingerprint) return { status: 'CONFLICT' } as const;
      if (existing.status === 'COMPLETED') return { status: 'COMPLETED', outcome: existing.outcome! } as const;
      if (existing.status === 'UNKNOWN') return { status: 'UNKNOWN', ...(existing.outcome ? { outcome: existing.outcome } : {}) } as const;

      if (Date.parse(existing.expiresAt) <= Date.now()) {
        const outcome = unknownOutcome('Host API 请求超过截止时间，状态未知');
        await this.update(tx, admission.key, { ...existing, status: 'UNKNOWN', outcome });
        return { status: 'UNKNOWN', outcome } as const;
      }
      return { status: 'IN_FLIGHT' } as const;
    });
  }

  async complete(admission: HostApiRequestAdmission, outcome: HostApiRequestOutcome): Promise<HostApiRequestCompleteResult> {
    await this.ensureTable();
    return this.db.transaction(async (tx) => {
      const existing = await this.getForUpdate(tx, admission.key);
      if (!existing || existing.requestFingerprint !== admission.requestFingerprint) return 'CONFLICT';
      if (existing.status !== 'IN_FLIGHT') return 'LATE';
      await this.update(tx, admission.key, { ...existing, status: 'COMPLETED', outcome });
      return 'COMMITTED';
    });
  }

  async expire(admission: HostApiRequestAdmission, error: PluginRunnerError): Promise<HostApiRequestExpireResult> {
    await this.ensureTable();
    return this.db.transaction(async (tx) => {
      const existing = await this.getForUpdate(tx, admission.key);
      if (!existing || existing.requestFingerprint !== admission.requestFingerprint) return 'CONFLICT';
      if (existing.status !== 'IN_FLIGHT') return 'ALREADY_TERMINAL';
      await this.update(tx, admission.key, { ...existing, status: 'UNKNOWN', outcome: { ok: false, error } });
      return 'EXPIRED';
    });
  }

  private initialRecord(admission: HostApiRequestAdmission): PersistedHostApiRequestRecord {
    return {
      requestFingerprint: admission.requestFingerprint,
      status: 'IN_FLIGHT',
      expiresAt: admission.expiresAt,
    };
  }

  private async getForUpdate(tx: DatabasePort, key: string): Promise<PersistedHostApiRequestRecord | undefined> {
    const result = await tx.query<{ payload: PersistedHostApiRequestRecord }>(
      `select payload from pg_documents where namespace = $1 and document_id = $2 for update`,
      [this.namespace, key],
    );
    return result.rows[0]?.payload ? structuredClone(result.rows[0].payload) : undefined;
  }

  private async update(tx: DatabasePort, key: string, record: PersistedHostApiRequestRecord): Promise<void> {
    await tx.query(
      `update pg_documents set payload = $3::jsonb, updated_at = now()
       where namespace = $1 and document_id = $2`,
      [this.namespace, key, JSON.stringify(record)],
    );
  }

  private async ensureTable(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.db.exec(`
        create table if not exists pg_documents (
          namespace varchar(128) not null,
          document_id varchar(128) not null,
          payload jsonb not null,
          updated_at timestamptz not null default now(),
          primary key (namespace, document_id)
        );
        create index if not exists idx_pg_documents_namespace_updated
          on pg_documents (namespace, updated_at desc);
      `);
    }
    await this.initialized;
  }
}

export interface HostApiRequestBinding {
  requestId: string;
  method: string;
  input: Record<string, unknown>;
  timeoutMs: number;
  idempotencyKey: string;
  deadlineAt: string;
  tenantId: string;
  executionId: string;
  executionStepId: string;
  pluginVersionId: string;
  pluginId: string;
  pluginVersion: string;
  capability: string;
  grantRefs: readonly string[];
  workflowVersionId: string;
  planDigest: string;
  hostPermissions: readonly string[];
}

/** 负责生成稳定请求键和输入指纹，具体持久化由宿主装配。 */
export class PluginRunnerHostApiRequestGate {
  constructor(private readonly store: PluginRunnerHostApiRequestStore) {}

  createAdmission(binding: HostApiRequestBinding, definition: HostApiMethodDefinition): HostApiRequestAdmission {
    const idempotencyValue = definition.idempotencyKey === null
      ? binding.idempotencyKey
      : binding.input[definition.idempotencyKey];
    if (typeof idempotencyValue !== 'string' && typeof idempotencyValue !== 'number') {
      throw new AppError('PLUGIN_HOST_CALL_DENIED', 'Host API 幂等键字段缺失或类型无效', { method: definition.method, field: definition.idempotencyKey });
    }
    const scope = {
      tenantId: binding.tenantId,
      executionId: binding.executionId,
      executionStepId: binding.executionStepId,
      pluginVersionId: binding.pluginVersionId,
      method: definition.method,
      idempotencyValue: String(idempotencyValue),
    };
    const requestFingerprint = digest({
      ...scope,
      pluginId: binding.pluginId,
      pluginVersion: binding.pluginVersion,
      capability: binding.capability,
      grantRefs: [...binding.grantRefs].sort(),
      workflowVersionId: binding.workflowVersionId,
      planDigest: binding.planDigest,
      hostPermissions: [...binding.hostPermissions].sort(),
      input: binding.input,
    });
    return {
      key: digest(scope),
      requestFingerprint,
      requestId: binding.requestId,
      method: definition.method,
      tenantId: binding.tenantId,
      executionId: binding.executionId,
      executionStepId: binding.executionStepId,
      pluginVersionId: binding.pluginVersionId,
      capability: binding.capability,
      expiresAt: binding.deadlineAt,
    };
  }

  claim(admission: HostApiRequestAdmission): Promise<HostApiRequestClaimResult> {
    return this.store.claim(admission);
  }

  complete(admission: HostApiRequestAdmission, outcome: HostApiRequestOutcome): Promise<HostApiRequestCompleteResult> {
    return this.store.complete(admission, outcome);
  }

  expire(admission: HostApiRequestAdmission, error: PluginRunnerError): Promise<HostApiRequestExpireResult> {
    return this.store.expire(admission, error);
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function unknownOutcome(message: string): HostApiRequestOutcome {
  return {
    ok: false,
    error: {
      code: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      message,
      retryable: false,
      mayBeUnknown: true,
      secretRedacted: true,
    },
  };
}
