import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import { useTenantStore } from '@/stores/tenant.store'
import { resetPermissionProvider, setPermissionProvider } from '@/providers/permission.provider'

const apiMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getTenantContext: vi.fn(),
  listAccessibleTenants: vi.fn(),
  switchTenant: vi.fn(),
}))
const taskMocks = vi.hoisted(() => ({ resetTaskRealtimeConnection: vi.fn() }))

vi.mock('@/api/modules/security.api', () => apiMocks)
vi.mock('@/views/tasks/task-events', () => taskMocks)

describe('租户 Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetPermissionProvider()
    useAuthStore().setSession({
      token: 'token-a',
      user: { id: 'user-1', username: 'admin', displayName: '管理员', tenantId: 'tenant-a', tenantName: '公司 A', roles: ['old-role'] },
    })
    usePermissionStore().setPermissions(['old.permission'])
    useTenantStore().$patch({
      currentTenantId: 'tenant-a',
      mode: 'hierarchical',
      contextVersion: 'context-a',
      tenants: [
        { id: 'tenant-a', tenantId: 'tenant-a', name: '公司 A', code: 'a', type: 'COMPANY', membershipType: 'admin', membershipStatus: 'ACTIVE', current: true, canSwitch: true, mode: 'hierarchical' },
        { id: 'tenant-b', tenantId: 'tenant-b', name: '公司 B', code: 'b', type: 'COMPANY', membershipType: 'admin', membershipStatus: 'ACTIVE', current: false, canSwitch: true, mode: 'hierarchical' },
      ],
    })
  })

  it('切换时原子刷新 token、用户、权限、可访问租户和实时连接', async () => {
    apiMocks.switchTenant.mockResolvedValue({ data: { token: 'token-b', currentTenantId: 'tenant-b', homeTenantId: 'tenant-a', accessibleTenantIds: ['tenant-a', 'tenant-b'], mode: 'hierarchical', version: 'context-b' } })
    apiMocks.getCurrentUser.mockResolvedValue({ data: { user: { id: 'user-1', username: 'admin', displayName: '管理员', tenantId: 'tenant-b', tenantName: '公司 B', roles: [{ code: 'new-role' }] } } })
    setPermissionProvider({
      async loadPermissions() { return ['unused'] },
      async loadPermissionContext() {
        return { user: {} as never, roles: [], permissions: ['new.permission'], objectSets: [], roleBindings: [], objectPermissionVersion: 'permission-b', expiresAt: '2026-08-14T12:00:00.000Z' }
      },
    })
    apiMocks.listAccessibleTenants.mockResolvedValue({ data: { currentTenantId: 'tenant-b', version: 'context-b', mode: 'hierarchical', items: [
      { tenantId: 'tenant-a', name: '公司 A', code: 'a', type: 'COMPANY', membershipType: 'admin', membershipStatus: 'ACTIVE', current: false, canSwitch: true, mode: 'hierarchical' },
      { tenantId: 'tenant-b', name: '公司 B', code: 'b', type: 'COMPANY', membershipType: 'admin', membershipStatus: 'ACTIVE', current: true, canSwitch: true, mode: 'hierarchical' },
    ] } })

    await useTenantStore().switchTenant('tenant-b')

    expect(apiMocks.switchTenant).toHaveBeenCalledWith({ tenantId: 'tenant-b', contextVersion: 'context-a' })
    expect(useAuthStore().token).toBe('token-b')
    expect(useAuthStore().user).toMatchObject({ tenantId: 'tenant-b', tenantName: '公司 B', roles: ['new-role'] })
    expect(usePermissionStore().hasPermission('new.permission')).toBe(true)
    expect(usePermissionStore().hasPermission('old.permission')).toBe(false)
    expect(useTenantStore()).toMatchObject({ currentTenantId: 'tenant-b', contextVersion: 'context-b', switching: false })
    expect(taskMocks.resetTaskRealtimeConnection).toHaveBeenCalledTimes(1)
  })

  it('后续刷新失败时恢复旧租户、token、用户和权限，避免半切换', async () => {
    apiMocks.switchTenant.mockResolvedValue({ data: { token: 'token-b', currentTenantId: 'tenant-b', homeTenantId: 'tenant-a', accessibleTenantIds: ['tenant-a', 'tenant-b'], mode: 'hierarchical', version: 'context-b' } })
    apiMocks.getCurrentUser.mockRejectedValue(new Error('AUTH_CONTEXT_EMPTY'))

    await expect(useTenantStore().switchTenant('tenant-b')).rejects.toThrow('AUTH_CONTEXT_EMPTY')

    expect(useAuthStore().token).toBe('token-a')
    expect(useAuthStore().user).toMatchObject({ tenantId: 'tenant-a', roles: ['old-role'] })
    expect(usePermissionStore().hasPermission('old.permission')).toBe(true)
    expect(useTenantStore()).toMatchObject({ currentTenantId: 'tenant-a', contextVersion: 'context-a', switching: false, errorCode: 'AUTH_CONTEXT_EMPTY' })
    expect(taskMocks.resetTaskRealtimeConnection).toHaveBeenCalledTimes(2)
  })

  it('single 模式与非直接成员关系均不显示租户切换入口', () => {
    const store = useTenantStore()
    store.$patch({ mode: 'single' })
    expect(store.hasTenantSwitcher).toBe(false)
    store.$patch({ mode: 'hierarchical', tenants: [{ ...store.tenants[0]!, canSwitch: false }] })
    expect(store.hasTenantSwitcher).toBe(false)
  })
})
