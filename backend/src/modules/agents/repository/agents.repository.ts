import { applyAuthorizationFilter, type PageQuery } from '../../../common/pagination/pagination.js';
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
  publishVersion(release: AgentVersionRelease): Promise<AgentVersionRelease>;
  listActiveVersions(tenantId: string): Promise<AgentVersionRelease[]>;
  createUpgradePlan(plan: AgentUpgradePlan): Promise<AgentUpgradePlan>;
  updateUpgradePlan(planId: string, patch: Partial<AgentUpgradePlan>): Promise<AgentUpgradePlan>;
  getUpgradePlan(tenantId: string, planId: string): Promise<AgentUpgradePlan | undefined>;
  findUpgradePlanForAgent(tenantId: string, agentId: string, releaseId: string): Promise<AgentUpgradePlan | undefined>;
  listUpgradePlansForAgent(tenantId: string, agentId: string): Promise<AgentUpgradePlan[]>;
  createInstallSession(session: AgentInstallSession): Promise<AgentInstallSession>;
  updateInstallSession(sessionId: string, patch: Partial<AgentInstallSession>): Promise<AgentInstallSession>;
  getInstallSession(tenantId: string, sessionId: string): Promise<AgentInstallSession | undefined>;
  findInstallSessionByTokenHash(tenantId: string, tokenHash: string): Promise<AgentInstallSession | undefined>;
  findInstallSessionByTokenHashAnyTenant(tokenHash: string): Promise<AgentInstallSession | undefined>;
  consumeInstallSessionByTokenHash(tokenHash: string, usedAt: string, usedByIp?: string, tenantId?: string): Promise<AgentInstallSession | undefined>;
}

type AgentHeartbeatRecord = AgentHeartbeat & IdentifiedEntity;
type AgentTaskLogCursorRecord = AgentTaskLogCursor & IdentifiedEntity;

function logCursorKey(tenantId: string, agentId: string, taskId: string): string {
  return `${tenantId}:${agentId}:${taskId}`;
}

function heartbeatKey(tenantId: string, agentId: string): string {
  return `${tenantId}:${agentId}`;
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
    return (await this.enrollmentTokens.list((item) => item.tenantId === tenantId && item.tokenHash === tokenHash))[0];
  }

  async findEnrollmentTokenByHashAnyTenant(tokenHash: string): Promise<EnrollmentToken | undefined> {
    return (await this.enrollmentTokens.list((item) => item.tokenHash === tokenHash))[0];
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
    return (await this.registrations.list((item) => item.tenantId === tenantId && item.agentKey === agentKey))[0];
  }

  async findByMachineId(tenantId: string, machineId: string): Promise<AgentRegistration | undefined> {
    return (await this.registrations.list((item) => item.tenantId === tenantId && item.descriptor.machineId === machineId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.registeredAt.localeCompare(right.registeredAt))[0];
  }

  async listRegistrations(tenantId: string, query: PageQuery): Promise<PageResponse<AgentRegistration>> {
    const rows = await this.registrations.list((item) => item.tenantId === tenantId);
    const authorized = applyAuthorizationFilter(rows, query);
    return createPageResponse(authorized, query.page, query.pageSize, authorized.length);
  }

  async listAllRegistrations(): Promise<AgentRegistration[]> {
    return this.registrations.list(() => true);
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
    return this.certificates
      .list((item) => item.tenantId === tenantId && item.agentId === agentId)
      .then((rows) => rows.sort((left, right) => right.issuedAt.localeCompare(left.issuedAt)));
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
    return (await this.heartbeats.list((item) => item.tenantId === tenantId && item.agentId === agentId))
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))[0];
  }

  async saveCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): Promise<AgentCapabilitySnapshot> {
    return this.snapshots.upsert(snapshot);
  }

  async getLatestCapabilitySnapshot(tenantId: string, agentId: string): Promise<AgentCapabilitySnapshot | undefined> {
    return (await this.snapshots.list((item) => item.tenantId === tenantId && item.agentId === agentId))
      .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt))[0];
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
    return (await this.tasks.list((item) => item.tenantId === tenantId && item.agentId === agentId && item.idempotencyKey === idempotencyKey))[0];
  }

  async listTasks(tenantId: string, agentId: string, statuses?: string[]): Promise<AgentTaskEnvelope[]> {
    return (await this.tasks.list((item) => item.tenantId === tenantId && item.agentId === agentId && (!statuses?.length || statuses.includes(item.status))))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
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
    return (await this.taskLogs.list((item) => item.tenantId === tenantId && item.taskId === taskId))
      .sort((left, right) => left.sequence - right.sequence);
  }

  async listAgentTaskLogs(tenantId: string, agentId: string, levels?: AgentTaskLogEntry['level'][]): Promise<AgentTaskLogEntry[]> {
    return (await this.taskLogs.list((item) => item.tenantId === tenantId && item.agentId === agentId && (!levels?.length || levels.includes(item.level))))
      .sort((left, right) => right.emittedAt.localeCompare(left.emittedAt) || right.sequence - left.sequence);
  }

  async listAgentRuntimeLogs(tenantId: string, agentId: string, categories?: AgentRuntimeLogEntry['category'][]): Promise<AgentRuntimeLogEntry[]> {
    return (await this.runtimeLogs.list((item) => item.tenantId === tenantId && item.agentId === agentId && (!categories?.length || categories.includes(item.category))))
      .sort((left, right) => right.emittedAt.localeCompare(left.emittedAt));
  }

  async publishVersion(release: AgentVersionRelease): Promise<AgentVersionRelease> {
    return this.releases.upsert(release);
  }

  async listActiveVersions(tenantId: string): Promise<AgentVersionRelease[]> {
    return (await this.releases.list((item) => item.tenantId === tenantId && item.status === 'active'))
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
    return (await this.upgradePlans.list((item) => item.tenantId === tenantId && item.agentId === agentId && item.releaseId === releaseId))[0];
  }

  async listUpgradePlansForAgent(tenantId: string, agentId: string): Promise<AgentUpgradePlan[]> {
    return (await this.upgradePlans.list((item) => item.tenantId === tenantId && item.agentId === agentId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async createInstallSession(session: AgentInstallSession): Promise<AgentInstallSession> {
    return this.installSessions.upsert(session);
  }

  async updateInstallSession(sessionId: string, patch: Partial<AgentInstallSession>): Promise<AgentInstallSession> {
    return this.installSessions.update(sessionId, patch);
  }

  async getInstallSession(tenantId: string, sessionId: string): Promise<AgentInstallSession | undefined> {
    const row = await this.installSessions.get(sessionId);
    return row?.tenantId === tenantId ? row : undefined;
  }

  async findInstallSessionByTokenHash(tenantId: string, tokenHash: string): Promise<AgentInstallSession | undefined> {
    return (await this.installSessions.list((item) => item.tenantId === tenantId && item.bootstrapTokenHash === tokenHash))[0];
  }

  async findInstallSessionByTokenHashAnyTenant(tokenHash: string): Promise<AgentInstallSession | undefined> {
    return (await this.installSessions.list((item) => item.bootstrapTokenHash === tokenHash))[0];
  }

  async consumeInstallSessionByTokenHash(tokenHash: string, usedAt: string, usedByIp?: string, tenantId?: string): Promise<AgentInstallSession | undefined> {
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
          and ($5::text is null or payload->>'tenantId' = $5)
          and coalesce(payload->>'usedAt', '') = ''
          and (payload->>'expiresAt')::timestamptz >= now()
        returning document_id, payload`,
      ['agents:installSessions', tokenHash, usedAt, usedByIp ?? null, tenantId ?? null],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return structuredClone({ ...row.payload, id: row.document_id });
  }
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
