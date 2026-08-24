import { defineStore } from 'pinia'
import { getCurrentUserPreferences, updateCurrentUserPreferences } from '@/api/modules/security.api'
import { setI18nLocale, type SupportedLocale } from '@/i18n'
import {
  applyThemeToDocument,
  defaultPreferences,
  normalizePreferences,
  readCachedPreferences,
  writeCachedPreferences,
  type AppPreferences,
  type ThemeMode
} from '@/preferences/app-preferences'

interface AppState {
  theme: ThemeMode
  locale: SupportedLocale
  globalLoading: boolean
  preferenceSyncing: boolean
  preferenceError: string | null
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    theme: defaultPreferences.theme,
    locale: defaultPreferences.locale,
    globalLoading: false,
    preferenceSyncing: false,
    preferenceError: null
  }),
  getters: {
    preferences: (state): AppPreferences => ({ theme: state.theme, locale: state.locale, version: 1 })
  },
  actions: {
    initializePreferences(): void {
      this.applyPreferences(readCachedPreferences(), { cache: false })
    },
    async loadPreferencesFromBackend(): Promise<void> {
      try {
        const result = await getCurrentUserPreferences()
        this.applyPreferences(normalizePreferences(result.data), { cache: true })
        this.preferenceError = null
      } catch (cause) {
        this.preferenceError = cause instanceof Error ? cause.message : '偏好加载失败'
      }
    },
    async setTheme(theme: ThemeMode): Promise<void> {
      await this.updatePreferences({ ...this.preferences, theme })
    },
    async setLocale(locale: SupportedLocale): Promise<void> {
      await this.updatePreferences({ ...this.preferences, locale })
    },
    setGlobalLoading(loading: boolean): void {
      this.globalLoading = loading
    },
    applyPreferences(preferences: AppPreferences, options: { cache: boolean }): void {
      this.theme = preferences.theme
      this.locale = preferences.locale
      applyThemeToDocument(preferences.theme)
      setI18nLocale(preferences.locale)
      if (options.cache) writeCachedPreferences(preferences)
    },
    async updatePreferences(preferences: AppPreferences): Promise<void> {
      const normalized = normalizePreferences(preferences)
      this.applyPreferences(normalized, { cache: true })
      this.preferenceSyncing = true
      this.preferenceError = null
      try {
        const result = await updateCurrentUserPreferences({
          theme: normalized.theme,
          locale: normalized.locale
        })
        this.applyPreferences(normalizePreferences(result.data), { cache: true })
      } catch (cause) {
        this.preferenceError = cause instanceof Error ? cause.message : '偏好保存失败'
      } finally {
        this.preferenceSyncing = false
      }
    }
  }
})
