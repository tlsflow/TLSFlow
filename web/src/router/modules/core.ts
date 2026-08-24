import type { GcRouteRecord } from '@/types/router'

export const coreRoutes: GcRouteRecord[] = [
  {
    path: '/dashboard',
    name: 'dashboard.overview',
    component: () => import('@/views/dashboard/DashboardView.vue'),
    meta: {
      title: 'Dashboard',
      titleKey: 'app.dashboard',
      module: 'dashboard',
      requiresAuth: true,
      permission: 'dashboard.read',
      resourceType: 'dashboard',
      riskLevel: 'low',
      breadcrumbKeys: ['app.dashboard'],
      keepAlive: true
    }
  }
]
