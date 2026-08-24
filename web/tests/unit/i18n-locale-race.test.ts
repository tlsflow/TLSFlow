import { describe, expect, it, vi } from 'vitest'

const localeLoads = vi.hoisted(() => {
  let resolveFrench!: (value: { default: Record<string, unknown> }) => void
  let resolveJapanese!: (value: { default: Record<string, unknown> }) => void
  return {
    french: new Promise<{ default: Record<string, unknown> }>((resolve) => { resolveFrench = resolve }),
    japanese: new Promise<{ default: Record<string, unknown> }>((resolve) => { resolveJapanese = resolve }),
    resolveFrench: (messages: Record<string, unknown>) => resolveFrench({ default: messages }),
    resolveJapanese: (messages: Record<string, unknown>) => resolveJapanese({ default: messages }),
  }
})

vi.mock('@/i18n/fr-FR', () => localeLoads.french)
vi.mock('@/i18n/ja-JP', () => localeLoads.japanese)

import { i18n, setI18nLocale } from '@/i18n'

describe('国际化异步切换', () => {
  it('较早发起的加载较晚完成时，不得覆盖最新语言请求', async () => {
    const frenchRequest = setI18nLocale('fr-FR')
    const japaneseRequest = setI18nLocale('ja-JP')

    localeLoads.resolveJapanese({ common: { language: 'Japanese' } })
    await japaneseRequest
    localeLoads.resolveFrench({ common: { language: 'French' } })
    await frenchRequest

    expect(i18n.global.locale.value).toBe('ja-JP')
    expect(document.documentElement.lang).toBe('ja-JP')
  })
})
