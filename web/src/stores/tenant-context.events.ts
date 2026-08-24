export const TENANT_CONTEXT_CHANGED_EVENT = 'gcac:tenant-context-changed'

export function emitTenantContextChanged(detail: { readonly tenantId: string; readonly contextVersion: string }): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TENANT_CONTEXT_CHANGED_EVENT, { detail }))
}
