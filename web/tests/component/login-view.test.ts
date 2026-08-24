import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import LoginView from '@/views/auth/LoginView.vue'
import { setAuthProvider } from '@/providers/auth.provider'

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('使用极简登录表单提交后进入仪表盘', async () => {
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
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'login', component: LoginView, meta: { title: '登录', module: 'auth' } },
        { path: '/dashboard', name: 'dashboard', component: { template: '<div />' }, meta: { title: '仪表盘', module: 'dashboard' } }
      ]
    })
    await router.push('/login')
    const wrapper = mount(LoginView, { global: { plugins: [router] } })

    expect(wrapper.text()).toContain('欢迎回来')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/dashboard')
  })

  it('登录失败展示中文错误', async () => {
    setAuthProvider({
      async bootstrapSession() { return null },
      async login() { throw new Error('用户名或密码错误') },
      async logout() {}
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', name: 'login', component: LoginView, meta: { title: '登录', module: 'auth' } }] })
    const wrapper = mount(LoginView, { global: { plugins: [router] } })
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('用户名或密码错误'))
  })
})
