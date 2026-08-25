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

describe('CA 管理导航与国际化', () => {
  it('保留受权限保护的兼容路由，并将内部 CA 入口收归 CA 管理页', () => {
    const route = businessRoutes.find((item) => item.path === '/internal-ca')
    expect(route?.meta?.permission).toBe('ca.operations.read')
    expect(mainMenuItems.some((item) => item.children?.some((child) => child.path === '/internal-ca'))).toBe(false)
    const operationsRoute = businessRoutes.find((item) => item.path === '/ca-operations')
    expect(operationsRoute?.meta?.permission).toBe('ca.operations.read')
    expect(mainMenuItems.some((item) => item.children?.some((child) => child.path === '/ca-operations'))).toBe(true)
  })

  it('8 种语言都提供内部 CA 完整入口', () => {
    for (const locale of [zhCN, zhTW, enUS, jaJP, frFR, ruRU, ptBR, koKR]) {
      expect(locale.internalCa.title).toBeTruthy()
      expect(locale.internalCa.tabs.trustDomains).toBeTruthy()
      expect(locale.internalCa.actions.createTrustDomain).toBeTruthy()
      expect(locale.internalCa.fields.trustDomain).toBeTruthy()
      expect(locale.internalCa.labels.trustDomainCount).toBeTruthy()
      expect(locale.internalCa.sections.caArchitecture).toBeTruthy()
      expect(locale.internalCa.actions.addIntermediate).toBeTruthy()
      expect(locale.internalCa.wizard.rootTitle).toBeTruthy()
      expect(locale.internalCa.wizard.intermediateTitle).toBeTruthy()
      expect(locale.internalCa.wizard.builtinTitle).toBeTruthy()
      expect(locale.internalCa.sections.issuingBackends).toBeTruthy()
      expect(locale.internalCa.fields.issuingBackend).toBeTruthy()
      expect(locale.internalCa.topology.rootOnlyRisk).toBeTruthy()
      expect(locale.internalCa.actions.queryResult).toBeTruthy()
      expect(locale.internalCa.riskTypes.public_key_reuse).toBeTruthy()
      expect(locale.caOperations.title).toBeTruthy()
      expect(locale.caOperations.views.request).toBeTruthy()
      expect(locale.caOperations.actions.sync).toBeTruthy()
      expect(locale.caOperations.actions.manageInternalCa).toBeTruthy()
      expect(locale.caOperations.messages.noAuthority).toBeTruthy()
    }
  })

  it('证书管理二级导航使用短标签，并覆盖全部语言', () => {
    const certificateMenu = mainMenuItems.find((item) => item.path === '/certificates')
    expect(certificateMenu?.children?.map((item) => item.submenuTitleKey)).toEqual([
      'nav.certificateInventoryShort',
      'nav.acmeAutomationShort',
      'nav.caOperationsShort',
      'nav.certificateFormatsShort',
    ])
    expect([
      enUS.nav.certificateInventoryShort,
      enUS.nav.acmeAutomationShort,
      enUS.nav.caOperationsShort,
      enUS.nav.certificateFormatsShort,
    ]).toEqual(['Inventory', 'ACME automation', 'CA ops', 'Delivery formats'])

    for (const locale of [zhCN, zhTW, enUS, jaJP, frFR, ruRU, ptBR, koKR]) {
      expect(locale.nav.certificateInventoryShort).toBeTruthy()
      expect(locale.nav.acmeAutomationShort).toBeTruthy()
      expect(locale.nav.caOperationsShort).toBeTruthy()
      expect(locale.nav.certificateFormatsShort).toBeTruthy()
    }
  })

  it('CA 与宿主默认证书格式名称均通过国际化提供', () => {
    for (const locale of [zhCN, zhTW, enUS, jaJP, frFR, ruRU, ptBR, koKR]) {
      expect(locale.caOperations.actions.manageInternalCa).toBe('CA')
      expect(locale.internalCa.wizard.builtinProviderName).toBeTruthy()
      expect(locale.bindings.defaults.p12Container).toBeTruthy()
      expect(locale.bindings.defaults.pemBundle).toBeTruthy()
    }
  })
})
