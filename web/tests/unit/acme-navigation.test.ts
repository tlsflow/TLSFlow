import { describe, expect, it } from 'vitest'
import { mainMenuItems } from '@/router/menu'
import { businessRoutes } from '@/router/modules/business'

describe('ACME 证书自动化导航', () => {
  it('在证书管理二级导航中提供 ACME 标签和对应路由', () => {
    const certificateMenu = mainMenuItems.find((item) => item.path === '/certificates')
    expect(certificateMenu?.children?.some((item) => item.path === '/acme')).toBe(true)
    expect(businessRoutes.find((item) => item.path === '/acme')).toMatchObject({
      name: 'acme.automation',
      meta: { titleKey: 'nav.acmeAutomation', permission: 'certificate.asset.read' },
    })
  })
})
