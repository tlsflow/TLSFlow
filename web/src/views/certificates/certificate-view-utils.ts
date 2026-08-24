import { ApiClientError } from '@/api/client'
import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import { i18n } from '@/i18n'

export interface CertificatePageError {
  readonly message: string
  readonly errorCode: string
  readonly requestId: string
}

export function readPath(record: ApiRecord | null | undefined, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

export function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = '—'): string {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

export function firstRecord(result: ApiPageResult): ApiRecord | null {
  return result.data?.items?.[0] ?? null
}

export function toErrorState(cause: unknown): CertificatePageError {
  if (cause instanceof ApiClientError) {
    return {
      message: cause.message,
      errorCode: cause.errorCode,
      requestId: cause.requestId
    }
  }
  return {
    message: cause instanceof Error ? cause.message : i18n.global.t('certificates.errors.requestFailed'),
    errorCode: 'NETWORK_OR_RUNTIME_ERROR',
    requestId: ''
  }
}

export function formatList(items: readonly unknown[] | undefined): string {
  if (!items?.length) return '—'
  return items.map((item) => {
    if (typeof item === 'object' && item) return JSON.stringify(item)
    return String(item)
  }).join(', ')
}
