import { createHash } from 'node:crypto';
import { MemoryRepository } from '../../persistence/repositories/memory-repository.js';
import type { RepositoryPort } from '../../persistence/repositories/repository-port.js';
import type { ApprovalDecision, ApprovalRequestEntity, ApprovalResourceRef } from '../../persistence/entities/approval.entity.js';
import type { RequestContext, RiskLevel } from '../../shared/security-types.js';
import { canonicalize } from '../../shared/canonical-json.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';

export interface CreateApprovalInput {
  operationType: string;
  resourceRefs: ApprovalResourceRef[];
  riskLevel: RiskLevel;
  parameters: unknown;
  requestedBy: string;
  expiresAt?: string;
}

export interface DecideApprovalInput {
  approvalId: string;
  decision: ApprovalDecision;
  approverId: string;
  comment?: string;
  forbidSelfApproval?: boolean;
}

export class ApprovalService {
  constructor(
    private readonly approvals: RepositoryPort<ApprovalRequestEntity> = new MemoryRepository<ApprovalRequestEntity>(),
    private readonly audit?: AuditService,
  ) {}

  create(input: CreateApprovalInput, context: RequestContext = {}): ApprovalRequestEntity {
    if (this.requiresApproval(input.riskLevel, input.operationType) === false) {
      throw securityErrors.approvalInvalid({ reason: 'operation does not require approval' });
    }

    const now = new Date().toISOString();
    const approval = this.approvals.create({
      id: newId('apr'),
      operationType: input.operationType,
      resourceRefs: input.resourceRefs,
      riskLevel: input.riskLevel,
      parameterHash: this.hashParameters(input.parameters),
      status: 'pending',
      requestedBy: input.requestedBy,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    this.audit?.write({
      eventType: AUDIT_EVENT_TYPES.APPROVAL_CREATED,
      actorType: 'user',
      actorId: input.requestedBy,
      action: 'approval.create',
      resourceType: 'approval',
      resourceId: approval.id,
      result: 'success',
      riskLevel: input.riskLevel,
      context,
      detail: { operationType: input.operationType, resourceRefs: input.resourceRefs, parameterHash: approval.parameterHash },
    });

    return approval;
  }

  decide(input: DecideApprovalInput, context: RequestContext = {}): ApprovalRequestEntity {
    const current = this.getFresh(input.approvalId);
    if (current.status !== 'pending') {
      throw securityErrors.approvalInvalid({ reason: 'approval is not pending', status: current.status });
    }
    if (input.forbidSelfApproval !== false && current.requestedBy === input.approverId && input.decision === 'approved') {
      throw securityErrors.approvalInvalid({ reason: 'self approval denied' });
    }

    const nextStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    const updated = this.approvals.update(current.id, {
      status: nextStatus,
      approvedBy: input.approverId,
      comment: input.comment,
      updatedAt: new Date().toISOString(),
    });

    this.audit?.write({
      eventType: nextStatus === 'approved' ? AUDIT_EVENT_TYPES.APPROVAL_APPROVED : AUDIT_EVENT_TYPES.APPROVAL_REJECTED,
      actorType: 'user',
      actorId: input.approverId,
      action: `approval.${nextStatus}`,
      resourceType: 'approval',
      resourceId: updated.id,
      result: nextStatus === 'approved' ? 'success' : 'denied',
      riskLevel: updated.riskLevel,
      context,
      failClosed: true,
      detail: { operationType: updated.operationType, comment: input.comment },
    });

    return updated;
  }

  consume(approvalId: string, parameters: unknown): ApprovalRequestEntity {
    const current = this.getFresh(approvalId);
    if (current.status !== 'approved') {
      throw securityErrors.approvalInvalid({ reason: 'approval is not approved', status: current.status });
    }
    const expectedHash = this.hashParameters(parameters);
    if (current.parameterHash !== expectedHash) {
      this.approvals.update(current.id, { status: 'cancelled', updatedAt: new Date().toISOString() });
      throw securityErrors.approvalInvalid({ reason: 'parameter hash changed' });
    }
    return this.approvals.update(current.id, { status: 'consumed', updatedAt: new Date().toISOString() });
  }

  get(id: string): ApprovalRequestEntity | undefined {
    return this.approvals.get(id);
  }

  hashParameters(parameters: unknown): string {
    return createHash('sha256').update(canonicalize(parameters)).digest('hex');
  }

  requiresApproval(riskLevel: RiskLevel, operationType: string): boolean {
    if (riskLevel === 'high' || riskLevel === 'critical') {
      return true;
    }
    return ['plugin.install', 'plugin.enable', 'deployment.rollback', 'workflow_template.execute'].includes(operationType);
  }

  private getFresh(id: string): ApprovalRequestEntity {
    const current = this.approvals.get(id);
    if (!current) {
      throw securityErrors.approvalInvalid({ reason: 'approval not found', id });
    }
    if (current.expiresAt && new Date(current.expiresAt).getTime() < Date.now() && current.status === 'pending') {
      return this.approvals.update(id, { status: 'expired', updatedAt: new Date().toISOString() });
    }
    return current;
  }
}
