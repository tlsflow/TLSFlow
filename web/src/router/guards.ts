import type { Router } from 'vue-router'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import { useTenantStore } from '@/stores/tenant.store'
import { useSystemCapabilitiesStore, type SystemFeature } from '@/stores/system-capabilities.store'
import { useSystemInitializationStore } from '@/stores/system-initialization.store'

const publicRouteNames = new Set(['login', 'system.initialization', 'error.forbidden', 'error.notFound'])

function isInitializationPreviewRoute(routeName: string): boolean {
  return import.meta.env.DEV
    && routeName === 'system.initialization.preview'
}

export function registerRouterGuards(router: Router): void {
  router.beforeEach(async (to) => {
    const authStore = useAuthStore()
    const permissionStore = usePermissionStore()
    const tenantStore = useTenantStore()
    const systemCapabilities = useSystemCapabilitiesStore()
    const systemInitialization = useSystemInitializationStore()

    const routeName = String(to.name ?? '')
    if (isInitializationPreviewRoute(routeName)) return true
    await systemInitialization.loadStatus()
    if (systemInitialization.isPending && routeName !== 'system.initialization') {
      return { name: 'system.initialization' }
    }
    if (systemInitialization.initialized && routeName === 'system.initialization') {
      return { name: 'login' }
    }
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

    if (to.meta.requiresAuth && !tenantStore.contextVersion) {
      await tenantStore.loadAccessibleTenants()
    }

    if (!systemCapabilities.isLoaded) {
      await systemCapabilities.load().catch(() => undefined)
    }

    const permissionOptions = { explicitOnly: to.meta.allowInferredPermission === false }
    const permissions = Array.isArray(to.meta.permissions)
      ? to.meta.permissions.filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []
    const permission = typeof to.meta.permission === 'string' ? to.meta.permission : null
    const routePermissions = permission ? [permission, ...permissions] : permissions

    if (
      routePermissions.length > 0
      && !routePermissions.some((item) => permissionStore.hasPermission(item, permissionOptions))
    ) {
      return {
        name: 'error.forbidden',
        query: { from: to.fullPath, permission: routePermissions.join(',') }
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
    document.title = `${title} - ${i18n.global.t('app.brand')}`
  })
}
