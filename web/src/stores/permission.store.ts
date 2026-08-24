import { defineStore } from 'pinia'
import { mainMenuItems } from '@/router/menu'
import type { MenuItem } from '@/types/router'
import { getPermissionProvider } from '@/providers/permission.provider'

interface PermissionState {
  permissions: readonly string[]
  loadedAt: string | null
}

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
    async loadPermissions(): Promise<void> {
      this.setPermissions(await getPermissionProvider().loadPermissions())
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
