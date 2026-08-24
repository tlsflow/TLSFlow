import { apiClient } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiRecord, type BusinessListQuery } from './common'

const PLUGIN_CATALOG_PATH = '/api/v1/plugin-catalog'
const BUILTIN_PLUGIN_CATALOG_REFRESH_PATH = '/api/v1/plugin-catalog/refresh-builtins'
const UNIFIED_PLUGIN_ENABLE_PATH = '/api/v1/plugin-versions/enable'
const UNIFIED_PLUGIN_DISABLE_PATH = '/api/v1/plugin-versions/disable'
const UNIFIED_PLUGIN_UI_RESOURCES_PATH = '/api/v1/plugin-versions/ui-resources'
const PLUGIN_BINDINGS_PATH = '/api/v1/plugin-bindings'

export function listPluginCatalog(query?: BusinessListQuery) {
  return listRecords(PLUGIN_CATALOG_PATH, query)
}

export function refreshBuiltinPluginCatalog() {
  return postAction(BUILTIN_PLUGIN_CATALOG_REFRESH_PATH, {}, 'builtin_plugin_catalog_refresh')
}

export function enableUnifiedPluginVersion(pluginVersionId: string) {
  return postAction(UNIFIED_PLUGIN_ENABLE_PATH, { pluginVersionId }, 'unified_plugin_enable')
}

export function disableUnifiedPluginVersion(pluginVersionId: string) {
  return postAction(UNIFIED_PLUGIN_DISABLE_PATH, { pluginVersionId }, 'unified_plugin_disable')
}

export function getUnifiedPluginUiResources(pluginVersionId: string, locale: string) {
  const query = new URLSearchParams({ pluginVersionId, locale })
  return apiClient.get<ApiRecord>(`${toClientPath(UNIFIED_PLUGIN_UI_RESOURCES_PATH)}?${query.toString()}`)
}

export function createPluginBinding(payload: ApiBody) {
  return postAction(PLUGIN_BINDINGS_PATH, payload, 'plugin_binding_create')
}

export function getPluginBinding(bindingId: string) {
  return apiClient.get<ApiRecord>(`${toClientPath(PLUGIN_BINDINGS_PATH)}?bindingId=${encodeURIComponent(bindingId)}`)
}

export function updatePluginBinding(payload: ApiBody) {
  return apiClient.request<ApiRecord>(toClientPath(PLUGIN_BINDINGS_PATH), { method: 'PATCH', body: payload })
}

export function assignPluginCapability(payload: ApiBody) {
  return postAction('/api/v1/capability-assignments', payload, 'plugin_capability_assign')
}
