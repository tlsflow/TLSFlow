import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth.store'

const apiMocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }))
vi.mock('@/api/modules/security.api', () => apiMocks)

describe('认证 Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('刷新当前用户时保留前端会话模型并将角色对象转换为角色编码', async () => {
    apiMocks.getCurrentUser.mockResolvedValue({ data: { user: { id: 'user-1', username: 'admin', displayName: '新管理员', tenantId: 'tenant-b', tenantName: '公司 B', roles: [{ code: 'tenant.admin' }] } } })

    await useAuthStore().refreshCurrentUser()

    expect(useAuthStore().user).toEqual({ id: 'user-1', username: 'admin', displayName: '新管理员', tenantId: 'tenant-b', tenantName: '公司 B', roles: ['tenant.admin'] })
  })

  it('页面刷新后保留会话级 token，Cookie 恢复用户时不清空 token', () => {
    const user = { id: 'user-1', username: 'admin', displayName: '管理员', tenantId: 'tenant-1', tenantName: '租户', roles: ['admin'] }
    const store = useAuthStore()
    store.setSession({ token: 'token-1', user })
    expect(window.sessionStorage.getItem('gcac.auth.session-token')).toBe('token-1')

    setActivePinia(createPinia())
    const refreshed = useAuthStore()
    expect(refreshed.token).toBe('token-1')
    refreshed.setSession({ user })
    expect(refreshed.token).toBe('token-1')
  })
})
