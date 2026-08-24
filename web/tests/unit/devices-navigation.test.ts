import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'
import { mainMenuItems } from '@/router/menu'

describe('统一设备导航', () => {
  it('注册设备页面并保留 Agent 参数重定向', () => {
    const devices = businessRoutes.find((route) => route.path === '/devices')
    const agents = businessRoutes.find((route) => route.path === '/agents')
    expect(devices?.meta?.permission).toBe('host.read')
    expect(typeof agents?.redirect).toBe('function')

    const redirect = (agents?.redirect as (to: { query: Record<string, string>; hash: string }) => unknown)({ query: { status: 'online' }, hash: '#list' })
    expect(redirect).toEqual({ path: '/assets/devices', query: { status: 'online' }, hash: '#list' })
  })

  it('主菜单只暴露统一设备入口', () => {
    const assetsMenu = mainMenuItems.find((item) => item.path === '/assets')
    expect(assetsMenu?.children?.find((item) => item.path === '/assets/devices')).toMatchObject({ titleKey: 'nav.devices' })
    expect(assetsMenu?.children?.some((item) => item.path === '/agents')).toBe(false)
  })
})
