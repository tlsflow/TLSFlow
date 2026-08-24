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
      '/reports/incident-window',
      '/settings'
    ])
  })

  it('证书部署和工作流作为顶层菜单按权限展示', () => {
    const store = usePermissionStore()

    store.setPermissions(['execution.read'])
    expect(store.visibleMenuItems.map((item) => item.titleKey)).toEqual(['nav.deployments'])
    expect(store.visibleMenuItems[0]?.path).toBe('/executions')
    expect(store.visibleMenuItems[0]?.activePaths).toEqual(['/deployment-plans', '/executions'])
    expect(store.visibleMenuItems[0]?.children?.map((item) => item.titleKey)).toEqual(['nav.executions'])

    store.setPermissions(['plugin.read'])
    expect(store.visibleMenuItems.map((item) => item.titleKey)).toEqual(['nav.workflows'])
    expect(store.visibleMenuItems[0]?.path).toBe('/plugins')
    expect(store.visibleMenuItems[0]?.activePaths).toEqual(['/workflow-templates', '/plugins'])
    expect(store.visibleMenuItems[0]?.children?.map((item) => item.titleKey)).toEqual(['nav.plugins'])
  })

  it('报表菜单只对 report.read 权限开放', () => {
    const store = usePermissionStore()

    store.setPermissions(['report.read'])

    expect(store.visibleMenuItems.map((item) => item.titleKey)).toEqual(['nav.reports'])
    expect(store.visibleMenuItems[0]?.children?.map((item) => item.path)).toEqual([
      '/reports/incident-window',
      '/reports/risk-response',
      '/reports/automation-effectiveness'
    ])
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
