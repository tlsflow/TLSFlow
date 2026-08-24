import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const PLUGIN_PACKAGES_PATH = '/api/v1/plugins/packages'
const PLUGIN_DISABLE_PATH = '/api/v1/plugins/disable'

export function listPlugins(query?: BusinessListQuery) {
  return listRecords(PLUGIN_PACKAGES_PATH, query)
}

export function disablePlugin(pluginId: string, payload: ApiBody = {}) {
  return postAction(PLUGIN_DISABLE_PATH, { ...payload, pluginPackageId: pluginId }, 'plugin_disable')
}
