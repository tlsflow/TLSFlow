import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { registerRouterGuards } from '@/router/guards'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'

describe('路由权限守卫', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('无权限访问受保护路由时跳转 403', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/secret', name: 'secret', component: { template: '<div />' }, meta: { title: '秘密', module: 'test', requiresAuth: true, permission: 'secret.read' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)
    await useAuthStore().bootstrapMockSession()
    usePermissionStore().setPermissions(['dashboard.read'])

    await router.push('/secret')
    expect(router.currentRoute.value.name).toBe('error.forbidden')
  })
})
