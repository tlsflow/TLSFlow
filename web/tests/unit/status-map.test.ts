import { describe, expect, it } from 'vitest'
import { resolveRiskMeta } from '@/design-system/status/risk-map'
import { resolveStatusMeta } from '@/design-system/status/status-map'

describe('状态和风险映射', () => {
  it('把英文部署状态映射为中文文案', () => {
    expect(resolveStatusMeta('PENDING_APPROVAL')).toEqual({ label: '待审批', tone: 'warning' })
  })

  it('未知状态不崩溃，按 muted 展示原值', () => {
    expect(resolveStatusMeta('NEW_BACKEND_STATUS')).toEqual({ label: 'NEW_BACKEND_STATUS', tone: 'muted' })
  })

  it('风险等级使用统一文案', () => {
    expect(resolveRiskMeta('CRITICAL').label).toBe('严重')
  })
})
