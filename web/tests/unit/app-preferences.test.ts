import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppStore } from '@/stores/app.store'
import { defaultPreferences } from '@/preferences/app-preferences'
import { i18n } from '@/i18n'

const preferenceApi = vi.hoisted(() => ({
  getCurrentUserPreferences: vi.fn(),
  updateCurrentUserPreferences: vi.fn()
}))

vi.mock('@/api/modules/security.api', () => ({
  getCurrentUserPreferences: preferenceApi.getCurrentUserPreferences,
  updateCurrentUserPreferences: preferenceApi.updateCurrentUserPreferences
}))

describe('App 偏好 Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    preferenceApi.getCurrentUserPreferences.mockReset()
    preferenceApi.updateCurrentUserPreferences.mockReset()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.viewMode
    document.documentElement.style.colorScheme = ''
  })

  it('初始化时使用本地缓存兜底并应用主题和语言', () => {
    localStorage.setItem('gcac.app.preferences', JSON.stringify({ theme: 'dark', locale: 'ko-KR', version: 1 }))
    localStorage.setItem('gcac.app.view-mode', 'user')

    const store = useAppStore()
    store.initializePreferences()

    expect(store.theme).toBe('dark')
    expect(store.locale).toBe('ko-KR')
    expect(store.viewMode).toBe('user')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.viewMode).toBe('user')
    expect(document.documentElement.lang).toBe('ko-KR')
  })

  it('登录后以后端偏好覆盖本地缓存', async () => {
    preferenceApi.getCurrentUserPreferences.mockResolvedValue({
      data: { theme: 'dark', locale: 'pt-BR', version: 1 },
      requestId: 'req_preferences',
      timestamp: '2026-07-07T00:00:00.000Z'
    })

    const store = useAppStore()
    await store.loadPreferencesFromBackend()

    expect(store.theme).toBe('dark')
    expect(store.locale).toBe('pt-BR')
    expect(i18n.global.locale.value).toBe('pt-BR')
    expect(JSON.parse(localStorage.getItem('gcac.app.preferences') ?? '{}')).toEqual({ theme: 'dark', locale: 'pt-BR', version: 1 })
  })

  it('切换主题会立即更新界面并保存到后端', async () => {
    preferenceApi.updateCurrentUserPreferences.mockResolvedValue({
      data: { theme: 'dark', locale: 'zh-CN', version: 1 },
      requestId: 'req_save_preferences',
      timestamp: '2026-07-07T00:00:00.000Z'
    })

    const store = useAppStore()
    await store.setTheme('dark')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(preferenceApi.updateCurrentUserPreferences).toHaveBeenCalledWith({ theme: 'dark', locale: defaultPreferences.locale })
    expect(store.preferenceError).toBeNull()
  })

  it('设置默认 CA 会保存偏好并在 Store 中保留', async () => {
    preferenceApi.updateCurrentUserPreferences.mockResolvedValue({
      data: { theme: 'light', locale: 'zh-CN', defaultCaId: 'ca_default', version: 1 },
      requestId: 'req_save_default_ca',
      timestamp: '2026-07-07T00:00:00.000Z'
    })

    const store = useAppStore()
    await store.setDefaultCaId('  ca_default  ')

    expect(store.preferences.defaultCaId).toBe('ca_default')
    expect(preferenceApi.updateCurrentUserPreferences).toHaveBeenCalledWith({
      theme: defaultPreferences.theme,
      locale: defaultPreferences.locale,
      defaultCaId: 'ca_default'
    })
    expect(JSON.parse(localStorage.getItem('gcac.app.preferences') ?? '{}')).toEqual({
      theme: defaultPreferences.theme,
      locale: 'zh-CN',
      defaultCaId: 'ca_default',
      version: 1
    })
  })

  it('默认 CA 保存失败时回滚本地选择', async () => {
    preferenceApi.updateCurrentUserPreferences.mockRejectedValue(new Error('backend down'))

    const store = useAppStore()
    const saved = await store.setDefaultCaId('ca_default')

    expect(saved).toBe(false)
    expect(store.preferences.defaultCaId).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('gcac.app.preferences') ?? '{}')).not.toHaveProperty('defaultCaId')
  })

  it('后端保存失败时保留当前界面选择并记录错误', async () => {
    preferenceApi.updateCurrentUserPreferences.mockRejectedValue(new Error('backend down'))

    const store = useAppStore()
    await store.setLocale('ja-JP')

    expect(store.locale).toBe('ja-JP')
    expect(store.preferenceError).toBe('backend down')
  })

  it('切换全局视图只写入本地缓存，不调用后端偏好接口', () => {
    const store = useAppStore()

    store.setViewMode('user')

    expect(store.viewMode).toBe('user')
    expect(document.documentElement.dataset.viewMode).toBe('user')
    expect(localStorage.getItem('gcac.app.view-mode')).toBe('user')
    expect(preferenceApi.updateCurrentUserPreferences).not.toHaveBeenCalled()
  })
})
