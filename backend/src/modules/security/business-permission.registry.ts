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
          resource('certificate_binding', 'read', 'certificate.binding.read'),
        ],
        forbiddenCapabilities: ['certificate.private_key.export', 'secret.resolve', 'certificate.import', 'certificate.renew'],
      },
      manager: {
        resources: [
          resource('certificate', 'edit', 'certificate.read', 'certificate.update', 'certificate.lifecycle', 'certificate.import', 'certificate.renew'),
          resource('certificate_asset', 'edit', 'certificate.read', 'certificate.update', 'certificate.lifecycle', 'certificate.import', 'certificate.renew'),
          resource('certificate_version', 'edit', 'certificate.version.read', 'certificate.version.update', 'certificate.lifecycle'),
          resource('certificate_version_format', 'read', 'certificate.format.read'),
          resource('certificate_binding', 'edit', 'certificate.binding.read', 'certificate.binding.update'),
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
          resource('application_asset', 'read', 'application.read'),
          resource('service_asset', 'read', 'application.read'),
          resource('device_asset', 'read', 'application.device.read'),
          resource('certificate_binding', 'read', 'application.certificate.read'),
          resource('deployment_plan', 'read', 'application.deployment.read'),
          resource('workflow', 'read', 'application.workflow.read'),
          resource('execution_run', 'read', 'application.execution.read', 'execution.run.read'),
          resource('execution_step', 'read', 'execution.step.read'),
        ],
        forbiddenCapabilities: ['application.update', 'deployment.execute', 'deployment.rollback', 'permission.delegate'],
      },
      manager: {
        resources: [
          resource('application_asset', 'edit', 'application.read', 'application.update'),
          resource('service_asset', 'edit', 'application.read', 'application.update', 'service_asset.manage'),
          resource('device_asset', 'read', 'application.device.read'),
          resource('certificate_binding', 'edit', 'application.certificate.read', 'application.certificate.update'),
          resource('deployment_plan', 'edit', 'application.deployment.read', 'application.deployment.update', 'application.deployment.create', 'application.deployment.submit', 'application.deployment.execute', 'application.deployment.rollback', 'deployment.plan.read', 'deployment.plan.create', 'deployment.plan.update', 'deployment.plan.submit', 'deployment.plan.execute', 'deployment.plan.rollback'),
          resource('workflow', 'control', 'application.workflow.read', 'application.workflow.update', 'application.workflow.create', 'workflow.read', 'workflow.create', 'workflow.update', 'workflow.publish', 'workflow.test'),
          resource('execution_run', 'control', 'application.execution.read', 'application.execution.update', 'application.execution.execute', 'application.execution.rollback', 'execution.run.read', 'execution.run.retry', 'execution.run.rollback', 'execution.read', 'execution.update', 'execution.rollback'),
          resource('execution_step', 'read', 'execution.step.read'),
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

function resource(
  objectType: string,
  accessLevel: 'read' | 'edit' | 'control',
  ...actions: string[]
): BusinessPermissionResourceRule {
  return { objectType, accessLevel, actions };
}
