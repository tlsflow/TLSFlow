import type { GcRouteRecord } from '@/types/router'

export const coreRoutes: GcRouteRecord[] = [
  {
    path: '/dashboard',
    name: 'dashboard.overview',
    component: () => import('@/views/dashboard/DashboardView.vue'),
    meta: {
      title: '仪表盘',
      module: 'dashboard',
      requiresAuth: true,
      permission: 'dashboard.read',
      resourceType: 'dashboard',
      riskLevel: 'low',
      breadcrumb: ['仪表盘'],
      keepAlive: true
    }
  }
]
