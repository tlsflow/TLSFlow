import { describe, expect, it } from 'vitest'
import { normalizeCaSyncRuns, type CaSyncRun } from '@/api/modules/ca-operations.api'

const run: CaSyncRun = {
  id: 'sync-1',
  providerId: 'provider-1',
  caId: 'ca-1',
  objectType: 'request',
  mode: 'incremental',
  status: 'queued',
  readCount: 0,
  upsertedCount: 0,
  failedCount: 0,
  createdAt: '2026-08-12T00:00:00.000Z',
  updatedAt: '2026-08-12T00:00:00.000Z',
}

describe('CA 运营同步运行响应适配', () => {
  it('读取统一任务控制面返回的 items 包装', () => {
    expect(normalizeCaSyncRuns({ items: [run] })).toEqual([run])
  })

  it('兼容历史数组响应并对空响应失败关闭', () => {
    expect(normalizeCaSyncRuns([run])).toEqual([run])
    expect(normalizeCaSyncRuns(undefined)).toEqual([])
  })
})
