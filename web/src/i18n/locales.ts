export const supportedLocales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'fr-FR', 'ru-RU', 'pt-BR', 'ko-KR'] as const
export type SupportedLocale = (typeof supportedLocales)[number]

export const defaultLocale: SupportedLocale = 'zh-CN'

/** 兼容旧版本缓存或浏览器设置中的短 locale，最终只在应用内部使用正式 locale。 */
export function normalizeLocale(value: unknown): SupportedLocale {
  if (value === 'zh') return 'zh-CN'
  if (value === 'en') return 'en-US'
  if (value === 'ja') return 'ja-JP'
  if (value === 'fr') return 'fr-FR'
  if (value === 'ru') return 'ru-RU'
  if (value === 'pt') return 'pt-BR'
  if (value === 'ko') return 'ko-KR'
  return isSupportedLocale(value) ? value : defaultLocale
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
