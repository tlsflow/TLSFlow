import { describe, expect, it } from 'vitest'
import { buildAcmeTaskAttemptHistory } from '@/views/tasks/acme-task-history'

describe('buildAcmeTaskAttemptHistory', () => {
  it('将等待重试的失败尝试展示为自动重试，而不是续签失败', () => {
    expect(buildAcmeTaskAttemptHistory([
      {
        id: 'attempt-1',
        attemptNo: 1,
        status: 'FAILED',
        errorCode: 'ACME_RENEWAL_PENDING',
        startedAt: '2026-08-13T12:37:55.250Z',
        finishedAt: '2026-08-13T12:37:55.400Z',
      },
      {
        id: 'attempt-2',
        attemptNo: 2,
        status: 'SUCCEEDED',
        startedAt: '2026-08-13T13:19:54.870Z',
        finishedAt: '2026-08-13T13:21:06.847Z',
      },
    ])).toEqual([
      {
        id: 'attempt-1',
        attemptNo: 1,
        state: 'retryWaiting',
        startedAt: '2026-08-13T12:37:55.250Z',
        finishedAt: '2026-08-13T12:37:55.400Z',
      },
      {
        id: 'attempt-2',
        attemptNo: 2,
        state: 'succeeded',
        startedAt: '2026-08-13T13:19:54.870Z',
        finishedAt: '2026-08-13T13:21:06.847Z',
      },
    ])
  })
})
