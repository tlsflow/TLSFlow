import type { GcRouteRecord } from '@/types/router'
import { licensingRoutes } from '@/edition/licensing'

export const businessRoutes: GcRouteRecord[] = [
  {
    path: '/reports/incident-window', name: 'reports.incidentWindow', component: () => import('@/views/reports/IncidentWindowReportView.vue'),
    meta: { title: 'Incident window report', titleKey: 'reports.incidentWindow.title', module: 'report', requiresAuth: true, permission: 'report.read', resourceType: 'report', riskLevel: 'medium', breadcrumbKeys: ['nav.reports', 'reports.incidentWindow.title'], keepAlive: true }
  },
  {
    path: '/reports/risk-response', name: 'reports.riskResponse', component: () => import('@/views/reports/RiskResponseReportView.vue'),
    meta: { title: 'Risk response report', titleKey: 'reports.riskResponse.title', module: 'report', requiresAuth: true, permission: 'report.read', resourceType: 'report', riskLevel: 'medium', breadcrumbKeys: ['nav.reports', 'reports.riskResponse.title'], keepAlive: true }
  },
  {
    path: '/reports/automation-effectiveness', name: 'reports.automationEffectiveness', component: () => import('@/views/reports/AutomationEffectivenessReportView.vue'),
    meta: { title: 'Automation effectiveness report', titleKey: 'reports.automationEffectiveness.title', module: 'report', requiresAuth: true, permission: 'report.read', resourceType: 'report', riskLevel: 'medium', breadcrumbKeys: ['nav.reports', 'reports.automationEffectiveness.title'], keepAlive: true }
  },
  {
    path: '/certificates',
    name: 'certificate.list',
    component: () => import('@/views/certificates/CertificatesView.vue'),
    meta: {
      title: 'Certificate inventory',
      titleKey: 'nav.certificateAssets',
      heroTitle: true,
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
    path: '/acme',
    name: 'acme.automation',
    component: () => import('@/views/acme/AcmeOperationsView.vue'),
    meta: {
      title: 'ACME certificate automation',
      titleKey: 'nav.acmeAutomation',
      heroTitle: true,
      module: 'certificate',
      requiresAuth: true,
      permission: 'certificate.asset.read',
      resourceType: 'certificate',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.certificates', 'nav.acmeAutomation'],
      keepAlive: true
    }
  },
  {
    path: '/ca-operations',
    name: 'caOperations.console',
    component: () => import('@/views/ca-operations/CaOperationsView.vue'),
    meta: {
      title: 'CA operations',
      titleKey: 'caOperations.title',
      module: 'certificate',
      requiresAuth: true,
      permission: 'ca.operations.read',
      allowInferredPermission: false,
      resourceType: 'certificate_authority',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.certificates', 'caOperations.title'],
      keepAlive: true,
      heroTitle: true
    }
  },
  {
    path: '/internal-ca',
    name: 'internalCa.console',
    component: () => import('@/views/internal-ca/InternalCaView.vue'),
    meta: {
      title: 'Internal CA',
      titleKey: 'internalCa.title',
      heroTitle: true,
      module: 'certificate',
      requiresAuth: true,
      permission: 'ca.operations.read',
      allowInferredPermission: false,
      resourceType: 'certificate_authority',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.certificates', 'internalCa.title'],
      keepAlive: true
    }
  },
  {
    path: '/certificates/import',
    name: 'certificate.import',
    component: () => import('@/views/certificates/CertificateImportView.vue'),
    meta: {
      title: 'Import certificate',
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
      title: 'Certificate detail',
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
      title: 'Certificate usages',
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
      title: 'Certificate formats',
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
    path: '/providers',
    name: 'provider.cloud.list',
    redirect: (to) => ({ path: '/applications', query: { ...to.query, cloudAccount: '1' }, hash: to.hash }),
    meta: {
      title: 'Cloud providers',
      titleKey: 'providers.page.title',
      heroTitle: true,
      module: 'provider',
      requiresAuth: true,
      permission: 'cloud_account_asset.read',
      allowInferredPermission: false,
      resourceType: 'service_asset',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.assetCenter', 'providers.page.title'],
      keepAlive: true
    }
  },
  {
    path: '/applications/onboarding',
    name: 'asset.onboarding',
    redirect: (to) => ({ path: '/applications', query: { ...to.query, onboarding: '1' }, hash: to.hash }),
    meta: {
      title: 'Application onboarding',
      titleKey: 'applicationOnboarding.title',
      module: 'asset',
      requiresAuth: true,
      permission: 'service_asset.manage',
      resourceType: 'service_asset',
      riskLevel: 'low',
      breadcrumbKeys: ['nav.assetCenter', 'applicationOnboarding.title'],
      hiddenInMenu: true,
    },
  },
  {
    path: '/applications',
    name: 'asset.list',
    component: () => import('@/views/assets/AssetsView.vue'),
    meta: {
      title: 'Applications',
      titleKey: 'nav.assets',
      heroTitle: true,
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
      title: 'Certificate format configuration',
      titleKey: 'nav.certificateFormats',
      heroTitle: true,
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
    redirect: (to) => {
      const query = to.query ?? {}
      const planId = typeof query.planId === 'string' ? query.planId : typeof query.id === 'string' ? query.id : ''
      const runId = typeof query.runId === 'string' ? query.runId : ''
      if (runId) return { path: '/executions', query: { ...query, runId }, hash: to.hash }
      if (planId) return { path: '/executions', query: { ...query, planId }, hash: to.hash }
      return { path: '/applications', query, hash: to.hash }
    },
    meta: {
      title: 'Applications',
      titleKey: 'nav.assets',
      heroTitle: true,
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
    path: '/executions',
    name: 'execution.list',
    component: () => import('@/views/executions/ExecutionsView.vue'),
    meta: {
      title: 'Executions',
      titleKey: 'nav.executions',
      heroTitle: true,
      module: 'execution',
      requiresAuth: true,
      permission: 'execution.run.read',
      resourceType: 'execution',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.deployments', 'nav.executions'],
      keepAlive: true
    }
  },
  {
    path: '/assets',
    name: 'asset.device.list',
    component: () => import('@/views/devices/DevicesView.vue'),
    meta: {
      title: 'Assets',
      titleKey: 'devices.page.title',
      heroTitle: true,
      module: 'asset',
      requiresAuth: true,
      permission: 'host.read',
      resourceType: 'host',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.assetCenter', 'devices.page.title'],
      keepAlive: true
    }
  },
  {
    path: '/devices',
    name: 'device.list',
    redirect: (to) => ({ path: '/assets', query: to.query, hash: to.hash }),
    meta: {
      title: 'Assets',
      titleKey: 'devices.page.title',
      heroTitle: true,
      module: 'device',
      requiresAuth: true,
      permission: 'host.read',
      resourceType: 'host',
      riskLevel: 'medium',
      breadcrumbKeys: ['devices.page.title'],
      keepAlive: true
    }
  },
  {
    path: '/agents',
    name: 'agent.list',
    redirect: (to) => ({ path: '/assets', query: to.query, hash: to.hash }),
    meta: {
      title: 'Agent',
      titleKey: 'nav.agents',
      module: 'agent',
      requiresAuth: true,
      permission: 'agent.read',
      resourceType: 'agent',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.agents'],
      keepAlive: false
    }
  },
  {
    path: '/gateways',
    name: 'gateway.list',
    component: () => import('@/views/gateways/GatewaysView.vue'),
    meta: {
      title: 'Gateways',
      titleKey: 'nav.gateways',
      heroTitle: true,
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
      breadcrumbKeys: ['nav.plugins'],
      keepAlive: true
    }
  },
  {
    path: '/workflows',
    name: 'workflow.template.list',
    component: () => import('@/views/workflows/WorkflowTemplatesView.vue'),
    meta: {
      title: 'Workflows',
      titleKey: 'nav.workflowTemplates',
      heroTitle: true,
      module: 'workflow',
      requiresAuth: true,
      permission: 'workflow.read',
      resourceType: 'workflowTemplate',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.deployments', 'nav.workflowTemplates'],
      keepAlive: true
    }
  },
  {
    path: '/automations',
    name: 'automation.list',
    component: () => import('@/views/automations/AutomationsView.vue'),
    meta: {
      title: 'Automations',
      titleKey: 'nav.automations',
      heroTitle: true,
      module: 'automation',
      requiresAuth: true,
      permission: 'automation.read',
      resourceType: 'automation',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.deployments', 'nav.automations'],
      keepAlive: true
    }
  },
  {
    path: '/automation-runs',
    name: 'automation.run.list',
    component: () => import('@/views/automations/AutomationRunsView.vue'),
    meta: {
      title: 'Automation runs',
      titleKey: 'automations.runs.title',
      module: 'automation',
      requiresAuth: true,
      permission: 'automation.read',
      resourceType: 'automationRun',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.deployments', 'nav.automations', 'automations.runs.title'],
      keepAlive: true
    }
  },
  {
    path: '/automation-runs/:id',
    name: 'automation.run.detail',
    component: () => import('@/views/automations/AutomationRunDetail.vue'),
    meta: {
      title: 'Automation run detail',
      titleKey: 'automations.runDetail.title',
      module: 'automation',
      requiresAuth: true,
      permission: 'automation.read',
      resourceType: 'automationRun',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.deployments', 'nav.automations', 'automations.runDetail.title']
    }
  },
  {
    path: '/monitors',
    name: 'monitor.list',
    component: () => import('@/views/monitoring/MonitorsView.vue'),
    meta: {
      title: 'Monitor alerts',
      titleKey: 'nav.monitoringAnalysis',
      module: 'monitoring',
      requiresAuth: true,
      permissions: ['monitor.target.read', 'monitor.risk.read', 'monitor.dashboard.read', 'monitor.alert_rule.read'],
      resourceType: 'monitor',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.monitoringAnalysis'],
      keepAlive: true
    }
  },
  {
    path: '/audits',
    name: 'audit.list',
    component: () => import('@/views/audit/AuditsView.vue'),
    meta: {
      title: 'Audit logs',
      titleKey: 'nav.logAudit',
      module: 'audit',
      requiresAuth: true,
      permission: 'audit.read',
      resourceType: 'auditLog',
      riskLevel: 'low',
      breadcrumbKeys: ['nav.logAudit'],
      keepAlive: true
    }
  },
  {
    path: '/settings',
    name: 'settings.overview',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: {
      title: 'System settings',
      titleKey: 'nav.systemSettings',
      heroTitle: true,
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
    path: '/settings/credentials',
    name: 'settings.credentials',
    component: () => import('@/views/settings/CredentialsView.vue'),
    meta: {
      title: 'credentials.title',
      titleKey: 'credentials.title',
      heroTitle: true,
      module: 'settings',
      requiresAuth: true,
      permission: 'credential.read',
      resourceType: 'credential',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.systemSettings', 'credentials.title'],
      keepAlive: true
    }
  },
  {
    path: '/settings/tenant-architecture',
    name: 'settings.tenantArchitecture',
    component: () => import('@/views/settings/TenantArchitectureView.vue'),
    meta: {
      title: 'Tenant architecture',
      titleKey: 'tenantArchitecture.title',
      heroTitle: true,
      module: 'settings',
      requiresAuth: true,
      permission: 'settings.read',
      resourceType: 'settings',
      riskLevel: 'high',
      breadcrumbKeys: ['nav.systemSettings', 'tenantArchitecture.title'],
      keepAlive: true,
    }
  },
  {
    path: '/monitors/tls',
    name: 'monitor.tls.overview',
    redirect: (to) => ({
      path: '/monitors',
      query: { ...to.query, tlsModal: '1' }
    }),
    meta: {
      title: 'TLS deep monitoring',
      titleKey: 'nav.monitorTls',
      module: 'monitoring',
      requiresAuth: true,
      permissions: ['monitor.target.read', 'monitor.risk.read', 'monitor.dashboard.read', 'monitor.alert_rule.read'],
      resourceType: 'monitor',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.monitorTls'],
      keepAlive: true
    }
  },
  {
    path: '/monitors/tls/:id',
    name: 'monitor.tls.detail',
    redirect: (to) => ({
      path: '/monitors',
      query: { ...to.query, tlsModal: '1', tlsTargetId: String(to.params.id ?? '') }
    }),
    meta: {
      title: 'TLS deep detail',
      titleKey: 'monitoring.tls.detailTitle',
      module: 'monitoring',
      requiresAuth: true,
      permissions: ['monitor.target.read', 'monitor.dashboard.read'],
      resourceType: 'monitor',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.monitorTls', 'monitoring.tls.detailTitle']
    }
  },
  {
    path: '/settings/version',
    name: 'settings.version',
    component: () => import('@/views/settings/VersionView.vue'),
    meta: {
      title: 'settings.version.title',
      titleKey: 'settings.version.title',
      heroTitle: true,
      module: 'settings',
      requiresAuth: true,
      permission: 'settings.read',
      resourceType: 'settings',
      riskLevel: 'low',
      breadcrumbKeys: ['nav.systemSettings', 'settings.version.title'],
      keepAlive: true
    }
  },
  ...licensingRoutes,
  {
    path: '/settings/notifications',
    name: 'settings.notifications',
    component: () => import('@/views/settings/NotificationsView.vue'),
    meta: {
      title: 'Notification center',
      titleKey: 'notifications.title',
      heroTitle: true,
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
    path: '/settings/deployment-tasks',
    name: 'settings.deploymentTasks',
    component: () => import('@/views/settings/DeploymentTaskSettingsView.vue'),
    meta: {
      title: 'settings.deploymentTasks.title',
      titleKey: 'settings.deploymentTasks.title',
      heroTitle: true,
      module: 'settings',
      requiresAuth: true,
      permission: 'settings.read',
      resourceType: 'settings',
      riskLevel: 'medium',
      breadcrumbKeys: ['nav.systemSettings', 'settings.deploymentTasks.title'],
      keepAlive: true,
    }
  },
  {
    path: '/settings/users',
    name: 'settings.users',
    component: () => import('@/views/settings/UsersView.vue'),
    meta: {
      title: 'Users',
      titleKey: 'nav.users',
      heroTitle: true,
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
      heroTitle: true,
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
      title: 'Identity sources',
      titleKey: 'nav.identitySources',
      heroTitle: true,
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
      title: 'Group role mappings',
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
