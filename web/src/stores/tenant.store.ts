import { defineStore } from 'pinia'
import { i18n } from '@/i18n'
import {
  getTenantContext,
  listAccessibleTenants,
  switchTenant as switchTenantApi,
  type AccessibleTenantResponse,
  type TenantContextResponse,
  type TenantMode,
  type TenantScopeType,
} from '@/api/modules/security.api'
import { ApiClientError } from '@/api/client'
import { useAuthStore } from './auth.store'
import { usePermissionStore } from './permission.store'
import { emitTenantContextChanged } from './tenant-context.events'
import { resetTaskRealtimeConnection } from '@/views/tasks/task-events'

export interface TenantOption extends AccessibleTenantResponse {
  readonly id: string
}

interface TenantState {
  currentTenantId: string
  mode: TenantMode
  contextVersion: string | null
  managementScope: { readonly type: TenantScopeType; readonly rootTenantId?: string; readonly tenantIds?: readonly string[] } | null
  tenants: readonly TenantOption[]
  loading: boolean
  switching: boolean
  errorCode: string | null
}

export const useTenantStore = defineStore('tenant', {
  state: (): TenantState => ({
    currentTenantId: 'default',
    mode: 'single',
    contextVersion: null,
    managementScope: null,
    tenants: [{
      id: 'default',
      tenantId: 'default',
      name: i18n.global.t('common.tenantFallback'),
      code: 'default',
      type: 'GROUP',
      membershipType: 'owner',
      membershipStatus: 'ACTIVE',
      current: true,
      canSwitch: true,
      mode: 'single',
    }],
    loading: false,
    switching: false,
    errorCode: null,
  }),
  getters: {
    switchableTenants: (state): readonly TenantOption[] => state.tenants.filter((tenant) => tenant.canSwitch),
    canSwitchTenant: (state) => (tenantId: string): boolean => state.tenants.some((tenant) => tenant.tenantId === tenantId && tenant.canSwitch),
    hasTenantSwitcher: (state): boolean => state.mode === 'hierarchical' && state.tenants.filter((tenant) => tenant.canSwitch).length >= 2,
  },
  actions: {
    setCurrentTenant(tenantId: string): void {
      this.currentTenantId = tenantId
    },
    async loadAccessibleTenants(): Promise<readonly TenantOption[]> {
      this.loading = true
      this.errorCode = null
      try {
        const result = await listAccessibleTenants()
        const data = result.data
        if (!data) return this.tenants
        this.mode = data.mode
        this.currentTenantId = data.currentTenantId
        this.contextVersion = data.version
        this.tenants = data.items.map((tenant) => ({ ...tenant, id: tenant.tenantId }))
        return this.tenants
      } catch (cause) {
        this.errorCode = cause instanceof ApiClientError ? cause.errorCode : 'TENANT_ACCESSIBLE_LOAD_FAILED'
        throw cause
      } finally {
        this.loading = false
      }
    },
    async refreshTenantContext(): Promise<TenantContextResponse & { readonly currentTenant?: Record<string, unknown> }> {
      const result = await getTenantContext()
      if (!result.data) throw new Error('TENANT_CONTEXT_EMPTY')
      this.applyContext(result.data)
      const currentTenant = result.data.currentTenant
      if (currentTenant) {
        const authStore = useAuthStore()
        if (authStore.user) {
          authStore.user = {
            ...authStore.user,
            tenantId: String(currentTenant.id ?? this.currentTenantId),
            tenantName: String(currentTenant.name ?? authStore.user.tenantName),
          }
        }
      }
      return result.data
    },
    async switchTenant(tenantId: string): Promise<void> {
      const target = this.tenants.find((tenant) => tenant.tenantId === tenantId)
      if (!target?.canSwitch) {
        const error = new Error('TENANT_MEMBERSHIP_REQUIRED')
        this.errorCode = 'TENANT_MEMBERSHIP_REQUIRED'
        throw error
      }
      if (!this.contextVersion) await this.refreshTenantContext()
      const previous = snapshotStore(this)
      const authStore = useAuthStore()
      const permissionStore = usePermissionStore()
      const previousAuth = snapshotAuth(authStore)
      const previousPermissions = snapshotPermissions(permissionStore)
      this.switching = true
      this.errorCode = null
      try {
        const result = await switchTenantApi({ tenantId, contextVersion: this.contextVersion! })
        if (!result.data) throw new Error('TENANT_CONTEXT_EMPTY')
        authStore.setToken(result.data.token)
        this.applyContext(result.data)
        // 先关停旧租户实时连接，避免切换期间把旧事件写入新上下文。
        resetTaskRealtimeConnection()
        await authStore.refreshCurrentUser()
        permissionStore.clear()
        await permissionStore.loadPermissions()
        await this.loadAccessibleTenants()
        emitTenantContextChanged({ tenantId: this.currentTenantId, contextVersion: this.contextVersion! })
      } catch (cause) {
        restoreStore(this, previous)
        restoreAuth(authStore, previousAuth)
        restorePermissions(permissionStore, previousPermissions)
        resetTaskRealtimeConnection()
        this.errorCode = cause instanceof ApiClientError ? cause.errorCode : (cause instanceof Error ? cause.message : 'TENANT_SWITCH_FAILED')
        throw cause
      } finally {
        this.switching = false
      }
    },
    async resetToDefaultTenant(): Promise<void> {
      const defaultTenant = this.tenants.find((tenant) => tenant.tenantId === 'default' || tenant.code === 'default')
      if (defaultTenant?.canSwitch) await this.switchTenant(defaultTenant.tenantId)
    },
    applyContext(context: TenantContextResponse): void {
      this.mode = context.mode
      this.currentTenantId = context.currentTenantId
      this.contextVersion = context.version
      this.managementScope = context.managementScope ?? null
    },
    clear(): void {
      this.currentTenantId = 'default'
      this.mode = 'single'
      this.contextVersion = null
      this.managementScope = null
      this.tenants = []
      this.errorCode = null
    },
  },
})

function stateSnapshot(store: ReturnType<typeof useTenantStore>): TenantState {
  return {
    currentTenantId: store.currentTenantId,
    mode: store.mode,
    contextVersion: store.contextVersion,
    managementScope: store.managementScope,
    tenants: store.tenants,
    loading: store.loading,
    switching: store.switching,
    errorCode: store.errorCode,
  }
}
function snapshotStore(store: ReturnType<typeof useTenantStore>): TenantState {
  return stateSnapshot(store)
}

function restoreStore(store: ReturnType<typeof useTenantStore>, snapshot: TenantState): void {
  store.currentTenantId = snapshot.currentTenantId
  store.mode = snapshot.mode
  store.contextVersion = snapshot.contextVersion
  store.managementScope = snapshot.managementScope
  store.tenants = snapshot.tenants
  store.errorCode = snapshot.errorCode
}

function snapshotAuth(store: ReturnType<typeof useAuthStore>): { readonly token: string | null; readonly user: typeof store.user } {
  return {
    token: store.token,
    user: store.user ? { ...store.user, roles: [...store.user.roles] } : null,
  }
}

function restoreAuth(store: ReturnType<typeof useAuthStore>, snapshot: { readonly token: string | null; readonly user: typeof store.user }): void {
  store.setToken(snapshot.token)
  store.user = snapshot.user
}

function snapshotPermissions(store: ReturnType<typeof usePermissionStore>) {
  return {
    permissions: [...store.permissions],
    objectSets: [...store.objectSets],
    roleBindings: [...store.roleBindings],
    objectPermissionVersion: store.objectPermissionVersion,
    businessPermissions: [...store.businessPermissions],
    businessPermissionVersion: store.businessPermissionVersion,
    expiresAt: store.expiresAt,
    loadedAt: store.loadedAt,
  }
}

function restorePermissions(store: ReturnType<typeof usePermissionStore>, snapshot: ReturnType<typeof snapshotPermissions>): void {
  store.permissions = snapshot.permissions
  store.objectSets = snapshot.objectSets
  store.roleBindings = snapshot.roleBindings
  store.objectPermissionVersion = snapshot.objectPermissionVersion
  store.businessPermissions = snapshot.businessPermissions
  store.businessPermissionVersion = snapshot.businessPermissionVersion
  store.expiresAt = snapshot.expiresAt
  store.loadedAt = snapshot.loadedAt
}
