import type { GcRouteRecord } from '@/types/router'

export const businessRoutes: GcRouteRecord[] = [
  {
    path: '/certificates',
    name: 'certificate.list',
    component: () => import('@/views/certificates/CertificatesView.vue'),
    meta: {
      title: '证书资产',
      module: 'certificate',
      requiresAuth: true,
      permission: 'certificate.asset.read',
      resourceType: 'certificate',
      riskLevel: 'medium',
      breadcrumb: ['证书资产'],
      keepAlive: true
    }
  },
  {
    path: '/assets',
    name: 'asset.list',
    component: () => import('@/views/assets/AssetsView.vue'),
    meta: {
      title: '资产',
      module: 'asset',
      requiresAuth: true,
      permission: 'host.read',
      resourceType: 'host',
      riskLevel: 'low',
      breadcrumb: ['资产'],
      keepAlive: true
    }
  },
  {
    path: '/bindings',
    name: 'binding.list',
    component: () => import('@/views/bindings/BindingsView.vue'),
    meta: {
      title: '证书绑定',
      module: 'binding',
      requiresAuth: true,
      permission: 'binding.read',
      resourceType: 'binding',
      riskLevel: 'medium',
      breadcrumb: ['证书绑定'],
      keepAlive: true
    }
  },
  {
    path: '/deployment-plans',
    name: 'deployment.plan.list',
    component: () => import('@/views/deployments/DeploymentPlansView.vue'),
    meta: {
      title: '部署计划',
      module: 'deployment',
      requiresAuth: true,
      permission: 'deployment.plan.read',
      resourceType: 'deploymentPlan',
      riskLevel: 'high',
      breadcrumb: ['部署计划'],
      keepAlive: true
    }
  },
  {
    path: '/executions',
    name: 'execution.list',
    component: () => import('@/views/executions/ExecutionsView.vue'),
    meta: {
      title: '执行记录',
      module: 'execution',
      requiresAuth: true,
      permission: 'execution.read',
      resourceType: 'execution',
      riskLevel: 'medium',
      breadcrumb: ['执行记录'],
      keepAlive: true
    }
  },
  {
    path: '/agents',
    name: 'agent.list',
    component: () => import('@/views/agents/AgentsView.vue'),
    meta: {
      title: 'Agent',
      module: 'agent',
      requiresAuth: true,
      permission: 'agent.read',
      resourceType: 'agent',
      riskLevel: 'medium',
      breadcrumb: ['Agent'],
      keepAlive: true
    }
  },
  {
    path: '/gateways',
    name: 'gateway.list',
    component: () => import('@/views/gateways/GatewaysView.vue'),
    meta: {
      title: '网关',
      module: 'gateway',
      requiresAuth: true,
      permission: 'gateway.read',
      resourceType: 'gateway',
      riskLevel: 'medium',
      breadcrumb: ['网关'],
      keepAlive: true
    }
  },
  {
    path: '/plugins',
    name: 'plugin.list',
    component: () => import('@/views/plugins/PluginsView.vue'),
    meta: {
      title: '插件',
      module: 'plugin',
      requiresAuth: true,
      permission: 'plugin.read',
      resourceType: 'plugin',
      riskLevel: 'high',
      breadcrumb: ['插件'],
      keepAlive: true
    }
  },
  {
    path: '/workflow-templates',
    name: 'workflow.template.list',
    component: () => import('@/views/workflows/WorkflowTemplatesView.vue'),
    meta: {
      title: '工作流模板',
      module: 'workflow',
      requiresAuth: true,
      permission: 'workflow.template.read',
      resourceType: 'workflowTemplate',
      riskLevel: 'high',
      breadcrumb: ['工作流模板'],
      keepAlive: true,
      featureFlag: 'template.dsl.editor'
    }
  },
  {
    path: '/monitors',
    name: 'monitor.list',
    component: () => import('@/views/monitoring/MonitorsView.vue'),
    meta: {
      title: '监控告警',
      module: 'monitoring',
      requiresAuth: true,
      permission: 'monitor.read',
      resourceType: 'monitor',
      riskLevel: 'medium',
      breadcrumb: ['监控告警'],
      keepAlive: true
    }
  },
  {
    path: '/audits',
    name: 'audit.list',
    component: () => import('@/views/audit/AuditsView.vue'),
    meta: {
      title: '审计日志',
      module: 'audit',
      requiresAuth: true,
      permission: 'audit.read',
      resourceType: 'auditLog',
      riskLevel: 'low',
      breadcrumb: ['审计日志'],
      keepAlive: true
    }
  },
  {
    path: '/settings',
    name: 'settings.overview',
    component: () => import('@/views/settings/SettingsView.vue'),
    meta: {
      title: '系统设置',
      module: 'settings',
      requiresAuth: true,
      permission: 'settings.read',
      resourceType: 'settings',
      riskLevel: 'medium',
      breadcrumb: ['系统设置'],
      keepAlive: true
    }
  }
  ,
  {
    path: '/settings/users',
    name: 'settings.users',
    component: () => import('@/views/settings/UsersView.vue'),
    meta: {
      title: '用户管理',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.user.read',
      resourceType: 'user',
      riskLevel: 'medium',
      breadcrumb: ['系统设置', '用户管理'],
      keepAlive: true
    }
  },
  {
    path: '/settings/roles',
    name: 'settings.roles',
    component: () => import('@/views/settings/RolesView.vue'),
    meta: {
      title: '角色管理',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.role.read',
      resourceType: 'role',
      riskLevel: 'medium',
      breadcrumb: ['系统设置', '角色管理'],
      keepAlive: true
    }
  },
  {
    path: '/settings/permissions',
    name: 'settings.permissions',
    component: () => import('@/views/settings/PermissionPoliciesView.vue'),
    meta: {
      title: '权限策略',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.permission.read',
      resourceType: 'permissionPolicy',
      riskLevel: 'medium',
      breadcrumb: ['系统设置', '权限策略'],
      keepAlive: true
    }
  },
  {
    path: '/settings/identity-sources',
    name: 'settings.identitySources',
    component: () => import('@/views/settings/IdentitySourcesView.vue'),
    meta: {
      title: '身份源',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.identity_source.read',
      resourceType: 'identitySource',
      riskLevel: 'medium',
      breadcrumb: ['系统设置', '身份源'],
      keepAlive: true
    }
  },
  {
    path: '/settings/group-role-mappings',
    name: 'settings.groupRoleMappings',
    component: () => import('@/views/settings/GroupRoleMappingsView.vue'),
    meta: {
      title: '组角色映射',
      module: 'settings',
      requiresAuth: true,
      permission: 'security.identity_source.read',
      resourceType: 'externalGroupRoleMapping',
      riskLevel: 'medium',
      breadcrumb: ['系统设置', '组角色映射'],
      keepAlive: true
    }
  }
]
