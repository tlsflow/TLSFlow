import { createI18n } from 'vue-i18n'
import { defaultLocale, supportedLocales, type SupportedLocale } from './locales'

// Statically import the default locale for immediate availability
import zhCN from './zh-CN'

// Create i18n instance with only the default locale loaded
export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: defaultLocale,
  fallbackLocale: defaultLocale,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
  messages: {
    [defaultLocale]: zhCN
  }
})

/**
 * Lazy-loaders for each locale.
 * Keys match SupportedLocale values.
 */
const localeLoaders: Record<SupportedLocale, () => Promise<{ default: any }>> = {
  'zh-CN': () => import('./zh-CN'),
  'zh-TW': () => import('./zh-TW'),
  'en-US': () => import('./en-US'),
  'ja-JP': () => import('./ja-JP'),
  'fr-FR': () => import('./fr-FR'),
  'ru-RU': () => import('./ru-RU'),
  'pt-BR': () => import('./pt-BR'),
  'ko-KR': () => import('./ko-KR'),
}

/**
 * Track which locale messages have already been loaded.
 */
const loadedLocales = new Set<SupportedLocale>([defaultLocale])

/**
 * Switch to the given locale, lazy-loading its messages on first use.
 * Falls back to defaultLocale if the target locale fails to load.
 */
export async function setI18nLocale(locale: SupportedLocale): Promise<void> {
  // Already loaded — just switch
  if (loadedLocales.has(locale)) {
    i18n.global.locale.value = locale
    document.documentElement.lang = locale
    return
  }

  try {
    const loader = localeLoaders[locale]
    if (!loader) {
      console.warn(`[i18n] No loader for locale "${locale}", falling back to "${defaultLocale}"`)
      i18n.global.locale.value = defaultLocale
      document.documentElement.lang = defaultLocale
      return
    }

    const mod = await loader()
    i18n.global.setLocaleMessage(locale, mod.default)
    loadedLocales.add(locale)

    i18n.global.locale.value = locale
    document.documentElement.lang = locale
  } catch (err) {
    console.error(`[i18n] Failed to load locale "${locale}":`, err)
    i18n.global.locale.value = defaultLocale
    document.documentElement.lang = defaultLocale
  }
}

export { defaultLocale, localeLabels, supportedLocales, isSupportedLocale, type SupportedLocale } from './locales'
