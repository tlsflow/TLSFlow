import { createI18n } from 'vue-i18n'
import { defaultLocale, type SupportedLocale } from './locales'
import { messages } from './messages'

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: defaultLocale,
  fallbackLocale: defaultLocale,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
  messages
})

export function setI18nLocale(locale: SupportedLocale): void {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
}

export { defaultLocale, localeLabels, supportedLocales, isSupportedLocale, type SupportedLocale } from './locales'
