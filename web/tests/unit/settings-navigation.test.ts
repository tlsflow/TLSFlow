import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mainMenuItems } from '@/router/menu'

describe('系统设置导航', () => {
  it('隐藏只能从设置概览页进入的部署参数和用户页内的身份源菜单项', () => {
    const settingsMenu = mainMenuItems.find((item) => item.path === '/settings')
    const childPaths = settingsMenu?.children?.map((item) => item.path) ?? []

    expect(childPaths).not.toContain('/settings/deployment-tasks')
    expect(childPaths).not.toContain('/settings/identity-sources')
  })

  it('部署参数保留系统设置卡片，身份源改由用户管理页打开', () => {
    const settingsSource = readFileSync(resolve(process.cwd(), 'src/views/settings/SettingsView.vue'), 'utf8')
    const usersSource = readFileSync(resolve(process.cwd(), 'src/views/settings/UsersView.vue'), 'utf8')

    expect(settingsSource).toContain("path: '/settings/deployment-tasks'")
    expect(settingsSource).not.toContain("path: '/settings/identity-sources'")
    expect(usersSource).toContain("import IdentitySourcesView from './IdentitySourcesView.vue'")
    expect(usersSource).toContain("t('nav.identitySources')")
    expect(usersSource).toContain('v-model:open="identitySourcesModalOpen"')
  })
})
