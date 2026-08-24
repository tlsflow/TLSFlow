import { defineStore } from 'pinia'

export interface TenantOption {
  readonly id: string
  readonly name: string
}

interface TenantState {
  currentTenantId: string
  tenants: readonly TenantOption[]
}

export const useTenantStore = defineStore('tenant', {
  state: (): TenantState => ({
    currentTenantId: 'default',
    tenants: [{ id: 'default', name: '默认租户' }]
  }),
  actions: {
    setCurrentTenant(tenantId: string): void {
      this.currentTenantId = tenantId
    }
  }
})
