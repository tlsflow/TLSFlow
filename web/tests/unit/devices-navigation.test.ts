import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'
import { mainMenuItems } from '@/router/menu'
import { devicesZhCN } from '@/i18n/devices.locale'

describe('统一资产导航', () => {
  it('注册设备页面并保留 Agent 参数重定向', () => {
    const devices = businessRoutes.find((route) => route.path === '/devices')
    const agents = businessRoutes.find((route) => route.path === '/agents')
    expect(devices?.meta?.permission).toBe('host.read')
    expect(typeof agents?.redirect).toBe('function')

    const redirect = (agents?.redirect as (to: { query: Record<string, string>; hash: string }) => unknown)({ query: { status: 'online' }, hash: '#list' })
    expect(redirect).toEqual({ path: '/assets', query: { status: 'online' }, hash: '#list' })
  })

  it('主菜单只暴露统一资产入口', () => {
    const assetRoute = businessRoutes.find((route) => route.path === '/assets')
    expect(assetRoute?.name).toBe('asset.device.list')
    expect(assetRoute?.component).toBeDefined()
    expect(assetRoute?.redirect).toBeUndefined()

    const assetsMenu = mainMenuItems.find((item) => item.path === '/applications')
    expect(assetsMenu?.children?.find((item) => item.path === '/assets')).toMatchObject({ titleKey: 'devices.page.title' })
    expect(assetsMenu?.children?.some((item) => item.path === '/agents')).toBe(false)
  })

  it('中文资产页使用资产标题及设备详情标题', () => {
    expect(devicesZhCN.page.title).toBe('资产')
    expect(devicesZhCN.detail.title).toBe('设备详情')
  })
})
