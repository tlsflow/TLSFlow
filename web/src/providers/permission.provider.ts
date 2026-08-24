import { getCurrentPermissions } from '@/api/modules/security.api'

export interface PermissionProvider {
  loadPermissions(): Promise<readonly string[]>
}

export const skeletonPermissions = [
  'dashboard.read',
  'certificate.asset.read',
  'certificate.import',
  'host.read',
  'binding.read',
  'deployment.plan.read',
  'execution.read',
  'agent.read',
  'agent.write',
  'gateway.read',
  'plugin.read',
  'workflow.template.read',
  'monitor.read',
  'audit.read',
  'settings.read',
  'security.user.read',
  'security.user.write',
  'security.role.read',
  'security.role.write',
  'security.permission.read',
  'security.permission.write',
  'security.identity_source.read',
  'security.identity_source.write',
  'deployment.plan.execute',
  'execution.rollback',
  'plugin.manage',
  'workflow.template.write'
] as const

export class ApiPermissionProvider implements PermissionProvider {
  async loadPermissions(): Promise<readonly string[]> {
    const result = await getCurrentPermissions()
    return result.data?.permissions ?? []
  }
}

export class MockPermissionProvider implements PermissionProvider {
  async loadPermissions(): Promise<readonly string[]> {
    // 中文说明：前端权限只负责入口体验，不是安全边界；真实权限以后端返回为准。
    return skeletonPermissions
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
