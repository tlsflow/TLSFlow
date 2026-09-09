import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  getSystemUpdateSettings: vi.fn(),
  updateSystemUpdateChannel: vi.fn(),
  checkSystemUpdate: vi.fn(),
}))

vi.mock('@/api/modules/system.api', () => apiMocks)

import VersionView from '@/views/settings/VersionView.vue'

const settings = {
  id: 'singleton' as const,
  channel: 'stable' as const,
  version: 1,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
}

describe('VersionView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['settings.read', 'settings.system.write'])
    i18n.global.locale.value = 'zh-CN'
    apiMocks.getSystemUpdateSettings.mockReset().mockResolvedValue({ data: settings })
    apiMocks.updateSystemUpdateChannel.mockReset().mockResolvedValue({
      data: { ...settings, channel: 'dev', version: 2 },
    })
    apiMocks.checkSystemUpdate.mockReset().mockResolvedValue({
      data: {
        channel: 'dev',
        currentVersion: '1.0.0',
        targetVersion: '1.1.0-dev.20260909.test',
        updateAvailable: true,
        relation: 'upgrade',
        publishedAt: '2026-09-09T10:00:00.000Z',
        releaseNotes: '开发版更新说明',
        commands: {
          installScript: './install.sh upgrade 1.1.0-dev.20260909.test',
          compose: 'export GCAC_RELEASE_VERSION=1.1.0-dev.20260909.test && docker compose pull && docker compose up -d',
        },
        checkedAt: '2026-09-09T10:01:00.000Z',
      },
    })
  })

  it('支持选择通道、检查更新，并只展示宿主机手动命令', async () => {
    expect(usePermissionStore().hasPermission('settings.system.write')).toBe(true)
    const wrapper = mount(VersionView, { global: { plugins: [i18n] } })
    await flushPromises()

    await wrapper.find('input[value="dev"]').setValue()
    await wrapper.find('.version-page__channel-card').trigger('submit')
    await flushPromises()
    expect(apiMocks.updateSystemUpdateChannel).toHaveBeenCalledWith('dev', 1)

    await wrapper.find('.version-page__check-card button').trigger('click')
    await flushPromises()
    expect(apiMocks.checkSystemUpdate).toHaveBeenCalledWith('dev')
    expect(wrapper.text()).toContain('1.1.0-dev.20260909.test')
    expect(wrapper.text()).toContain('./install.sh upgrade 1.1.0-dev.20260909.test')
    expect(wrapper.text()).not.toContain('升级容器')
    expect(wrapper.text()).not.toContain('回滚容器')
  })

  it('没有系统设置写权限时保持只读', async () => {
    usePermissionStore().setPermissions(['settings.read'])
    expect(usePermissionStore().hasPermission('settings.system.write')).toBe(false)
    const wrapper = mount(VersionView, { global: { plugins: [i18n] } })
    await flushPromises()

    expect((wrapper.find('fieldset').element as HTMLFieldSetElement).disabled).toBe(true)
    expect(wrapper.find('.version-page__channel-card button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('当前账号只有查看权限。')
  })
})
