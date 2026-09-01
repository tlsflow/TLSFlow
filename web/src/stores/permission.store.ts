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
  businessPermissions: readonly ApiRecord[]
  businessPermissionVersion: string | null
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
  execution_run: ['execution.run.read', 'execution.read'],
  execution_step: ['execution.step.read', 'execution.read'],
  workflow: ['workflow.read', 'workflow.template.read'],
  workflow_template: ['workflow.read', 'workflow.template.read'],
  plugin_version: ['plugin.read'],
  plugin_binding: ['plugin.read'],
  plugin_capability_assignment: ['plugin.read'],
  cloud_account_asset: ['cloud_account_asset.read'],
  monitor_target: ['monitor.target.read', 'monitor.read'],
  monitor_risk: ['monitor.risk.read', 'monitor.read'],
  monitor_dashboard: ['monitor.dashboard.read', 'monitor.read'],
  monitor_alert_rule: ['monitor.alert_rule.read', 'monitor.read'],
  notification_channel: ['notification.channel.read'],
  notification_route: ['notification.route.read'],
  notification_template: ['notification.template.read'],
  notification_silence: ['notification.silence.read'],
  notification_request: ['notification.request.read'],
  notification_delivery: ['notification.delivery.read'],
  workflow_execution_binding: ['workflow.execution_binding.read', 'workflow.read'],
  identity_source: ['security.identity_source.read']
}

const permissionAliases: Record<string, readonly string[]> = {
  'certificate.asset.read': ['certificate.read'],
  'service_asset.read': ['application.read'],
  'service_asset.manage': ['application.update'],
  'workflow.template.read': ['workflow.read'],
  'workflow.template.write': ['workflow.create', 'workflow.update', 'workflow.delete', 'workflow.publish', 'workflow.test'],
  'execution.read': ['execution.run.read', 'execution.step.read'],
  'monitor.read': ['monitor.target.read', 'monitor.risk.read', 'monitor.dashboard.read', 'monitor.alert_rule.read'],
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

function readStringArray(row: ApiRecord, key: string): string[] {
  const value = readField(row, key)
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function inferredBusinessPermissions(businessPermissions: readonly ApiRecord[]): string[] {
  const permissions = new Set<string>()
  for (const grant of businessPermissions) {
    // 业务拒绝授权不能反向变成前端允许权限；状态字段缺失时兼容旧上下文数据。
    const effect = readField(grant, 'effect')
    const status = readField(grant, 'status')
    if (effect === 'deny' || (status !== undefined && status !== 'active')) continue
    for (const action of readStringArray(grant, 'expandedActions')) permissions.add(action)
    // 兼容历史应用管理授权：新增的单应用证书部署动作不能依赖旧记录的展开快照。
    if (readField(grant, 'domain') === 'application' && readField(grant, 'level') === 'manager') {
      permissions.add('application.deployment.execute')
    }
    // 兼容旧版本只返回资源类型、未返回 expandedActions 的权限上下文。
    for (const objectType of readStringArray(grant, 'expandedResourceTypes')) {
      for (const permission of objectTypePermissionAliases[objectType] ?? []) permissions.add(permission)
    }
  }
  return [...permissions]
}

function permissionGranted(permissionSet: Set<string>, permission: string): boolean {
  if (permissionSet.has('*') || permissionSet.has(permission)) return true
  return (permissionAliases[permission] ?? []).some((candidate) => permissionSet.has(candidate))
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
  if (item.permissions?.length) {
    return item.permissions.some((permission) => permissionGranted(activePermissionSet, permission))
  }
  return !item.permission || permissionGranted(activePermissionSet, item.permission)
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
    businessPermissions: [],
    businessPermissionVersion: null,
    expiresAt: null,
    loadedAt: null
  }),
  getters: {
    isLoaded: (state) => Boolean(state.loadedAt),
    explicitPermissionSet: (state) => new Set(state.permissions),
    permissionSet: (state) => new Set([
      ...state.permissions,
      ...inferredReadPermissions(state.objectSets),
      ...inferredBusinessPermissions(state.businessPermissions),
    ]),
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
        this.businessPermissions = [...(context.businessPermissions ?? [])]
        this.businessPermissionVersion = context.businessPermissionVersion ?? null
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
      this.businessPermissions = []
      this.businessPermissionVersion = null
      this.expiresAt = null
      this.loadedAt = new Date().toISOString()
    },
    clear(): void {
      this.permissions = []
      this.objectSets = []
      this.roleBindings = []
      this.objectPermissionVersion = null
      this.businessPermissions = []
      this.businessPermissionVersion = null
      this.expiresAt = null
      this.loadedAt = null
    },
    hasPermission(permission: string, options?: { explicitOnly?: boolean }): boolean {
      const activePermissionSet = options?.explicitOnly ? this.explicitPermissionSet : this.permissionSet
      return permissionGranted(activePermissionSet, permission)
    }
  }
})
