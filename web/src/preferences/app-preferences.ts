import { defaultLocale, isSupportedLocale, type SupportedLocale } from '@/i18n'

export type ThemeMode = 'light' | 'dark'

export interface AppPreferences {
  readonly theme: ThemeMode
  readonly locale: SupportedLocale
  readonly version: 1
}

const storageKey = 'gcac.app.preferences'
export const defaultPreferences: AppPreferences = { theme: 'light', locale: defaultLocale, version: 1 }

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

export function normalizePreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaultPreferences
  }
  const record = value as Record<string, unknown>
  return {
    theme: isThemeMode(record.theme) ? record.theme : defaultPreferences.theme,
    locale: isSupportedLocale(record.locale) ? record.locale : defaultPreferences.locale,
    version: 1
  }
}

export function readCachedPreferences(): AppPreferences {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? normalizePreferences(JSON.parse(raw)) : defaultPreferences
  } catch {
    return defaultPreferences
  }
}

export function writeCachedPreferences(preferences: AppPreferences): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // 本地缓存只是兜底；后端偏好才是最终事实来源。
  }
}

export function applyThemeToDocument(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}
