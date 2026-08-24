import { newId } from '../../shared/id.js';
import type { RequestContext, ResourceDescriptor, RiskLevel, SecuritySubject } from '../../shared/security-types.js';
import { securityErrors } from '../../shared/security-error.js';
import type { AuditService } from '../audits/audit.service.js';
import type { PermissionBroker } from '../security/permission-broker.service.js';
import type { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { parseSecretRef } from '../secrets/secret-ref.js';
import type { CredentialIssueRequest, CredentialSession } from './gateway-agent.types.js';

const defaultAllowedActions = ['read', 'write', 'exec', 'upload'];

export type GatewayCredentialAuditEvent = 'issued' | 'used' | 'revoked' | 'expired' | 'denied';

export interface GatewayCredentialBrokerAuditRecord {
  id: string;
  sessionId?: string;
  event: GatewayCredentialAuditEvent;
  auditRef?: string;
  operatorId?: string;
  executionRunId?: string;
  stepId?: string;
  taskId: string;
  gatewayId: string;
  targetId: string;
  protocol: string;
  action?: string;
  status?: CredentialSession['status'];
  result: 'success' | 'denied';
  reason?: string;
  createdAt: string;
}

export interface GatewayCredentialIssueInput extends CredentialIssueRequest {
  subject: SecuritySubject;
  resource?: ResourceDescriptor;
  riskLevel?: RiskLevel;
  operationType?: string;
  approvalId?: string;
  approvalParameters?: unknown;
  context?: RequestContext;
}

export class GatewayCredentialBroker {
  private readonly sessions = new Map<string, CredentialSession>();
  private readonly audits: GatewayCredentialBrokerAuditRecord[] = [];

  constructor(
    private readonly permissionBroker: PermissionBroker,
    private readonly grants: ExecutionGrantService,
    private readonly audit: AuditService,
  ) {}

  async issue(input: GatewayCredentialIssueInput): Promise<CredentialSession> {
    const now = input.now ?? new Date();
    const requestedActions = this.normalizeRequestedActions(input.requestedActions);
    this.assertSecretRef(input.secretRef);

    try {
      const grant = await this.permissionBroker.createExecutorGrant({
        subject: input.subject,
        action: 'gateway.credential.issue',
        resource: input.resource ?? this.defaultResource(input),
        operationType: input.operationType ?? 'gateway.credential.issue',
        riskLevel: input.riskLevel ?? 'high',
        approvalId: input.approvalId,
        approvalParameters: input.approvalParameters ?? this.defaultApprovalParameters(input, requestedActions),
        runId: input.executionRunId ?? input.taskId,
        stepId: input.stepId ?? input.taskId,
        executorType: String(input.protocol),
        allowedSecretRefs: [input.secretRef],
        grantActions: requestedActions,
        expiresAt: new Date(now.getTime() + (input.ttlSeconds ?? 300) * 1000).toISOString(),
        context: input.context,
      });

      const session: CredentialSession = {
        id: newId('cred_sess'),
        taskId: input.taskId,
        operatorId: input.operatorId ?? input.subject.id,
        executionRunId: input.executionRunId,
        stepId: input.stepId,
        auditRefs: input.auditRef ? [input.auditRef] : [],
        // 只保存引用。这里绝不碰 Secret 明文，SecretService 后续也必须凭 Grant 才能解析。
        secretRef: { ref: input.secretRef },
        grantRef: { ref: grant.id },
        gatewayId: input.gatewayId,
        targetId: input.targetId,
        protocol: input.protocol,
        allowedActions: requestedActions,
        remainingUses: input.maxUses ?? 1,
        expiresAt: grant.expiresAt,
        status: 'active',
        createdAt: now.toISOString(),
      };

      this.sessions.set(session.id, session);
      await this.recordAudit(session, 'issued', now, { auditRef: input.auditRef, result: 'success' });
      return session;
    } catch (error) {
      await this.recordDenied(input, now, this.errorCode(error));
      throw error;
    }
  }

  get(sessionId: string, now = new Date()): CredentialSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.status === 'active' && new Date(session.expiresAt).getTime() <= now.getTime()) {
      const expired: CredentialSession = { ...session, status: 'expired', expiredAt: now.toISOString() };
      this.sessions.set(sessionId, expired);
      this.recordAudit(expired, 'expired', now, { result: 'success' });
      return expired;
    }
    return session;
  }

  async use(sessionId: string, action: string, now = new Date()): Promise<CredentialSession> {
    const session = this.get(sessionId, now);
    if (!session) {
      throw securityErrors.executorGrantDenied({ reason: 'credential session not found' });
    }
    if (session.status !== 'active') {
      throw securityErrors.executorGrantDenied({ reason: 'credential session not active', status: session.status });
    }
    if (!session.allowedActions.includes(action)) {
      throw securityErrors.executorGrantDenied({ reason: 'credential action not allowed', action });
    }

    await this.grants.validate({
      grantId: session.grantRef.ref,
      runId: session.executionRunId ?? session.taskId,
      stepId: session.stepId ?? session.taskId,
      executorType: String(session.protocol),
      secretRef: session.secretRef.ref,
      action,
      markUsed: true,
    });

    const updated: CredentialSession = {
      ...session,
      remainingUses: Math.max(session.remainingUses - 1, 0),
      status: session.remainingUses <= 1 ? 'used' : 'active',
      usedAt: now.toISOString(),
    };
    this.sessions.set(sessionId, updated);
    await this.recordAudit(updated, 'used', now, { action, result: 'success' });
    return updated;
  }

  async revoke(sessionId: string, now = new Date(), auditRef?: string): Promise<CredentialSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw securityErrors.executorGrantDenied({ reason: 'credential session not found' });
    }
    const revoked: CredentialSession = {
      ...session,
      status: 'revoked',
      auditRefs: auditRef ? [...new Set([...session.auditRefs, auditRef])] : session.auditRefs,
      revokedAt: now.toISOString(),
    };
    this.sessions.set(sessionId, revoked);
    await this.grants.revoke(session.grantRef.ref);
    await this.recordAudit(revoked, 'revoked', now, { auditRef, result: 'success' });
    return revoked;
  }

  list(): CredentialSession[] {
    return [...this.sessions.values()];
  }

  listAuditRecords(sessionId?: string): GatewayCredentialBrokerAuditRecord[] {
    return this.audits.filter((record) => !sessionId || record.sessionId === sessionId);
  }

  private normalizeRequestedActions(actions: string[]): string[] {
    const requestedActions = [...new Set(actions)];
    if (requestedActions.length === 0) {
      throw securityErrors.executorGrantDenied({ reason: 'empty credential actions' });
    }
    const denied = requestedActions.filter((action) => !defaultAllowedActions.includes(action));
    if (denied.length > 0) {
      throw securityErrors.executorGrantDenied({ reason: 'credential action out of range', denied });
    }
    return requestedActions;
  }

  private assertSecretRef(secretRef: string): void {
    parseSecretRef(secretRef);
  }

  private defaultResource(input: GatewayCredentialIssueInput): ResourceDescriptor {
    return {
      type: 'gatewayTarget',
      id: input.targetId,
      scope: { zoneId: input.gatewayId },
    };
  }

  private defaultApprovalParameters(input: GatewayCredentialIssueInput, requestedActions: string[]): unknown {
    return {
      taskId: input.taskId,
      operatorId: input.operatorId ?? input.subject.id,
      executionRunId: input.executionRunId,
      stepId: input.stepId,
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol: input.protocol,
      secretRef: input.secretRef,
      requestedActions,
    };
  }

  private async recordAudit(
    session: CredentialSession,
    event: Exclude<GatewayCredentialAuditEvent, 'denied'>,
    now: Date,
    extra: { auditRef?: string; action?: string; result: 'success' } = { result: 'success' },
  ): Promise<void> {
    const record: GatewayCredentialBrokerAuditRecord = {
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
      result: extra.result,
      createdAt: now.toISOString(),
    };
    this.audits.push(record);
    await this.writeSystemAudit(record);
  }

  private async recordDenied(input: GatewayCredentialIssueInput, now: Date, reason: string): Promise<void> {
    const record: GatewayCredentialBrokerAuditRecord = {
      id: newId('cred_audit'),
      event: 'denied',
      auditRef: input.auditRef,
      operatorId: input.operatorId ?? input.subject.id,
      executionRunId: input.executionRunId,
      stepId: input.stepId,
      taskId: input.taskId,
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol: input.protocol,
      result: 'denied',
      reason,
      createdAt: now.toISOString(),
    };
    this.audits.push(record);
    await this.writeSystemAudit(record);
  }

  private async writeSystemAudit(record: GatewayCredentialBrokerAuditRecord): Promise<void> {
    await this.audit.write({
      eventType: `gateway.credential.${record.event}`,
      actorType: 'executor',
      actorId: record.operatorId ?? 'gateway-credential-broker',
      action: `gateway.credential.${record.event}`,
      resourceType: 'gateway_credential_session',
      resourceId: record.sessionId,
      result: record.result,
      riskLevel: 'high',
      failClosed: true,
      detail: {
        auditRef: record.auditRef,
        taskId: record.taskId,
        gatewayId: record.gatewayId,
        targetId: record.targetId,
        protocol: record.protocol,
        action: record.action,
        status: record.status,
        reason: record.reason,
        executionRunId: record.executionRunId,
        stepId: record.stepId,
      },
    });
  }

  private errorCode(error: unknown): string {
    if (error instanceof Error && 'errorCode' in error && typeof (error as { errorCode?: unknown }).errorCode === 'string') {
      return (error as { errorCode: string }).errorCode;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
