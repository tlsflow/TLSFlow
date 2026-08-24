import { computed, onMounted, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiPage, ApiPageResult, ApiRecord } from '@/api/modules/common'
import { formatMaybeLocalTimeByCandidates } from '@/utils/browser-local-time'
import type { BusinessPageConfig } from '@/views/business-page.types'

export interface ViewRow extends Record<string, unknown> {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  readonly raw: ApiRecord
}

export interface PageErrorState {
  readonly message: string
  readonly errorCode: string
  readonly requestId: string
}

const KNOWN_RISKS = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

export function readString(record: ApiRecord, candidates: readonly string[], fallback = '—'): string {
  for (const key of candidates) {
    const value = readPath(record, key)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

export function readNumber(record: ApiRecord, candidates: readonly string[]): number | null {
  for (const key of candidates) {
    const value = readPath(record, key)
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
  }
  return null
}

export function readPath(record: ApiRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function normalizeRisk(value: string, fallback: ViewRow['risk']): ViewRow['risk'] {
  const risk = value.toUpperCase()
  return KNOWN_RISKS.has(risk) ? (risk as ViewRow['risk']) : fallback
}

function toRows(page: ApiPage | undefined, config: BusinessPageConfig): ViewRow[] {
  const items = page?.items ?? []
  return items.map((record, index) => {
    const id = readString(record, ['id', 'resourceId', 'certificateId', 'planId', 'runId', 'eventId'], `${config.moduleName}-${index + 1}`)
    const name = readString(record, ['name', 'displayName', 'primaryDomain', 'domainName', 'hostname', 'title', 'resourceName'], id)
    const status = readString(record, ['status', 'state', 'result', 'health.status'], config.defaultStatus)
    const risk = normalizeRisk(readString(record, ['risk', 'riskLevel', 'severity'], config.defaultRisk), config.defaultRisk)
    const row: Record<string, unknown> = { id, name, status, risk, raw: record }
    config.columns.forEach((column) => {
      if (column.key === 'name') row[column.key] = name
      else if (column.key === 'status') row[column.key] = status
      else if (column.key === 'risk') row[column.key] = risk
      else row[column.key] = formatMaybeLocalTimeByCandidates(readString(record, column.candidates), column.candidates)
    })
    return row as ViewRow
  })
}

export function useBusinessPage(config: BusinessPageConfig) {
  const loading = ref(false)
  const page = ref<ApiPage | null>(null)
  const error = ref<PageErrorState | null>(null)
  const lastRequestId = ref('尚未请求')

  const rows = computed(() => toRows(page.value ?? undefined, config))
  const total = computed(() => page.value?.total ?? rows.value.length)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const result: ApiPageResult = await config.load()
      lastRequestId.value = result.requestId
      page.value = result.data ?? { items: [], page: 1, pageSize: 20, total: 0 }
    } catch (cause) {
      if (cause instanceof ApiClientError) {
        error.value = {
          message: cause.message,
          errorCode: cause.errorCode,
          requestId: cause.requestId
        }
      } else {
        error.value = {
          message: cause instanceof Error ? cause.message : '未知错误',
          errorCode: 'NETWORK_OR_RUNTIME_ERROR',
          requestId: ''
        }
      }
      page.value = null
    } finally {
      loading.value = false
    }
  }

  onMounted(() => {
    void load()
  })

  return { loading, page, rows, total, error, lastRequestId, reload: load }
}
