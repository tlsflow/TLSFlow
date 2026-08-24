export function normalizeInternalRedirectPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback

  const normalized = value.trim()
  if (!normalized.startsWith('/') || normalized.startsWith('//')) return fallback

  return normalized
}
