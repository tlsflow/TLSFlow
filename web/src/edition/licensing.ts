import type { GcRouteRecord, MenuItem } from '@/types/router';

export const licensingRoutes: GcRouteRecord[] = [
  {
    path: '/settings/licensing',
    name: 'settings.licensing',
    component: () => import('@/views/settings/LicensingView.vue'),
    meta: {
      title: 'settings.licensing.title',
      titleKey: 'settings.licensing.title',
      heroTitle: true,
      module: 'settings',
      requiresAuth: true,
      permission: 'settings.read',
      resourceType: 'settings',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings', 'settings.licensing.title'],
      keepAlive: true
    }
  }
];

export const licensingMenuItems: MenuItem[] = [
  { titleKey: 'nav.licensing', path: '/settings/licensing', module: 'settings', permission: 'settings.read', descriptionKey: 'settings.licensing.description' }
];
