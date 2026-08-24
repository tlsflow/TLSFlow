import { defineStore } from 'pinia'
import { getCurrentUserPreferences, updateCurrentUserPreferences } from '@/api/modules/security.api'
import { i18n, setI18nLocale, type SupportedLocale } from '@/i18n'
import {
  applyThemeToDocument,
  applyViewModeToDocument,
  defaultPreferences,
  defaultViewMode,
  normalizePreferences,
  readCachedPreferences,
  readCachedViewMode,
  writeCachedPreferences,
  writeCachedViewMode,
  type AppPreferences,
  type AppViewMode,
  type ThemeMode
} from '@/preferences/app-preferences'

interface AppState {
  theme: ThemeMode
  locale: SupportedLocale
  viewMode: AppViewMode
  globalLoading: boolean
  preferenceSyncing: boolean
  preferenceError: string | null
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    theme: defaultPreferences.theme,
    locale: defaultPreferences.locale,
    viewMode: defaultViewMode,
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
      this.setViewMode(readCachedViewMode())
    },
    async loadPreferencesFromBackend(): Promise<void> {
      try {
        const result = await getCurrentUserPreferences()
        this.applyPreferences(normalizePreferences(result.data), { cache: true })
        this.preferenceError = null
      } catch (cause) {
        this.preferenceError = cause instanceof Error ? cause.message : i18n.global.t('preferences.errors.loadFailed')
      }
    },
    async setTheme(theme: ThemeMode): Promise<void> {
      await this.updatePreferences({ ...this.preferences, theme })
    },
    async setLocale(locale: SupportedLocale): Promise<void> {
      await this.updatePreferences({ ...this.preferences, locale })
    },
    setViewMode(viewMode: AppViewMode): void {
      this.viewMode = viewMode
      applyViewModeToDocument(viewMode)
      writeCachedViewMode(viewMode)
    },
    setGlobalLoading(loading: boolean): void {
      this.globalLoading = loading
    },
    applyPreferences(preferences: AppPreferences, options: { cache: boolean }): void {
      this.theme = preferences.theme
      this.locale = preferences.locale
      applyThemeToDocument(preferences.theme)
      // setI18nLocale 是异步方法，浏览器语言或用户偏好首次使用时按需加载语言包。
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
        this.preferenceError = cause instanceof Error ? cause.message : i18n.global.t('preferences.errors.saveFailed')
      } finally {
        this.preferenceSyncing = false
      }
    }
  }
})
