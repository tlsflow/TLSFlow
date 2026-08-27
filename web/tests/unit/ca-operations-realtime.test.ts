import { describe, expect, it } from 'vitest'
import { parseCaOperationsRealtimeMessage } from '@/views/ca-operations/ca-operations-realtime'

describe('CA 运营实时消息', () => {
  it('解析快照消息', () => {
    expect(parseCaOperationsRealtimeMessage(JSON.stringify({
      type: 'snapshot',
      emittedAt: '2026-08-27T01:00:00.000Z',
    }))).toEqual({
      type: 'snapshot',
      emittedAt: '2026-08-27T01:00:00.000Z',
    })
  })

  it('解析 CA 变更消息', () => {
    expect(parseCaOperationsRealtimeMessage(JSON.stringify({
      type: 'ca.changed',
      caId: 'ca-1',
      providerId: 'provider-1',
      objectTypes: ['request', 'issuance'],
      emittedAt: '2026-08-27T01:00:00.000Z',
    }))).toEqual({
      type: 'ca.changed',
      caId: 'ca-1',
      providerId: 'provider-1',
      objectTypes: ['request', 'issuance'],
      emittedAt: '2026-08-27T01:00:00.000Z',
    })
  })

  it('拒绝缺少身份字段的消息', () => {
    expect(parseCaOperationsRealtimeMessage(JSON.stringify({
      type: 'ca.changed',
      caId: 'ca-1',
      objectTypes: ['request'],
    }))).toBeUndefined()
  })
})
