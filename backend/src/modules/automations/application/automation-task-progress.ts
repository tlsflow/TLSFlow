import type { AutomationRunActionResultDto, AutomationRunDto, AutomationRunTargetDto } from '../dto/automations.dto.js';

interface AutomationTaskSummaryInput {
  run: AutomationRunDto;
  targets?: readonly AutomationRunTargetDto[];
  actionResults?: readonly AutomationRunActionResultDto[];
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function uniqueCount(values: Array<string | undefined>): number {
  return new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)).size;
}

function computePercent(run: AutomationRunDto): number {
  const total = finiteCount(run.targetSummary.total);
  if (total <= 0) return ['succeeded', 'partially_succeeded', 'failed', 'needs_attention', 'stopped', 'cancelled'].includes(run.status) ? 100 : 0;
  const completed = finiteCount(run.targetSummary.succeeded)
    + finiteCount(run.targetSummary.failed)
    + finiteCount(run.targetSummary.skipped)
    + finiteCount(run.targetSummary.cancelled);
  if (completed >= total) return 100;
  if (run.status === 'queued') return 5;
  if (run.status === 'running') return Math.max(10, Math.round((completed / total) * 100));
  if (run.status === 'waiting_approval') return Math.max(15, Math.round((completed / total) * 100));
  return Math.round((completed / total) * 100);
}

function buildSummary(run: AutomationRunDto): string {
  const total = finiteCount(run.targetSummary.total);
  const succeeded = finiteCount(run.targetSummary.succeeded);
  const failed = finiteCount(run.targetSummary.failed);
  const skipped = finiteCount(run.targetSummary.skipped);
  const waitingApproval = finiteCount(run.targetSummary.waitingApproval);
  const running = finiteCount(run.targetSummary.running);
  const pending = finiteCount(run.targetSummary.pending);
  if (run.status === 'waiting_approval') return `等待审批，${Math.max(waitingApproval, 1)} 个目标待继续`;
  if (run.status === 'queued') return `已创建自动化运行，${Math.max(pending, total)} 个目标待处理`;
  if (run.status === 'running') return `正在处理，已完成 ${succeeded + failed + skipped}/${total} 个目标`;
  if (run.status === 'succeeded') return `全部完成，共 ${succeeded}/${total} 个目标成功`;
  if (run.status === 'partially_succeeded') return `部分完成，成功 ${succeeded} 个，失败 ${failed} 个`;
  if (run.status === 'failed') return `执行失败，${failed || total} 个目标未完成`;
  if (run.status === 'needs_attention') return `需要人工处理，失败 ${failed} 个，等待 ${waitingApproval + running + pending} 个`;
  if (run.status === 'stopped') return `已停止，成功 ${succeeded} 个，跳过 ${skipped + pending} 个`;
  if (run.status === 'cancelled') return '已取消';
  return run.status;
}

export function buildAutomationTaskResourceSummary(run: AutomationRunDto): Record<string, unknown> {
  const approvalPending = run.status === 'waiting_approval' && Boolean(run.approvalId);
  return {
    displayName: run.automationNameSnapshot,
    automationId: run.automationId,
    automationRunId: run.id,
    approvalId: run.approvalId,
    approvalPending,
    ...(approvalPending ? { approvalStatus: 'pending' } : {}),
    summary: buildSummary(run),
    percent: computePercent(run),
    totalTargets: finiteCount(run.targetSummary.total),
    succeededTargets: finiteCount(run.targetSummary.succeeded),
    failedTargets: finiteCount(run.targetSummary.failed),
    skippedTargets: finiteCount(run.targetSummary.skipped),
    waitingApprovalTargets: finiteCount(run.targetSummary.waitingApproval),
    runningTargets: finiteCount(run.targetSummary.running),
    pendingTargets: finiteCount(run.targetSummary.pending),
    status: run.status,
    ...(run.scheduledAt ? { scheduledAt: run.scheduledAt } : {}),
  };
}

export function buildAutomationTaskProgress(input: AutomationTaskSummaryInput): Record<string, unknown> {
  const { run, targets = [], actionResults = [] } = input;
  const approvalPending = run.status === 'waiting_approval' && Boolean(run.approvalId);
  return {
    ...buildAutomationTaskResourceSummary(run),
    message: buildSummary(run),
    approvalPending,
    approvalStatus: approvalPending ? 'pending' : undefined,
    deploymentPlanCount: uniqueCount(targets.map((target) => target.deploymentPlanId)),
    executionRunCount: uniqueCount(targets.map((target) => target.executionRunId)),
    notificationRequestCount: targets.reduce((count, target) => count + target.notificationRequestIds.length, 0),
    actionResultCount: actionResults.length,
    succeededActionCount: actionResults.filter((result) => result.status === 'succeeded').length,
    failedActionCount: actionResults.filter((result) => result.status === 'failed').length,
    runningActionCount: actionResults.filter((result) => result.status === 'running').length,
    targetNames: targets
      .map((target) => target.targetSnapshot.assetName ?? target.targetSnapshot.certificateName)
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, 5),
  };
}
