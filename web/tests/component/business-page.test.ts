import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { ApiClientError } from '@/api/client'
import { usePermissionStore } from '@/stores/permission.store'

function createConfig(overrides: Partial<BusinessPageConfig> = {}): BusinessPageConfig {
  return {
    title: '测试页面',
    description: '测试描述',
    readPermission: 'test.read',
    primaryPermission: 'test.write',
    primaryActionLabel: '新增测试',
    moduleName: 'test',
    resourceName: '测试资源',
    defaultStatus: 'SUCCESS',
    defaultRisk: 'LOW',
    showDetailPanel: true,
    showActionPanel: true,
    columns: [
      { key: 'name', title: '名称', candidates: ['name'] },
      { key: 'status', title: '状态', candidates: ['status'] },
      { key: 'risk', title: '风险', candidates: ['risk'] },
    ],
    metrics: [
      { title: '测试总数', description: '测试指标', status: 'SUCCESS', risk: 'LOW' },
    ],
    emptyTitle: '暂无测试数据',
    emptyDescription: '空状态说明',
    load: async () => ({
      data: {
        items: [
          { id: 'row-1', name: '资源一', status: 'SUCCESS', risk: 'HIGH', certificateId: 'cert-1' },
          { id: 'row-2', name: '资源二', status: 'FAILED', risk: 'CRITICAL', certificateId: 'cert-2' },
        ],
        page: 1,
        pageSize: 20,
        total: 2,
      },
      requestId: 'req_ok',
      timestamp: '2026-06-08T00:00:00.000Z',
    }),
    actions: [
      { label: '危险测试', permission: 'test.danger', danger: true, confirmText: 'CONFIRM', requiresSelection: true },
    ],
    detailFields: [
      { label: '证书 ID', candidates: ['certificateId'] },
    ],
    contextLinks: [
      { label: '查看证书', to: '/certificates', queryKey: 'certificateId', candidates: ['certificateId'] },
    ],
    ...overrides,
  }
}

describe('BusinessResourcePage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('渲染状态标签、风险标签和详情面板', async () => {
    usePermissionStore().setPermissions(['test.write', 'test.danger'])
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/certificates', component: { template: '<div />' } }],
    })
    await router.push('/certificates')
    await router.isReady()

    const wrapper = mount(BusinessResourcePage, {
      props: { config: createConfig() },
      global: {
        plugins: [router],
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('资源一'))
    expect(wrapper.text()).toContain('成功')
    expect(wrapper.text()).toContain('级别：高')
    expect(wrapper.text()).toContain('证书 ID')
    expect(wrapper.text()).toContain('cert-1')
  })

  it('无权限时隐藏权限按钮和危险动作', async () => {
    usePermissionStore().setPermissions(['test.read'])
    const wrapper = mount(BusinessResourcePage, { props: { config: createConfig() } })

    await vi.waitFor(() => expect(wrapper.text()).toContain('资源一'))
    expect(wrapper.text()).not.toContain('新增测试')
    expect(wrapper.text()).not.toContain('危险测试')
  })

  it('高风险操作点击后出现确认弹窗', async () => {
    usePermissionStore().setPermissions(['test.write', 'test.danger'])
    const wrapper = mount(BusinessResourcePage, { props: { config: createConfig() } })

    await vi.waitFor(() => expect(wrapper.text()).toContain('危险测试'))
    await wrapper.findAll('button').find((button) => button.text() === '危险测试')?.trigger('click')

    await vi.waitFor(() => expect(document.body.textContent).toContain('输入 CONFIRM 二次确认'))
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('主操作按钮点击后执行配置动作', async () => {
    usePermissionStore().setPermissions(['test.write'])
    const primaryAction = vi.fn(async () => undefined)

    const wrapper = mount(BusinessResourcePage, {
      props: {
        config: createConfig({ primaryAction }),
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('新增测试'))
    await wrapper.findAll('button').find((button) => button.text() === '新增测试')?.trigger('click')
    await flushPromises()

    expect(primaryAction).toHaveBeenCalledTimes(1)
  })

  it('普通资源动作按钮会执行 run 并刷新列表', async () => {
    usePermissionStore().setPermissions(['test.write'])
    const run = vi.fn(async () => undefined)
    const load = vi.fn(createConfig().load)

    const wrapper = mount(BusinessResourcePage, {
      props: {
        config: createConfig({
          load,
          actions: [
            { label: '普通测试', permission: 'test.write', run },
          ],
        }),
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('普通测试'))
    await wrapper.findAll('button').find((button) => button.text() === '普通测试')?.trigger('click')
    await flushPromises()

    expect(run).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('选择行后危险动作使用真实资源 id', async () => {
    usePermissionStore().setPermissions(['test.write', 'test.danger'])
    const run = vi.fn(async () => undefined)

    const wrapper = mount(BusinessResourcePage, {
      props: {
        config: createConfig({
          actions: [
            { label: '危险测试', permission: 'test.danger', danger: true, confirmText: 'CONFIRM', requiresSelection: true, run },
          ],
        }),
      },
    })

    await vi.waitFor(() => expect(wrapper.findAll('.business-page__row-link')).toHaveLength(2))
    const rowButtons = wrapper.findAll('.business-page__row-link')
    await rowButtons[1]!.trigger('click')

    const dangerTrigger = wrapper.findAll('button').find((button) => button.text() === '危险测试')
    expect(dangerTrigger).toBeTruthy()
    await dangerTrigger!.trigger('click')

    await vi.waitFor(() => expect(document.body.querySelector('.gc-confirm input')).toBeTruthy())
    const confirmInput = document.body.querySelector('.gc-confirm input') as HTMLInputElement | null
    expect(confirmInput).toBeTruthy()
    confirmInput!.value = 'CONFIRM'
    confirmInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const confirmButton = document.body.querySelector('.gc-confirm footer .gc-button--danger') as HTMLButtonElement | null
    expect(confirmButton).toBeTruthy()
    confirmButton!.click()
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: 'row-2' })))
  })

  it('错误状态展示 requestId 排查入口', async () => {
    usePermissionStore().setPermissions(['test.write'])

    const wrapper = mount(BusinessResourcePage, {
      props: {
        config: createConfig({
          load: async () => {
            throw new ApiClientError('无权限', { errorCode: 'PERMISSION_DENIED', requestId: 'req_denied', status: 403 })
          },
        }),
      },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('服务请求失败'))
    expect(wrapper.text()).toContain('requestId：req_denied')
    expect(wrapper.text()).toContain('PERMISSION_DENIED')
  })

  it('空状态有明确引导', async () => {
    usePermissionStore().setPermissions(['test.write'])

    const wrapper = mount(BusinessResourcePage, {
      props: {
        config: createConfig({
          load: async () => ({
            data: { items: [], page: 1, pageSize: 20, total: 0 },
            requestId: 'req_empty',
            timestamp: '2026-06-08T00:00:00.000Z',
          }),
        }),
      },
    })

    await flushPromises()
    await vi.waitFor(() => expect(wrapper.text()).toContain('空状态说明'))
    expect(wrapper.text()).toContain('暂无测试数据')
    expect(wrapper.findAll('.gc-empty-state')).toHaveLength(0)
    expect(wrapper.get('.gc-data-table').attributes('aria-label')).toContain('测试资源')
  })

  it('未提供主操作时不会渲染无效按钮', async () => {
    usePermissionStore().setPermissions(['test.write'])

    const wrapper = mount(BusinessResourcePage, {
      props: { config: createConfig({ primaryAction: undefined }) },
    })

    await vi.waitFor(() => expect(wrapper.text()).toContain('资源一'))
    expect(wrapper.text()).not.toContain('新增测试')
  })
})
