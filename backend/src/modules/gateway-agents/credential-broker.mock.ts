import { newId } from '../../shared/id.js';
import type { CredentialIssueRequest, CredentialSession } from './gateway-agent.types.js';

const defaultAllowedActions = ['read', 'write', 'exec', 'upload'];

export interface CredentialBrokerAuditRecord {
  id: string;
  sessionId: string;
  event: 'issued' | 'used' | 'revoked' | 'expired';
  auditRef?: string;
  operatorId?: string;
  executionRunId?: string;
  stepId?: string;
  taskId: string;
  gatewayId: string;
  targetId: string;
  protocol: string;
  action?: string;
  status: CredentialSession['status'];
  createdAt: string;
}

export class MockCredentialBroker {
  private readonly sessions = new Map<string, CredentialSession>();
  private readonly audits: CredentialBrokerAuditRecord[] = [];

  issue(request: CredentialIssueRequest): CredentialSession {
    const now = request.now ?? new Date();
    const requestedActions = [...new Set(request.requestedActions)];
    const denied = requestedActions.filter((action) => !defaultAllowedActions.includes(action));
    if (denied.length > 0) throw new Error(`凭据动作超范围: ${denied.join(',')}`);

    const session: CredentialSession = {
      id: newId('cred_sess'),
      taskId: request.taskId,
      operatorId: request.operatorId,
      executionRunId: request.executionRunId,
      stepId: request.stepId,
      auditRefs: request.auditRef ? [request.auditRef] : [],
      secretRef: { ref: request.secretRef },
      grantRef: { ref: newId('grant') },
      gatewayId: request.gatewayId,
      targetId: request.targetId,
      protocol: request.protocol,
      allowedActions: requestedActions,
      remainingUses: request.maxUses ?? 1,
      expiresAt: new Date(now.getTime() + (request.ttlSeconds ?? 300) * 1000).toISOString(),
      status: 'active',
      createdAt: now.toISOString(),
    };
    this.sessions.set(session.id, session);
    this.recordAudit(session, 'issued', now, { auditRef: request.auditRef });
    return session;
  }

  get(sessionId: string, now = new Date()): CredentialSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.status === 'active' && new Date(session.expiresAt).getTime() <= now.getTime()) {
      const expired: CredentialSession = { ...session, status: 'expired', expiredAt: now.toISOString() };
      this.sessions.set(sessionId, expired);
      this.recordAudit(expired, 'expired', now);
      return expired;
    }
    return session;
  }

  use(sessionId: string, action: string, now = new Date()): CredentialSession {
    const session = this.get(sessionId, now);
    if (!session) throw new Error('凭据会话不存在');
    if (session.status !== 'active') throw new Error(`凭据会话不可用: ${session.status}`);
    if (!session.allowedActions.includes(action)) throw new Error(`凭据动作未授权: ${action}`);
    const updated: CredentialSession = {
      ...session,
      remainingUses: Math.max(session.remainingUses - 1, 0),
      status: session.remainingUses <= 1 ? 'used' : 'active',
      usedAt: now.toISOString(),
    };
    this.sessions.set(sessionId, updated);
    this.recordAudit(updated, 'used', now, { action });
    return updated;
  }

  revoke(sessionId: string, now = new Date(), auditRef?: string): CredentialSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('凭据会话不存在');
    const revoked: CredentialSession = {
      ...session,
      status: 'revoked',
      auditRefs: auditRef ? [...new Set([...session.auditRefs, auditRef])] : session.auditRefs,
      revokedAt: now.toISOString(),
    };
    this.sessions.set(sessionId, revoked);
    this.recordAudit(revoked, 'revoked', now, { auditRef });
    return revoked;
  }

  list(): CredentialSession[] {
    return [...this.sessions.values()];
  }

  listAuditRecords(sessionId?: string): CredentialBrokerAuditRecord[] {
    return this.audits.filter((record) => !sessionId || record.sessionId === sessionId);
  }

  private recordAudit(session: CredentialSession, event: CredentialBrokerAuditRecord['event'], now: Date, extra: { auditRef?: string; action?: string } = {}): void {
    this.audits.push({
      id: newId('cred_audit'),
      sessionId: session.id,
      event,
      auditRef: extra.auditRef ?? session.auditRefs[session.auditRefs.length - 1],
      operatorId: session.operatorId,
      executionRunId: session.executionRunId,
      stepId: session.stepId,
      taskId: session.taskId,
      gatewayId: session.gatewayId,
      targetId: session.targetId,
      protocol: session.protocol,
      action: extra.action,
      status: session.status,
      createdAt: now.toISOString(),
    });
  }
}
