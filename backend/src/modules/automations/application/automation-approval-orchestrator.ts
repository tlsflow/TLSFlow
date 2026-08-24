import { AppError } from '../../../common/errors/app-error.js';
import type { ApprovalService } from '../../approvals/approval.service.js';
import type { AutomationRunTargetDto, AutomationVersionDto } from '../dto/automations.dto.js';
import { AutomationsRepository } from '../repository/automations.repository.js';

export class AutomationApprovalOrchestrator {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly repository: AutomationsRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  requiresApproval(version: AutomationVersionDto): boolean {
    return Boolean(version.approvalStage || version.guardrails.requireApproval);
  }

  async ensureApproval(input: {
    runId: string;
    tenantId: string;
    automationId: string;
    automationVersion: number;
    actorId: string;
    version: AutomationVersionDto;
    targets: AutomationRunTargetDto[];
    deliveryId?: string;
  }): Promise<string | undefined> {
    if (!this.requiresApproval(input.version)) return undefined;
    const run = await this.repository.getRun(input.runId, input.tenantId);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', '自动化运行不存在', { runId: input.runId });
    if (run.approvalId) return run.approvalId;
    const approvalStage = input.version.approvalStage ?? {
      type: 'run' as const,
      mode: 'before_actions' as const,
      operationType: 'automation.run.approve',
      riskLevel: 'high' as const,
    };
    const expiresAt = approvalStage.expiresInHours
      ? new Date(this.clock().getTime() + approvalStage.expiresInHours * 3_600_000).toISOString()
      : undefined;
    const approval = await this.approvals.create({
      tenantId: input.tenantId,
      operationType: approvalStage.operationType ?? 'automation.run.approve',
      resourceRefs: [
        { type: 'automation', id: input.automationId },
        { type: 'automationRun', id: input.runId },
      ],
      riskLevel: approvalStage.riskLevel ?? 'high',
      parameters: this.parameters({
        runId: input.runId,
        automationId: input.automationId,
        automationVersion: input.automationVersion,
        deliveryId: input.deliveryId,
        targets: input.targets,
      }),
      requestedBy: input.actorId,
      expiresAt,
    });
    await this.repository.updateRun(input.runId, input.tenantId, {
      approvalId: approval.id,
      status: 'waiting_approval',
    });
    return approval.id;
  }

  async synchronizeRun(runId: string, tenantId: string): Promise<{ status: 'pending' | 'approved' | 'rejected'; approvalId?: string }> {
    const run = await this.repository.getRun(runId, tenantId);
    if (!run?.approvalId) return { status: 'approved' };
    const approval = await this.approvals.get(run.approvalId, tenantId);
    if (!approval) throw new AppError('VALIDATION_FAILED', '自动化审批记录不存在', { approvalId: run.approvalId });
    if (approval.status === 'pending') return { status: 'pending', approvalId: approval.id };
    if (approval.status === 'approved' || approval.status === 'consumed') {
      const targets = await this.repository.listRunTargets(run.id, tenantId);
      if (approval.status === 'approved') {
        await this.approvals.consume(approval.id, this.parameters({
          runId: run.id,
          automationId: run.automationId,
          automationVersion: run.automationVersion,
          deliveryId: run.deliveryId,
          targets,
        }), tenantId);
      }
      await this.repository.updateRun(run.id, tenantId, { status: 'queued' });
      return { status: 'approved', approvalId: approval.id };
    }
    await this.repository.updateRun(run.id, tenantId, {
      status: 'needs_attention',
      failureStage: 'approval',
      failureCode: 'AUTOMATION_APPROVAL_INVALID',
      failureMessage: `自动化审批以 ${approval.status} 结束`,
      finishedAt: this.clock().toISOString(),
    });
    return { status: 'rejected', approvalId: approval.id };
  }

  private parameters(input: {
    runId: string;
    automationId: string;
    automationVersion: number;
    deliveryId?: string;
    targets: Array<Pick<AutomationRunTargetDto, 'targetSnapshot'>>;
  }): Record<string, unknown> {
    return {
      runId: input.runId,
      automationId: input.automationId,
      automationVersion: input.automationVersion,
      deliveryId: input.deliveryId,
      targets: input.targets
        .map((target) => ({
          certificateVersionId: target.targetSnapshot.certificateVersionId,
          bindingId: target.targetSnapshot.bindingId,
          assetId: target.targetSnapshot.assetId,
          environment: target.targetSnapshot.environment,
        }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    };
  }
}
