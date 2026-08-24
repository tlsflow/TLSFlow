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
    store.setPermissions([])
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
      '/automations',
      '/plugins',
      '/monitors',
      '/audits',
      '/settings'
    ])
    const settings = store.visibleMenuItems.find((item) => item.path === '/settings')
    expect(settings?.children?.map((item) => item.path)).toEqual([
      '/settings',
      '/settings/users',
      '/settings/roles',
      '/settings/credentials',
      '/settings/notifications',
      '/settings/licensing',
      '/settings/identity-sources'
    ])
    expect(settings?.children?.map((item) => item.path)).not.toContain('/settings/version')
    expect(settings?.children?.map((item) => item.path)).not.toContain('/settings/tenant-architecture')
    expect(settings?.activePaths).toEqual(['/settings/tenant-architecture', '/settings/version'])
    const monitoring = store.visibleMenuItems.find((item) => item.path === '/monitors')
    expect(monitoring?.children).toBeUndefined()
    expect(store.visibleMenuItems.find((item) => item.path === '/audits')).toBeTruthy()
  })

  it('通知读取权限会显示设置下的通知中心标签', () => {
    const store = usePermissionStore()
    store.setPermissions(['notification.channel.read'])
    expect(store.visibleMenuItems.map((item) => item.path)).toEqual(['/dashboard', '/settings/notifications'])
    const notifications = store.visibleMenuItems.find((item) => item.path === '/settings/notifications')
    expect(notifications?.children?.map((item) => item.path)).toEqual(['/settings/notifications'])
  })

  it('证书部署导航按可见标签选择入口', () => {
    const store = usePermissionStore()

    store.setPermissions(['execution.run.read'])
    expect(store.visibleMenuItems.map((item) => item.titleKey)).toEqual(['nav.dashboard', 'nav.deployments'])
    const deployments = store.visibleMenuItems.find((item) => item.titleKey === 'nav.deployments')
    expect(deployments?.path).toBe('/executions')
    expect(deployments?.activePaths).toEqual(['/deployment-plans', '/workflows', '/automations', '/automation-runs', '/executions'])
    expect(deployments?.children?.map((item) => item.titleKey)).toEqual(['nav.executions'])

    store.setPermissions(['automation.read'])
    expect(store.visibleMenuItems.map((item) => item.titleKey)).toEqual(['nav.dashboard', 'nav.deployments'])
    const automations = store.visibleMenuItems.find((item) => item.titleKey === 'nav.deployments')
    expect(automations?.path).toBe('/automations')
    expect(automations?.children?.map((item) => item.titleKey)).toEqual(['nav.automations'])

    store.setPermissions(['plugin.read'])
    expect(store.visibleMenuItems.map((item) => item.titleKey)).toEqual(['nav.dashboard', 'nav.plugins'])
    const plugins = store.visibleMenuItems.find((item) => item.titleKey === 'nav.plugins')
    expect(plugins?.path).toBe('/plugins')
    expect(plugins?.activePaths).toBeUndefined()
    expect(plugins?.children).toBeUndefined()
  })

  it('只有历史部署计划读取权限时不显示空的部署导航组', () => {
    const store = usePermissionStore()
    store.setPermissions(['deployment.plan.read'])
    expect(store.visibleMenuItems.map((item) => item.titleKey)).toEqual(['nav.dashboard'])
  })

  it('报表暂时不显示主菜单入口', () => {
    const store = usePermissionStore()

    store.setPermissions(['report.read'])

    expect(store.visibleMenuItems.some((item) => item.path.startsWith('/reports'))).toBe(false)
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
    expect(store.visibleMenuItems.map((item) => item.path)).toEqual(['/dashboard', '/certificates'])
    const certificates = store.visibleMenuItems.find((item) => item.path === '/certificates')
    expect(certificates?.children?.map((item) => item.path)).toEqual(['/certificates', '/acme'])
  })

  it('对象级证书和应用资产权限会隐式放开对应页面入口', async () => {
    const store = usePermissionStore()
    store.$patch({
      permissions: [],
      objectSets: [
        { id: 'oset_cert', objectTypes: ['certificate'] },
        { id: 'oset_asset', objectTypes: ['service_asset'] }
      ],
      roleBindings: [],
      objectPermissionVersion: 'test',
      expiresAt: new Date('2026-08-07T12:00:00.000Z').toISOString(),
      loadedAt: new Date('2026-08-07T11:55:00.000Z').toISOString()
    })

    expect(store.hasPermission('certificate.asset.read')).toBe(true)
    expect(store.hasPermission('service_asset.read')).toBe(true)
    expect(store.visibleMenuItems.map((item) => item.path)).toEqual(['/dashboard', '/certificates', '/assets'])
    const certificates = store.visibleMenuItems.find((item) => item.path === '/certificates')
    expect(certificates?.children?.map((item) => item.path)).toEqual(['/certificates', '/acme'])
    const assets = store.visibleMenuItems.find((item) => item.path === '/assets')
    expect(assets?.children?.map((item) => item.path)).toEqual(['/assets'])
  })

  it('兼容历史前端权限名与后端真实动作名映射', () => {
    const store = usePermissionStore()
    store.setPermissions(['workflow.read', 'execution.run.read', 'monitor.target.read'])

    expect(store.hasPermission('workflow.template.read')).toBe(true)
    expect(store.hasPermission('execution.read')).toBe(true)
    expect(store.hasPermission('monitor.read')).toBe(true)
  })
})
