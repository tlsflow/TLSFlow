import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { usePermissionStore } from '@/stores/permission.store'
import CloudProvidersView from '@/views/providers/CloudProvidersView.vue'

const pageState = vi.hoisted(() => ({
  config: null as Record<string, any> | null,
}))

const providerApiMocks = vi.hoisted(() => ({
  listCloudAccountAssets: vi.fn(),
  createCloudAccountAsset: vi.fn(),
  updateCloudAccountAsset: vi.fn(),
  deleteCloudAccountAsset: vi.fn(),
}))

const credentialApiMocks = vi.hoisted(() => ({
  listCredentials: vi.fn(),
}))

vi.mock('@/api/modules/providers.api', () => providerApiMocks)
vi.mock('@/api/modules/credentials.api', async () => {
  const actual = await vi.importActual<typeof import('@/api/modules/credentials.api')>('@/api/modules/credentials.api')
  return {
    ...actual,
    listCredentials: credentialApiMocks.listCredentials,
  }
})

vi.mock('@/views/BusinessResourcePage.vue', () => ({
  default: defineComponent({
    name: 'BusinessResourcePageStub',
    props: {
      config: {
        type: Object,
        required: true,
      },
    },
    setup(props) {
      pageState.config = props.config as Record<string, any>
      return () => h('div', { class: 'business-resource-page-stub' }, [
        h('button', {
          type: 'button',
          'data-testid': 'business-primary-action',
          onClick: () => (props.config as { primaryAction?: () => void }).primaryAction?.(),
        }, (props.config as { primaryActionLabel?: string }).primaryActionLabel ?? 'primary'),
      ])
    },
  }),
}))

vi.mock('@/design-system/components', async () => {
  const actual = await vi.importActual<typeof import('@/design-system/components')>('@/design-system/components')
  return {
    ...actual,
    GcModal: defineComponent({
      name: 'GcModalStub',
      props: {
        open: { type: Boolean, default: false },
        title: { type: String, default: '' },
        description: { type: String, default: '' },
      },
      emits: ['update:open'],
      setup(props, { slots }) {
        return () => (props.open
          ? h('div', { class: 'gc-modal-stub', role: 'dialog' }, [
            h('h2', props.title),
            props.description ? h('p', props.description) : null,
            slots.default?.(),
            h('div', { class: 'gc-modal-stub__actions' }, slots.actions?.() ?? []),
          ])
          : null)
      },
    }),
  }
})

function mountView(): VueWrapper {
  const localI18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'zh-CN',
    messages: {
      'zh-CN': i18n.global.getLocaleMessage('zh-CN'),
    },
  })
  return mount(CloudProvidersView, {
    attachTo: document.body,
    global: {
      plugins: [localI18n],
    },
  })
}

async function clickButton(wrapper: VueWrapper, text: string): Promise<void> {
  const button = wrapper.findAll('button').find((item) => item.text().trim() === text)
  expect(button, `未找到按钮：${text}`).toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
}

describe('CloudProvidersView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    vi.clearAllMocks()
    pageState.config = null
    usePermissionStore().setPermissions([
      'cloud_account_asset.read',
      'cloud_account_asset.create',
      'cloud_account_asset.update',
      'cloud_account_asset.delete',
    ])
    providerApiMocks.listCloudAccountAssets.mockResolvedValue({
      data: { items: [], page: 1, pageSize: 20, total: 0 },
    })
    providerApiMocks.createCloudAccountAsset.mockResolvedValue({ data: { id: 'asset-1' } })
    providerApiMocks.updateCloudAccountAsset.mockResolvedValue({ data: { id: 'asset-1' } })
    providerApiMocks.deleteCloudAccountAsset.mockResolvedValue({ data: { id: 'asset-1' } })
    credentialApiMocks.listCredentials.mockResolvedValue({
      data: {
        items: [{
          id: 'cred-aliyun',
          name: '阿里云凭据',
          kind: 'CLOUD_PROVIDER',
          scopeType: 'global',
          status: 'active',
          metadata: { providerKey: 'cloud.aliyun' },
        }],
      },
    })
  })

  it('页面只配置 Cloud Account CRUD 行为', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('main.gc-page.provider-page').exists()).toBe(true)
    expect(pageState.config).not.toBeNull()
    expect(pageState.config!.actions).toEqual([])
    expect(pageState.config!.rowActions.map((action: { label: string }) => action.label)).toEqual(['编辑', '删除'])
    expect(pageState.config!.rowActions.map((action: { label: string }) => action.label).join('|'))
      .not.toMatch(/测试|发现|执行/)
    expect(providerApiMocks.listCloudAccountAssets).not.toHaveBeenCalled()
    await pageState.config!.load()
    expect(providerApiMocks.listCloudAccountAssets).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toMatch(/测试连接|发现资源|执行操作|Provider 操作/)
  })

  it('创建云账号时只提交 Cloud Account CRUD 载荷', async () => {
    const wrapper = mountView()
    await flushPromises()
    await clickButton(wrapper, '添加云账号')
    await clickButton(wrapper, '下一步')

    await wrapper.get('input[placeholder="例如：生产云账号"]').setValue('生产阿里云账号')
    await wrapper.get('.provider-credential-select select').setValue('cred-aliyun')
    await clickButton(wrapper, '保存')

    expect(providerApiMocks.createCloudAccountAsset).toHaveBeenCalledWith({
      displayName: '生产阿里云账号',
      providerKey: 'cloud.aliyun',
      accountId: undefined,
      credentialRef: 'credential://cred-aliyun',
      scope: {},
    })
    expect(providerApiMocks.updateCloudAccountAsset).not.toHaveBeenCalled()
    expect(providerApiMocks.deleteCloudAccountAsset).not.toHaveBeenCalled()
  })
})
