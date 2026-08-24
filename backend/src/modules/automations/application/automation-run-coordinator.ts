import { newId } from '../../../shared/id.js';
import type { AutomationActionDto, AutomationFailureStage, AutomationRunDto, AutomationRunTargetDto, AutomationTargetSummaryDto } from '../dto/automations.dto.js';
import { AutomationsRepository } from '../repository/automations.repository.js';

export interface AutomationActionExecutionPort {
  execute(input: { run: AutomationRunDto; target: AutomationRunTargetDto; action: AutomationActionDto; requireApproval: boolean }): Promise<{ status: 'succeeded' | 'running' | 'waiting_approval'; referenceType?: 'deployment_plan' | 'execution_run' | 'notification_request'; referenceId?: string }>;
}

export function isWithinMaintenanceWindow(window: { daysOfWeek: number[]; startTime: string; endTime: string; timeZone: string } | undefined, now: Date): boolean {
  if (!window) return true;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: window.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  const time = `${values.hour}:${values.minute}`;
  if (window.startTime <= window.endTime) return window.daysOfWeek.includes(day) && time >= window.startTime && time <= window.endTime;
  if (time >= window.startTime) return window.daysOfWeek.includes(day);
  const previousDay = (day + 6) % 7;
  return time <= window.endTime && window.daysOfWeek.includes(previousDay);
}

export function summarizeTargets(targets: AutomationRunTargetDto[]): AutomationTargetSummaryDto {
  return targets.reduce<AutomationTargetSummaryDto>((summary, target) => {
    summary.total += 1;
    if (target.status === 'pending') summary.pending += 1;
    if (target.status === 'running') summary.running += 1;
    if (target.status === 'waiting_approval') summary.waitingApproval += 1;
    if (target.status === 'succeeded') summary.succeeded += 1;
    if (target.status === 'failed') summary.failed += 1;
    if (target.status === 'skipped') summary.skipped += 1;
    if (target.status === 'cancelled') summary.cancelled += 1;
    return summary;
  }, { total: 0, pending: 0, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 });
}

export function failureStageFromError(error: unknown, fallback: AutomationFailureStage): AutomationFailureStage {
  const code = String((error as { errorCode?: string })?.errorCode ?? (error as Error)?.message ?? '').toUpperCase();
  if (code.includes('ROLLBACK')) return 'rollback';
  if (code.includes('VERIFY') || code.includes('TLS')) return 'verification';
  if (code.includes('APPROVAL')) return 'approval';
  return fallback;
}

export class AutomationRunCoordinator {
  constructor(private readonly repository: AutomationsRepository, private readonly actions: AutomationActionExecutionPort, private readonly clock: () => Date = () => new Date()) {}

  async execute(runId: string, tenantId: string): Promise<AutomationRunDto> {
    let run = await this.requireRun(runId, tenantId);
    const version = await this.repository.getVersion(run.automationId, run.automationVersion, tenantId);
    if (!version) throw new Error(`automation version missing: ${run.automationId}@${run.automationVersion}`);
    if (!isWithinMaintenanceWindow(version.guardrails.maintenanceWindow, this.clock())) {
      return this.repository.updateRun(run.id, tenantId, { status: 'needs_attention', failureStage: 'execution', failureCode: 'MAINTENANCE_WINDOW_CLOSED', failureMessage: '当前时间不在维护窗口内', finishedAt: this.clock().toISOString() });
    }
    run = await this.repository.updateRun(run.id, tenantId, { status: 'running', startedAt: run.startedAt ?? this.clock().toISOString() });
    const orderedActions = version.actions.slice().sort((left, right) => left.position - right.position);
    const targets = await this.repository.listRunTargets(run.id, tenantId);
    let consecutiveFailures = 0;
    for (const target of targets) {
      if (target.status !== 'pending') continue;
      const latestRun = await this.requireRun(run.id, tenantId);
      if (latestRun.status === 'stopped') break;
      try {
        await this.repository.updateRunTarget(target.id, tenantId, { status: 'running', startedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() });
        let terminal: 'succeeded' | 'running' | 'waiting_approval' = 'succeeded';
        for (const action of orderedActions) {
          const resultId = newId('aar');
          await this.repository.createActionResult({ id: resultId, tenantId, runId, runTargetId: target.id, actionType: action.type, actionPosition: action.position, status: 'running', startedAt: this.clock().toISOString(), createdAt: this.clock().toISOString() });
          try {
            const result = await this.actions.execute({ run, target: (await this.repository.getRunTarget(target.id, tenantId))!, action, requireApproval: version.guardrails.requireApproval });
            terminal = result.status;
            await this.repository.updateActionResult(resultId, tenantId, { status: result.status === 'succeeded' ? 'succeeded' : 'running', externalReferenceType: result.referenceType, externalReferenceId: result.referenceId, finishedAt: result.status === 'succeeded' ? this.clock().toISOString() : undefined });
            const linkPatch = result.referenceType === 'deployment_plan' ? { deploymentPlanId: result.referenceId }
              : result.referenceType === 'execution_run' ? { executionRunId: result.referenceId }
                : result.referenceType === 'notification_request' ? { notificationRequestIds: [...((await this.repository.getRunTarget(target.id, tenantId))?.notificationRequestIds ?? []), result.referenceId!] } : {};
            await this.repository.updateRunTarget(target.id, tenantId, { ...linkPatch, currentAction: action.type, updatedAt: this.clock().toISOString() });
            if (result.status !== 'succeeded') break;
          } catch (error) {
            const fallback = action.type === 'create_deployment_plan' ? 'plan_creation' : action.type === 'send_notification' ? 'notification' : 'execution';
            const failureStage = failureStageFromError(error, fallback);
            await this.repository.updateActionResult(resultId, tenantId, { status: 'failed', failureStage, errorCode: String((error as { errorCode?: string }).errorCode ?? 'AUTOMATION_ACTION_FAILED'), errorMessage: error instanceof Error ? error.message : String(error), finishedAt: this.clock().toISOString() });
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), { failureStage });
          }
        }
        await this.repository.updateRunTarget(target.id, tenantId, { status: terminal === 'succeeded' ? 'succeeded' : terminal, finishedAt: terminal === 'succeeded' ? this.clock().toISOString() : undefined, updatedAt: this.clock().toISOString() });
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const failureStage = (error as { failureStage?: AutomationFailureStage }).failureStage ?? 'execution';
        await this.repository.updateRunTarget(target.id, tenantId, { status: 'failed', failureStage, errorCode: String((error as { errorCode?: string }).errorCode ?? 'AUTOMATION_ACTION_FAILED'), errorMessage: error instanceof Error ? error.message : String(error), finishedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() });
      }
      const latestTargets = await this.repository.listRunTargets(run.id, tenantId);
      const summary = summarizeTargets(latestTargets);
      const processed = summary.succeeded + summary.failed + summary.skipped + summary.cancelled;
      const failureRate = processed === 0 ? 0 : summary.failed / processed;
      if ((version.guardrails.failureCountThreshold && consecutiveFailures >= version.guardrails.failureCountThreshold)
        || (version.guardrails.failureRateThreshold && failureRate >= version.guardrails.failureRateThreshold)) {
        for (const pending of latestTargets.filter((item) => item.status === 'pending')) {
          await this.repository.updateRunTarget(pending.id, tenantId, { status: 'cancelled', finishedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() });
        }
        run = await this.repository.updateRun(run.id, tenantId, { status: 'needs_attention', failureStage: latestTargets.find((item) => item.status === 'failed')?.failureStage, targetSummary: summarizeTargets(await this.repository.listRunTargets(run.id, tenantId)), finishedAt: this.clock().toISOString() });
        return run;
      }
    }
    return this.finish(run.id, tenantId);
  }

  async stop(runId: string, tenantId: string): Promise<AutomationRunDto> {
    const run = await this.requireRun(runId, tenantId);
    for (const target of (await this.repository.listRunTargets(runId, tenantId)).filter((item) => item.status === 'pending')) {
      await this.repository.updateRunTarget(target.id, tenantId, { status: 'cancelled', finishedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() });
    }
    return this.repository.updateRun(run.id, tenantId, { status: 'stopped', targetSummary: summarizeTargets(await this.repository.listRunTargets(runId, tenantId)), finishedAt: this.clock().toISOString() });
  }

  async retryFailed(runId: string, tenantId: string, actorId: string, idempotencyKey: string): Promise<AutomationRunDto> {
    const source = await this.requireRun(runId, tenantId);
    const existing = await this.repository.findRunByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;
    const failedTargets = (await this.repository.listRunTargets(runId, tenantId)).filter((target) => target.status === 'failed');
    const now = this.clock().toISOString();
    const retry = { ...source, id: newId('arun'), triggerType: 'retry' as const, parentRunId: source.id, idempotencyKey, status: 'queued' as const, targetSummary: { total: failedTargets.length, pending: failedTargets.length, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 }, failureStage: undefined, failureCode: undefined, failureMessage: undefined, startedAt: undefined, finishedAt: undefined, createdBy: actorId, createdAt: now };
    await this.repository.transaction(async (repository) => {
      await repository.createRun(retry);
      for (const [index, target] of failedTargets.entries()) await repository.createRunTarget({ ...target, id: newId('art'), runId: retry.id, sequenceNo: index + 1, status: 'pending', currentAction: undefined, failureStage: undefined, deploymentPlanId: undefined, executionRunId: undefined, notificationRequestIds: [], errorCode: undefined, errorMessage: undefined, startedAt: undefined, finishedAt: undefined, createdAt: now, updatedAt: now });
    });
    return retry;
  }

  private async finish(runId: string, tenantId: string): Promise<AutomationRunDto> {
    const targets = await this.repository.listRunTargets(runId, tenantId);
    const summary = summarizeTargets(targets);
    const status = summary.waitingApproval > 0 ? 'waiting_approval' : summary.running > 0 ? 'running' : summary.failed === 0 ? 'succeeded' : summary.succeeded > 0 ? 'partially_succeeded' : 'failed';
    return this.repository.updateRun(runId, tenantId, { status, targetSummary: summary, failureStage: targets.find((item) => item.status === 'failed')?.failureStage, finishedAt: ['succeeded', 'partially_succeeded', 'failed'].includes(status) ? this.clock().toISOString() : undefined });
  }

  private async requireRun(runId: string, tenantId: string): Promise<AutomationRunDto> {
    const run = await this.repository.getRun(runId, tenantId);
    if (!run) throw new Error(`automation run not found: ${runId}`);
    return run;
  }
}
