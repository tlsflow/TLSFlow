import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHistory } from 'vue-router'
import { registerRouterGuards } from '@/router/guards'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import { useTenantStore } from '@/stores/tenant.store'
import { resetAuthProviderToMock, setAuthProvider } from '@/providers/auth.provider'
import { resetPermissionProviderToMock, setPermissionProvider } from '@/providers/permission.provider'
import { getSystemHealth } from '@/api/modules/system.api'

vi.mock('@/api/modules/system.api', () => ({
  getSystemHealth: vi.fn()
}))

describe('路由权限守卫', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 预置租户上下文，避免把后端网络请求混入路由权限行为验证。
    useTenantStore().contextVersion = 'test-context'
    localStorage.clear()
    resetAuthProviderToMock()
    resetPermissionProviderToMock()
    vi.mocked(getSystemHealth).mockResolvedValue({
      data: {
        status: 'OK',
        service: 'gcac-backend',
        version: 'test',
        timestamp: new Date().toISOString(),
        deploymentArchitecture: 'standard',
        features: { browserRuntime: true }
      }
    } as never)
  })

  it('无权限访问受保护路由时跳转 403', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/secret', name: 'secret', component: { template: '<div />' }, meta: { title: '秘密', module: 'test', requiresAuth: true, permission: 'secret.read' } },
        { path: '/login', name: 'login', component: { template: '<div />' }, meta: { title: '登录', module: 'auth' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)
    useAuthStore().setSession({
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
          user: {
            id: 'provider-user',
            username: 'provider',
            displayName: 'Provider 用户',
            tenantId: 'default',
            tenantName: '默认租户',
            roles: []
          }
        }
      },
      async login() {
        throw new Error('本测试不覆盖登录')
      },
      async logout() {}
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
        { path: '/login', name: 'login', component: { template: '<div />' }, meta: { title: '登录', module: 'auth' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)

    await router.push('/secret')
    expect(router.currentRoute.value.name).toBe('secret')
    expect(useAuthStore().user?.id).toBe('provider-user')
    expect(usePermissionStore().hasPermission('secret.read')).toBe(true)
  })

  it('对象级只读范围会隐式放开对应路由', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/certificates', name: 'certificate.list', component: { template: '<div />' }, meta: { title: '证书', module: 'certificate', requiresAuth: true, permission: 'certificate.asset.read' } },
        { path: '/login', name: 'login', component: { template: '<div />' }, meta: { title: '登录', module: 'auth' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)
    useAuthStore().setSession({
      user: {
        id: 'user_test',
        displayName: '测试用户',
        tenantId: 'default',
        tenantName: '默认租户',
        roles: []
      }
    })
    usePermissionStore().$patch({
      permissions: [],
      objectSets: [{ id: 'oset_cert', objectTypes: ['certificate'] }],
      roleBindings: [],
      objectPermissionVersion: 'test',
      expiresAt: new Date('2026-08-07T12:00:00.000Z').toISOString(),
      loadedAt: new Date('2026-08-07T11:55:00.000Z').toISOString()
    })

    await router.push('/certificates')
    expect(router.currentRoute.value.name).toBe('certificate.list')
  })

  it('仅对象级推导权限不能放开显式权限路由', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/ca-operations',
          name: 'ca.operations',
          component: { template: '<div />' },
          meta: {
            title: 'CA 运营管理',
            module: 'certificate',
            requiresAuth: true,
            permission: 'ca.operations.read',
            allowInferredPermission: false
          }
        },
        { path: '/login', name: 'login', component: { template: '<div />' }, meta: { title: '登录', module: 'auth' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)
    useAuthStore().setSession({
      user: {
        id: 'user_test',
        displayName: '测试用户',
        tenantId: 'default',
        tenantName: '默认租户',
        roles: []
      }
    })
    usePermissionStore().$patch({
      permissions: [],
      objectSets: [{ id: 'oset_cert', objectTypes: ['certificate'] }],
      roleBindings: [],
      objectPermissionVersion: 'test',
      expiresAt: new Date('2026-08-07T12:00:00.000Z').toISOString(),
      loadedAt: new Date('2026-08-07T11:55:00.000Z').toISOString()
    })

    await router.push('/ca-operations')
    expect(router.currentRoute.value.name).toBe('error.forbidden')
  })

  it('多权限路由满足任一显式权限即可放行', async () => {
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/monitors',
          name: 'monitor.list',
          component: { template: '<div />' },
          meta: {
            title: '监控',
            module: 'monitoring',
            requiresAuth: true,
            permissions: ['monitor.target.read', 'monitor.risk.read']
          }
        },
        { path: '/login', name: 'login', component: { template: '<div />' }, meta: { title: '登录', module: 'auth' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } }
      ]
    })
    registerRouterGuards(router)
    useAuthStore().setSession({
      user: {
        id: 'user_test',
        displayName: '测试用户',
        tenantId: 'default',
        tenantName: '默认租户',
        roles: []
      }
    })
    usePermissionStore().setPermissions(['monitor.risk.read'])

    await router.push('/monitors')
    expect(router.currentRoute.value.name).toBe('monitor.list')
  })

  it('小型架构拒绝进入 Browser Runtime 功能路由', async () => {
    vi.mocked(getSystemHealth).mockResolvedValue({
      data: {
        status: 'OK',
        service: 'gcac-backend',
        version: 'test',
        timestamp: new Date().toISOString(),
        deploymentArchitecture: 'small',
        features: { browserRuntime: false }
      }
    } as never)
    const router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/browser',
          name: 'browser',
          component: { template: '<div />' },
          meta: {
            title: 'Browser',
            module: 'test',
            requiresAuth: true,
            permission: 'credential.create',
            featureFlag: 'browser.runtime'
          }
        },
        { path: '/login', name: 'login', component: { template: '<div />' }, meta: { title: '登录', module: 'auth' } },
        { path: '/403', name: 'error.forbidden', component: { template: '<div />' }, meta: { title: '无权限', module: 'error' } },
        { path: '/404', name: 'error.notFound', component: { template: '<div />' }, meta: { title: '不存在', module: 'error' } }
      ]
    })
    registerRouterGuards(router)
    useAuthStore().setSession({
      user: {
        id: 'user_test',
        displayName: '测试用户',
        tenantId: 'default',
        tenantName: '默认租户',
        roles: []
      }
    })
    usePermissionStore().setPermissions(['credential.create'])

    await router.push('/browser')
    expect(router.currentRoute.value.name).toBe('error.notFound')
  })
})
