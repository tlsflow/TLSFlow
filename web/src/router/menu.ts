import type { MenuItem } from '@/types/router'

export const mainMenuItems: MenuItem[] = [
  {
    titleKey: 'nav.dashboard',
    path: '/dashboard',
    module: 'dashboard',
    permission: 'dashboard.read',
    icon: 'dashboard',
    descriptionKey: 'nav.dashboardDesc'
  },
  {
    titleKey: 'nav.certificates',
    path: '/certificates',
    module: 'certificate',
    permission: 'certificate.asset.read',
    icon: 'shield',
    descriptionKey: 'nav.certificatesDesc',
    children: [
      { titleKey: 'nav.certificateAssets', path: '/certificates', module: 'certificate', permission: 'certificate.asset.read', descriptionKey: 'nav.certificateAssetsDesc' },
      { titleKey: 'caOperations.title', path: '/ca-operations', module: 'certificate', permission: 'certificate.asset.read', descriptionKey: 'caOperations.description' },
      { titleKey: 'internalCa.title', path: '/internal-ca', module: 'certificate', permission: 'certificate.asset.read', descriptionKey: 'internalCa.description' },
      { titleKey: 'nav.certificateFormats', path: '/bindings', module: 'binding', permission: 'binding.read', descriptionKey: 'nav.certificateFormatsDesc' }
    ]
  },
  {
    titleKey: 'nav.assets',
    path: '/assets',
    module: 'asset',
    permission: 'service_asset.read',
    icon: 'server',
    descriptionKey: 'nav.assetsDesc',
    children: [
      { titleKey: 'nav.assets', path: '/assets', module: 'asset', permission: 'service_asset.read', descriptionKey: 'nav.assetsDesc' },
      { titleKey: 'devices.page.title', path: '/devices', module: 'device', permission: 'host.read', descriptionKey: 'devices.page.description' },
      { titleKey: 'nav.gateways', path: '/gateways', module: 'gateway', permission: 'gateway.read', descriptionKey: 'nav.gatewaysDesc' }
    ]
  },
  {
    titleKey: 'nav.deployments',
    path: '/deployment-plans',
    module: 'certificate-deployment',
    permissions: ['deployment.plan.read', 'workflow.template.read', 'automation.read', 'execution.read'],
    activePaths: ['/deployment-plans', '/workflows', '/workflow-templates', '/automations', '/automation-runs', '/executions'],
    icon: 'bolt',
    descriptionKey: 'nav.deploymentsDesc',
    children: [
      { titleKey: 'nav.deploymentPlans', path: '/deployment-plans', module: 'deployment', permission: 'deployment.plan.read', descriptionKey: 'nav.deploymentPlansDesc' },
      { titleKey: 'nav.workflowTemplates', path: '/workflows', module: 'workflow-template', permission: 'workflow.template.read', descriptionKey: 'nav.workflowTemplatesDesc' },
      { titleKey: 'nav.automations', path: '/automations', module: 'automation', permission: 'automation.read', descriptionKey: 'nav.automationsDesc' },
      { titleKey: 'nav.executions', path: '/executions', module: 'execution', permission: 'execution.read', descriptionKey: 'nav.executionsDesc' }
    ]
  },
  {
    titleKey: 'nav.plugins',
    path: '/plugins',
    module: 'plugin',
    permission: 'plugin.read',
    icon: 'plugin',
    descriptionKey: 'nav.pluginsDesc'
  },
  {
    titleKey: 'nav.monitoring',
    path: '/monitors',
    module: 'monitoring',
    permission: 'monitor.read',
    icon: 'pulse',
    descriptionKey: 'nav.monitoringDesc',
    children: [
      { titleKey: 'nav.monitorAlerts', path: '/monitors', module: 'monitoring', permission: 'monitor.read', descriptionKey: 'nav.monitorAlertsDesc' },
      { titleKey: 'nav.audits', path: '/audits', module: 'audit', permission: 'audit.read', descriptionKey: 'nav.auditsDesc' }
    ]
  },
  {
    titleKey: 'nav.settings',
    path: '/settings',
    module: 'settings',
    permission: 'settings.read',
    icon: 'settings',
    descriptionKey: 'nav.settingsDesc',
    children: [
      { titleKey: 'nav.systemSettings', path: '/settings', module: 'settings', permission: 'settings.read', descriptionKey: 'nav.systemSettingsDesc' },
      { titleKey: 'credentials.title', path: '/settings/credentials', module: 'settings', permission: 'credential.read', descriptionKey: 'credentials.description' },
      { titleKey: 'settings.version.title', path: '/settings/version', module: 'settings', permission: 'settings.read', descriptionKey: 'settings.version.description' },
      { titleKey: 'notifications.title', path: '/settings/notifications', module: 'settings', permission: 'notification.channel.read', descriptionKey: 'notifications.description' },
      { titleKey: 'nav.users', path: '/settings/users', module: 'settings', permission: 'security.user.read', descriptionKey: 'nav.usersDesc' },
      { titleKey: 'nav.roles', path: '/settings/roles', module: 'settings', permission: 'security.role.read', descriptionKey: 'nav.rolesDesc' },
      { titleKey: 'nav.identitySources', path: '/settings/identity-sources', module: 'settings', permission: 'security.identity_source.read', descriptionKey: 'nav.identitySourcesDesc' }
    ]
  }
]
