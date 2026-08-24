import type { MenuItem } from '@/types/router'

export const mainMenuItems: MenuItem[] = [
  {
    title: '总览',
    path: '/dashboard',
    module: 'dashboard',
    permission: 'dashboard.read',
    icon: 'dashboard',
    description: '风险、到期、漂移和执行状态总览'
  },
  {
    title: '证书',
    path: '/certificates',
    module: 'certificate',
    permission: 'certificate.asset.read',
    icon: 'shield',
    description: '证书库、绑定关系和到期风险',
    children: [
      { title: '证书资产', path: '/certificates', module: 'certificate', permission: 'certificate.asset.read', description: '证书、私钥引用、指纹和到期时间' },
      { title: '证书绑定', path: '/bindings', module: 'binding', permission: 'binding.read', description: '证书、域名、服务实例和端口绑定' }
    ]
  },
  {
    title: '资产',
    path: '/assets',
    module: 'asset',
    permission: 'host.read',
    icon: 'server',
    description: '主机、Agent 和网关统一入口',
    children: [
      { title: '主机资产', path: '/assets', module: 'asset', permission: 'host.read', description: '主机、服务实例和发现结果' },
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
    description: '告警、审计和风险事件',
    children: [
      { title: '监控告警', path: '/monitors', module: 'monitoring', permission: 'monitor.read', description: '到期、漂移和执行失败风险' },
      { title: '审计日志', path: '/audits', module: 'audit', permission: 'audit.read', description: '操作证据、requestId 和合规导出' }
    ]
  },
  {
    title: '设置',
    path: '/settings',
    module: 'settings',
    permission: 'settings.read',
    icon: 'settings',
    description: '租户、用户、权限和系统配置'
  }
]
