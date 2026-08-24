const DATE_TIME_KEY_PATTERN = /(?:^|\.)(?:createdAt|updatedAt|startedAt|finishedAt|scheduledAt|checkedAt|detectedAt|lastCheckedAt|lastSeenAt|lastContactAt|heartbeatAt|lastHeartbeatAt|lastRecoveryAt|lastTaskPollAt|lastTaskResultAt|lastSelfCheckAt|reportedAt|receivedAt|emittedAt|expiresAt|capturedAt|notBefore|notAfter|timestamp|time)$/i
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_DATE_TIME_PATTERN = /^\d{4}[/-]\d{2}[/-]\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

interface LocalTimeOptions {
  readonly includeTime?: boolean
  readonly includeSeconds?: boolean
}

export interface ExpiryCountdown {
  readonly expired: boolean
  readonly days: number
}

export type ExpiryRemaining =
  | { readonly kind: 'longTerm' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'days'; readonly days: number }
  | { readonly kind: 'hoursMinutes'; readonly hours: number; readonly minutes: number }

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function parseDateValue(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (!looksLikeDateText(text)) return null
  if (LOCAL_DATE_TIME_PATTERN.test(text)) {
    const match = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/.exec(text)
    if (!match) return null
    const [, year, month, day, hour, minute, second = '0', fraction = ''] = match
    const milliseconds = Number((fraction + '000').slice(0, 3))
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds)
    return Number.isFinite(date.getTime())
      && date.getFullYear() === Number(year)
      && date.getMonth() === Number(month) - 1
      && date.getDate() === Number(day)
      ? date
      : null
  }
  const normalizedText = normalizeDateText(text)
  const time = Date.parse(normalizedText)
  if (!Number.isFinite(time)) return null
  return new Date(time)
}

function looksLikeDateText(value: string): boolean {
  return ISO_DATE_TIME_PATTERN.test(value)
    || ISO_DATE_PATTERN.test(value)
    || LOCAL_DATE_TIME_PATTERN.test(value)
    || /\b(?:GMT|UTC)\b/i.test(value)
}

function normalizeDateText(value: string): string {
  return value.replace(
    /(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:\d{2})$)/,
    '$1',
  )
}

export function isDateTimeCandidate(candidates: readonly string[]): boolean {
  return candidates.some((candidate) => DATE_TIME_KEY_PATTERN.test(candidate))
}

export function formatBrowserLocalTime(value: unknown, options: LocalTimeOptions = {}): string {
  const date = parseDateValue(value)
  if (!date) return ''

  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())

  if (options.includeTime === false) return `${year}-${month}-${day}`
  if (options.includeSeconds === false) return `${year}-${month}-${day} ${hour}:${minute}`
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

export function getExpiryCountdown(value: unknown, now = new Date()): ExpiryCountdown | null {
  const expiry = parseDateValue(value)
  const nowTime = now.getTime()
  if (!expiry || !Number.isFinite(nowTime)) return null

  const difference = expiry.getTime() - nowTime
  return {
    expired: difference < 0,
    days: Math.ceil(Math.abs(difference) / MILLISECONDS_PER_DAY),
  }
}

export function getExpiryRemaining(value: unknown, now = new Date()): ExpiryRemaining {
  const expiry = parseDateValue(value)
  if (!expiry) return { kind: 'longTerm' }

  const difference = expiry.getTime() - now.getTime()
  if (difference <= 0) return { kind: 'expired' }

  const totalMinutes = Math.floor(difference / (60 * 1000))
  const days = Math.floor(totalMinutes / (24 * 60))
  if (days >= 1) return { kind: 'days', days }

  return {
    kind: 'hoursMinutes',
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  }
}

export function formatMaybeLocalTime(value: unknown, fallback = '—'): string {
  if (value === undefined || value === null || value === '') return fallback
  if (Array.isArray(value)) return value.map((item) => formatMaybeLocalTime(item, '')).filter(Boolean).join(', ') || fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return formatBrowserLocalTime(value) || String(value)
}

export function formatMaybeLocalTimeByCandidates(value: string, candidates: readonly string[]): string {
  if (!isDateTimeCandidate(candidates)) return value
  return formatBrowserLocalTime(value)
}
