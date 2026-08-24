import type { GcRouteRecord } from '@/types/router'

export const businessRoutes: GcRouteRecord[] = [
  {
    path: '/compatibility',
    name: 'compatibility.catalog',
    component: () => import('@/views/compatibility/CompatibilityCatalogView.vue'),
    meta: {
      title: 'Compatibility Catalog',
      titleKey: 'compatibility.title',
      module: 'compatibility',
      requiresAuth: true,
      permission: 'dashboard.read',
      resourceType: 'dashboard',
      riskLevel: 'low',
      breadcrumbKeys: ['compatibility.title'],
      keepAlive: true
    }
  },
  {
    path: '/certificates',
    name: 'certificate.list',
    component: () => import('@/views/certificates/CertificatesView.vue'),
    meta: {
      title: 'Certificate Assets',
      titleKey: 'nav.certificateAssets',
      module: 'certificate',
      requiresAuth: true,
      permission: 'certificate.asset.read',
      resourceType: 'certificate',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.certificateAssets'],
      keepAlive: true
    }
  },
  {
    path: '/certificates/import',
    name: 'certificate.import',
    component: () => import('@/views/certificates/CertificateImportView.vue'),
    meta: {
      title: 'Import Certificate',
      titleKey: 'routes.certificateImport',
      module: 'certificate',
      requiresAuth: true,
      permission: 'certificate.import',
      resourceType: 'certificate',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.certificateAssets', 'routes.certificateImport']
    }
  },
  {
    path: '/certificates/:id',
    name: 'certificate.detail',
    component: () => import('@/views/certificates/CertificateDetailView.vue'),
    meta: {
      title: 'Certificate Detail',
      titleKey: 'routes.certificateDetail',
      module: 'certificate',
      requiresAuth: true,
      permission: 'certificate.asset.read',
      resourceType: 'certificate',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.certificateAssets', 'routes.certificateDetail']
    }
  },
  {
    path: '/certificates/:id/usages',
    name: 'certificate.usages',
    component: () => import('@/views/certificates/CertificateUsagesView.vue'),
    meta: {
      title: 'Certificate Usages',
      titleKey: 'routes.certificateUsages',
      module: 'certificate',
      requiresAuth: true,
      permission: 'certificate.asset.read',
      resourceType: 'certificate',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.certificateAssets', 'routes.certificateUsages']
    }
  },
  {
    path: '/certificates/:id/formats',
    name: 'certificate.formats',
    component: () => import('@/views/certificates/CertificateFormatsView.vue'),
    meta: {
      title: 'Certificate Formats',
      titleKey: 'routes.certificateFormats',
      module: 'certificate',
      requiresAuth: true,
      permission: 'certificate.asset.read',
      resourceType: 'certificate',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.certificateAssets', 'routes.certificateFormats']
    }
  },
  {
    path: '/assets',
    name: 'asset.list',
    component: () => import('@/views/assets/AssetsView.vue'),
    meta: {
      title: 'Application Assets',
      titleKey: 'nav.assets',
      module: 'asset',
      requiresAuth: true,
      permission: 'service_asset.read',
      resourceType: 'service_asset',
      riskLevel: 'low',
      breadcrumbKeys: ['nav.assets'],
      keepAlive: true
    }
  },
  {
    path: '/bindings',
    name: 'binding.list',
    component: () => import('@/views/bindings/BindingsView.vue'),
    meta: {
      title: 'Certificate Format Config',
      titleKey: 'nav.certificateFormats',
      module: 'binding',
      requiresAuth: true,
      permission: 'binding.read',
      resourceType: 'binding',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.certificateFormats'],
      keepAlive: true
    }
  },
  {
    path: '/deployment-plans',
    name: 'deployment.plan.list',
    component: () => import('@/views/deployments/DeploymentPlansView.vue'),
    meta: {
      title: 'Deployment Plans',
      titleKey: 'nav.deploymentPlans',
      module: 'deployment',
      requiresAuth: true,
      permission: 'deployment.plan.read',
      resourceType: 'deploymentPlan',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.deployments', 'nav.deploymentPlans'],
      keepAlive: true
    }
  },
  {
    path: '/executions',
    name: 'execution.list',
    component: () => import('@/views/executions/ExecutionsView.vue'),
    meta: {
      title: 'Executions',
      titleKey: 'nav.executions',
      module: 'execution',
      requiresAuth: true,
      permission: 'execution.read',
      resourceType: 'execution',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.deployments', 'nav.executions'],
      keepAlive: true
    }
  },
  {
    path: '/agents',
    name: 'agent.list',
    component: () => import('@/views/agents/AgentsView.vue'),
    meta: {
      title: 'Agent',
      titleKey: 'nav.agents',
      module: 'agent',
      requiresAuth: true,
      permission: 'agent.read',
      resourceType: 'agent',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.agents'],
      keepAlive: true
    }
  },
  {
    path: '/gateways',
    name: 'gateway.list',
    component: () => import('@/views/gateways/GatewaysView.vue'),
    meta: {
      title: 'Gateways',
      titleKey: 'nav.gateways',
      module: 'gateway',
      requiresAuth: true,
      permission: 'gateway.read',
      resourceType: 'gateway',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.gateways'],
      keepAlive: true
    }
  },
  {
    path: '/plugins',
    name: 'plugin.list',
    component: () => import('@/views/plugins/PluginsView.vue'),
    meta: {
      title: 'Plugins',
      titleKey: 'nav.plugins',
      module: 'plugin',
      requiresAuth: true,
      permission: 'plugin.read',
      resourceType: 'plugin',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.workflows', 'nav.plugins'],
      keepAlive: true
    }
  },
  {
    path: '/workflow-templates',
    name: 'workflow.template.list',
    component: () => import('@/views/workflows/WorkflowTemplatesView.vue'),
    meta: {
      title: 'Workflows',
      titleKey: 'nav.workflowTemplates',
      module: 'workflow',
      requiresAuth: true,
      permission: 'workflow.template.read',
      resourceType: 'workflowTemplate',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.workflows', 'nav.workflowTemplates'],
      keepAlive: true,
      featureFlag: 'template.dsl.editor'
    }
  },
  {
    path: '/monitors',
    name: 'monitor.list',
    component: () => import('@/views/monitoring/MonitorsView.vue'),
    meta: {
      title: 'Monitor Alerts',
      titleKey: 'nav.monitorAlerts',
      module: 'monitoring',
      requiresAuth: true,
      permission: 'monitor.read',
      resourceType: 'monitor',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.monitorAlerts'],
      keepAlive: true
    }
  },
  {
    path: '/audits',
    name: 'audit.list',
    component: () => import('@/views/audit/AuditsView.vue'),
    meta: {
      title: 'Audit Logs',
      titleKey: 'nav.audits',
      module: 'audit',
      requiresAuth: true,
      permission: 'audit.read',
      resourceType: 'auditLog',
      riskLevel: 'low',
      breadcrumbKeys: ['nav.audits'],
      keepAlive: true
    }
  },
  {
    path: '/settings',
    name: 'settings.overview',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: {
      title: 'System Settings',
      titleKey: 'nav.systemSettings',
      module: 'settings',
      requiresAuth: true,
      permission: 'settings.read',
      resourceType: 'settings',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings'],
      keepAlive: true
    }
  },
  {
    path: '/settings/notifications',
    name: 'settings.notifications',
    component: () => import('@/views/settings/NotificationsView.vue'),
    meta: {
      title: 'Notification Center',
      titleKey: 'notifications.title',
      module: 'settings',
      requiresAuth: true,
      permission: 'notification.channel.read',
      resourceType: 'notificationChannel',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings', 'notifications.title'],
      keepAlive: true
    }
  },
  {
    path: '/settings/users',
    name: 'settings.users',
    component: () => import('@/views/settings/UsersView.vue'),
    meta: {
      title: 'Users',
      titleKey: 'nav.users',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.user.read',
      resourceType: 'user',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings', 'nav.users'],
      keepAlive: true
    }
  },
  {
    path: '/settings/roles',
    name: 'settings.roles',
    component: () => import('@/views/settings/RolesView.vue'),
    meta: {
      title: 'Roles',
      titleKey: 'nav.roles',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.role.read',
      resourceType: 'role',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings', 'nav.roles'],
      keepAlive: true
    }
  },
  {
    path: '/settings/identity-sources',
    name: 'settings.identitySources',
    component: () => import('@/views/settings/IdentitySourcesView.vue'),
    meta: {
      title: 'Identity Sources',
      titleKey: 'nav.identitySources',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.identity_source.read',
      resourceType: 'identitySource',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings', 'nav.identitySources'],
      keepAlive: true
    }
  },
  {
    path: '/settings/group-role-mappings',
    name: 'settings.groupRoleMappings',
    component: () => import('@/views/settings/GroupRoleMappingsView.vue'),
    meta: {
      title: 'Group Role Mappings',
      titleKey: 'nav.groupRoleMappings',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.identity_source.read',
      resourceType: 'externalGroupRoleMapping',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings', 'nav.groupRoleMappings'],
      keepAlive: true
    }
  }
]
