import { createHash } from 'node:crypto';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { ApprovalDecision, ApprovalRequestEntity, ApprovalResourceRef } from '../../persistence/entities/approval.entity.js';
import type { RequestContext, RiskLevel } from '../../shared/security-types.js';
import { canonicalize } from '../../shared/canonical-json.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import { structuredLogger } from '../../common/logging/structured-logger.js';
import type { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';

export interface CreateApprovalInput {
  tenantId?: string;
  operationType: string;
  resourceRefs: ApprovalResourceRef[];
  riskLevel: RiskLevel;
  parameters: unknown;
  requestedBy: string;
  expiresAt?: string;
}

export interface DecideApprovalInput {
  approvalId: string;
  tenantId?: string;
  decision: ApprovalDecision;
  approverId: string;
  comment?: string;
  forbidSelfApproval?: boolean;
}

export interface ApprovalServiceOptions {
  allowSelfApproval?: boolean;
  onDecided?: (approval: ApprovalRequestEntity) => Promise<void>;
}

export class ApprovalService {
  private static readonly defaultDb = new PgliteDatabase();
  private readonly allowSelfApproval: boolean;
  private decisionListener?: (approval: ApprovalRequestEntity) => Promise<void>;

  private static createDefaultRepository(): AsyncRepositoryPort<ApprovalRequestEntity> {
    return new PgDocumentRepository<ApprovalRequestEntity>(ApprovalService.defaultDb, 'security.approval_requests');
  }

  constructor(
    private readonly approvals: AsyncRepositoryPort<ApprovalRequestEntity> = ApprovalService.createDefaultRepository(),
    private readonly audit?: AuditService,
    options: ApprovalServiceOptions = {},
  ) {
    this.allowSelfApproval = options.allowSelfApproval ?? false;
    this.decisionListener = options.onDecided;
  }

  /**
   * 中文说明：安全服务初始化早于业务模块，因此审批决策回调允许在应用装配完成后再绑定。
   */
  setDecisionListener(listener?: (approval: ApprovalRequestEntity) => Promise<void>): void {
    this.decisionListener = listener;
  }

  async create(input: CreateApprovalInput, context: RequestContext = {}): Promise<ApprovalRequestEntity> {
    if (this.requiresApproval(input.riskLevel, input.operationType) === false) {
      throw securityErrors.approvalInvalid({ reason: 'operation does not require approval' });
    }

    const now = new Date().toISOString();
    const approval = await this.approvals.create({
      id: newId('apr'),
      tenantId: input.tenantId ?? resolveContextTenantId(context),
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

    await this.audit?.write({
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

  async decide(input: DecideApprovalInput, context: RequestContext = {}): Promise<ApprovalRequestEntity> {
    const current = await this.getFresh(input.approvalId, input.tenantId ?? resolveContextTenantId(context));
    if (current.status !== 'pending') {
      const message = current.status === 'approved' || current.status === 'consumed'
        ? '审批已处理，不能重复审批'
        : '审批已结束，状态不允许当前操作';
      throw securityErrors.approvalInvalid({ reason: 'approval is not pending', status: current.status }, message);
    }
    const selfApprovalAllowed = input.forbidSelfApproval === false || this.allowSelfApproval;
    if (!selfApprovalAllowed && current.requestedBy === input.approverId && input.decision === 'approved') {
      throw securityErrors.approvalInvalid({ reason: 'self approval denied' }, '申请人不能批准自己提交的审批');
    }

    const nextStatus = input.decision === 'approved' ? 'approved' : 'rejected';
    const updated = await this.approvals.update(current.id, {
      status: nextStatus,
      approvedBy: input.approverId,
      comment: input.comment,
      updatedAt: new Date().toISOString(),
    });

    await this.audit?.write({
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

    try {
      await this.decisionListener?.(updated);
    } catch (error) {
      // 中文说明：审批已经成功落库，唤醒业务运行失败时不能把成功审批伪装成失败。
      structuredLogger.warn('审批已落库，但后续运行唤醒失败', {
        approvalId: updated.id,
        status: updated.status,
        error: error instanceof Error ? error.message : String(error),
      }, { module: 'approval-service', resourceType: 'approval', resourceId: updated.id });
    }

    return updated;
  }

  async consume(approvalId: string, parameters: unknown, tenantId?: string): Promise<ApprovalRequestEntity> {
    const current = await this.getFresh(approvalId, tenantId);
    if (current.status !== 'approved') {
      throw securityErrors.approvalInvalid({ reason: 'approval is not approved', status: current.status });
    }
    const expectedHash = this.hashParameters(parameters);
    if (current.parameterHash !== expectedHash) {
      await this.approvals.update(current.id, { status: 'cancelled', updatedAt: new Date().toISOString() });
      throw securityErrors.approvalInvalid({ reason: 'parameter hash changed' });
    }
    return this.approvals.update(current.id, { status: 'consumed', updatedAt: new Date().toISOString() });
  }

  async get(id: string, tenantId?: string): Promise<ApprovalRequestEntity | undefined> {
    const approval = await this.approvals.get(id);
    return matchesTenant(approval?.tenantId, tenantId) ? approval : undefined;
  }

  async getMany(ids: readonly string[], tenantId?: string): Promise<Map<string, ApprovalRequestEntity>> {
    const idSet = new Set(ids.filter(Boolean));
    if (idSet.size === 0) return new Map();
    const approvals = await this.approvals.list((approval) => idSet.has(approval.id) && matchesTenant(approval.tenantId, tenantId));
    return new Map(approvals.map((approval) => [approval.id, approval]));
  }

  async deleteByDeploymentPlan(planId: string, approvalId?: string, tenantId?: string): Promise<string[]> {
    const matched = await this.approvals.list((approval) => {
      if (!matchesTenant(approval.tenantId, tenantId)) return false;
      if (approvalId && approval.id === approvalId) return true;
      return approval.resourceRefs.some((ref) => ref.type === 'deploymentPlan' && ref.id === planId);
    });
    await Promise.all(matched.map((approval) => this.approvals.delete(approval.id)));
    return matched.map((approval) => approval.id);
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

  private async getFresh(id: string, tenantId?: string): Promise<ApprovalRequestEntity> {
    const current = await this.approvals.get(id);
    if (!current || !matchesTenant(current.tenantId, tenantId)) {
      throw securityErrors.approvalInvalid({ reason: 'approval not found', id });
    }
    if (current.expiresAt && new Date(current.expiresAt).getTime() < Date.now() && current.status === 'pending') {
      return this.approvals.update(id, { status: 'expired', updatedAt: new Date().toISOString() });
    }
    return current;
  }
}

function resolveContextTenantId(context: RequestContext | undefined): string | undefined {
  return context?.tenantId ?? context?.actor?.scope?.tenantId;
}

function matchesTenant(actualTenantId: string | undefined, expectedTenantId: string | undefined): boolean {
  if (!expectedTenantId) return true;
  return actualTenantId === expectedTenantId;
}
