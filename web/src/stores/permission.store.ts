import { defineStore } from 'pinia'
import { mainMenuItems } from '@/router/menu'
import type { MenuItem } from '@/types/router'
import { getPermissionProvider } from '@/providers/permission.provider'

interface PermissionState {
  permissions: readonly string[]
  loadedAt: string | null
}

function hasOwnMenuPermission(item: MenuItem, permissionSet: Set<string>): boolean {
  return !item.permission || permissionSet.has(item.permission)
}

function filterMenuItem(item: MenuItem, permissionSet: Set<string>): MenuItem | null {
  const children = item.children
    ?.map((child) => filterMenuItem(child, permissionSet))
    .filter((child): child is MenuItem => Boolean(child)) ?? []

  if (!hasOwnMenuPermission(item, permissionSet) && children.length === 0) {
    return null
  }

  return children.length > 0 ? { ...item, children } : { ...item, children: undefined }
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
      return mainMenuItems
        .map((item) => filterMenuItem(item, this.permissionSet))
        .filter((item): item is MenuItem => Boolean(item))
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
