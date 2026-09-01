import type {
  BusinessPermissionDomain,
  BusinessPermissionLevel,
} from '../../persistence/entities/business-permission.entity.js';

export interface BusinessPermissionResourceRule {
  objectType: string;
  accessLevel: 'read' | 'edit' | 'control';
  actions: string[];
  highRisk?: boolean;
}

export interface BusinessPermissionDefinition {
  domain: BusinessPermissionDomain;
  label: string;
  rootObjectTypes: string[];
  levels: Record<BusinessPermissionLevel, {
    resources: BusinessPermissionResourceRule[];
    forbiddenCapabilities: string[];
  }>;
}

/**
 * 预置模板只是一组可复用的业务授权建议，不是角色，也不单独持久化。
 * 实际授权仍然写入 business_permission_grants，并通过 RoleBinding 绑定主体。
 */
export interface BusinessPermissionPreset {
  id: string;
  label: string;
  domain: BusinessPermissionDomain;
  level: BusinessPermissionLevel;
}

export const BUSINESS_PERMISSION_PRESETS: readonly BusinessPermissionPreset[] = [
  { id: 'certificate.viewer', label: '证书查看', domain: 'certificate', level: 'user' },
  { id: 'certificate.manager', label: '证书管理', domain: 'certificate', level: 'manager' },
  { id: 'application.viewer', label: '应用查看', domain: 'application', level: 'user' },
  { id: 'application.manager', label: '应用管理', domain: 'application', level: 'manager' },
];

export const BUSINESS_PERMISSION_ACTION_ALIASES: Readonly<Record<string, string>> = {
  'certificate.format.create': 'certificate.artifact.export',
  'binding.read': 'application.certificate.read',
  'binding.manage': 'application.certificate.update',
  'service_asset.read': 'application.read',
  'service_asset.manage': 'application.update',
};

/**
 * 业务授权注册表是唯一的业务域/级别映射来源。Controller 不得复制这些分支。
 * manager 只增加业务所需的编辑能力，审批、Secret 和 Agent 最小权限仍由下游服务决定。
 */
export const BUSINESS_PERMISSION_REGISTRY: Readonly<Record<BusinessPermissionDomain, BusinessPermissionDefinition>> = {
  certificate: {
    domain: 'certificate',
    label: '证书',
    rootObjectTypes: ['certificate', 'certificate_asset'],
    levels: {
      user: {
        resources: [
          resource('certificate', 'read', 'certificate.read'),
          resource('certificate_asset', 'read', 'certificate.read'),
          resource('certificate_version', 'read', 'certificate.version.read'),
          resource('certificate_version_format', 'read', 'certificate.format.read'),
          resource('certificate_binding', 'read', 'certificate.binding.read', 'binding.read'),
        ],
        forbiddenCapabilities: ['certificate.private_key.export', 'secret.resolve', 'certificate.import', 'certificate.renew'],
      },
      manager: {
        resources: [
          resource('certificate', 'edit', 'certificate.read', 'certificate.update', 'certificate.lifecycle', 'certificate.import', 'certificate.renew', 'certificate.auto_renew.update', 'certificate.artifact.export'),
          resource('certificate_asset', 'edit', 'certificate.read', 'certificate.update', 'certificate.lifecycle', 'certificate.import', 'certificate.renew', 'certificate.auto_renew.update', 'certificate.artifact.export'),
          resource('certificate_version', 'edit', 'certificate.version.read', 'certificate.version.update', 'certificate.lifecycle', 'certificate.artifact.export'),
          resource('certificate_version_format', 'edit', 'certificate.format.read', 'certificate.artifact.export', 'certificate.format.create'),
          resource('certificate_binding', 'edit', 'certificate.binding.read', 'certificate.binding.update', 'binding.read'),
          resource('certificate_request', 'edit', 'certificate.request.read', 'certificate.request.create', 'certificate.request.approve'),
          resource('certificate_renewal', 'edit', 'certificate.renew.read', 'certificate.renew.create', 'certificate.lifecycle'),
        ],
        forbiddenCapabilities: ['certificate.private_key.export', 'secret.resolve', 'permission.delegate'],
      },
    },
  },
  application: {
    domain: 'application',
    label: '应用',
    rootObjectTypes: ['application_asset', 'service_asset'],
    levels: {
      user: {
        resources: [
          resource('application_asset', 'read', 'application.read', 'application.asset.rescan', 'application.monitor.read'),
          resource('service_asset', 'read', 'application.read', 'application.asset.rescan', 'application.monitor.read'),
          resource('device_asset', 'read', 'application.device.read'),
          resource('certificate_binding', 'read', 'application.certificate.read'),
          resource('monitor_target', 'read', 'application.monitor.read', 'monitor.target.read'),
          resource('monitor_risk', 'read', 'application.monitor.read', 'monitor.risk.read'),
          resource('monitor_dashboard', 'read', 'application.monitor.read', 'monitor.dashboard.read'),
          resource('monitor_probe_result', 'read', 'application.monitor.read'),
          resource('monitor_certificate_observation', 'read', 'application.monitor.read'),
        ],
        forbiddenCapabilities: ['application.update', 'deployment.execute', 'deployment.rollback', 'permission.delegate'],
      },
      manager: {
        resources: [
          resource('application_asset', 'edit', 'application.read', 'application.update', 'application.asset.rescan', 'application.monitor.read'),
          resource('service_asset', 'edit', 'application.read', 'application.update', 'service_asset.manage', 'application.asset.rescan', 'application.monitor.read'),
          resource('device_asset', 'read', 'application.device.read'),
          resource('certificate_binding', 'edit', 'application.certificate.read', 'application.certificate.update', 'binding.manage', 'certificate.binding.update'),
          resource('monitor_target', 'read', 'application.monitor.read', 'monitor.target.read'),
          resource('monitor_risk', 'read', 'application.monitor.read', 'monitor.risk.read'),
          resource('monitor_dashboard', 'read', 'application.monitor.read', 'monitor.dashboard.read'),
          resource('monitor_probe_result', 'read', 'application.monitor.read'),
          resource('monitor_certificate_observation', 'read', 'application.monitor.read'),
        ],
        forbiddenCapabilities: ['permission.delegate', 'secret.resolve', 'certificate.private_key.export'],
      },
    },
  },
  audit: {
    domain: 'audit',
    label: '日志',
    rootObjectTypes: ['audit_log'],
    levels: {
      user: {
        resources: [resource('audit_log', 'read', 'audit.read')],
        forbiddenCapabilities: ['audit.delete', 'audit.mutate'],
      },
      manager: {
        resources: [resource('audit_log', 'edit', 'audit.read', 'audit.export', 'audit.archive', 'audit.policy.update')],
        forbiddenCapabilities: ['audit.delete', 'audit.mutate'],
      },
    },
  },
  settings: {
    domain: 'settings',
    label: '系统设置',
    rootObjectTypes: ['system_setting'],
    levels: {
      user: {
        resources: [resource('system_setting', 'read', 'settings.read')],
        forbiddenCapabilities: ['settings.user.write', 'settings.role.write', 'settings.identity_source.write', 'secret.resolve'],
      },
      manager: {
        resources: [resource('system_setting', 'edit', 'settings.read', 'settings.user.write', 'settings.role.write', 'settings.identity_source.write', 'settings.notification.write', 'settings.system.write')],
        forbiddenCapabilities: ['secret.resolve', 'audit.mutate', 'permission.delegate'],
      },
    },
  },
};

export function getBusinessPermissionDefinition(domain: string): BusinessPermissionDefinition | undefined {
  return BUSINESS_PERMISSION_REGISTRY[domain as BusinessPermissionDomain];
}

export function getBusinessPermissionPreset(id: string): BusinessPermissionPreset | undefined {
  return BUSINESS_PERMISSION_PRESETS.find((preset) => preset.id === id);
}

export function canonicalBusinessPermissionAction(action: string): string {
  return BUSINESS_PERMISSION_ACTION_ALIASES[action] ?? action;
}

function resource(
  objectType: string,
  accessLevel: 'read' | 'edit' | 'control',
  ...actions: string[]
): BusinessPermissionResourceRule {
  return { objectType, accessLevel, actions };
}
