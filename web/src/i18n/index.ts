import { createI18n } from 'vue-i18n'
import type { LocaleMessage } from '@intlify/core-base'
import { defaultLocale, supportedLocales, normalizeLocale, type SupportedLocale } from './locales'

// 静态导入默认语言，确保应用启动后立即可用。
import zhCN from './zh-CN'

// 创建只加载默认语言的 i18n 实例，其余语言按需加载。
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
 * 为每种语言定义懒加载器，键必须与 SupportedLocale 的值一致。
 */
type LocaleModule = {
  default: LocaleMessage
}

const localeLoaders: Record<SupportedLocale, () => Promise<LocaleModule>> = {
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
 * 记录已经加载过语言包的语言。
 */
const loadedLocales = new Set<SupportedLocale>([defaultLocale])
let requestedLocale: SupportedLocale = defaultLocale

/**
 * 切换语言，首次使用时按需加载语言包。
 * 目标语言加载失败时回退到 defaultLocale。
 */
export async function setI18nLocale(locale: SupportedLocale): Promise<void> {
  locale = normalizeLocale(locale)
  requestedLocale = locale
  document.documentElement.lang = locale

  // 已经加载过时直接切换。
  if (loadedLocales.has(locale)) {
    i18n.global.locale.value = locale
    return
  }

  try {
    const loader = localeLoaders[locale]
    if (!loader) {
      console.warn(`[i18n] No loader for locale "${locale}", falling back to "${defaultLocale}"`)
      if (requestedLocale === locale) {
        i18n.global.locale.value = defaultLocale
        document.documentElement.lang = defaultLocale
      }
      return
    }

    const mod = await loader()
    i18n.global.setLocaleMessage(locale, mod.default)
    loadedLocales.add(locale)

    if (requestedLocale !== locale) return
    i18n.global.locale.value = locale
    document.documentElement.lang = locale
  } catch (err) {
    console.error(`[i18n] Failed to load locale "${locale}":`, err)
    if (requestedLocale === locale) {
      i18n.global.locale.value = defaultLocale
      document.documentElement.lang = defaultLocale
    }
  }
}

export { defaultLocale, localeLabels, supportedLocales, isSupportedLocale, normalizeLocale, type SupportedLocale } from './locales'
