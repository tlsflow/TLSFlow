import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'
import { mainMenuItems } from '@/router/menu'

describe('版本信息导航', () => {
  it('版本页面不再作为设置二级菜单项，仅保留系统设置概览页入口', () => {
    const route = businessRoutes.find((item) => item.path === '/settings/version')
    const settingsMenu = mainMenuItems.find((item) => item.path === '/settings')

    expect(route?.meta?.permission).toBe('settings.read')
    expect(settingsMenu?.children?.some((item) => item.path === '/settings/version')).toBe(false)
    expect(settingsMenu?.activePaths).toContain('/settings/version')
  })

  it('系统设置概览页包含版本信息入口卡片', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/views/settings/SettingsView.vue'), 'utf8')
    expect(source).toContain("path: '/settings/version'")
  })

  it('用户菜单版本信息位于退出登录按钮下方', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/layouts/ShellLayout.vue'), 'utf8')
    const versionPosition = source.indexOf('gc-shell__user-menu-version')
    const logoutPosition = source.indexOf("t('userMenu.logout')")

    expect(versionPosition).toBeGreaterThan(-1)
    expect(versionPosition).toBeGreaterThan(logoutPosition)
  })
})
