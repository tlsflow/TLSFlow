import { describe, expect, it } from 'vitest'
import { mainMenuItems } from '@/router/menu'

describe('监控与日志导航', () => {
  it('将监控分析和日志审计作为两个独立的一级导航页', () => {
    expect(mainMenuItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/monitors',
        titleKey: 'nav.monitoringAnalysis',
        module: 'monitoring',
      }),
      expect.objectContaining({
        path: '/audits',
        titleKey: 'nav.logAudit',
        module: 'audit',
      }),
    ]))

    expect(mainMenuItems.find((item) => item.path === '/monitors')?.children).toBeUndefined()
    expect(mainMenuItems.find((item) => item.path === '/audits')?.children).toBeUndefined()
  })
})
