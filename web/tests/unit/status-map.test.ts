import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { resolveRiskMeta } from '@/design-system/status/risk-map'
import { resolveStatusMeta } from '@/design-system/status/status-map'

const translate = (key: string) => String(i18n.global.t(key))

describe('状态和风险映射', () => {
  it('把英文部署状态映射为中文文案', () => {
    expect(resolveStatusMeta('PENDING_APPROVAL', translate)).toEqual({ label: '待审批', tone: 'warning' })
  })

  it('把凭据启用状态映射为成功色中文标签', () => {
    expect(resolveStatusMeta('active', translate)).toEqual({ label: '已启用', tone: 'success' })
    expect(resolveStatusMeta('disabled', translate)).toEqual({ label: '已停用', tone: 'muted' })
  })

  it('未知状态不崩溃，按 muted 展示原值', () => {
    expect(resolveStatusMeta('NEW_BACKEND_STATUS')).toEqual({ label: 'NEW_BACKEND_STATUS', tone: 'muted' })
  })

  it('风险等级使用统一文案', () => {
    expect(resolveRiskMeta('CRITICAL', translate).label).toBe('严重')
  })
})
