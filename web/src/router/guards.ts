import type { Router } from 'vue-router'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'

const publicRouteNames = new Set(['login', 'error.forbidden', 'error.notFound'])

export function registerRouterGuards(router: Router): void {
  router.beforeEach(async (to) => {
    const authStore = useAuthStore()
    const permissionStore = usePermissionStore()

    const routeName = String(to.name ?? '')
    if (publicRouteNames.has(routeName)) {
      return true
    }

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      await authStore.bootstrapSession()
    }

    if (to.meta.requiresAuth && !permissionStore.isLoaded) {
      await permissionStore.loadPermissions()
    }

    const permission = to.meta.permission
    if (typeof permission === 'string' && !permissionStore.hasPermission(permission)) {
      return {
        name: 'error.forbidden',
        query: { from: to.fullPath, permission }
      }
    }

    return true
  })

  router.afterEach((to) => {
    const title = typeof to.meta.title === 'string' ? to.meta.title : '控制台'
    document.title = `${title} - 企业 SSL 证书生命周期管理平台`
  })
}
