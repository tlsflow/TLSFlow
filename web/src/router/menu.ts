import type { MenuItem } from '@/types/router'

export const mainMenuItems: MenuItem[] = [
  {
    title: '总览',
    path: '/dashboard',
    module: 'dashboard',
    permission: 'dashboard.read',
    icon: 'dashboard',
    description: '应用、证书、Agent、网关和审计状态总览'
  },
  {
    title: '证书',
    path: '/certificates',
    module: 'certificate',
    permission: 'certificate.asset.read',
    icon: 'shield',
    description: '证书库、绑定关系和到期状态',
    children: [
      { title: '证书资产', path: '/certificates', module: 'certificate', permission: 'certificate.asset.read', description: '证书、私钥引用、指纹和到期时间' },
      { title: '证书格式配置', path: '/bindings', module: 'binding', permission: 'binding.read', description: '为已保存证书定义 PFX、CER、CRT、PEM 等格式规则配置' }
    ]
  },
  {
    title: '应用资产',
    path: '/assets',
    module: 'asset',
    permission: 'service_asset.read',
    icon: 'server',
    description: '域名/IP 维度的应用入口与证书部署目标',
    children: [
      { title: '应用资产', path: '/assets', module: 'asset', permission: 'service_asset.read', description: '域名、端口、协议和关联服务实例' },
      { title: 'Agent', path: '/agents', module: 'agent', permission: 'agent.read', description: '在线状态、心跳和能力集合' },
      { title: '网关', path: '/gateways', module: 'gateway', permission: 'gateway.read', description: '隔离区网关、协议和可达目标' }
    ]
  },
  {
    title: '自动化',
    path: '/deployment-plans',
    module: 'automation',
    permission: 'deployment.plan.read',
    icon: 'bolt',
    description: '部署计划、执行记录、模板和插件',
    children: [
      { title: '部署计划', path: '/deployment-plans', module: 'deployment', permission: 'deployment.plan.read', description: '证书部署计划和审批入口' },
      { title: '执行记录', path: '/executions', module: 'execution', permission: 'execution.read', description: '执行步骤、日志、失败和回滚' },
      { title: '工作流模板', path: '/workflow-templates', module: 'workflow', permission: 'workflow.template.read', description: '模板变量、能力声明和发布' },
      { title: '插件', path: '/plugins', module: 'plugin', permission: 'plugin.read', description: 'Provider、执行器和沙箱状态' }
    ]
  },
  {
    title: '监控',
    path: '/monitors',
    module: 'monitoring',
    permission: 'monitor.read',
    icon: 'pulse',
    description: '告警、审计和证书状态',
    children: [
      { title: '监控告警', path: '/monitors', module: 'monitoring', permission: 'monitor.read', description: '到期、漂移和执行失败事件' },
      { title: '审计日志', path: '/audits', module: 'audit', permission: 'audit.read', description: '操作证据与合规导出' }
    ]
  },
  {
    title: '设置',
    path: '/settings',
    module: 'settings',
    permission: 'settings.read',
    icon: 'settings',
    description: '租户、用户、权限和系统配置',
    children: [
      { title: '系统设置', path: '/settings', module: 'settings', permission: 'settings.read', description: '系统配置和安全元数据' },
      { title: '用户管理', path: '/settings/users', module: 'settings', permission: 'security.user.read', description: '控制台用户、状态和角色' },
      { title: '角色管理', path: '/settings/roles', module: 'settings', permission: 'security.role.read', description: '角色定义和权限数量' },
      { title: '权限策略', path: '/settings/permissions', module: 'settings', permission: 'security.permission.read', description: 'RBAC allow/deny 策略' },
      { title: '身份源', path: '/settings/identity-sources', module: 'settings', permission: 'security.identity_source.read', description: 'AD/LDAP 服务配置' },
      { title: '组角色映射', path: '/settings/group-role-mappings', module: 'settings', permission: 'security.identity_source.read', description: '外部目录组映射本地角色' }
    ]
  }
]
