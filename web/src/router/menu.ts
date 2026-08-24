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
      { titleKey: 'nav.agents', path: '/agents', module: 'agent', permission: 'agent.read', descriptionKey: 'nav.agentsDesc' },
      { titleKey: 'nav.gateways', path: '/gateways', module: 'gateway', permission: 'gateway.read', descriptionKey: 'nav.gatewaysDesc' }
    ]
  },
  {
    titleKey: 'nav.deployments',
    path: '/deployment-plans',
    module: 'certificate-deployment',
    permissions: ['deployment.plan.read', 'execution.read'],
    activePaths: ['/deployment-plans', '/executions'],
    icon: 'bolt',
    descriptionKey: 'nav.deploymentsDesc',
    children: [
      { titleKey: 'nav.deploymentPlans', path: '/deployment-plans', module: 'deployment', permission: 'deployment.plan.read', descriptionKey: 'nav.deploymentPlansDesc' },
      { titleKey: 'nav.executions', path: '/executions', module: 'execution', permission: 'execution.read', descriptionKey: 'nav.executionsDesc' }
    ]
  },
  {
    titleKey: 'nav.workflows',
    path: '/workflow-templates',
    module: 'workflow',
    permissions: ['workflow.template.read', 'plugin.read'],
    activePaths: ['/workflow-templates', '/plugins'],
    icon: 'workflow',
    descriptionKey: 'nav.workflowsDesc',
    children: [
      { titleKey: 'nav.workflowTemplates', path: '/workflow-templates', module: 'workflow-template', permission: 'workflow.template.read', descriptionKey: 'nav.workflowTemplatesDesc' },
      { titleKey: 'nav.plugins', path: '/plugins', module: 'plugin', permission: 'plugin.read', descriptionKey: 'nav.pluginsDesc' }
    ]
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
    titleKey: 'nav.reports', path: '/reports/incident-window', module: 'report', permission: 'report.read', activePaths: ['/reports/incident-window', '/reports/risk-response', '/reports/automation-effectiveness'], icon: 'dashboard', descriptionKey: 'nav.reportsDesc',
    children: [
      { titleKey: 'nav.incidentWindowReport', path: '/reports/incident-window', module: 'report', permission: 'report.read', descriptionKey: 'nav.incidentWindowReportDesc' },
      { titleKey: 'nav.riskResponseReport', path: '/reports/risk-response', module: 'report', permission: 'report.read', descriptionKey: 'nav.riskResponseReportDesc' },
      { titleKey: 'nav.automationEffectivenessReport', path: '/reports/automation-effectiveness', module: 'report', permission: 'report.read', descriptionKey: 'nav.automationEffectivenessReportDesc' }
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
      { titleKey: 'nav.users', path: '/settings/users', module: 'settings', permission: 'security.user.read', descriptionKey: 'nav.usersDesc' },
      { titleKey: 'nav.roles', path: '/settings/roles', module: 'settings', permission: 'security.role.read', descriptionKey: 'nav.rolesDesc' },
      { titleKey: 'nav.identitySources', path: '/settings/identity-sources', module: 'settings', permission: 'security.identity_source.read', descriptionKey: 'nav.identitySourcesDesc' }
    ]
  }
]
