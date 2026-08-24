import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePermissionStore } from '@/stores/permission.store'

describe('权限 Store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('按权限过滤菜单', () => {
    const store = usePermissionStore()
    store.setPermissions(['dashboard.read'])
    expect(store.visibleMenuItems.map((item) => item.path)).toEqual(['/dashboard'])
  })

  it('mock 权限覆盖核心入口', async () => {
    const store = usePermissionStore()
    await store.loadMockPermissions()
    expect(store.hasPermission('certificate.asset.read')).toBe(true)
    expect(store.visibleMenuItems.length).toBeGreaterThan(8)
  })
})
