export const supportedLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'fr-FR', 'ru-RU', 'pt-BR', 'ko-KR'] as const
export type SupportedLocale = (typeof supportedLocales)[number]

export const defaultLocale: SupportedLocale = 'zh-CN'
/** 默认语言缺失或无法使用时的全局第二语言。 */
export const fallbackLocale: SupportedLocale = 'en-US'

const languageLocaleMap: Record<string, SupportedLocale> = {
  en: 'en-US',
  fr: 'fr-FR',
  ja: 'ja-JP',
  ko: 'ko-KR',
  pt: 'pt-BR',
  ru: 'ru-RU',
  zh: 'zh-CN',
}

function matchLocale(value: unknown): SupportedLocale | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const normalized = value.trim().replace('_', '-')
  const exact = supportedLocales.find((locale) => locale.toLowerCase() === normalized.toLowerCase())
  if (exact) return exact

  const language = normalized.split('-')[0].toLowerCase()
  if (language === 'zh' && /(?:tw|hk|hant)/i.test(normalized)) return 'zh-TW'
  return languageLocaleMap[language]
}

/** 按浏览器首选语言列表解析应用支持的界面语言。 */
export function resolveBrowserLocale(): SupportedLocale {
  const candidates = typeof navigator === 'undefined'
    ? []
    : [navigator.language, ...(navigator.languages ?? [])]
  for (const candidate of candidates) {
    const resolved = matchLocale(candidate)
    if (resolved) return resolved
  }
  return fallbackLocale
}

/** 兼容旧版本缓存或浏览器设置中的短 locale，最终只在应用内部使用正式 locale。 */
export function normalizeLocale(value: unknown): SupportedLocale {
  return matchLocale(value) ?? fallbackLocale
}

export const localeLabels: Record<SupportedLocale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'en-US': 'English',
  'ja-JP': '日本語',
  'fr-FR': 'Français',
  'ru-RU': 'Русский',
  'pt-BR': 'Português (Brasil)',
  'ko-KR': '한국어'
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && supportedLocales.includes(value as SupportedLocale)
}
