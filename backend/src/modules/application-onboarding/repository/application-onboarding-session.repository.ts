import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { ApplicationOnboardingSessionDto, OnboardingSessionState, OnboardingTargetOptionDto } from '../dto/application-onboarding.dto.js';

interface SessionRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  actor_id: string;
  platform_key: string;
  plugin_version_id?: string | null;
  recipe_hash?: string | null;
  state: OnboardingSessionState;
  state_version: number;
  deployment_mode?: string | null;
  device_id?: string | null;
  asset_id?: string | null;
  discovery_snapshot_id?: string | null;
  target_id?: string | null;
  target_fingerprint?: string | null;
  certificate_id?: string | null;
  certificate_version_id?: string | null;
  input_snapshot: Record<string, unknown>;
  targets: OnboardingTargetOptionDto[];
  result?: Record<string, unknown> | null;
  last_error_code?: string | null;
  last_error_detail?: Record<string, unknown> | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface UpdateSessionPatch {
  state?: OnboardingSessionState;
  deploymentMode?: string;
  deviceId?: string | null;
  assetId?: string | null;
  discoverySnapshotId?: string | null;
  targetId?: string | null;
  targetFingerprint?: string | null;
  certificateId?: string | null;
  certificateVersionId?: string | null;
  inputSnapshot?: Record<string, unknown>;
  targets?: OnboardingTargetOptionDto[];
  result?: Record<string, unknown> | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: Record<string, unknown> | null;
  expiresAt?: string;
}

export class ApplicationOnboardingSessionRepository {
  constructor(private readonly db: DatabasePort = new PgliteDatabase()) {}

  async create(input: ApplicationOnboardingSessionDto): Promise<ApplicationOnboardingSessionDto> {
    await this.db.query(`
      insert into application_onboarding_sessions (
        id, tenant_id, actor_id, platform_key, plugin_version_id, recipe_hash, state, state_version,
        deployment_mode, device_id, asset_id, discovery_snapshot_id, target_id, target_fingerprint,
        certificate_id, certificate_version_id, input_snapshot, targets, result, last_error_code,
        last_error_detail, idempotency_key, created_at, updated_at, expires_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19::jsonb,$20,$21::jsonb,$22,$23,$24,$25)
    `, [
      input.id, input.tenantId, input.actorId, input.platformKey, input.pluginVersionId ?? null, input.recipeHash ?? null,
      input.state, input.stateVersion, input.deploymentMode ?? null, input.deviceId ?? null, input.assetId ?? null,
      input.discoverySnapshotId ?? null, input.targetId ?? null, input.targetFingerprint ?? null, input.certificateId ?? null,
      input.certificateVersionId ?? null, JSON.stringify(input.inputSnapshot), JSON.stringify(input.targets),
      input.result ? JSON.stringify(input.result) : null, input.lastErrorCode ?? null,
      input.lastErrorDetail ? JSON.stringify(input.lastErrorDetail) : null, input.idempotencyKey, input.createdAt, input.updatedAt, input.expiresAt,
    ]);
    return input;
  }

  async get(tenantId: string, id: string): Promise<ApplicationOnboardingSessionDto | undefined> {
    const row = (await this.db.query<SessionRow>('select * from application_onboarding_sessions where tenant_id = $1 and id = $2', [tenantId, id])).rows[0];
    return row ? fromRow(row) : undefined;
  }

  async findByIdempotencyKey(tenantId: string, key: string): Promise<ApplicationOnboardingSessionDto | undefined> {
    const row = (await this.db.query<SessionRow>('select * from application_onboarding_sessions where tenant_id = $1 and idempotency_key = $2', [tenantId, key])).rows[0];
    return row ? fromRow(row) : undefined;
  }

  async update(tenantId: string, id: string, expectedStateVersion: number, patch: UpdateSessionPatch): Promise<ApplicationOnboardingSessionDto | undefined> {
    const now = new Date().toISOString();
    const sets: string[] = ['state_version = state_version + 1', 'updated_at = $3'];
    const params: unknown[] = [tenantId, id, now, expectedStateVersion];
    let index = 5;
    const add = (column: string, value: unknown, cast?: string) => {
      sets.push(`${column} = $${index}${cast ? `::${cast}` : ''}`);
      params.push(value);
      index += 1;
    };
    if (patch.state !== undefined) add('state', patch.state);
    if (patch.deploymentMode !== undefined) add('deployment_mode', patch.deploymentMode);
    if (patch.deviceId !== undefined) add('device_id', patch.deviceId);
    if (patch.assetId !== undefined) add('asset_id', patch.assetId);
    if (patch.discoverySnapshotId !== undefined) add('discovery_snapshot_id', patch.discoverySnapshotId);
    if (patch.targetId !== undefined) add('target_id', patch.targetId);
    if (patch.targetFingerprint !== undefined) add('target_fingerprint', patch.targetFingerprint);
    if (patch.certificateId !== undefined) add('certificate_id', patch.certificateId);
    if (patch.certificateVersionId !== undefined) add('certificate_version_id', patch.certificateVersionId);
    if (patch.inputSnapshot !== undefined) add('input_snapshot', JSON.stringify(patch.inputSnapshot), 'jsonb');
    if (patch.targets !== undefined) add('targets', JSON.stringify(patch.targets), 'jsonb');
    if (patch.result !== undefined) add('result', patch.result === null ? null : JSON.stringify(patch.result), 'jsonb');
    if (patch.lastErrorCode !== undefined) add('last_error_code', patch.lastErrorCode);
    if (patch.lastErrorDetail !== undefined) add('last_error_detail', patch.lastErrorDetail === null ? null : JSON.stringify(patch.lastErrorDetail), 'jsonb');
    if (patch.expiresAt !== undefined) add('expires_at', patch.expiresAt);
    const result = await this.db.query<SessionRow>(`update application_onboarding_sessions set ${sets.join(', ')} where tenant_id = $1 and id = $2 and state_version = $4 returning *`, params);
    const row = result.rows[0];
    return row ? fromRow(row) : undefined;
  }
}

function fromRow(row: SessionRow): ApplicationOnboardingSessionDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    actorId: row.actor_id,
    platformKey: row.platform_key,
    pluginVersionId: row.plugin_version_id ?? undefined,
    recipeHash: row.recipe_hash ?? undefined,
    state: row.state,
    stateVersion: Number(row.state_version),
    deploymentMode: row.deployment_mode as ApplicationOnboardingSessionDto['deploymentMode'],
    deviceId: row.device_id ?? undefined,
    assetId: row.asset_id ?? undefined,
    discoverySnapshotId: row.discovery_snapshot_id ?? undefined,
    targetId: row.target_id ?? undefined,
    targetFingerprint: row.target_fingerprint ?? undefined,
    certificateId: row.certificate_id ?? undefined,
    certificateVersionId: row.certificate_version_id ?? undefined,
    inputSnapshot: row.input_snapshot ?? {},
    targets: row.targets ?? [],
    result: row.result ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    lastErrorDetail: row.last_error_detail ?? undefined,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}
