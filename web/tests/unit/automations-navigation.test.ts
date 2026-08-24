import { describe, expect, it } from 'vitest'
import { mainMenuItems } from '@/router/menu'
import { businessRoutes } from '@/router/modules/business'
import enUS from '@/i18n/en-US'
import frFR from '@/i18n/fr-FR'
import jaJP from '@/i18n/ja-JP'
import koKR from '@/i18n/ko-KR'
import ptBR from '@/i18n/pt-BR'
import ruRU from '@/i18n/ru-RU'
import zhCN from '@/i18n/zh-CN'
import zhTW from '@/i18n/zh-TW'

describe('Spec 030 自动化导航', () => {
  it('不再把部署计划作为导航入口，并将自动化作为证书部署默认标签', () => {
    const deploymentGroup = mainMenuItems.find((item) => item.titleKey === 'nav.deployments')
    expect(deploymentGroup).toMatchObject({ path: '/automations' })
    expect(deploymentGroup?.children?.map((item) => item.titleKey)).toEqual([
      'nav.automations',
      'nav.workflowTemplates',
      'nav.executions'
    ])
    expect(deploymentGroup?.children?.[0]).toMatchObject({ path: '/automations', permission: 'automation.read' })
    expect(mainMenuItems.find((item) => item.titleKey === 'nav.plugins')).toMatchObject({ path: '/plugins', permission: 'plugin.read' })
  })

  it('自动化路由均由 automation.read 守卫', () => {
    const routes = businessRoutes.filter((route) => route.path.startsWith('/automation'))
    expect(routes.map((route) => route.path)).toEqual(['/automations', '/automation-runs', '/automation-runs/:id'])
    expect(routes.every((route) => route.meta.permission === 'automation.read')).toBe(true)
  })

  it('八个语言文件都包含自动化导航和页面文案', () => {
    for (const locale of [zhCN, zhTW, enUS, jaJP, frFR, ruRU, ptBR, koKR]) {
      expect(locale.nav.automations).toBeTruthy()
      expect(locale.nav.automationsDesc).toBeTruthy()
      expect(locale.automations.runs.title).toBeTruthy()
      expect(locale.automations.runDetail.title).toBeTruthy()
    }
  })
})
