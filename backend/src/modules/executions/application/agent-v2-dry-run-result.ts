import { AppError } from '../../../common/errors/app-error.js';

export function normalizeAgentV2DryRunDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const existingChecks = readRecordArray(detail.dryRunChecks);
  if (existingChecks.length > 0) {
    return detail.dryRunSummary ? detail : { ...detail, dryRunSummary: summarizeDryRunChecks(existingChecks) };
  }

  const operationResults = readRecordArray(detail.operationResults);
  if (operationResults.length === 0) return detail;

  const dryRunChecks = operationResults.map((operation, index) => {
    const operationId = requiredOperationString(operation, 'operationId', index);
    const operationType = requiredOperationString(operation, 'operationType', index);
    const stage = requiredOperationString(operation, 'stage', index);
    const errorMessage = readString(operation, 'errorMessage');
    const status = normalizeOperationStatus(operation.status);
    const result = readRecord(operation.detail);
    return {
      key: `atomic:${operationId}`,
      label: `${operationId} · ${operationType}`,
      status,
      detail: describePreflight(operationId, operationType, status, result, errorMessage),
      evidence: {
        operationId,
        operationType,
        stage,
        ...(result ? { result } : {}),
        ...(readString(operation, 'errorCode') ? { errorCode: readString(operation, 'errorCode') } : {}),
      },
    };
  });

  return {
    ...detail,
    dryRunChecks,
    dryRunSummary: summarizeDryRunChecks(dryRunChecks),
  };
}

function describePreflight(
  operationId: string,
  operationType: string,
  status: 'passed' | 'failed' | 'warning' | 'unknown',
  result: Record<string, unknown> | undefined,
  errorMessage: string | undefined,
): string {
  const path = result ? readString(result, 'path') : undefined;
  const program = result ? readString(result, 'program') : undefined;
  const serviceName = result ? readString(result, 'serviceName') : undefined;
  const plannedAction = result ? readString(result, 'plannedAction') : undefined;
  if (operationType === 'preflight.assert') {
    if (path) return `已检查路径权限和可访问性：${path}。`;
    if (program) return `已检查程序权限和可执行文件：${program}。`;
  }
  if (operationType === 'file.backup') {
    return result?.exists === false
      ? `正式部署会尝试备份 ${path ?? operationId}；当前文件不存在，因此没有旧文件可备份。`
      : `正式部署会先备份 ${path ?? operationId}；当前文件已存在且可读取。`;
  }
  if (operationType === 'file.atomic_replace') {
    return `正式部署会原子写入 ${path ?? operationId}；已验证路径权限和部署内容，预演未修改文件。`;
  }
  if (operationType === 'file.set_permissions') {
    return `正式部署会调整 ${path ?? operationId} 的文件权限；预演未修改权限。`;
  }
  if (operationType === 'command.execute_allowlisted') {
    const args = Array.isArray(result?.args) ? result.args.map(String).join(' ') : '';
    return `正式部署将执行命令：${[program, args].filter(Boolean).join(' ')}；预演仅验证程序、参数和权限，未执行命令。`;
  }
  if (operationType === 'service.control') {
    const currentState = result?.currentStateCheckPassed === true ? '服务当前处于活动状态' : '未确认服务处于活动状态';
    return `正式部署将对服务 ${serviceName ?? operationId} 执行 ${plannedAction ?? '控制操作'}；${currentState}，预演未执行服务变更。`;
  }
  if (errorMessage) return errorMessage;
  if (status === 'warning') return `原子操作 ${operationId} 已完成预演，但存在需要关注的条件。`;
  if (status === 'passed') return `原子操作 ${operationId} 已完成非破坏性预演。`;
  if (status === 'failed') return `原子操作 ${operationId} 预演失败。`;
  return `原子操作 ${operationId} 未返回明确预演状态。`;
}

function summarizeDryRunChecks(checks: readonly Record<string, unknown>[]): { passed: number; failed: number; warning: number; unknown: number } {
  const summary = { passed: 0, failed: 0, warning: 0, unknown: 0 };
  for (const check of checks) summary[normalizeOperationStatus(check.status)] += 1;
  return summary;
}

function normalizeOperationStatus(value: unknown): 'passed' | 'failed' | 'warning' | 'unknown' {
  const status = String(value ?? '').trim().toUpperCase();
  if (status === 'SUCCEEDED' || status === 'SUCCESS' || status === 'PASSED') return 'passed';
  if (status === 'FAILED' || status === 'ERROR') return 'failed';
  if (status === 'WARNING' || status === 'WARN') return 'warning';
  return 'unknown';
}

function requiredOperationString(value: Record<string, unknown>, field: string, index: number): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new AppError('VALIDATION_FAILED', `Agent v2 operationResults[${index}] 缺少 ${field}`);
  }
  return candidate.trim();
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: Record<string, unknown>, field: string): string | undefined {
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}
