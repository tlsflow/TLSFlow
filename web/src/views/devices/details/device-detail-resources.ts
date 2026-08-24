import type { ApiRecord } from '@/api/modules/common'
import type { DeviceDetailTabDescriptor } from './device-detail.model'

export const DETAIL_RESOURCE_INCLUDES = ['frameworks', 'sites', 'certificates', 'logs'] as const

type DetailResourceInclude = typeof DETAIL_RESOURCE_INCLUDES[number]

export function includeForDetailTab(tab: string): DetailResourceInclude[] {
  if (tab === 'logs') return ['logs']
  if (tab === 'certificates') return ['certificates', 'sites']
  if (frameworkIdForDetailTab(tab)) return ['sites']
  if (tab === 'sites' || tab.startsWith('sites:')) return ['sites']
  return []
}

export function frameworkIdForDetailTab(tab: string): string | undefined {
  const prefix = 'framework:'
  const frameworkId = tab.startsWith(prefix) ? tab.slice(prefix.length).trim() : ''
  return frameworkId || undefined
}

export function mergeDetailResources(current: ApiRecord, next: ApiRecord, includes: readonly DetailResourceInclude[]): ApiRecord {
  const merged = { ...current, ...next }
  for (const resource of DETAIL_RESOURCE_INCLUDES) {
    if (!includes.includes(resource)) merged[resource] = current[resource]
  }
  return merged
}

export function resolveAvailableDetailTab(activeTab: string, tabs: readonly DeviceDetailTabDescriptor[]): string {
  if (tabs.some(tab => tab.key === activeTab)) return activeTab
  if (activeTab === 'sites') return tabs.find(tab => tab.key.startsWith('sites:'))?.key ?? 'overview'
  return 'overview'
}
