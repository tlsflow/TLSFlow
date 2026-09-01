import { getCurrentPermissions, getPermissionContext, type ObjectPermissionContextResponse } from '@/api/modules/security.api'
import { i18n } from '@/i18n'

export interface PermissionProvider {
  loadPermissions(): Promise<readonly string[]>
  loadPermissionContext?(): Promise<ObjectPermissionContextResponse | null>
}

export const skeletonPermissions = [
  'dashboard.read',
  'certificate.asset.read',
  'ca.operations.read',
  'certificate.import',
  'host.read',
  'service_asset.read',
  'service_asset.manage',
  'application.device.update',
  'provider.read',
  'cloud_account_asset.read',
  'cloud_account_asset.create',
  'cloud_account_asset.update',
  'cloud_account_asset.control',
  'cloud_account_asset.delete',
  'binding.read',
  'deployment.plan.read',
  'execution.run.read',
  'execution.step.read',
  'agent.read',
  'agent.write',
  'gateway.read',
  'plugin.read',
  'workflow.read',
  'workflow.create',
  'workflow.update',
  'workflow.delete',
  'workflow.publish',
  'monitor.target.read',
  'monitor.risk.read',
  'monitor.dashboard.read',
  'monitor.alert_rule.read',
  'audit.read',
  'settings.read',
  'settings.write',
  'credential.read',
  'credential.create',
  'credential.update',
  'credential.rotate',
  'credential.disable',
  'credential.delete',
  'credential.use',
  'notification.channel.read',
  'security.user.read',
  'security.user.write',
  'security.role.read',
  'security.role.write',
  'security.permission.read',
  'security.permission.write',
  'security.identity_source.read',
  'security.identity_source.write',
  'deployment.plan.execute',
  'execution.run.recover',
  'execution.rollback',
  'plugin.manage'
] as const

export class ApiPermissionProvider implements PermissionProvider {
  async loadPermissions(): Promise<readonly string[]> {
    const result = await getCurrentPermissions()
    return result.data?.permissions ?? []
  }

  async loadPermissionContext(): Promise<ObjectPermissionContextResponse | null> {
    const result = await getPermissionContext()
    return result.data ?? null
  }
}

export class MockPermissionProvider implements PermissionProvider {
  async loadPermissions(): Promise<readonly string[]> {
    // 中文说明：前端权限只负责入口体验，不是安全边界；真实权限以后端返回为准。
    return skeletonPermissions
  }

  async loadPermissionContext(): Promise<ObjectPermissionContextResponse> {
    return {
      user: {
        id: 'user_mock',
        username: 'mock',
        displayName: 'Mock User',
        tenantId: 'default',
        tenantName: i18n.global.t('common.tenantFallback'),
        status: 'active',
        roles: []
      },
      roles: [],
      permissions: skeletonPermissions,
      objectSets: [],
      roleBindings: [],
      objectPermissionVersion: 'mock',
      businessPermissions: [],
      businessPermissionVersion: 'mock',
      expiresAt: new Date(Date.now() + 300_000).toISOString()
    }
  }
}

let permissionProvider: PermissionProvider = new ApiPermissionProvider()

export function getPermissionProvider(): PermissionProvider {
  return permissionProvider
}

export function setPermissionProvider(provider: PermissionProvider): void {
  permissionProvider = provider
}

export function resetPermissionProvider(): void {
  permissionProvider = new ApiPermissionProvider()
}

export function resetPermissionProviderToMock(): void {
  permissionProvider = new MockPermissionProvider()
}
