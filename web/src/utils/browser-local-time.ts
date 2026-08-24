const DATE_TIME_KEY_PATTERN = /(?:^|\.)(?:createdAt|updatedAt|startedAt|finishedAt|scheduledAt|checkedAt|detectedAt|lastCheckedAt|lastSeenAt|lastContactAt|heartbeatAt|lastHeartbeatAt|lastRecoveryAt|lastTaskPollAt|lastTaskResultAt|lastSelfCheckAt|reportedAt|receivedAt|emittedAt|expiresAt|capturedAt|notBefore|notAfter|timestamp|time)$/i
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

interface LocalTimeOptions {
  readonly includeTime?: boolean
  readonly includeSeconds?: boolean
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function parseDateValue(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (!looksLikeDateText(text)) return null
  const normalizedText = normalizeDateText(text)
  const time = Date.parse(normalizedText)
  if (!Number.isFinite(time)) return null
  return new Date(time)
}

function looksLikeDateText(value: string): boolean {
  return ISO_DATE_TIME_PATTERN.test(value) || ISO_DATE_PATTERN.test(value) || /\b(?:GMT|UTC)\b/i.test(value)
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
  if (!date) return typeof value === 'string' ? value : ''

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

export function formatMaybeLocalTime(value: unknown, fallback = '—'): string {
  if (value === undefined || value === null || value === '') return fallback
  if (Array.isArray(value)) return value.map((item) => formatMaybeLocalTime(item, '')).filter(Boolean).join(', ') || fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return formatBrowserLocalTime(value) || String(value)
}

export function formatMaybeLocalTimeByCandidates(value: string, candidates: readonly string[]): string {
  if (!isDateTimeCandidate(candidates)) return value
  return formatBrowserLocalTime(value) || value
}
