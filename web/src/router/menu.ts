import type { MenuItem } from '@/types/router'

export const mainMenuItems: MenuItem[] = [
  { title: '仪表盘', path: '/dashboard', module: 'dashboard', permission: 'dashboard.read' },
  { title: '证书资产', path: '/certificates', module: 'certificate', permission: 'certificate.asset.read' },
  { title: '资产', path: '/assets', module: 'asset', permission: 'host.read' },
  { title: '证书绑定', path: '/bindings', module: 'binding', permission: 'binding.read' },
  { title: '部署计划', path: '/deployment-plans', module: 'deployment', permission: 'deployment.plan.read' },
  { title: '执行记录', path: '/executions', module: 'execution', permission: 'execution.read' },
  { title: 'Agent', path: '/agents', module: 'agent', permission: 'agent.read' },
  { title: '网关', path: '/gateways', module: 'gateway', permission: 'gateway.read' },
  { title: '插件', path: '/plugins', module: 'plugin', permission: 'plugin.read' },
  { title: '工作流模板', path: '/workflow-templates', module: 'workflow', permission: 'workflow.template.read' },
  { title: '监控告警', path: '/monitors', module: 'monitoring', permission: 'monitor.read' },
  { title: '审计日志', path: '/audits', module: 'audit', permission: 'audit.read' },
  { title: '系统设置', path: '/settings', module: 'settings', permission: 'settings.read' }
]
