import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/en-US'
import frFR from '@/i18n/fr-FR'
import jaJP from '@/i18n/ja-JP'
import koKR from '@/i18n/ko-KR'
import ptBR from '@/i18n/pt-BR'
import ruRU from '@/i18n/ru-RU'
import zhCN from '@/i18n/zh-CN'
import zhTW from '@/i18n/zh-TW'
import { mainMenuItems } from '@/router/menu'
import { businessRoutes } from '@/router/modules/business'

describe('内部 CA 导航与国际化', () => {
  it('注册受权限保护的路由和菜单', () => {
    const route = businessRoutes.find((item) => item.path === '/internal-ca')
    expect(route?.meta?.permission).toBe('certificate.asset.read')
    expect(mainMenuItems.some((item) => item.children?.some((child) => child.path === '/internal-ca'))).toBe(true)
  })

  it('8 种语言都提供内部 CA 完整入口', () => {
    for (const locale of [zhCN, zhTW, enUS, jaJP, frFR, ruRU, ptBR, koKR]) {
      expect(locale.internalCa.title).toBeTruthy()
      expect(locale.internalCa.topology.rootOnlyRisk).toBeTruthy()
      expect(locale.internalCa.actions.queryResult).toBeTruthy()
      expect(locale.internalCa.riskTypes.public_key_reuse).toBeTruthy()
    }
  })
})
