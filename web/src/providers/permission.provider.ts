export interface PermissionProvider {
  loadPermissions(): Promise<readonly string[]>
}

export const skeletonPermissions = [
  'dashboard.read',
  'certificate.asset.read',
  'host.read',
  'binding.read',
  'deployment.plan.read',
  'execution.read',
  'agent.read',
  'gateway.read',
  'plugin.read',
  'workflow.template.read',
  'monitor.read',
  'audit.read',
  'settings.read',
  'deployment.plan.execute',
  'execution.rollback',
  'plugin.manage',
  'workflow.template.write'
] as const

export class MockPermissionProvider implements PermissionProvider {
  async loadPermissions(): Promise<readonly string[]> {
    // 中文说明：前端权限只负责入口体验，不是安全边界；真实权限以后端返回为准。
    return skeletonPermissions
  }
}

let permissionProvider: PermissionProvider = new MockPermissionProvider()

export function getPermissionProvider(): PermissionProvider {
  return permissionProvider
}

export function setPermissionProvider(provider: PermissionProvider): void {
  permissionProvider = provider
}

export function resetPermissionProvider(): void {
  permissionProvider = new MockPermissionProvider()
}
