export type AcmeTaskAttemptState = 'queued' | 'running' | 'retryWaiting' | 'succeeded' | 'failed' | 'cancelled'

export interface AcmeTaskAttemptHistoryItem {
  readonly id: string
  readonly attemptNo: number
  readonly state: AcmeTaskAttemptState
  readonly startedAt?: string
  readonly finishedAt?: string
}

/**
 * 将统一任务的尝试记录归并为 ACME 续签的用户可读状态。
 * 任务尝试标为 FAILED 但 errorCode 是 ACME_RENEWAL_PENDING 时，表示本次未完成并将自动重试，不能误报为续签失败。
 */
export function buildAcmeTaskAttemptHistory(attempts: readonly Record<string, unknown>[]): AcmeTaskAttemptHistoryItem[] {
  return attempts.map((attempt, index) => ({
    id: recordString(attempt, 'id') || `acme-attempt-${index + 1}`,
    attemptNo: recordNumber(attempt, 'attemptNo') ?? index + 1,
    state: attemptState(recordString(attempt, 'status'), recordString(attempt, 'errorCode')),
    startedAt: recordString(attempt, 'startedAt'),
    finishedAt: recordString(attempt, 'finishedAt'),
  }))
}

function attemptState(status: string, errorCode: string): AcmeTaskAttemptState {
  if (errorCode === 'ACME_RENEWAL_PENDING') return 'retryWaiting'
  if (status === 'SUCCEEDED') return 'succeeded'
  if (status === 'RUNNING') return 'running'
  if (status === 'CANCELLED') return 'cancelled'
  if (status === 'QUEUED') return 'queued'
  return 'failed'
}

function recordString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key].trim() : ''
}

function recordNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : undefined
}
