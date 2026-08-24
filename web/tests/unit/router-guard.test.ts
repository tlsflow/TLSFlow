import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { registerRouterGuards } from '@/router/guards'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import { resetAuthProvider, setAuthProvider } from '@/providers/auth.provider'
import { resetPermissionProvider, setPermissionProvider } from '@/providers/permission.provider'

describe('路由权限守卫', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAuthProvider()
    resetPermissionProvider()
  })

  it('无权限访问受保护路由时跳转 403', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/secret', name: 'secret', component: { template: '<div />' }, meta: { title: '秘密', module: 'test', requiresAuth: true, permission: 'secret.read' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)
    useAuthStore().setSession({
      token: 'test-token',
      user: {
        id: 'user_test',
        displayName: '测试用户',
        tenantId: 'default',
        tenantName: '默认租户',
        roles: []
      }
    })
    usePermissionStore().setPermissions(['dashboard.read'])

    await router.push('/secret')
    expect(router.currentRoute.value.name).toBe('error.forbidden')
  })

  it('未认证时通过 Provider 初始化会话和权限', async () => {
    setAuthProvider({
      async bootstrapSession() {
        return {
          token: 'provider-token',
          user: {
            id: 'provider-user',
            displayName: 'Provider 用户',
            tenantId: 'default',
            tenantName: '默认租户',
            roles: []
          }
        }
      }
    })
    setPermissionProvider({
      async loadPermissions() {
        return ['secret.read']
      }
    })

    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/secret', name: 'secret', component: { template: '<div />' }, meta: { title: '秘密', module: 'test', requiresAuth: true, permission: 'secret.read' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)

    await router.push('/secret')
    expect(router.currentRoute.value.name).toBe('secret')
    expect(useAuthStore().user?.id).toBe('provider-user')
    expect(usePermissionStore().hasPermission('secret.read')).toBe(true)
  })
})
