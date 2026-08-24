import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const PLUGINS_PATH = '/api/v1/plugins'

export function listPlugins(query?: BusinessListQuery) {
  return listRecords(PLUGINS_PATH, query)
}

export function disablePlugin(pluginId: string, payload: ApiBody = {}) {
  return postAction(`${PLUGINS_PATH}/${encodeURIComponent(pluginId)}:disable`, payload, 'plugin_disable')
}
