import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePermissionStore } from '@/stores/permission.store'
import { resetPermissionProvider, setPermissionProvider } from '@/providers/permission.provider'

describe('权限 Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetPermissionProvider()
  })

  it('按权限过滤菜单', () => {
    const store = usePermissionStore()
    store.setPermissions(['dashboard.read'])
    expect(store.visibleMenuItems.map((item) => item.path)).toEqual(['/dashboard'])
  })

  it('管理员通配权限可以看到全部顶部菜单', () => {
    const store = usePermissionStore()
    store.setPermissions(['*'])
    expect(store.hasPermission('security.identity_source.write')).toBe(true)
    expect(store.visibleMenuItems.map((item) => item.path)).toEqual([
      '/dashboard',
      '/certificates',
      '/assets',
      '/deployment-plans',
      '/workflow-templates',
      '/monitors',
      '/settings'
    ])
    const settings = store.visibleMenuItems.find((item) => item.path === '/settings')
    expect(settings?.children?.map((item) => item.path)).toContain('/settings/notifications')
  })

  it('通知读取权限会显示设置下的通知中心标签', () => {
    const store = usePermissionStore()
    store.setPermissions(['notification.channel.read'])
    expect(store.visibleMenuItems).toHaveLength(1)
    expect(store.visibleMenuItems[0]?.path).toBe('/settings/notifications')
    expect(store.visibleMenuItems[0]?.children?.map((item) => item.path)).toEqual(['/settings/notifications'])
  })

  it('证书部署和工作流作为顶层菜单按权限展示', () => {
    const store = usePermissionStore()

    store.setPermissions(['execution.read'])
    expect(store.visibleMenuItems.map((item) => item.title)).toEqual(['证书部署'])
    expect(store.visibleMenuItems[0]?.path).toBe('/executions')
    expect(store.visibleMenuItems[0]?.activePaths).toEqual(['/deployment-plans', '/executions'])
    expect(store.visibleMenuItems[0]?.children?.map((item) => item.title)).toEqual(['执行记录'])

    store.setPermissions(['plugin.read'])
    expect(store.visibleMenuItems.map((item) => item.title)).toEqual(['工作流'])
    expect(store.visibleMenuItems[0]?.path).toBe('/plugins')
    expect(store.visibleMenuItems[0]?.activePaths).toEqual(['/workflow-templates', '/plugins'])
    expect(store.visibleMenuItems[0]?.children?.map((item) => item.title)).toEqual(['插件'])
  })

  it('通过 Provider 加载权限', async () => {
    setPermissionProvider({
      async loadPermissions() {
        return ['certificate.asset.read']
      }
    })
    const store = usePermissionStore()
    await store.loadPermissions()
    expect(store.hasPermission('certificate.asset.read')).toBe(true)
    expect(store.visibleMenuItems.map((item) => item.path)).toEqual(['/certificates'])
    expect(store.visibleMenuItems[0]?.children?.map((item) => item.path)).toEqual(['/certificates'])
  })
})
