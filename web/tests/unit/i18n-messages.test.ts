import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/en-US'
import frFR from '@/i18n/fr-FR'
import jaJP from '@/i18n/ja-JP'
import koKR from '@/i18n/ko-KR'
import ptBR from '@/i18n/pt-BR'
import ruRU from '@/i18n/ru-RU'
import zhCN from '@/i18n/zh-CN'
import zhTW from '@/i18n/zh-TW'
import { localeLabels, supportedLocales, type SupportedLocale } from '@/i18n'

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    return flattenKeys(child, nextPrefix)
  })
}

const localeMessages: Record<SupportedLocale, Record<string, unknown>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'fr-FR': frFR,
  'ru-RU': ruRU,
  'pt-BR': ptBR,
  'ko-KR': koKR
}

function getMessage(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

describe('i18n 消息字典', () => {
  it('8 个 Locale 文件都能独立加载并提供核心文案', () => {
    const requiredKeys = [
      'app.versionLabel',
      'settings.version.title',
      'settings.version.description',
      'settings.version.currentVersion',
      'preferences.language',
      'preferences.theme',
      'userMenu.changePassword',
      'password.submit',
    ]
    for (const locale of supportedLocales) {
      expect(localeLabels[locale]).toBeTruthy()
      for (const key of requiredKeys) {
        expect(getMessage(localeMessages[locale], key), `${locale}.${key}`).toBeTruthy()
      }
    }
  })

  it('默认语言和英文语言都提供报表文案', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      expect(getMessage(localeMessages[locale], 'nav.reports')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.incidentWindow.title')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.riskResponse.title')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.automationEffectiveness.title')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.export.csv')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.aria.reportPage')).toBeTruthy()
    }
  })

  it('语言文件中的翻译 key 可以被独立展开检查', () => {
    expect(flattenKeys(localeMessages['zh-CN'])).toContain('app.versionLabel')
    expect(flattenKeys(localeMessages['en-US'])).toContain('reports.export.csv')
  })
})
