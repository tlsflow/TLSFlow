import type { MenuItem } from '@/types/router'
import { licensingMenuItems } from '@/edition/licensing'

export const mainMenuItems: MenuItem[] = [
  {
    titleKey: 'nav.dashboard',
    path: '/dashboard',
    module: 'dashboard',
    icon: 'dashboard',
    descriptionKey: 'nav.dashboardDesc'
  },
  {
    titleKey: 'nav.certificates',
    path: '/certificates',
    module: 'certificate',
    permission: 'certificate.asset.read',
    icon: 'certificate',
    descriptionKey: 'nav.certificatesDesc',
    children: [
      { titleKey: 'nav.certificateAssets', path: '/certificates', module: 'certificate', permission: 'certificate.asset.read', descriptionKey: 'nav.certificateAssetsDesc' },
      { titleKey: 'nav.acmeAutomation', path: '/acme', module: 'certificate', permission: 'certificate.asset.read', descriptionKey: 'nav.acmeAutomationDesc' },
      { titleKey: 'caOperations.title', path: '/ca-operations', module: 'certificate', permission: 'ca.operations.read', allowInferredPermission: false },
      { titleKey: 'nav.certificateFormats', path: '/bindings', module: 'binding', permission: 'binding.read', descriptionKey: 'nav.certificateFormatsDesc' }
    ]
  },
  {
    titleKey: 'nav.assetCenter',
    path: '/assets',
    module: 'asset',
    permission: 'service_asset.read',
    icon: 'stack',
    descriptionKey: 'nav.assetCenterDesc',
    children: [
      { titleKey: 'nav.assets', path: '/assets', module: 'asset', permission: 'service_asset.read', descriptionKey: 'nav.assetsDesc' },
      { titleKey: 'providers.page.title', path: '/providers', module: 'provider', permission: 'cloud_account_asset.read', allowInferredPermission: false, descriptionKey: 'providers.page.description' },
      { titleKey: 'nav.devices', path: '/assets/devices', module: 'asset', permission: 'host.read', descriptionKey: 'devices.page.description' },
      { titleKey: 'nav.gateways', path: '/gateways', module: 'gateway', permission: 'gateway.read', descriptionKey: 'nav.gatewaysDesc' }
    ]
  },
  {
    titleKey: 'nav.deployments',
    path: '/automations',
    module: 'certificate-deployment',
    permissions: ['workflow.read', 'automation.read', 'execution.run.read'],
    activePaths: ['/deployment-plans', '/workflows', '/automations', '/automation-runs', '/executions'],
    icon: 'rocket',
    descriptionKey: 'nav.deploymentsDesc',
    children: [
      { titleKey: 'nav.automations', path: '/automations', module: 'automation', permission: 'automation.read', descriptionKey: 'nav.automationsDesc' },
      { titleKey: 'nav.workflowTemplates', path: '/workflows', module: 'workflow-template', permission: 'workflow.read', descriptionKey: 'nav.workflowTemplatesDesc' },
      { titleKey: 'nav.executions', path: '/executions', module: 'execution', permission: 'execution.run.read', descriptionKey: 'nav.executionsDesc' }
    ]
  },
  {
    titleKey: 'nav.plugins',
    path: '/plugins',
    module: 'plugin',
    permission: 'plugin.read',
    icon: 'plug',
    descriptionKey: 'nav.pluginsDesc'
  },
  {
    titleKey: 'nav.monitoringAnalysis',
    path: '/monitors',
    module: 'monitoring',
    permissions: ['monitor.target.read', 'monitor.risk.read', 'monitor.dashboard.read', 'monitor.alert_rule.read'],
    icon: 'activity',
    descriptionKey: 'nav.monitoringAnalysisDesc',
  },
  {
    titleKey: 'nav.logAudit',
    path: '/audits',
    module: 'audit',
    permission: 'audit.read',
    icon: 'document',
    descriptionKey: 'nav.logAuditDesc',
  },
  {
    titleKey: 'nav.settings',
    path: '/settings',
    module: 'settings',
    permission: 'settings.read',
    icon: 'sliders',
    descriptionKey: 'nav.settingsDesc',
    activePaths: ['/settings/tenant-architecture', '/settings/version', '/settings/deployment-tasks'],
    children: [
      { titleKey: 'nav.systemSettings', path: '/settings', module: 'settings', permission: 'settings.read', descriptionKey: 'nav.systemSettingsDesc' },
      { titleKey: 'nav.users', path: '/settings/users', module: 'settings', permission: 'security.user.read', descriptionKey: 'nav.usersDesc' },
      { titleKey: 'nav.roles', path: '/settings/roles', module: 'settings', permission: 'security.role.read', descriptionKey: 'nav.rolesDesc' },
      { titleKey: 'credentials.title', path: '/settings/credentials', module: 'settings', permission: 'credential.read', descriptionKey: 'credentials.description' },
      { titleKey: 'notifications.title', path: '/settings/notifications', module: 'settings', permission: 'notification.channel.read', descriptionKey: 'notifications.description' },
      { titleKey: 'settings.deploymentTasks.title', path: '/settings/deployment-tasks', module: 'settings', permission: 'settings.read', descriptionKey: 'settings.deploymentTasks.description' },
      ...licensingMenuItems,
      { titleKey: 'nav.identitySources', path: '/settings/identity-sources', module: 'settings', permission: 'security.identity_source.read', descriptionKey: 'nav.identitySourcesDesc' }
    ]
  }
]
