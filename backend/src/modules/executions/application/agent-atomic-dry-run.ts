export function normalizeAgentAtomicDryRunDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const existingChecks = readRecords(detail.dryRunChecks);
  if (existingChecks.length > 0) {
    return detail.dryRunSummary ? detail : { ...detail, dryRunSummary: summarize(existingChecks) };
  }

  const operationResults = readRecords(detail.operationResults);
  if (operationResults.length === 0) return detail;

  const dryRunChecks = operationResults.map((operation, index) => {
    const operationId = readString(operation.operationId) ?? 'operation-' + (index + 1);
    const operationType = readString(operation.operationType) ?? operationId;
    const stage = readString(operation.stage);
    const errorMessage = readString(operation.errorMessage);
    const status = normalizeAtomicStatus(operationType, stage, operation.status, errorMessage);
    const result = readRecord(operation.detail);
    return {
      key: 'atomic:' + operationId,
      label: operationId + ' · ' + operationType,
      status,
      detail: describeAtomicPreflight(operationId, operationType, status, result, errorMessage),
      evidence: {
        operationId,
        operationType,
        stage,
        ...(result ? { result } : {}),
        ...(readString(operation.errorCode) ? { errorCode: readString(operation.errorCode) } : {}),
      },
    };
  });

  return {
    ...detail,
    dryRunChecks,
    dryRunSummary: summarize(dryRunChecks),
  };
}

function describeAtomicPreflight(
  operationId: string,
  operationType: string,
  status: 'passed' | 'failed' | 'warning' | 'unknown',
  result: Record<string, unknown> | undefined,
  errorMessage: string | undefined,
): string {
  const path = readString(result?.path);
  const program = readString(result?.program);
  const serviceName = readString(result?.serviceName);
  const plannedAction = readString(result?.plannedAction);
  if (operationType === 'preflight.assert') {
    if (path) return '已检查路径权限和可访问性：' + path + '。';
    if (program) return '已检查程序权限和可执行文件：' + program + '。';
  }
  if (operationType === 'file.backup') {
    return result?.exists === false
      ? '正式部署会尝试备份 ' + (path ?? operationId) + '；当前文件不存在，因此没有旧文件可备份。'
      : '正式部署会先备份 ' + (path ?? operationId) + '；当前文件已存在且可读取。';
  }
  if (operationType === 'file.atomic_replace') {
    return '正式部署会原子写入 ' + (path ?? operationId) + '；已验证路径权限和部署内容，预演未修改文件。';
  }
  if (operationType === 'file.set_permissions') {
    return '正式部署会调整 ' + (path ?? operationId) + ' 的文件权限；预演未修改权限。';
  }
  if (operationType === 'command.execute') {
    const args = Array.isArray(result?.args) ? result.args.map(String).join(' ') : '';
    return '正式部署将执行命令：' + [program, args].filter(Boolean).join(' ') + '；预演仅验证程序、参数和权限，未执行命令。';
  }
  if (operationType === 'service.control') {
    const currentState = result?.currentStateCheckPassed === true ? '服务当前处于活动状态' : '未确认服务处于活动状态';
    return '正式部署将对服务 ' + (serviceName ?? operationId) + ' 执行 ' + (plannedAction ?? '控制操作') + '；' + currentState + '，预演未执行服务变更。';
  }
  if (errorMessage) return errorMessage;
  if (status === 'warning') return '原子操作 ' + operationId + ' 已完成预演，但存在需要关注的条件。';
  if (status === 'passed') return '原子操作 ' + operationId + ' 已完成非破坏性预演。';
  if (status === 'failed') return '原子操作 ' + operationId + ' 预演失败。';
  return '原子操作 ' + operationId + ' 未返回明确预演状态。';
}

function normalizeAtomicStatus(
  operationType: string,
  stage: string | undefined,
  rawStatus: unknown,
  errorMessage: string | undefined,
): 'passed' | 'failed' | 'warning' | 'unknown' {
  const status = normalizeStatus(rawStatus);
  return status;
}

interface DryRunSummary {
  passed: number;
  failed: number;
  warning: number;
  unknown: number;
}

function summarize(checks: readonly Record<string, unknown>[]): DryRunSummary {
  return checks.reduce<DryRunSummary>((summary, check) => {
    const status = normalizeStatus(check.status);
    summary[status] += 1;
    return summary;
  }, { passed: 0, failed: 0, warning: 0, unknown: 0 });
}

function normalizeStatus(value: unknown): 'passed' | 'failed' | 'warning' | 'unknown' {
  const status = String(value ?? '').trim().toUpperCase();
  if (status === 'SUCCEEDED' || status === 'SUCCESS' || status === 'PASSED') return 'passed';
  if (status === 'FAILED' || status === 'ERROR') return 'failed';
  if (status === 'WARNING' || status === 'WARN') return 'warning';
  return 'unknown';
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
