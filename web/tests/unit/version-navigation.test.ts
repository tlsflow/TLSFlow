import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'
import { mainMenuItems } from '@/router/menu'

describe('版本信息导航', () => {
  it('设置模块提供只读版本页面入口', () => {
    const route = businessRoutes.find((item) => item.path === '/settings/version')
    const settingsMenu = mainMenuItems.find((item) => item.path === '/settings')

    expect(route?.meta?.permission).toBe('settings.read')
    expect(settingsMenu?.children?.some((item) => item.path === '/settings/version')).toBe(true)
  })

  it('用户菜单版本信息位于退出登录按钮下方', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/layouts/ShellLayout.vue'), 'utf8')
    const versionPosition = source.indexOf('gc-shell__user-menu-version')
    const logoutPosition = source.indexOf("t('userMenu.logout')")

    expect(versionPosition).toBeGreaterThan(-1)
    expect(versionPosition).toBeGreaterThan(logoutPosition)
  })
})
