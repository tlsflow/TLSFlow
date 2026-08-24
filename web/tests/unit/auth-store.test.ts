import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth.store'

const apiMocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }))
vi.mock('@/api/modules/security.api', () => apiMocks)

describe('认证 Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('刷新当前用户时保留前端会话模型并将角色对象转换为角色编码', async () => {
    apiMocks.getCurrentUser.mockResolvedValue({ data: { user: { id: 'user-1', username: 'admin', displayName: '新管理员', tenantId: 'tenant-b', tenantName: '公司 B', roles: [{ code: 'tenant.admin' }] } } })

    await useAuthStore().refreshCurrentUser()

    expect(useAuthStore().user).toEqual({ id: 'user-1', username: 'admin', displayName: '新管理员', tenantId: 'tenant-b', tenantName: '公司 B', roles: ['tenant.admin'] })
  })
})
