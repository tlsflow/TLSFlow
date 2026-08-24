import { apiClient } from '@/api/client'
import { toClientPath, type ApiRecordResult } from './common'

const GLOBAL_SEARCH_PATH = '/api/v1/global-search'

export function searchGlobal(query: string, locale?: string): Promise<ApiRecordResult> {
  const params = new URLSearchParams({ query })
  if (locale) params.set('locale', locale)
  return apiClient.get(toClientPath(`${GLOBAL_SEARCH_PATH}?${params.toString()}`))
}
