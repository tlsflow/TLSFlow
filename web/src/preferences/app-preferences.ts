import { normalizeLocale, resolveBrowserLocale, type SupportedLocale } from '@/i18n'

export type ThemeMode = 'light' | 'dark'
export type AppViewMode = 'user' | 'professional'

export interface AppPreferences {
  readonly theme: ThemeMode
  readonly locale: SupportedLocale
  readonly version: 1
}

const storageKey = 'gcac.app.preferences'
const viewModeStorageKey = 'gcac.app.view-mode'
export const defaultPreferences: AppPreferences = { theme: 'light', locale: resolveBrowserLocale(), version: 1 }
export const defaultViewMode: AppViewMode = 'professional'

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
    locale: normalizeLocale(record.locale),
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

export function isAppViewMode(value: unknown): value is AppViewMode {
  return value === 'user' || value === 'professional'
}

export function readCachedViewMode(): AppViewMode {
  try {
    const value = window.localStorage.getItem(viewModeStorageKey)
    return isAppViewMode(value) ? value : defaultViewMode
  } catch {
    return defaultViewMode
  }
}

export function writeCachedViewMode(viewMode: AppViewMode): void {
  try {
    window.localStorage.setItem(viewModeStorageKey, viewMode)
  } catch {
    // 视图模式只影响前端展示，缓存失败不能阻断业务操作。
  }
}

export function applyViewModeToDocument(viewMode: AppViewMode): void {
  document.documentElement.dataset.viewMode = viewMode
}
