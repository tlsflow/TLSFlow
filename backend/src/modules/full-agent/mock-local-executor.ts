import { redactSensitive } from '../../common/logging/redact.js';
import type { MockExecutionInput, StepExecutionResultLike } from './full-agent.types.js';

function numberFromPayload(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class MockLocalExecutor {
  execute(input: MockExecutionInput): StepExecutionResultLike {
    const startedAt = new Date();
    const payload = input.task.payload ?? {};
    const dryRun = input.dryRun ?? Boolean(payload.dryRun);
    const simulate = typeof payload.simulate === 'string' ? payload.simulate : 'success';
    const durationMs = numberFromPayload(payload, 'durationMs') ?? 1;
    const timeoutMs = input.timeoutMs ?? numberFromPayload(payload, 'timeoutMs') ?? 30_000;
    const redactedPayload = redactSensitive(payload);

    const timedOut = simulate === 'timeout' || durationMs > timeoutMs;
    const failed = simulate === 'failure';
    const status: StepExecutionResultLike['status'] = dryRun ? 'dry_run' : timedOut ? 'timeout' : failed ? 'failed' : 'succeeded';
    const success = status === 'dry_run' || status === 'succeeded';
    const finishedAt = new Date(startedAt.getTime() + Math.min(durationMs, timeoutMs));

    return {
      executionRunId: input.task.executionRunId,
      executionStepId: input.task.executionStepId,
      taskId: input.task.id,
      success,
      status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.min(durationMs, timeoutMs),
      exitCode: success ? 0 : 1,
      stdout: JSON.stringify({ dryRun, payload: redactedPayload }),
      stderr: success ? '' : (timedOut ? 'mock executor timeout' : 'mock executor failure'),
      detail: {
        dryRun,
        simulated: simulate,
        redactedPayload,
      },
      errorCode: success ? undefined : (timedOut ? 'AGENT_TASK_TIMEOUT' : 'MOCK_EXECUTION_FAILED'),
      errorMessage: success ? undefined : (timedOut ? '模拟执行超时' : '模拟执行失败'),
    };
  }
}
