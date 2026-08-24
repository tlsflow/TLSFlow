import { defineStore } from 'pinia'
import { mainMenuItems } from '@/router/menu'
import type { MenuItem } from '@/types/router'
import { getPermissionProvider } from '@/providers/permission.provider'
import type { ApiRecord } from '@/api/modules/common'

interface PermissionState {
  permissions: readonly string[]
  objectSets: readonly ApiRecord[]
  roleBindings: readonly ApiRecord[]
  objectPermissionVersion: string | null
  expiresAt: string | null
  loadedAt: string | null
}

function hasOwnMenuPermission(item: MenuItem, permissionSet: Set<string>): boolean {
  return permissionSet.has('*') || !item.permission || permissionSet.has(item.permission)
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
    objectSets: [],
    roleBindings: [],
    objectPermissionVersion: null,
    expiresAt: null,
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
      const provider = getPermissionProvider()
      const context = await provider.loadPermissionContext?.()
      if (context) {
        this.permissions = [...context.permissions]
        this.objectSets = [...context.objectSets]
        this.roleBindings = [...context.roleBindings]
        this.objectPermissionVersion = context.objectPermissionVersion
        this.expiresAt = context.expiresAt
        this.loadedAt = new Date().toISOString()
        return
      }
      this.setPermissions(await provider.loadPermissions())
    },
    setPermissions(permissions: readonly string[]): void {
      this.permissions = [...permissions]
      this.objectSets = []
      this.roleBindings = []
      this.objectPermissionVersion = null
      this.expiresAt = null
      this.loadedAt = new Date().toISOString()
    },
    hasPermission(permission: string): boolean {
      return this.permissions.includes('*') || this.permissions.includes(permission)
    }
  }
})
