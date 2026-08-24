import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { i18n } from '@/i18n'
import LoginView from '@/views/auth/LoginView.vue'
import { setAuthProvider } from '@/providers/auth.provider'
import { setPermissionProvider } from '@/providers/permission.provider'

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setPermissionProvider({
      async loadPermissions() {
        return []
      }
    })
  })

  it('使用极简登录表单提交后进入仪表盘', async () => {
    const loadPermissions = vi.fn(async () => ({
      user: {
        id: 'user_admin',
        username: 'admin',
        displayName: '系统管理员',
        tenantId: 'default',
        tenantName: '默认租户',
        status: 'active',
        roles: []
      },
      roles: [],
      permissions: ['*'],
      objectSets: [{ id: 'oset_asset', objectTypes: ['application_asset'] }],
      roleBindings: [],
      objectPermissionVersion: 'test',
      expiresAt: new Date('2026-08-07T12:00:00.000Z').toISOString()
    }))
    setAuthProvider({
      async bootstrapSession() { return null },
      async login() {
        return {
          token: 'token_ok',
          user: { id: 'user_admin', username: 'admin', displayName: '系统管理员', tenantId: 'default', tenantName: '默认租户', roles: ['admin'] },
          permissions: ['*']
        }
      },
      async logout() {}
    })
    setPermissionProvider({
      async loadPermissions() {
        return ['*']
      },
      loadPermissionContext: loadPermissions
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView, meta: { title: '登录', module: 'auth' } },
        { path: '/dashboard', name: 'dashboard', component: { template: '<div />' }, meta: { title: '仪表盘', module: 'dashboard' } }
      ]
    })
    await router.push('/login')
    const wrapper = mount(LoginView, { global: { plugins: [router, i18n] } })

    expect(wrapper.text()).toContain('登录控制台')
    expect(wrapper.text()).toContain('版本 1.0.0')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(loadPermissions).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/dashboard')
  })

  it('登录失败展示中文错误', async () => {
    setAuthProvider({
      async bootstrapSession() { return null },
      async login() { throw new Error('用户名或密码错误') },
      async logout() {}
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', name: 'login', component: LoginView, meta: { title: '登录', module: 'auth' } }] })
    const wrapper = mount(LoginView, { global: { plugins: [router, i18n] } })
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('用户名或密码错误'))
  })
})
