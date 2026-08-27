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
  defaultCaId?: string
  viewMode: AppViewMode
  globalLoading: boolean
  preferenceSyncing: boolean
  preferenceError: string | null
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    theme: defaultPreferences.theme,
    locale: defaultPreferences.locale,
    defaultCaId: defaultPreferences.defaultCaId,
    viewMode: defaultViewMode,
    globalLoading: false,
    preferenceSyncing: false,
    preferenceError: null
  }),
  getters: {
    preferences: (state): AppPreferences => ({
      theme: state.theme,
      locale: state.locale,
      ...(state.defaultCaId ? { defaultCaId: state.defaultCaId } : {}),
      version: 1
    })
  },
  actions: {
    initializePreferences(): void {
      void this.applyPreferences(readCachedPreferences(), { cache: false })
      this.setViewMode(readCachedViewMode())
    },
    async loadPreferencesFromBackend(): Promise<void> {
      try {
        const result = await getCurrentUserPreferences()
        await this.applyPreferences(normalizePreferences(result.data), { cache: true })
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
    async setDefaultCaId(defaultCaId: string): Promise<boolean> {
      const normalizedDefaultCaId = defaultCaId.trim()
      if (!normalizedDefaultCaId) return false
      const previousPreferences = this.preferences
      const saved = await this.updatePreferences({ ...previousPreferences, defaultCaId: normalizedDefaultCaId })
      if (!saved) {
        this.defaultCaId = previousPreferences.defaultCaId
        writeCachedPreferences(previousPreferences)
      }
      return saved
    },
    setViewMode(viewMode: AppViewMode): void {
      this.viewMode = viewMode
      applyViewModeToDocument(viewMode)
      writeCachedViewMode(viewMode)
    },
    setGlobalLoading(loading: boolean): void {
      this.globalLoading = loading
    },
    async applyPreferences(preferences: AppPreferences, options: { cache: boolean }): Promise<void> {
      this.theme = preferences.theme
      this.locale = preferences.locale
      this.defaultCaId = preferences.defaultCaId
      applyThemeToDocument(preferences.theme)
      // 后端偏好是登录后的语言事实来源；等待懒加载语言包完成，避免任务文案短暂使用旧语言。
      await setI18nLocale(preferences.locale)
      if (options.cache) writeCachedPreferences(preferences)
    },
    async updatePreferences(preferences: AppPreferences): Promise<boolean> {
      const normalized = normalizePreferences(preferences)
      await this.applyPreferences(normalized, { cache: true })
      this.preferenceSyncing = true
      this.preferenceError = null
      try {
        const result = await updateCurrentUserPreferences({
          theme: normalized.theme,
          locale: normalized.locale,
          ...(normalized.defaultCaId ? { defaultCaId: normalized.defaultCaId } : {})
        })
        await this.applyPreferences(normalizePreferences(result.data), { cache: true })
        return true
      } catch (cause) {
        this.preferenceError = cause instanceof Error ? cause.message : i18n.global.t('preferences.errors.saveFailed')
        return false
      } finally {
        this.preferenceSyncing = false
      }
    }
  }
})
