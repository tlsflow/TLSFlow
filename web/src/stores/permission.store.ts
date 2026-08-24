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

const objectTypePermissionAliases: Record<string, readonly string[]> = {
  certificate: ['certificate.asset.read'],
  certificate_asset: ['certificate.asset.read'],
  certificate_version: ['certificate.asset.read'],
  certificate_version_format: ['certificate.asset.read'],
  service_asset: ['service_asset.read'],
  application_asset: ['service_asset.read'],
  gateway: ['gateway.read'],
  agent: ['agent.read'],
  host: ['host.read'],
  device_asset: ['host.read'],
  certificate_binding: ['binding.read'],
  deployment_plan: ['deployment.plan.read'],
  execution_run: ['execution.read'],
  workflow: ['workflow.template.read'],
  workflow_template: ['workflow.template.read'],
  plugin_version: ['plugin.read'],
  monitor_target: ['monitor.read'],
  notification_channel: ['notification.channel.read']
}

function readField(row: ApiRecord | null | undefined, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, row)
}

function readObjectTypes(row: ApiRecord): string[] {
  const value = readField(row, 'objectTypes')
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function inferredReadPermissions(objectSets: readonly ApiRecord[]): string[] {
  const permissions = new Set<string>()
  for (const objectSet of objectSets) {
    for (const objectType of readObjectTypes(objectSet)) {
      for (const permission of objectTypePermissionAliases[objectType] ?? []) {
        permissions.add(permission)
      }
    }
  }
  return [...permissions]
}

function selectPermissionSet(
  item: Pick<MenuItem, 'allowInferredPermission'>,
  permissionSet: Set<string>,
  explicitPermissionSet: Set<string>,
): Set<string> {
  return item.allowInferredPermission === false ? explicitPermissionSet : permissionSet
}

function hasOwnMenuPermission(item: MenuItem, permissionSet: Set<string>, explicitPermissionSet: Set<string>): boolean {
  const activePermissionSet = selectPermissionSet(item, permissionSet, explicitPermissionSet)
  if (activePermissionSet.has('*')) return true
  if (item.permissions?.length) {
    return item.permissions.some((permission) => activePermissionSet.has(permission))
  }
  return !item.permission || activePermissionSet.has(item.permission)
}

function filterMenuItem(item: MenuItem, permissionSet: Set<string>, explicitPermissionSet: Set<string>): MenuItem | null {
  const children = item.children
    ?.map((child) => filterMenuItem(child, permissionSet, explicitPermissionSet))
    .filter((child): child is MenuItem => Boolean(child)) ?? []

  if (!hasOwnMenuPermission(item, permissionSet, explicitPermissionSet) && children.length === 0) {
    return null
  }

  const visiblePath = children.length > 0 && !children.some((child) => child.path === item.path)
    ? children[0].path
    : item.path

  return children.length > 0
    ? { ...item, path: visiblePath, children }
    : { ...item, children: undefined }
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
    explicitPermissionSet: (state) => new Set(state.permissions),
    permissionSet: (state) => new Set([...state.permissions, ...inferredReadPermissions(state.objectSets)]),
    visibleMenuItems(): readonly MenuItem[] {
      return mainMenuItems
        .map((item) => filterMenuItem(item, this.permissionSet, this.explicitPermissionSet))
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
    hasPermission(permission: string, options?: { explicitOnly?: boolean }): boolean {
      const activePermissionSet = options?.explicitOnly ? this.explicitPermissionSet : this.permissionSet
      return activePermissionSet.has('*') || activePermissionSet.has(permission)
    }
  }
})
