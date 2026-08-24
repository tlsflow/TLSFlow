import type { Router } from 'vue-router'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import { useSystemCapabilitiesStore, type SystemFeature } from '@/stores/system-capabilities.store'

const publicRouteNames = new Set(['login', 'error.forbidden', 'error.notFound'])

export function registerRouterGuards(router: Router): void {
  router.beforeEach(async (to) => {
    const authStore = useAuthStore()
    const permissionStore = usePermissionStore()
    const systemCapabilities = useSystemCapabilitiesStore()

    const routeName = String(to.name ?? '')
    if (publicRouteNames.has(routeName)) {
      return true
    }

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      await authStore.bootstrapSession()
    }

    if (to.meta.requiresAuth && !authStore.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }

    if (to.meta.requiresAuth && !permissionStore.isLoaded) {
      await permissionStore.loadPermissions()
    }

    if (!systemCapabilities.isLoaded) {
      await systemCapabilities.load().catch(() => undefined)
    }

    const permission = to.meta.permission
    if (
      typeof permission === 'string'
      && !permissionStore.hasPermission(permission, { explicitOnly: to.meta.allowInferredPermission === false })
    ) {
      return {
        name: 'error.forbidden',
        query: { from: to.fullPath, permission }
      }
    }

    const featureFlag = to.meta.featureFlag
    if (typeof featureFlag === 'string' && !systemCapabilities.hasFeature(featureFlag as SystemFeature)) {
      return { name: 'error.notFound', query: { from: to.fullPath } }
    }

    return true
  })

  router.afterEach((to) => {
    const title = typeof to.meta.titleKey === 'string'
      ? i18n.global.t(to.meta.titleKey)
      : typeof to.meta.title === 'string'
        ? to.meta.title
        : i18n.global.t('app.defaultBreadcrumb')
    document.title = `${title} - ${i18n.global.t('app.platform')}`
  })
}
