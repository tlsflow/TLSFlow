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
      { titleKey: 'nav.certificateAssets', submenuTitleKey: 'nav.certificateInventoryShort', path: '/certificates', module: 'certificate', permission: 'certificate.asset.read', descriptionKey: 'nav.certificateAssetsDesc' },
      { titleKey: 'nav.acmeAutomation', submenuTitleKey: 'nav.acmeAutomationShort', path: '/acme', module: 'certificate', permission: 'certificate.asset.read', descriptionKey: 'nav.acmeAutomationDesc' },
      { titleKey: 'caOperations.title', submenuTitleKey: 'nav.caOperationsShort', path: '/ca-operations', module: 'certificate', permission: 'ca.operations.read', allowInferredPermission: false },
      { titleKey: 'nav.certificateFormats', submenuTitleKey: 'nav.certificateFormatsShort', path: '/bindings', module: 'binding', permission: 'binding.read', descriptionKey: 'nav.certificateFormatsDesc' }
    ]
  },
  {
    titleKey: 'nav.assetCenter',
    path: '/applications',
    module: 'asset',
    permission: 'service_asset.read',
    icon: 'stack',
    descriptionKey: 'nav.assetCenterDesc',
    children: [
      { titleKey: 'nav.applications', path: '/applications', module: 'asset', permission: 'service_asset.read', descriptionKey: 'nav.applicationsDesc' },
      { titleKey: 'devices.page.title', path: '/assets', module: 'asset', permission: 'host.read', descriptionKey: 'devices.page.description' },
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
    activePaths: ['/settings/tenant-architecture', '/settings/version', '/settings/deployment-tasks', '/settings/identity-sources'],
    children: [
      { titleKey: 'nav.settingsOverview', path: '/settings', module: 'settings', permission: 'settings.read', descriptionKey: 'nav.systemSettingsDesc' },
      { titleKey: 'nav.users', path: '/settings/users', module: 'settings', permission: 'security.user.read', descriptionKey: 'nav.usersDesc' },
      { titleKey: 'nav.roles', path: '/settings/roles', module: 'settings', permission: 'security.role.read', descriptionKey: 'nav.rolesDesc' },
      { titleKey: 'nav.credentials', path: '/settings/credentials', module: 'settings', permission: 'credential.read', descriptionKey: 'credentials.description' },
      { titleKey: 'nav.notifications', path: '/settings/notifications', module: 'settings', permission: 'notification.channel.read', descriptionKey: 'notifications.description' },
      ...licensingMenuItems
    ]
  }
]
