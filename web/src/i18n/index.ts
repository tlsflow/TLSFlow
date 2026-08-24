import { createI18n } from 'vue-i18n'
import type { LocaleMessage } from '@intlify/core-base'
import { applyProductBranding } from '@/brand/product-brand'
import { defaultLocale, fallbackLocale, resolveBrowserLocale, supportedLocales, normalizeLocale, type SupportedLocale } from './locales'

// 静态导入默认语言和全局第二语言，确保默认文案与回退文案立即可用。
import zhCN from './zh-CN'
import enUS from './en-US'

const initialLocale = resolveBrowserLocale()

// 创建包含默认语言和全局第二语言的 i18n 实例，其余语言按需加载。
export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: initialLocale,
  fallbackLocale,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
  messages: {
    [defaultLocale]: applyProductBranding(zhCN),
    [fallbackLocale]: applyProductBranding(enUS)
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
  // 英文作为全局回退语言已静态加载，避免再次生成重复的异步包。
  'en-US': async () => ({ default: enUS }),
  'ja-JP': () => import('./ja-JP'),
  'fr-FR': () => import('./fr-FR'),
  'ru-RU': () => import('./ru-RU'),
  'pt-BR': () => import('./pt-BR'),
  'ko-KR': () => import('./ko-KR'),
}

/**
 * 记录已经加载过语言包的语言。
 */
const loadedLocales = new Set<SupportedLocale>([defaultLocale, fallbackLocale])
let requestedLocale: SupportedLocale = initialLocale

/**
 * 切换语言，首次使用时按需加载语言包。
 * 目标语言加载失败时回退到全局第二语言。
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
      console.warn(`[i18n] No loader for locale "${locale}", falling back to "${fallbackLocale}"`)
      if (requestedLocale === locale) {
        i18n.global.locale.value = fallbackLocale
        document.documentElement.lang = fallbackLocale
      }
      return
    }

    const mod = await loader()
    i18n.global.setLocaleMessage(locale, applyProductBranding(mod.default))
    loadedLocales.add(locale)

    if (requestedLocale !== locale) return
    i18n.global.locale.value = locale
    document.documentElement.lang = locale
  } catch (err) {
    console.error(`[i18n] Failed to load locale "${locale}":`, err)
    if (requestedLocale === locale) {
      i18n.global.locale.value = fallbackLocale
      document.documentElement.lang = fallbackLocale
    }
  }
}

export { defaultLocale, fallbackLocale, localeLabels, supportedLocales, isSupportedLocale, normalizeLocale, resolveBrowserLocale, type SupportedLocale } from './locales'
