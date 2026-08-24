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
    const status = normalizeStatus(operation.status);
    const errorMessage = readString(operation.errorMessage);
    const result = readRecord(operation.detail);
    return {
      key: 'atomic:' + operationId,
      label: operationType,
      status,
      detail: status === 'passed'
        ? '原子预检操作 ' + operationId + ' 执行成功。'
        : errorMessage ?? (status === 'failed'
          ? '原子预检操作 ' + operationId + ' 执行失败。'
          : '原子预检操作 ' + operationId + ' 未返回明确状态。'),
      evidence: {
        operationId,
        operationType,
        stage: readString(operation.stage),
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
