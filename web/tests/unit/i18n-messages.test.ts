import { describe, expect, it } from 'vitest'
import { messages } from '@/i18n/messages'
import { localeLabels, supportedLocales } from '@/i18n'

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    return flattenKeys(child, nextPrefix)
  })
}

describe('i18n 消息字典', () => {
  it('8 个 Locale 都有同结构基础 key', () => {
    const baseline = flattenKeys(messages['zh-CN']).sort()

    for (const locale of supportedLocales) {
      expect(localeLabels[locale]).toBeTruthy()
      expect(flattenKeys(messages[locale]).sort()).toEqual(baseline)
    }
  })

  it('用户菜单和偏好入口具备所有目标语言', () => {
    for (const locale of supportedLocales) {
      expect(messages[locale].preferences.language).toBeTruthy()
      expect(messages[locale].preferences.theme).toBeTruthy()
      expect(messages[locale].userMenu.changePassword).toBeTruthy()
      expect(messages[locale].password.submit).toBeTruthy()
    }
  })

  it('三个报表页面和导出文案覆盖全部目标语言', () => {
    for (const locale of supportedLocales) {
      expect(messages[locale].nav.reports).toBeTruthy()
      expect(messages[locale].reports.incidentWindow.title).toBeTruthy()
      expect(messages[locale].reports.riskResponse.title).toBeTruthy()
      expect(messages[locale].reports.automationEffectiveness.title).toBeTruthy()
      expect(messages[locale].reports.export.csv).toBeTruthy()
      expect(messages[locale].reports.aria.reportPage).toBeTruthy()
    }
  })
})
