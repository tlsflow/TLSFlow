import { defineStore } from 'pinia'
import { i18n } from '@/i18n'

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
    tenants: [{ id: 'default', name: i18n.global.t('common.tenantFallback') }]
  }),
  actions: {
    setCurrentTenant(tenantId: string): void {
      this.currentTenantId = tenantId
    }
  }
})
