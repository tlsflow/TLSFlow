import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const PLUGIN_PACKAGES_PATH = '/api/v1/plugins/packages'
const PLUGIN_DISABLE_PATH = '/api/v1/plugins/disable'
const PLUGIN_CATALOG_PATH = '/api/v1/plugin-catalog'
const UNIFIED_PLUGIN_ENABLE_PATH = '/api/v1/plugin-versions/enable'
const UNIFIED_PLUGIN_DISABLE_PATH = '/api/v1/plugin-versions/disable'
const WORKFLOW_TEMPLATE_PLUGIN_ENABLE_PATH = '/api/v1/plugin-catalog/workflow-templates/enable'
const WORKFLOW_TEMPLATE_PLUGIN_DISABLE_PATH = '/api/v1/plugin-catalog/workflow-templates/disable'
const AGENT_PLUGIN_PACKAGES_PATH = '/api/v1/plugins/agent-packages'
const AGENT_PLUGIN_MOUNTS_PATH = '/api/v1/plugins/agent-mounts'
const AGENT_PLUGIN_MOUNT_VALIDATE_PATH = '/api/v1/plugins/agent-mounts/validate'
const AGENT_PLUGIN_BINDING_PREVIEW_PATH = '/api/v1/plugins/agent-binding/preview'
const AGENT_PLUGIN_PERMISSION_APPROVAL_PATH = '/api/v1/plugins/agent-packages/permissions/approve'
const AGENT_PLUGIN_ENABLE_PATH = '/api/v1/plugins/agent-packages/enable'
const AGENT_PLUGIN_DISABLE_PATH = '/api/v1/plugins/agent-packages/disable'

export function listPlugins(query?: BusinessListQuery) {
  return listRecords(PLUGIN_PACKAGES_PATH, query)
}

export function disablePlugin(pluginId: string, payload: ApiBody = {}) {
  return postAction(PLUGIN_DISABLE_PATH, { ...payload, pluginPackageId: pluginId }, 'plugin_disable')
}

export function listPluginCatalog(query?: BusinessListQuery) {
  return listRecords(PLUGIN_CATALOG_PATH, query)
}

export function enableUnifiedPluginVersion(pluginVersionId: string) {
  return postAction(UNIFIED_PLUGIN_ENABLE_PATH, { pluginVersionId }, 'unified_plugin_enable')
}

export function disableUnifiedPluginVersion(pluginVersionId: string) {
  return postAction(UNIFIED_PLUGIN_DISABLE_PATH, { pluginVersionId }, 'unified_plugin_disable')
}

export function listAgentPluginPackages(query?: BusinessListQuery) {
  return listRecords(AGENT_PLUGIN_PACKAGES_PATH, query)
}

export function listAgentPluginMounts(query?: BusinessListQuery) {
  return listRecords(AGENT_PLUGIN_MOUNTS_PATH, query)
}

export function validateAgentPluginMount(agentId: string, pluginPackageId: string) {
  return postAction(AGENT_PLUGIN_MOUNT_VALIDATE_PATH, { agentId, pluginPackageId }, 'agent_plugin_mount_validate')
}

export function createAgentPluginMount(agentId: string, pluginPackageId: string) {
  return postAction(AGENT_PLUGIN_MOUNTS_PATH, { agentId, pluginPackageId }, 'agent_plugin_mount_create')
}

export function previewAgentPluginBinding(agentId: string, binding: ApiBody) {
  return postAction(AGENT_PLUGIN_BINDING_PREVIEW_PATH, { agentId, binding }, 'agent_plugin_binding_preview')
}

export function approveAgentPluginPermissions(pluginPackageId: string, approvedPermissions: string[]) {
  return postAction(AGENT_PLUGIN_PERMISSION_APPROVAL_PATH, { pluginPackageId, approvedBy: 'web-console', approvedPermissions }, 'agent_plugin_permissions_approve')
}

export function enableAgentPluginPackage(pluginPackageId: string) {
  return postAction(AGENT_PLUGIN_ENABLE_PATH, { pluginPackageId }, 'agent_plugin_enable')
}

export function disableAgentPluginPackage(pluginPackageId: string) {
  return postAction(AGENT_PLUGIN_DISABLE_PATH, { pluginPackageId }, 'agent_plugin_disable')
}

export function enableWorkflowTemplatePlugin(fileTemplateId: string) {
  return postAction(WORKFLOW_TEMPLATE_PLUGIN_ENABLE_PATH, { fileTemplateId }, 'workflow_template_plugin_enable')
}

export function disableWorkflowTemplatePlugin(fileTemplateId: string) {
  return postAction(WORKFLOW_TEMPLATE_PLUGIN_DISABLE_PATH, { fileTemplateId }, 'workflow_template_plugin_disable')
}
