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
      '/monitors',
      '/settings'
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
