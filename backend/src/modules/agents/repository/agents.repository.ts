import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { PageResponse } from '../../../shared/dto/page-response.js';
import { createPageResponse } from '../../../shared/dto/page-response.js';
import type { AgentCapabilitySnapshot, AgentCertificate, AgentCertificateAuthority, AgentCertificateSigningRequest, AgentHeartbeat, AgentRegistration, AgentSession, AgentTaskEnvelope, AgentTaskLogCursor, AgentTaskLogEntry, AgentUpgradePlan, AgentVersionRelease, EnrollmentToken } from '../schema/agents.schema.js';

export interface AgentsRepository {
  readonly moduleName: 'agents';
  createEnrollmentToken(token: EnrollmentToken): EnrollmentToken;
  updateEnrollmentToken(tokenId: string, patch: Partial<EnrollmentToken>): EnrollmentToken;
  findEnrollmentTokenByHash(tenantId: string, tokenHash: string): EnrollmentToken | undefined;
  upsertRegistration(agent: AgentRegistration): AgentRegistration;
  updateRegistration(agentId: string, patch: Partial<AgentRegistration>): AgentRegistration;
  getRegistration(tenantId: string, agentId: string): AgentRegistration | undefined;
  findByAgentKey(tenantId: string, agentKey: string): AgentRegistration | undefined;
  listRegistrations(tenantId: string, query: PageQuery): PageResponse<AgentRegistration>;
  createSession(session: AgentSession): AgentSession;
  getSession(tenantId: string, sessionId: string): AgentSession | undefined;
  saveCertificateAuthority(ca: AgentCertificateAuthority): AgentCertificateAuthority;
  getCertificateAuthority(): AgentCertificateAuthority | undefined;
  createCertificateSigningRequest(csr: AgentCertificateSigningRequest): AgentCertificateSigningRequest;
  updateCertificateSigningRequest(csrId: string, patch: Partial<AgentCertificateSigningRequest>): AgentCertificateSigningRequest;
  getCertificateSigningRequest(tenantId: string, csrId: string): AgentCertificateSigningRequest | undefined;
  createCertificate(certificate: AgentCertificate): AgentCertificate;
  updateCertificate(certificateId: string, patch: Partial<AgentCertificate>): AgentCertificate;
  getCertificate(tenantId: string, certificateId: string): AgentCertificate | undefined;
  findActiveCertificate(tenantId: string, agentId: string): AgentCertificate | undefined;
  listCertificates(tenantId: string, agentId: string): AgentCertificate[];
  saveHeartbeat(heartbeat: AgentHeartbeat): AgentHeartbeat;
  getLatestHeartbeat(tenantId: string, agentId: string): AgentHeartbeat | undefined;
  saveCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): AgentCapabilitySnapshot;
  getLatestCapabilitySnapshot(tenantId: string, agentId: string): AgentCapabilitySnapshot | undefined;
  createTask(task: AgentTaskEnvelope): AgentTaskEnvelope;
  updateTask(taskId: string, patch: Partial<AgentTaskEnvelope>): AgentTaskEnvelope;
  getTask(tenantId: string, taskId: string): AgentTaskEnvelope | undefined;
  findTaskByIdempotencyKey(tenantId: string, agentId: string, idempotencyKey: string): AgentTaskEnvelope | undefined;
  listTasks(tenantId: string, agentId: string, statuses?: string[]): AgentTaskEnvelope[];
  saveTaskLog(entry: AgentTaskLogEntry): AgentTaskLogEntry;
  saveTaskLogCursor(cursor: AgentTaskLogCursor): AgentTaskLogCursor;
  getTaskLogCursor(tenantId: string, agentId: string, taskId: string): AgentTaskLogCursor | undefined;
  listTaskLogs(tenantId: string, taskId: string): AgentTaskLogEntry[];
  listAgentTaskLogs(tenantId: string, agentId: string, levels?: AgentTaskLogEntry['level'][]): AgentTaskLogEntry[];
  publishVersion(release: AgentVersionRelease): AgentVersionRelease;
  listActiveVersions(tenantId: string): AgentVersionRelease[];
  createUpgradePlan(plan: AgentUpgradePlan): AgentUpgradePlan;
  updateUpgradePlan(planId: string, patch: Partial<AgentUpgradePlan>): AgentUpgradePlan;
  getUpgradePlan(tenantId: string, planId: string): AgentUpgradePlan | undefined;
  findUpgradePlanForAgent(tenantId: string, agentId: string, releaseId: string): AgentUpgradePlan | undefined;
  listUpgradePlansForAgent(tenantId: string, agentId: string): AgentUpgradePlan[];
}

export class InMemoryAgentsRepository implements AgentsRepository {
  readonly moduleName = 'agents' as const;
  private readonly enrollmentTokens = new Map<string, EnrollmentToken>();
  private readonly registrations = new Map<string, AgentRegistration>();
  private readonly sessions = new Map<string, AgentSession>();
  private certificateAuthority?: AgentCertificateAuthority;
  private readonly certificateSigningRequests = new Map<string, AgentCertificateSigningRequest>();
  private readonly certificates = new Map<string, AgentCertificate>();
  private readonly heartbeats: AgentHeartbeat[] = [];
  private readonly snapshots = new Map<string, AgentCapabilitySnapshot>();
  private readonly tasks = new Map<string, AgentTaskEnvelope>();
  private readonly taskLogs: AgentTaskLogEntry[] = [];
  private readonly taskLogCursors = new Map<string, AgentTaskLogCursor>();
  private readonly releases = new Map<string, AgentVersionRelease>();
  private readonly upgradePlans = new Map<string, AgentUpgradePlan>();

  createEnrollmentToken(token: EnrollmentToken): EnrollmentToken {
    this.enrollmentTokens.set(token.id, token);
    return token;
  }

  updateEnrollmentToken(tokenId: string, patch: Partial<EnrollmentToken>): EnrollmentToken {
    const current = this.enrollmentTokens.get(tokenId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '注册令牌不存在', { tokenId });
    const updated = { ...current, ...patch };
    this.enrollmentTokens.set(updated.id, updated);
    return updated;
  }

  findEnrollmentTokenByHash(tenantId: string, tokenHash: string): EnrollmentToken | undefined {
    return [...this.enrollmentTokens.values()].find((item) => item.tenantId === tenantId && item.tokenHash === tokenHash);
  }

  upsertRegistration(agent: AgentRegistration): AgentRegistration {
    this.registrations.set(agent.id, agent);
    return agent;
  }

  updateRegistration(agentId: string, patch: Partial<AgentRegistration>): AgentRegistration {
    const current = this.registrations.get(agentId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 不存在', { agentId });
    const updated = { ...current, ...patch, version: current.version + 1 };
    this.registrations.set(updated.id, updated);
    return updated;
  }

  getRegistration(tenantId: string, agentId: string): AgentRegistration | undefined {
    const item = this.registrations.get(agentId);
    return item?.tenantId === tenantId ? item : undefined;
  }

  findByAgentKey(tenantId: string, agentKey: string): AgentRegistration | undefined {
    return [...this.registrations.values()].find((item) => item.tenantId === tenantId && item.agentKey === agentKey);
  }

  listRegistrations(tenantId: string, query: PageQuery): PageResponse<AgentRegistration> {
    let rows = [...this.registrations.values()].filter((item) => item.tenantId === tenantId);
    for (const [field, expected] of Object.entries(query.filter)) {
      rows = rows.filter((item) => String((item as unknown as Record<string, unknown>)[field] ?? '').toLowerCase().includes(expected.toLowerCase()));
    }
    const start = (query.page - 1) * query.pageSize;
    return createPageResponse(rows.slice(start, start + query.pageSize), query.page, query.pageSize, rows.length);
  }

  createSession(session: AgentSession): AgentSession {
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(tenantId: string, sessionId: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    return session?.tenantId === tenantId ? session : undefined;
  }

  saveCertificateAuthority(ca: AgentCertificateAuthority): AgentCertificateAuthority {
    this.certificateAuthority = ca;
    return ca;
  }

  getCertificateAuthority(): AgentCertificateAuthority | undefined {
    return this.certificateAuthority;
  }

  createCertificateSigningRequest(csr: AgentCertificateSigningRequest): AgentCertificateSigningRequest {
    this.certificateSigningRequests.set(csr.id, csr);
    return csr;
  }

  updateCertificateSigningRequest(csrId: string, patch: Partial<AgentCertificateSigningRequest>): AgentCertificateSigningRequest {
    const current = this.certificateSigningRequests.get(csrId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Agent CSR 不存在', { csrId });
    const updated = { ...current, ...patch };
    this.certificateSigningRequests.set(updated.id, updated);
    return updated;
  }

  getCertificateSigningRequest(tenantId: string, csrId: string): AgentCertificateSigningRequest | undefined {
    const csr = this.certificateSigningRequests.get(csrId);
    return csr?.tenantId === tenantId ? csr : undefined;
  }

  createCertificate(certificate: AgentCertificate): AgentCertificate {
    this.certificates.set(certificate.id, certificate);
    return certificate;
  }

  updateCertificate(certificateId: string, patch: Partial<AgentCertificate>): AgentCertificate {
    const current = this.certificates.get(certificateId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Agent 证书不存在', { certificateId });
    const updated = { ...current, ...patch };
    this.certificates.set(updated.id, updated);
    return updated;
  }

  getCertificate(tenantId: string, certificateId: string): AgentCertificate | undefined {
    const certificate = this.certificates.get(certificateId);
    return certificate?.tenantId === tenantId ? certificate : undefined;
  }

  findActiveCertificate(tenantId: string, agentId: string): AgentCertificate | undefined {
    return this.listCertificates(tenantId, agentId).find((item) => item.status === 'active');
  }

  listCertificates(tenantId: string, agentId: string): AgentCertificate[] {
    return [...this.certificates.values()]
      .filter((item) => item.tenantId === tenantId && item.agentId === agentId)
      .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt));
  }

  saveHeartbeat(heartbeat: AgentHeartbeat): AgentHeartbeat {
    this.heartbeats.push(heartbeat);
    return heartbeat;
  }

  getLatestHeartbeat(tenantId: string, agentId: string): AgentHeartbeat | undefined {
    return this.heartbeats
      .filter((item) => item.tenantId === tenantId && item.agentId === agentId)
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))[0];
  }

  saveCapabilitySnapshot(snapshot: AgentCapabilitySnapshot): AgentCapabilitySnapshot {
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  getLatestCapabilitySnapshot(tenantId: string, agentId: string): AgentCapabilitySnapshot | undefined {
    return [...this.snapshots.values()]
      .filter((item) => item.tenantId === tenantId && item.agentId === agentId)
      .sort((left, right) => right.reportedAt.localeCompare(left.reportedAt))[0];
  }

  createTask(task: AgentTaskEnvelope): AgentTaskEnvelope {
    this.tasks.set(task.id, task);
    return task;
  }

  updateTask(taskId: string, patch: Partial<AgentTaskEnvelope>): AgentTaskEnvelope {
    const current = this.tasks.get(taskId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'Agent task 不存在', { taskId });
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.tasks.set(updated.id, updated);
    return updated;
  }

  getTask(tenantId: string, taskId: string): AgentTaskEnvelope | undefined {
    const task = this.tasks.get(taskId);
    return task?.tenantId === tenantId ? task : undefined;
  }

  findTaskByIdempotencyKey(tenantId: string, agentId: string, idempotencyKey: string): AgentTaskEnvelope | undefined {
    return [...this.tasks.values()].find((task) => task.tenantId === tenantId && task.agentId === agentId && task.idempotencyKey === idempotencyKey);
  }

  listTasks(tenantId: string, agentId: string, statuses?: string[]): AgentTaskEnvelope[] {
    return [...this.tasks.values()]
      .filter((task) => task.tenantId === tenantId && task.agentId === agentId && (!statuses?.length || statuses.includes(task.status)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  saveTaskLog(entry: AgentTaskLogEntry): AgentTaskLogEntry {
    const duplicated = this.taskLogs.find((item) => item.tenantId === entry.tenantId && item.taskId === entry.taskId && item.sequence === entry.sequence);
    if (duplicated) return duplicated;
    this.taskLogs.push(entry);
    return entry;
  }

  saveTaskLogCursor(cursor: AgentTaskLogCursor): AgentTaskLogCursor {
    this.taskLogCursors.set(logCursorKey(cursor.tenantId, cursor.agentId, cursor.taskId), cursor);
    return cursor;
  }

  getTaskLogCursor(tenantId: string, agentId: string, taskId: string): AgentTaskLogCursor | undefined {
    return this.taskLogCursors.get(logCursorKey(tenantId, agentId, taskId));
  }

  listTaskLogs(tenantId: string, taskId: string): AgentTaskLogEntry[] {
    return this.taskLogs
      .filter((item) => item.tenantId === tenantId && item.taskId === taskId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  listAgentTaskLogs(tenantId: string, agentId: string, levels?: AgentTaskLogEntry['level'][]): AgentTaskLogEntry[] {
    return this.taskLogs
      .filter((item) => item.tenantId === tenantId && item.agentId === agentId && (!levels?.length || levels.includes(item.level)))
      .sort((left, right) => right.emittedAt.localeCompare(left.emittedAt) || right.sequence - left.sequence);
  }

  publishVersion(release: AgentVersionRelease): AgentVersionRelease {
    this.releases.set(release.id, release);
    return release;
  }

  listActiveVersions(tenantId: string): AgentVersionRelease[] {
    return [...this.releases.values()]
      .filter((item) => item.tenantId === tenantId && item.status === 'active')
      .sort((left, right) => compareVersions(right.version, left.version));
  }

  createUpgradePlan(plan: AgentUpgradePlan): AgentUpgradePlan {
    this.upgradePlans.set(plan.id, plan);
    return plan;
  }

  updateUpgradePlan(planId: string, patch: Partial<AgentUpgradePlan>): AgentUpgradePlan {
    const current = this.upgradePlans.get(planId);
    if (!current) throw new AppError('RESOURCE_NOT_FOUND', '升级计划不存在', { planId });
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.upgradePlans.set(updated.id, updated);
    return updated;
  }

  getUpgradePlan(tenantId: string, planId: string): AgentUpgradePlan | undefined {
    const plan = this.upgradePlans.get(planId);
    return plan?.tenantId === tenantId ? plan : undefined;
  }

  findUpgradePlanForAgent(tenantId: string, agentId: string, releaseId: string): AgentUpgradePlan | undefined {
    return [...this.upgradePlans.values()].find((item) => item.tenantId === tenantId && item.agentId === agentId && item.releaseId === releaseId);
  }

  listUpgradePlansForAgent(tenantId: string, agentId: string): AgentUpgradePlan[] {
    return [...this.upgradePlans.values()]
      .filter((item) => item.tenantId === tenantId && item.agentId === agentId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

function logCursorKey(tenantId: string, agentId: string, taskId: string): string {
  return `${tenantId}:${agentId}:${taskId}`;
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
