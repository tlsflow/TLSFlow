import { applyAuthorizationFilter, type PageQuery } from '../../../common/pagination/pagination.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type { IdentifiedEntity } from '../../../persistence/repositories/repository-port.js';
import type { PageResponse } from '../../../shared/dto/page-response.js';
import { createPageResponse } from '../../../shared/dto/page-response.js';
import type {
  AgentCapabilitySnapshot,
  AgentCertificate,
  AgentCertificateAuthority,
  AgentCertificateSigningRequest,
  AgentHeartbeat,
  AgentInstallSession,
  AgentRegistration,
  AgentRuntimeLogEntry,
  AgentSession,
  AgentTaskEnvelope,
  AgentTaskLogCursor,
  AgentTaskLogEntry,
  AgentUpgradePlan,
  AgentVersionRelease,
  EnrollmentToken,
} from '../schema/agents.schema.js';

export interface AgentsRepository {
  readonly moduleName: 'agents';
  createEnrollmentToken(token: EnrollmentToken): Promise<EnrollmentToken>;
  updateEnrollmentToken(tokenId: string, patch: Partial<EnrollmentToken>): Promise<EnrollmentToken>;
  findEnrollmentTokenByHash(tenantId: string, tokenHash: string): Promise<EnrollmentToken | undefined>;
  findEnrollmentTokenByHashAnyTenant(tokenHash: string): Promise<EnrollmentToken | undefined>;
  upsertRegistration(agent: AgentRegistration): Promise<AgentRegistration>;
  updateRegistration(agentId: string, patch: Partial<AgentRegistration>): Promise<AgentRegistration>;
  deleteRegistration(agentId: string): Promise<void>;
  getRegistration(tenantId: string, agentId: string): Promise<AgentRegistration | undefined>;
  findByAgentKey(tenantId: string, agentKey: string): Promise<AgentRegistration | undefined>;
  findByMachineId(tenantId: string, machineId: string): Promise<AgentRegistration | undefined>;
  listRegistrations(tenantId: string, query: PageQuery): Promise<PageResponse<AgentRegistration>>;
  listAllRegistrations(): Promise<AgentRegistration[]>;
  createSession(session: AgentSession): Promise<AgentSession>;
  getSession(tenantId: string, sessionId: string): Promise<AgentSession | undefined>;
  saveCertificateAuthority(ca: AgentCertificateAuthority): Promise<AgentCertificateAuthority>;
  getCertificateAuthority(): Promise<AgentCertificateAuthority | undefined>;
  createCertificateSigningRequest(csr: AgentCertificateSigningRequest): Promise<AgentCertificateSigningRequest>;
  updateCertificateSigningRequest(csrId: string, patch: Partial<AgentCertificateSigningRequest>): Promise<AgentCertificateSigningRequest>;
  getCertificateSigningRequest(tenantId: string, csrId: string): Promise<AgentCertificateSigningRequest | undefined>;
  createCertificate(certificate: AgentCertificate): Promise<AgentCertificate>;
  updateCertificate(certificateId: string, patch: Partial<AgentCertificate>): Promise<AgentCertificate>;
  getCertificate(tenantId: string, certificateId: string): Promise<AgentCertificate | undefined>;
  findActiveCertificate(tenantId: string, agentId: string): Promise<AgentCertificate | undefined>;
  listCertificates(tenantId: string, agentId: string): Promise<AgentCertificate[]>;
  saveHeartbeat(heartbeat: AgentHeartbeat): Promise<AgentHeartbeat>;
  getLatestHeartbeat(tenantId: string, agentId: string): Promise<AgentHeartbeat | undefined>;
  saveCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): Promise<AgentCapabilitySnapshot>;
  getLatestCapabilitySnapshot(tenantId: string, agentId: string): Promise<AgentCapabilitySnapshot | undefined>;
  getLatestFullWebInventorySnapshot(tenantId: string, agentId: string): Promise<AgentCapabilitySnapshot | undefined>;
  backfillCurrentSnapshotPointers(input?: AgentSnapshotPointerBackfillInput): Promise<AgentSnapshotPointerBackfillResult>;
  createTask(task: AgentTaskEnvelope): Promise<AgentTaskEnvelope>;
  updateTask(taskId: string, patch: Partial<AgentTaskEnvelope>): Promise<AgentTaskEnvelope>;
  claimQueuedTask(taskId: string, agentId: string, leaseId: string, ackedAt: string): Promise<AgentTaskEnvelope | undefined>;
  getTask(tenantId: string, taskId: string): Promise<AgentTaskEnvelope | undefined>;
  findTaskByIdempotencyKey(tenantId: string, agentId: string, idempotencyKey: string): Promise<AgentTaskEnvelope | undefined>;
  listTasks(tenantId: string, agentId: string, statuses?: string[]): Promise<AgentTaskEnvelope[]>;
  saveTaskLog(entry: AgentTaskLogEntry): Promise<AgentTaskLogEntry>;
  saveRuntimeLog(entry: AgentRuntimeLogEntry): Promise<AgentRuntimeLogEntry>;
  saveTaskLogCursor(cursor: AgentTaskLogCursor): Promise<AgentTaskLogCursor>;
  getTaskLogCursor(tenantId: string, agentId: string, taskId: string): Promise<AgentTaskLogCursor | undefined>;
  listTaskLogs(tenantId: string, taskId: string): Promise<AgentTaskLogEntry[]>;
  listAgentTaskLogs(tenantId: string, agentId: string, levels?: AgentTaskLogEntry['level'][]): Promise<AgentTaskLogEntry[]>;
  listAgentRuntimeLogs(tenantId: string, agentId: string, categories?: AgentRuntimeLogEntry['category'][]): Promise<AgentRuntimeLogEntry[]>;
  getDetailData(tenantId: string, agentId: string, options?: { includeLogs?: boolean }): Promise<AgentDetailData | undefined>;
  publishVersion(release: AgentVersionRelease): Promise<AgentVersionRelease>;
  listActiveVersions(tenantId: string): Promise<AgentVersionRelease[]>;
  createUpgradePlan(plan: AgentUpgradePlan): Promise<AgentUpgradePlan>;
  updateUpgradePlan(planId: string, patch: Partial<AgentUpgradePlan>): Promise<AgentUpgradePlan>;
  getUpgradePlan(tenantId: string, planId: string): Promise<AgentUpgradePlan | undefined>;
  findUpgradePlanForAgent(tenantId: string, agentId: string, releaseId: string): Promise<AgentUpgradePlan | undefined>;
  listUpgradePlansForAgent(tenantId: string, agentId: string): Promise<AgentUpgradePlan[]>;
  createInstallSession(session: AgentInstallSession): Promise<AgentInstallSession>;
  getInstallSession(tenantId: string, sessionId: string): Promise<AgentInstallSession | undefined>;
  findInstallSessionByTokenHashAnyTenant(tokenHash: string): Promise<AgentInstallSession | undefined>;
  consumeInstallSessionByTokenHash(tokenHash: string, usedAt: string, usedByIp?: string): Promise<AgentInstallSession | undefined>;
}

export interface AgentSnapshotPointerBackfillInput {
  tenantId?: string;
  after?: {
    tenantId: string;
    agentId: string;
  };
  limit?: number;
}

export interface AgentSnapshotPointerBackfillResult {
  processed: number;
  next?: {
    tenantId: string;
    agentId: string;
  };
}

type AgentHeartbeatRecord = AgentHeartbeat & IdentifiedEntity;
type AgentTaskLogCursorRecord = AgentTaskLogCursor & IdentifiedEntity;

export interface AgentDetailData {
  agent: AgentRegistration;
  capabilitySnapshot?: AgentCapabilitySnapshot;
  latestHeartbeat?: AgentHeartbeat;
  tasks: AgentTaskEnvelope[];
  recentErrors: AgentTaskLogEntry[];
  runtimeLogs: AgentRuntimeLogEntry[];
  recentTaskLogs: AgentTaskLogEntry[];
  releases: AgentVersionRelease[];
  upgradePlans: AgentUpgradePlan[];
}

function logCursorKey(tenantId: string, agentId: string, taskId: string): string {
  return `${tenantId}:${agentId}:${taskId}`;
}

function heartbeatKey(tenantId: string, agentId: string): string {
  return `${tenantId}:${agentId}`;
}

function hasFullWebInventory(snapshot: AgentCapabilitySnapshot): boolean {
  return snapshot.capabilities.some((capability) => {
    if (capability.capabilityKey !== 'web.inventory') return false;
    return Boolean(capability.value)
      && typeof capability.value === 'object'
      && !Array.isArray(capability.value)
      && (capability.value as Record<string, unknown>).scope === 'FULL_WEB_DISCOVERY';
  });
}

function compareVersions(left: string, right: string): number {
  const l = left.split('.').map(Number);
  const r = right.split('.').map(Number);
  for (let index = 0; index < Math.max(l.length, r.length); index += 1) {
    const diff = (l[index] ?? 0) - (r[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class PgAgentsRepository implements AgentsRepository {
  readonly moduleName = 'agents' as const;
  private readonly db: DatabasePort;

  private readonly enrollmentTokens: PgDocumentRepository<EnrollmentToken>;
  private readonly registrations: PgDocumentRepository<AgentRegistration>;
  private readonly sessions: PgDocumentRepository<AgentSession>;
  private readonly certificateAuthorities: PgDocumentRepository<AgentCertificateAuthority>;
  private readonly certificateSigningRequests: PgDocumentRepository<AgentCertificateSigningRequest>;
  private readonly certificates: PgDocumentRepository<AgentCertificate>;
  private readonly heartbeats: PgDocumentRepository<AgentHeartbeatRecord>;
  private readonly snapshots: PgDocumentRepository<AgentCapabilitySnapshot>;
  private readonly tasks: PgDocumentRepository<AgentTaskEnvelope>;
  private readonly taskLogs: PgDocumentRepository<AgentTaskLogEntry>;
  private readonly runtimeLogs: PgDocumentRepository<AgentRuntimeLogEntry>;
  private readonly taskLogCursors: PgDocumentRepository<AgentTaskLogCursorRecord>;
  private readonly releases: PgDocumentRepository<AgentVersionRelease>;
  private readonly upgradePlans: PgDocumentRepository<AgentUpgradePlan>;
  private readonly installSessions: PgDocumentRepository<AgentInstallSession>;

  constructor(db: DatabasePort = new PgliteDatabase()) {
    this.db = db;
    this.enrollmentTokens = new PgDocumentRepository(db, 'agents:enrollmentTokens');
    this.registrations = new PgDocumentRepository(db, 'agents:registrations');
    this.sessions = new PgDocumentRepository(db, 'agents:sessions');
    this.certificateAuthorities = new PgDocumentRepository(db, 'agents:certificateAuthorities');
    this.certificateSigningRequests = new PgDocumentRepository(db, 'agents:certificateSigningRequests');
    this.certificates = new PgDocumentRepository(db, 'agents:certificates');
    this.heartbeats = new PgDocumentRepository(db, 'agents:heartbeats');
    this.snapshots = new PgDocumentRepository(db, 'agents:snapshots');
    this.tasks = new PgDocumentRepository(db, 'agents:tasks');
    this.taskLogs = new PgDocumentRepository(db, 'agents:taskLogs');
    this.runtimeLogs = new PgDocumentRepository(db, 'agents:runtimeLogs');
    this.taskLogCursors = new PgDocumentRepository(db, 'agents:taskLogCursors');
    this.releases = new PgDocumentRepository(db, 'agents:releases');
    this.upgradePlans = new PgDocumentRepository(db, 'agents:upgradePlans');
    this.installSessions = new PgDocumentRepository(db, 'agents:installSessions');
  }

  async createEnrollmentToken(token: EnrollmentToken): Promise<EnrollmentToken> {
    return this.enrollmentTokens.upsert(token);
  }

  async updateEnrollmentToken(tokenId: string, patch: Partial<EnrollmentToken>): Promise<EnrollmentToken> {
    return this.enrollmentTokens.update(tokenId, patch);
  }

  async findEnrollmentTokenByHash(tenantId: string, tokenHash: string): Promise<EnrollmentToken | undefined> {
    return findDocument(this.db, 'agents:enrollmentTokens', `
      and payload->>'tenantId' = $2
      and payload->>'tokenHash' = $3
      limit 1`, [tenantId, tokenHash]);
  }

  async findEnrollmentTokenByHashAnyTenant(tokenHash: string): Promise<EnrollmentToken | undefined> {
    return findDocument(this.db, 'agents:enrollmentTokens', `
      and payload->>'tokenHash' = $2
      limit 1`, [tokenHash]);
  }

  async upsertRegistration(agent: AgentRegistration): Promise<AgentRegistration> {
    await this.db.transaction(async (tx) => {
      await upsertDocument(tx, 'agents:registrations', agent);
      await syncAgentHost(tx, agent);
    });
    return structuredClone(agent);
  }

  async updateRegistration(agentId: string, patch: Partial<AgentRegistration>): Promise<AgentRegistration> {
    const current = await this.registrations.getOrThrow(agentId);
    const updated = { ...current, ...structuredClone(patch), id: agentId };
    return this.upsertRegistration(updated);
  }

  async deleteRegistration(agentId: string): Promise<void> {
    const current = await this.registrations.get(agentId);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `delete from pg_documents where namespace = $1 and document_id = $2`,
        ['agents:registrations', agentId],
      );
      if (current) {
        await tx.query(
          `update pg_hosts
           set status = 'DELETED', deleted_at = now(), updated_at = now(), version = version + 1
           where tenant_id = $1 and agent_id = $2 and deleted_at is null`,
          [current.tenantId, agentId],
        );
      }
    });
  }

  async getRegistration(tenantId: string, agentId: string): Promise<AgentRegistration | undefined> {
    const row = await this.registrations.get(agentId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async findByAgentKey(tenantId: string, agentKey: string): Promise<AgentRegistration | undefined> {
    return findDocument(this.db, 'agents:registrations', `
      and payload->>'tenantId' = $2
      and payload->>'agentKey' = $3
      limit 1`, [tenantId, agentKey]);
  }

  async findByMachineId(tenantId: string, machineId: string): Promise<AgentRegistration | undefined> {
    return findDocument(this.db, 'agents:registrations', `
      and payload->>'tenantId' = $2
      and payload #>> '{descriptor,machineId}' = $3
      order by payload->>'updatedAt' desc, payload->>'registeredAt' asc
      limit 1`, [tenantId, machineId]);
  }

  async listRegistrations(tenantId: string, query: PageQuery): Promise<PageResponse<AgentRegistration>> {
    const rows = await listDocuments<AgentRegistration>(this.db, 'agents:registrations', `
      and payload->>'tenantId' = $2
      order by updated_at asc`, [tenantId]);
    const authorized = applyAuthorizationFilter(rows, query);
    return createPageResponse(authorized, query.page, query.pageSize, authorized.length);
  }

  async listAllRegistrations(): Promise<AgentRegistration[]> {
    return listDocuments(this.db, 'agents:registrations', 'order by updated_at asc');
  }

  async createSession(session: AgentSession): Promise<AgentSession> {
    return this.sessions.upsert(session);
  }

  async getSession(tenantId: string, sessionId: string): Promise<AgentSession | undefined> {
    const row = await this.sessions.get(sessionId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async saveCertificateAuthority(ca: AgentCertificateAuthority): Promise<AgentCertificateAuthority> {
    return this.certificateAuthorities.upsert({ ...ca, id: 'default' });
  }

  async getCertificateAuthority(): Promise<AgentCertificateAuthority | undefined> {
    return this.certificateAuthorities.get('default');
  }

  async createCertificateSigningRequest(csr: AgentCertificateSigningRequest): Promise<AgentCertificateSigningRequest> {
    return this.certificateSigningRequests.upsert(csr);
  }

  async updateCertificateSigningRequest(csrId: string, patch: Partial<AgentCertificateSigningRequest>): Promise<AgentCertificateSigningRequest> {
    return this.certificateSigningRequests.update(csrId, patch);
  }

  async getCertificateSigningRequest(tenantId: string, csrId: string): Promise<AgentCertificateSigningRequest | undefined> {
    const row = await this.certificateSigningRequests.get(csrId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async createCertificate(certificate: AgentCertificate): Promise<AgentCertificate> {
    return this.certificates.upsert(certificate);
  }

  async updateCertificate(certificateId: string, patch: Partial<AgentCertificate>): Promise<AgentCertificate> {
    return this.certificates.update(certificateId, patch);
  }

  async getCertificate(tenantId: string, certificateId: string): Promise<AgentCertificate | undefined> {
    const row = await this.certificates.get(certificateId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async findActiveCertificate(tenantId: string, agentId: string): Promise<AgentCertificate | undefined> {
    return (await this.listCertificates(tenantId, agentId)).find((item) => item.status === 'active');
  }

  async listCertificates(tenantId: string, agentId: string): Promise<AgentCertificate[]> {
    return listDocuments(this.db, 'agents:certificates', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3
      order by payload->>'issuedAt' desc`, [tenantId, agentId]);
  }

  async saveHeartbeat(heartbeat: AgentHeartbeat): Promise<AgentHeartbeat> {
    return this.heartbeats.upsert({
      ...heartbeat,
      id: heartbeatKey(heartbeat.tenantId, heartbeat.agentId),
      tenantId: heartbeat.tenantId,
      agentId: heartbeat.agentId,
    });
  }

  async getLatestHeartbeat(tenantId: string, agentId: string): Promise<AgentHeartbeat | undefined> {
    return findDocument(this.db, 'agents:heartbeats', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3
      order by payload->>'receivedAt' desc
      limit 1`, [tenantId, agentId]);
  }

  async saveCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): Promise<AgentCapabilitySnapshot> {
    const fullWeb = hasFullWebInventory(snapshot);
    await this.db.transaction(async (tx) => {
      await upsertDocument(tx, 'agents:snapshots', snapshot);
      await tx.query(
        `insert into pg_agent_capability_snapshot_current (
           tenant_id,
           agent_id,
           latest_snapshot_id,
           latest_reported_at,
           latest_full_web_snapshot_id,
           latest_full_web_reported_at,
           updated_at
         ) values ($1, $2, $3, $4::timestamptz, $5, $6::timestamptz, now())
         on conflict (tenant_id, agent_id) do update
           set latest_snapshot_id = case
                 when excluded.latest_reported_at >= pg_agent_capability_snapshot_current.latest_reported_at
                 then excluded.latest_snapshot_id
                 else pg_agent_capability_snapshot_current.latest_snapshot_id
               end,
               latest_reported_at = case
                 when excluded.latest_reported_at >= pg_agent_capability_snapshot_current.latest_reported_at
                 then excluded.latest_reported_at
                 else pg_agent_capability_snapshot_current.latest_reported_at
               end,
               latest_full_web_snapshot_id = case
                 when excluded.latest_full_web_snapshot_id is not null
                   and (
                     pg_agent_capability_snapshot_current.latest_full_web_reported_at is null
                     or excluded.latest_full_web_reported_at >= pg_agent_capability_snapshot_current.latest_full_web_reported_at
                   )
                 then excluded.latest_full_web_snapshot_id
                 else pg_agent_capability_snapshot_current.latest_full_web_snapshot_id
               end,
               latest_full_web_reported_at = case
                 when excluded.latest_full_web_snapshot_id is not null
                   and (
                     pg_agent_capability_snapshot_current.latest_full_web_reported_at is null
                     or excluded.latest_full_web_reported_at >= pg_agent_capability_snapshot_current.latest_full_web_reported_at
                   )
                 then excluded.latest_full_web_reported_at
                 else pg_agent_capability_snapshot_current.latest_full_web_reported_at
               end,
               updated_at = now()`,
        [
          snapshot.tenantId,
          snapshot.agentId,
          snapshot.id,
          snapshot.reportedAt,
          fullWeb ? snapshot.id : null,
          fullWeb ? snapshot.reportedAt : null,
        ],
      );
    });
    return structuredClone(snapshot);
  }

  async getLatestCapabilitySnapshot(tenantId: string, agentId: string): Promise<AgentCapabilitySnapshot | undefined> {
    const startedAt = Date.now();
    const projected = await this.db.query<DocumentRow<AgentCapabilitySnapshot>>(
      `select document.document_id, document.payload
         from pg_agent_capability_snapshot_current current
         join pg_documents document
           on document.namespace = 'agents:snapshots'
          and document.document_id = current.latest_snapshot_id
          and document.payload->>'tenantId' = current.tenant_id
          and document.payload->>'agentId' = current.agent_id
        where current.tenant_id = $1 and current.agent_id = $2
        limit 1`,
      [tenantId, agentId],
    );
    if (projected.rows[0]) {
      const snapshot = documentEntity(projected.rows[0]);
      observeSnapshotRead('current_projection', tenantId, agentId, startedAt, snapshot);
      return snapshot;
    }

    const result = await this.db.query<DocumentRow<AgentCapabilitySnapshot>>(
      `select document_id, payload
         from pg_documents
        where namespace = 'agents:snapshots'
          and payload->>'tenantId' = $1
          and payload->>'agentId' = $2
          and coalesce(payload->>'reportedAt', '') <> ''
        order by payload->>'reportedAt' desc, document_id desc
        limit 1`,
      [tenantId, agentId],
    );
    const snapshot = documentEntity(result.rows[0]);
    observeSnapshotRead('sql_fallback', tenantId, agentId, startedAt, snapshot);
    return snapshot;
  }

  async getLatestFullWebInventorySnapshot(tenantId: string, agentId: string): Promise<AgentCapabilitySnapshot | undefined> {
    const startedAt = Date.now();
    const projected = await this.db.query<DocumentRow<AgentCapabilitySnapshot>>(
      `select document.document_id, document.payload
         from pg_agent_capability_snapshot_current current
         join pg_documents document
           on document.namespace = 'agents:snapshots'
          and document.document_id = current.latest_full_web_snapshot_id
          and document.payload->>'tenantId' = current.tenant_id
          and document.payload->>'agentId' = current.agent_id
        where current.tenant_id = $1
          and current.agent_id = $2
          and current.latest_full_web_snapshot_id is not null
          and exists (
            select 1
              from jsonb_array_elements(coalesce(document.payload->'capabilities', '[]'::jsonb)) as capability
             where capability->>'capabilityKey' = 'web.inventory'
               and capability->'value'->>'scope' = 'FULL_WEB_DISCOVERY'
          )
        limit 1`,
      [tenantId, agentId],
    );
    if (projected.rows[0]) {
      const snapshot = documentEntity(projected.rows[0]);
      observeSnapshotRead('current_full_web_projection', tenantId, agentId, startedAt, snapshot);
      return snapshot;
    }

    const result = await this.db.query<DocumentRow<AgentCapabilitySnapshot>>(
      `select document_id, payload
         from pg_documents
        where namespace = 'agents:snapshots'
          and payload->>'tenantId' = $1
          and payload->>'agentId' = $2
          and coalesce(payload->>'reportedAt', '') <> ''
          and exists (
            select 1
              from jsonb_array_elements(coalesce(payload->'capabilities', '[]'::jsonb)) as capability
             where capability->>'capabilityKey' = 'web.inventory'
               and capability->'value'->>'scope' = 'FULL_WEB_DISCOVERY'
          )
        order by payload->>'reportedAt' desc, document_id desc
        limit 1`,
      [tenantId, agentId],
    );
    const snapshot = documentEntity(result.rows[0]);
    observeSnapshotRead('full_web_sql_fallback', tenantId, agentId, startedAt, snapshot);
    return snapshot;
  }

  async backfillCurrentSnapshotPointers(input: AgentSnapshotPointerBackfillInput = {}): Promise<AgentSnapshotPointerBackfillResult> {
    const limit = Math.min(500, Math.max(1, Math.trunc(input.limit ?? 100)));
    const result = await this.db.query<{ tenant_id: string; agent_id: string }>(
      `with candidates as (
             select distinct document.payload->>'tenantId' as tenant_id,
                             document.payload->>'agentId' as agent_id
               from pg_documents document
              where document.namespace = 'agents:snapshots'
                and coalesce(document.payload->>'tenantId', '') <> ''
                and coalesce(document.payload->>'agentId', '') <> ''
                and coalesce(document.payload->>'reportedAt', '') <> ''
                and ($1::text is null or document.payload->>'tenantId' = $1)
                and (
                  $2::text is null
                  or (document.payload->>'tenantId', document.payload->>'agentId') > ($2, $3)
                )
              order by tenant_id, agent_id
              limit $4
           ), ordinary as (
             select distinct on (document.payload->>'tenantId', document.payload->>'agentId')
                    document.payload->>'tenantId' as tenant_id,
                    document.payload->>'agentId' as agent_id,
                    document.document_id as snapshot_id,
                    (document.payload->>'reportedAt')::timestamptz as reported_at
               from pg_documents document
               join candidates on candidates.tenant_id = document.payload->>'tenantId'
                              and candidates.agent_id = document.payload->>'agentId'
              where document.namespace = 'agents:snapshots'
                and coalesce(document.payload->>'reportedAt', '') <> ''
              order by document.payload->>'tenantId',
                       document.payload->>'agentId',
                       document.payload->>'reportedAt' desc,
                       document.document_id desc
           ), full_web as (
             select distinct on (document.payload->>'tenantId', document.payload->>'agentId')
                    document.payload->>'tenantId' as tenant_id,
                    document.payload->>'agentId' as agent_id,
                    document.document_id as snapshot_id,
                    (document.payload->>'reportedAt')::timestamptz as reported_at
               from pg_documents document
               join candidates on candidates.tenant_id = document.payload->>'tenantId'
                              and candidates.agent_id = document.payload->>'agentId'
              where document.namespace = 'agents:snapshots'
                and coalesce(document.payload->>'reportedAt', '') <> ''
                and exists (
                  select 1
                    from jsonb_array_elements(coalesce(document.payload->'capabilities', '[]'::jsonb)) as capability
                   where capability->>'capabilityKey' = 'web.inventory'
                     and capability->'value'->>'scope' = 'FULL_WEB_DISCOVERY'
                )
              order by document.payload->>'tenantId',
                       document.payload->>'agentId',
                       document.payload->>'reportedAt' desc,
                       document.document_id desc
           ), upserted as (
             insert into pg_agent_capability_snapshot_current (
               tenant_id,
               agent_id,
               latest_snapshot_id,
               latest_reported_at,
               latest_full_web_snapshot_id,
               latest_full_web_reported_at,
               updated_at
             )
             select ordinary.tenant_id,
                    ordinary.agent_id,
                    ordinary.snapshot_id,
                    ordinary.reported_at,
                    full_web.snapshot_id,
                    full_web.reported_at,
                    now()
               from ordinary
               left join full_web using (tenant_id, agent_id)
             on conflict (tenant_id, agent_id) do update
               set latest_snapshot_id = case
                     when excluded.latest_reported_at >= pg_agent_capability_snapshot_current.latest_reported_at
                     then excluded.latest_snapshot_id
                     else pg_agent_capability_snapshot_current.latest_snapshot_id
                   end,
                   latest_reported_at = case
                     when excluded.latest_reported_at >= pg_agent_capability_snapshot_current.latest_reported_at
                     then excluded.latest_reported_at
                     else pg_agent_capability_snapshot_current.latest_reported_at
                   end,
                   latest_full_web_snapshot_id = case
                     when excluded.latest_full_web_snapshot_id is not null
                       and (
                         pg_agent_capability_snapshot_current.latest_full_web_reported_at is null
                         or excluded.latest_full_web_reported_at >= pg_agent_capability_snapshot_current.latest_full_web_reported_at
                       )
                     then excluded.latest_full_web_snapshot_id
                     else pg_agent_capability_snapshot_current.latest_full_web_snapshot_id
                   end,
                   latest_full_web_reported_at = case
                     when excluded.latest_full_web_snapshot_id is not null
                       and (
                         pg_agent_capability_snapshot_current.latest_full_web_reported_at is null
                         or excluded.latest_full_web_reported_at >= pg_agent_capability_snapshot_current.latest_full_web_reported_at
                       )
                     then excluded.latest_full_web_reported_at
                     else pg_agent_capability_snapshot_current.latest_full_web_reported_at
                   end,
                   updated_at = now()
             returning tenant_id, agent_id
           )
           select tenant_id, agent_id
             from upserted
            order by tenant_id, agent_id`,
      [
        input.tenantId ?? null,
        input.after?.tenantId ?? null,
        input.after?.agentId ?? null,
        limit,
      ],
    );
    const last = result.rows[result.rows.length - 1];
    return {
      processed: result.rows.length,
      next: result.rows.length === limit && last ? { tenantId: last.tenant_id, agentId: last.agent_id } : undefined,
    };
  }

  async createTask(task: AgentTaskEnvelope): Promise<AgentTaskEnvelope> {
    return this.tasks.upsert(task);
  }

  async updateTask(taskId: string, patch: Partial<AgentTaskEnvelope>): Promise<AgentTaskEnvelope> {
    return this.tasks.update(taskId, patch);
  }

  async claimQueuedTask(taskId: string, agentId: string, leaseId: string, ackedAt: string): Promise<AgentTaskEnvelope | undefined> {
    // 用带状态条件的 UPDATE 抢占任务，避免并发 ack 先读后写导致 lease 互相覆盖。
    await this.tasks.get(taskId);
    const result = await this.db.query<{ document_id: string; payload: AgentTaskEnvelope }>(
      `update pg_documents
          set payload = payload || $3::jsonb,
              updated_at = now()
        where namespace = 'agents:tasks'
          and document_id = $1
          and payload->>'agentId' = $2
          and payload->>'status' = 'queued'
      returning document_id, payload`,
      [taskId, agentId, JSON.stringify({ status: 'acked', leaseId, ackedAt })],
    );
    const row = result.rows[0];
    return row ? structuredClone({ ...row.payload, id: row.document_id }) : undefined;
  }

  async getTask(tenantId: string, taskId: string): Promise<AgentTaskEnvelope | undefined> {
    const row = await this.tasks.get(taskId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async findTaskByIdempotencyKey(tenantId: string, agentId: string, idempotencyKey: string): Promise<AgentTaskEnvelope | undefined> {
    return findDocument(this.db, 'agents:tasks', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3
      and payload->>'idempotencyKey' = $4
      order by payload->>'createdAt' asc
      limit 1`, [tenantId, agentId, idempotencyKey]);
  }

  async listTasks(tenantId: string, agentId: string, statuses?: string[]): Promise<AgentTaskEnvelope[]> {
    const activeStatuses = uniqueStrings(statuses);
    return listDocuments(this.db, 'agents:tasks', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3
      ${activeStatuses.length > 0 ? `and payload->>'status' = any($4::text[])` : ''}
      order by payload->>'createdAt' asc`, activeStatuses.length > 0
      ? [tenantId, agentId, activeStatuses]
      : [tenantId, agentId]);
  }

  async saveTaskLog(entry: AgentTaskLogEntry): Promise<AgentTaskLogEntry> {
    const existing = await this.taskLogs.get(entry.id);
    if (existing) return existing;
    return this.taskLogs.upsert(entry);
  }

  async saveRuntimeLog(entry: AgentRuntimeLogEntry): Promise<AgentRuntimeLogEntry> {
    const existing = await this.runtimeLogs.get(entry.id);
    if (existing) return existing;
    return this.runtimeLogs.upsert(entry);
  }

  async saveTaskLogCursor(cursor: AgentTaskLogCursor): Promise<AgentTaskLogCursor> {
    return this.taskLogCursors.upsert({ ...cursor, id: logCursorKey(cursor.tenantId, cursor.agentId, cursor.taskId) });
  }

  async getTaskLogCursor(tenantId: string, agentId: string, taskId: string): Promise<AgentTaskLogCursor | undefined> {
    const row = await this.taskLogCursors.get(logCursorKey(tenantId, agentId, taskId));
    return row?.tenantId === tenantId ? row : undefined;
  }

  async listTaskLogs(tenantId: string, taskId: string): Promise<AgentTaskLogEntry[]> {
    return listDocuments(this.db, 'agents:taskLogs', `
      and payload->>'tenantId' = $2
      and payload->>'taskId' = $3
      order by case when payload->>'sequence' ~ '^[0-9]+$' then (payload->>'sequence')::int else 0 end asc,
               payload->>'emittedAt' asc`, [tenantId, taskId]);
  }

  async listAgentTaskLogs(tenantId: string, agentId: string, levels?: AgentTaskLogEntry['level'][]): Promise<AgentTaskLogEntry[]> {
    const activeLevels = uniqueStrings(levels);
    return listDocuments(this.db, 'agents:taskLogs', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3
      ${activeLevels.length > 0 ? `and payload->>'level' = any($4::text[])` : ''}
      order by payload->>'emittedAt' desc,
               case when payload->>'sequence' ~ '^[0-9]+$' then (payload->>'sequence')::int else 0 end desc`, activeLevels.length > 0
      ? [tenantId, agentId, activeLevels]
      : [tenantId, agentId]);
  }

  async listAgentRuntimeLogs(tenantId: string, agentId: string, categories?: AgentRuntimeLogEntry['category'][]): Promise<AgentRuntimeLogEntry[]> {
    const activeCategories = uniqueStrings(categories);
    return listDocuments(this.db, 'agents:runtimeLogs', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3
      ${activeCategories.length > 0 ? `and payload->>'category' = any($4::text[])` : ''}
      order by payload->>'emittedAt' desc`, activeCategories.length > 0
      ? [tenantId, agentId, activeCategories]
      : [tenantId, agentId]);
  }

  async getDetailData(tenantId: string, agentId: string, options: { includeLogs?: boolean } = {}): Promise<AgentDetailData | undefined> {
    const includeLogs = options.includeLogs !== false;
    const [registration, snapshots, heartbeats, tasks, recentErrors, runtimeLogs, recentTaskLogs, releases, upgradePlans] = await Promise.all([
      this.db.query<DocumentRow<AgentRegistration>>(
        `select document_id, payload from pg_documents
          where namespace='agents:registrations' and document_id=$1 and payload->>'tenantId'=$2`,
        [agentId, tenantId],
      ),
      this.db.query<DocumentRow<AgentCapabilitySnapshot>>(
        `select document_id, payload from pg_documents
          where namespace='agents:snapshots' and payload->>'tenantId'=$1 and payload->>'agentId'=$2
          order by payload->>'reportedAt' desc limit 1`,
        [tenantId, agentId],
      ),
      this.db.query<DocumentRow<AgentHeartbeat>>(
        `select document_id, payload from pg_documents
          where namespace='agents:heartbeats' and payload->>'tenantId'=$1 and payload->>'agentId'=$2
          order by payload->>'receivedAt' desc limit 1`,
        [tenantId, agentId],
      ),
      this.db.query<DocumentRow<AgentTaskEnvelope>>(
        `select document_id, payload from pg_documents
          where namespace='agents:tasks' and payload->>'tenantId'=$1 and payload->>'agentId'=$2
          order by payload->>'createdAt' asc`,
        [tenantId, agentId],
      ),
      includeLogs ? this.db.query<DocumentRow<AgentTaskLogEntry>>(
        `select document_id, payload from pg_documents
          where namespace='agents:taskLogs' and payload->>'tenantId'=$1 and payload->>'agentId'=$2 and payload->>'level'='error'
          order by payload->>'emittedAt' desc, (payload->>'sequence')::int desc limit 10`,
        [tenantId, agentId],
      ) : Promise.resolve({ rows: [] as DocumentRow<AgentTaskLogEntry>[] }),
      includeLogs ? this.db.query<DocumentRow<AgentRuntimeLogEntry>>(
        `select document_id, payload from pg_documents
          where namespace='agents:runtimeLogs' and payload->>'tenantId'=$1 and payload->>'agentId'=$2
          order by payload->>'emittedAt' desc limit 50`,
        [tenantId, agentId],
      ) : Promise.resolve({ rows: [] as DocumentRow<AgentRuntimeLogEntry>[] }),
      includeLogs ? this.db.query<DocumentRow<AgentTaskLogEntry>>(
        `select document_id, payload from pg_documents
          where namespace='agents:taskLogs' and payload->>'tenantId'=$1 and payload->>'agentId'=$2
          order by payload->>'emittedAt' desc, (payload->>'sequence')::int desc limit 50`,
        [tenantId, agentId],
      ) : Promise.resolve({ rows: [] as DocumentRow<AgentTaskLogEntry>[] }),
      this.db.query<DocumentRow<AgentVersionRelease>>(
        `select document_id, payload from pg_documents
          where namespace='agents:versions' and payload->>'tenantId'=$1 and payload->>'status'='active'
          order by payload->>'version' desc`,
        [tenantId],
      ),
      this.db.query<DocumentRow<AgentUpgradePlan>>(
        `select document_id, payload from pg_documents
          where namespace='agents:upgradePlans' and payload->>'tenantId'=$1 and payload->>'agentId'=$2`,
        [tenantId, agentId],
      ),
    ]);
    const agent = documentEntity(registration.rows[0]);
    if (!agent) return undefined;
    return {
      agent,
      capabilitySnapshot: documentEntity(snapshots.rows[0]),
      latestHeartbeat: documentEntity(heartbeats.rows[0]),
      tasks: tasks.rows.map(documentEntity).filter(isDefined),
      recentErrors: recentErrors.rows.map(documentEntity).filter(isDefined),
      runtimeLogs: runtimeLogs.rows.map(documentEntity).filter(isDefined),
      recentTaskLogs: recentTaskLogs.rows.map(documentEntity).filter(isDefined),
      releases: releases.rows.map(documentEntity).filter(isDefined),
      upgradePlans: upgradePlans.rows.map(documentEntity).filter(isDefined),
    };
  }

  async publishVersion(release: AgentVersionRelease): Promise<AgentVersionRelease> {
    return this.releases.upsert(release);
  }

  async listActiveVersions(tenantId: string): Promise<AgentVersionRelease[]> {
    return (await listDocuments<AgentVersionRelease>(this.db, 'agents:versions', `
      and payload->>'tenantId' = $2
      and payload->>'status' = 'active'`, [tenantId]))
      .sort((left, right) => compareVersions(right.version, left.version));
  }

  async createUpgradePlan(plan: AgentUpgradePlan): Promise<AgentUpgradePlan> {
    return this.upgradePlans.upsert(plan);
  }

  async updateUpgradePlan(planId: string, patch: Partial<AgentUpgradePlan>): Promise<AgentUpgradePlan> {
    return this.upgradePlans.update(planId, patch);
  }

  async getUpgradePlan(tenantId: string, planId: string): Promise<AgentUpgradePlan | undefined> {
    const row = await this.upgradePlans.get(planId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async findUpgradePlanForAgent(tenantId: string, agentId: string, releaseId: string): Promise<AgentUpgradePlan | undefined> {
    return findDocument(this.db, 'agents:upgradePlans', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3
      and payload->>'releaseId' = $4
      limit 1`, [tenantId, agentId, releaseId]);
  }

  async listUpgradePlansForAgent(tenantId: string, agentId: string): Promise<AgentUpgradePlan[]> {
    return (await listDocuments<AgentUpgradePlan>(this.db, 'agents:upgradePlans', `
      and payload->>'tenantId' = $2
      and payload->>'agentId' = $3`, [tenantId, agentId]))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createInstallSession(session: AgentInstallSession): Promise<AgentInstallSession> {
    return this.installSessions.upsert(session);
  }

  async getInstallSession(tenantId: string, sessionId: string): Promise<AgentInstallSession | undefined> {
    const row = await this.installSessions.get(sessionId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async findInstallSessionByTokenHashAnyTenant(tokenHash: string): Promise<AgentInstallSession | undefined> {
    return findDocument(this.db, 'agents:installSessions', `
      and payload->>'bootstrapTokenHash' = $2
      limit 1`, [tokenHash]);
  }

  async consumeInstallSessionByTokenHash(tokenHash: string, usedAt: string, usedByIp?: string): Promise<AgentInstallSession | undefined> {
    const result = await this.db.query<{ document_id: string; payload: AgentInstallSession }>(
      `update pg_documents
          set payload =
            jsonb_set(
              jsonb_set(payload, '{usedAt}', to_jsonb($3::text), true),
              '{usedByIp}',
              to_jsonb($4::text),
              true
            ),
              updated_at = now()
        where namespace = $1
          and payload->>'bootstrapTokenHash' = $2
          and coalesce(payload->>'usedAt', '') = ''
          and (payload->>'expiresAt')::timestamptz >= now()
        returning document_id, payload`,
      ['agents:installSessions', tokenHash, usedAt, usedByIp ?? null],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return structuredClone({ ...row.payload, id: row.document_id });
  }

}

interface DocumentRow<T> extends Record<string, unknown> {
  document_id: string;
  payload: T;
}

function documentEntity<T>(row: DocumentRow<T> | undefined): (T & IdentifiedEntity) | undefined {
  return row ? structuredClone({ ...row.payload, id: row.document_id }) : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** 中文说明：高基数 JSONB 命名空间必须先在数据库按领域键过滤，再反序列化实际返回的行。 */
async function listDocuments<T>(
  db: DatabasePort,
  namespace: string,
  clause = '',
  params: readonly unknown[] = [],
): Promise<Array<T & IdentifiedEntity>> {
  const rows = await db.query<DocumentRow<T>>(
    `select document_id, payload
       from pg_documents
      where namespace = $1
      ${clause}`,
    [namespace, ...params],
  );
  return rows.rows.map(documentEntity).filter(isDefined);
}

async function findDocument<T>(
  db: DatabasePort,
  namespace: string,
  clause: string,
  params: readonly unknown[] = [],
): Promise<(T & IdentifiedEntity) | undefined> {
  return (await listDocuments<T>(db, namespace, clause, params))[0];
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function observeSnapshotRead(
  path: 'current_projection' | 'sql_fallback' | 'current_full_web_projection' | 'full_web_sql_fallback',
  tenantId: string,
  agentId: string,
  startedAt: number,
  snapshot: AgentCapabilitySnapshot | undefined,
): void {
  const durationMs = Date.now() - startedAt;
  const threshold = Number(process.env.GCAC_PERFORMANCE_SLOW_QUERY_MS ?? 250);
  if (!Number.isFinite(threshold) || durationMs < Math.max(0, threshold)) return;
  const payloadBytes = snapshot ? Buffer.byteLength(JSON.stringify(snapshot), 'utf8') : 0;
  structuredLogger.warn('Agent 快照精确查询超过性能阈值', {
    operation: 'agent.snapshot.latest',
    path,
    durationMs,
    returnedRows: snapshot ? 1 : 0,
    payloadBytes,
  }, { module: 'agents', tenantId, resourceType: 'agent', resourceId: agentId });
}

async function upsertDocument<T extends IdentifiedEntity>(db: DatabasePort, namespace: string, entity: T): Promise<void> {
  await db.query(
    `insert into pg_documents (namespace, document_id, payload, updated_at)
     values ($1, $2, $3::jsonb, now())
     on conflict (namespace, document_id)
     do update set payload = excluded.payload, updated_at = excluded.updated_at`,
    [namespace, entity.id, JSON.stringify(entity)],
  );
}

async function syncAgentHost(db: DatabasePort, agent: AgentRegistration): Promise<void> {
  const descriptor = agent.descriptor;
  const hostId = `host_${agent.id}`;
  const candidate = (await db.query<{ id: string }>(
    `select id
     from pg_hosts
     where tenant_id = $1
       and (
         id = $2
         or (
           deleted_at is null
           and (
             agent_id = $3
             or ($4::text is not null and asset_fingerprint = $4)
             or ($5::text is not null and lower(hostname) = lower($5))
             or ($6::text is not null and primary_ip = $6)
           )
         )
       )
     order by
       case
         when id = $2 then 0
         when agent_id = $3 then 1
         when $4::text is not null and asset_fingerprint = $4 then 2
         when $5::text is not null and lower(hostname) = lower($5) then 3
         else 4
       end
     limit 1`,
    [agent.tenantId, hostId, agent.id, descriptor.machineId ?? null, descriptor.hostname || null, descriptor.ipAddress ?? null],
  )).rows[0];
  const osName = resolveAgentOsName(descriptor.osType, descriptor.linuxDistribution);
  const status = mapAgentHostStatus(agent.status);
  const ipAddresses = descriptor.ipAddress ? [descriptor.ipAddress] : [];

  if (candidate) {
    await db.query(
      `update pg_hosts
       set hostname = coalesce(hostname, $1),
           display_name = coalesce(display_name, $1),
           primary_ip = coalesce($2, primary_ip),
           ip_addresses = case when $2::text is not null then $3::jsonb else ip_addresses end,
           os_type = $4,
           os_name = $5,
           os_version = $6,
           arch = $7,
           zone_id = coalesce($8, zone_id),
           management_channels = '["AGENT"]'::jsonb,
           discovery_source = 'AGENT',
           last_discovered_at = $9::timestamptz,
           agent_id = $10,
           asset_fingerprint = coalesce(asset_fingerprint, $11),
           management_mode = 'AGENT',
           status = $12,
           tags = $13::jsonb,
           updated_at = $9::timestamptz,
           deleted_at = null,
           version = version + 1
       where id = $14 and tenant_id = $15`,
      [
        descriptor.hostname,
        descriptor.ipAddress ?? null,
        JSON.stringify(ipAddresses),
        descriptor.osType,
        osName,
        descriptor.osVersion ?? null,
        descriptor.arch ?? null,
        agent.zone ?? null,
        agent.updatedAt,
        agent.id,
        descriptor.machineId ?? null,
        status,
        JSON.stringify(descriptor.labels),
        candidate.id,
        agent.tenantId,
      ],
    );
    return;
  }

  await db.query(
    `insert into pg_hosts (
       id, tenant_id, hostname, display_name, primary_ip, ip_addresses, os_type, os_name, os_version, arch,
       zone_id, management_channels, discovery_source, last_discovered_at, agent_id, asset_fingerprint,
       compatibility_level, management_mode, status, tags, created_at, updated_at, version
     ) values (
       $1, $2, $3, $3, $4, $5::jsonb, $6, $7, $8, $9,
       $10, '["AGENT"]'::jsonb, 'AGENT', $11::timestamptz, $12, $13,
       'L1', 'AGENT', $14, $15::jsonb, $16::timestamptz, $11::timestamptz, 1
     )`,
    [
      hostId,
      agent.tenantId,
      descriptor.hostname,
      descriptor.ipAddress ?? null,
      JSON.stringify(ipAddresses),
      descriptor.osType,
      osName,
      descriptor.osVersion ?? null,
      descriptor.arch ?? null,
      agent.zone ?? null,
      agent.updatedAt,
      agent.id,
      descriptor.machineId ?? null,
      status,
      JSON.stringify(descriptor.labels),
      agent.registeredAt,
    ],
  );
}

function resolveAgentOsName(osType: string, linuxDistribution?: string): string {
  const names: Readonly<Record<string, string>> = {
    WINDOWS: 'Windows Server',
    LINUX: linuxDistribution ?? 'Linux Server',
  };
  return names[osType] ?? osType;
}

function mapAgentHostStatus(status: AgentRegistration['status']): 'ACTIVE' | 'INACTIVE' | 'DISABLED' | 'UNKNOWN' {
  if (status === 'ONLINE' || status === 'UPGRADING') return 'ACTIVE';
  if (status === 'OFFLINE') return 'INACTIVE';
  if (status === 'DISABLED') return 'DISABLED';
  return 'UNKNOWN';
}
