import type { MenuItem } from '@/types/router'

export const mainMenuItems: MenuItem[] = [
  {
    title: '总览',
    titleKey: 'nav.dashboard',
    path: '/dashboard',
    module: 'dashboard',
    permission: 'dashboard.read',
    icon: 'dashboard',
    description: '应用、证书、Agent、网关和审计状态总览',
    descriptionKey: 'nav.dashboardDesc'
  },
  {
    title: '证书',
    titleKey: 'nav.certificates',
    path: '/certificates',
    module: 'certificate',
    permission: 'certificate.asset.read',
    icon: 'shield',
    description: '证书库、绑定关系和到期状态',
    descriptionKey: 'nav.certificatesDesc',
    children: [
      { title: '证书资产', titleKey: 'nav.certificateAssets', path: '/certificates', module: 'certificate', permission: 'certificate.asset.read', description: '证书、私钥引用、指纹和到期时间', descriptionKey: 'nav.certificateAssetsDesc' },
      { title: '证书格式配置', titleKey: 'nav.certificateFormats', path: '/bindings', module: 'binding', permission: 'binding.read', description: '为已保存证书定义 PFX、CER、CRT、PEM 等格式规则', descriptionKey: 'nav.certificateFormatsDesc' }
    ]
  },
  {
    title: '应用资产',
    titleKey: 'nav.assets',
    path: '/assets',
    module: 'asset',
    permission: 'service_asset.read',
    icon: 'server',
    description: '域名/IP 维度的应用入口与证书部署目标',
    descriptionKey: 'nav.assetsDesc',
    children: [
      { title: '应用资产', titleKey: 'nav.assets', path: '/assets', module: 'asset', permission: 'service_asset.read', description: '域名、端口、协议和关联服务实例', descriptionKey: 'nav.assetsDesc' },
      { title: 'Agent', titleKey: 'nav.agents', path: '/agents', module: 'agent', permission: 'agent.read', description: '在线状态、心跳和能力集合', descriptionKey: 'nav.agentsDesc' },
      { title: '网关', titleKey: 'nav.gateways', path: '/gateways', module: 'gateway', permission: 'gateway.read', description: '隔离区网关、协议和可达目标', descriptionKey: 'nav.gatewaysDesc' }
    ]
  },
  {
    title: '证书部署',
    titleKey: 'nav.deployments',
    path: '/deployment-plans',
    module: 'certificate-deployment',
    permissions: ['deployment.plan.read', 'execution.read'],
    activePaths: ['/deployment-plans', '/executions'],
    icon: 'bolt',
    description: '部署计划和执行记录',
    descriptionKey: 'nav.deploymentsDesc',
    children: [
      { title: '部署计划', titleKey: 'nav.deploymentPlans', path: '/deployment-plans', module: 'deployment', permission: 'deployment.plan.read', description: '证书部署计划和审批入口', descriptionKey: 'nav.deploymentPlansDesc' },
      { title: '执行记录', titleKey: 'nav.executions', path: '/executions', module: 'execution', permission: 'execution.read', description: '执行步骤、日志、失败和回滚', descriptionKey: 'nav.executionsDesc' }
    ]
  },
  {
    title: '工作流',
    titleKey: 'nav.workflows',
    path: '/workflow-templates',
    module: 'workflow',
    permissions: ['workflow.template.read', 'plugin.read'],
    activePaths: ['/workflow-templates', '/plugins'],
    icon: 'workflow',
    description: '工作流和插件',
    descriptionKey: 'nav.workflowsDesc',
    children: [
      { title: '工作流', titleKey: 'nav.workflowTemplates', path: '/workflow-templates', module: 'workflow-template', permission: 'workflow.template.read', description: '画布草稿、变量、能力声明和发布', descriptionKey: 'nav.workflowTemplatesDesc' },
      { title: '插件', titleKey: 'nav.plugins', path: '/plugins', module: 'plugin', permission: 'plugin.read', description: 'Provider、执行器和沙箱状态', descriptionKey: 'nav.pluginsDesc' }
    ]
  },
  {
    title: '监控',
    titleKey: 'nav.monitoring',
    path: '/monitors',
    module: 'monitoring',
    permission: 'monitor.read',
    icon: 'pulse',
    description: '告警、审计和证书状态',
    descriptionKey: 'nav.monitoringDesc',
    children: [
      { title: '监控告警', titleKey: 'nav.monitorAlerts', path: '/monitors', module: 'monitoring', permission: 'monitor.read', description: '到期、漂移和执行失败事件', descriptionKey: 'nav.monitorAlertsDesc' },
      { title: '审计日志', titleKey: 'nav.audits', path: '/audits', module: 'audit', permission: 'audit.read', description: '操作证据与合规导出', descriptionKey: 'nav.auditsDesc' }
    ]
  },
  {
    title: '设置',
    titleKey: 'nav.settings',
    path: '/settings',
    module: 'settings',
    permission: 'settings.read',
    icon: 'settings',
    description: '租户、用户、权限和系统配置',
    descriptionKey: 'nav.settingsDesc',
    children: [
      { title: '系统设置', titleKey: 'nav.systemSettings', path: '/settings', module: 'settings', permission: 'settings.read', description: '系统配置和安全元数据', descriptionKey: 'nav.systemSettingsDesc' },
      { title: '用户管理', titleKey: 'nav.users', path: '/settings/users', module: 'settings', permission: 'security.user.read', description: '控制台用户、状态和角色', descriptionKey: 'nav.usersDesc' },
      { title: '权限管理', titleKey: 'nav.roles', path: '/settings/roles', module: 'settings', permission: 'security.role.read', description: '角色、授权对象范围和成员分配', descriptionKey: 'nav.rolesDesc' },
      { title: '身份源', titleKey: 'nav.identitySources', path: '/settings/identity-sources', module: 'settings', permission: 'security.identity_source.read', description: 'AD/LDAP 服务配置', descriptionKey: 'nav.identitySourcesDesc' }
    ]
  }
]
