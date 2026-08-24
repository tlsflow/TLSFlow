import { defineStore } from 'pinia'
import { mainMenuItems } from '@/router/menu'
import type { MenuItem } from '@/types/router'

interface PermissionState {
  permissions: readonly string[]
  loadedAt: string | null
}

const skeletonPermissions = [
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

function hasMenuPermission(item: MenuItem, permissionSet: Set<string>): boolean {
  return !item.permission || permissionSet.has(item.permission)
}

export const usePermissionStore = defineStore('permission', {
  state: (): PermissionState => ({
    permissions: [],
    loadedAt: null
  }),
  getters: {
    isLoaded: (state) => Boolean(state.loadedAt),
    permissionSet: (state) => new Set(state.permissions),
    visibleMenuItems(): readonly MenuItem[] {
      return mainMenuItems.filter((item) => hasMenuPermission(item, this.permissionSet))
    }
  },
  actions: {
    async loadMockPermissions(): Promise<void> {
      // 中文说明：前端权限只负责入口体验，不是安全边界；真实权限以后端返回为准。
      this.permissions = skeletonPermissions
      this.loadedAt = new Date().toISOString()
    },
    setPermissions(permissions: readonly string[]): void {
      this.permissions = [...permissions]
      this.loadedAt = new Date().toISOString()
    },
    hasPermission(permission: string): boolean {
      return this.permissions.includes(permission)
    }
  }
})
