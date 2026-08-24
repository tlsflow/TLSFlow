import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { usePermissionStore } from '@/stores/permission.store'
import CloudProvidersView from '@/views/providers/CloudProvidersView.vue'

const providerApiMocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  listProviderCapabilities: vi.fn(),
  listCloudAccountAssets: vi.fn(),
  createCloudAccountAsset: vi.fn(),
  updateCloudAccountAsset: vi.fn(),
  deleteCloudAccountAsset: vi.fn(),
  testCloudAccountAsset: vi.fn(),
  discoverCloudAccountAsset: vi.fn(),
  executeProviderCapability: vi.fn(),
}))

const credentialApiMocks = vi.hoisted(() => ({
  listCredentials: vi.fn(),
  createCredential: vi.fn(),
}))

vi.mock('@/api/modules/providers.api', () => providerApiMocks)
vi.mock('@/api/modules/credentials.api', async () => {
  const actual = await vi.importActual<typeof import('@/api/modules/credentials.api')>('@/api/modules/credentials.api')
  return {
    ...actual,
    listCredentials: credentialApiMocks.listCredentials,
    createCredential: credentialApiMocks.createCredential,
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
        open: {
          type: Boolean,
          default: false,
        },
        title: {
          type: String,
          default: '',
        },
        description: {
          type: String,
          default: '',
        },
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

async function openAccountWizard(wrapper: VueWrapper): Promise<void> {
  await clickButton(wrapper, '添加云账号')
  await vi.waitFor(() => expect(wrapper.text()).toContain('选择云服务提供商'))
}

describe('CloudProvidersView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    vi.clearAllMocks()
    usePermissionStore().setPermissions([
      'cloud_account_asset.read',
      'cloud_account_asset.create',
      'cloud_account_asset.update',
      'cloud_account_asset.control',
      'cloud_account_asset.delete',
      'credential.create',
    ])
    providerApiMocks.listProviders.mockResolvedValue({
      data: {
        items: [
          {
            providerKey: 'cloud.aliyun',
            signerType: 'sdk',
            supportedProducts: ['cloud.aliyun.cdn', 'cloud.aliyun.oss'],
          },
          {
            providerKey: 'cloud.tencent',
            signerType: 'hmac',
            supportedProducts: ['cloud.tencent.cdn'],
          },
        ],
      },
    })
    providerApiMocks.listProviderCapabilities.mockResolvedValue({
      data: {
        items: [],
      },
    })
    providerApiMocks.listCloudAccountAssets.mockResolvedValue({
      data: {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      },
      requestId: 'req_providers_ok',
      timestamp: '2026-08-06T00:00:00.000Z',
    })
    providerApiMocks.createCloudAccountAsset.mockResolvedValue({
      data: { id: 'asset-1' },
      requestId: 'req_create_ok',
      timestamp: '2026-08-06T00:00:00.000Z',
    })
    credentialApiMocks.listCredentials.mockResolvedValue({
      data: {
        items: [
          {
            id: 'cred-aliyun',
            name: '阿里云 AK',
            kind: 'CLOUD_PROVIDER',
            scopeType: 'global',
            status: 'active',
            version: 1,
            updatedAt: '2026-08-06T00:00:00.000Z',
            metadata: { providerKey: 'cloud.aliyun' },
          },
          {
            id: 'cred-tencent',
            name: '腾讯云 Secret',
            kind: 'CLOUD_PROVIDER',
            scopeType: 'global',
            status: 'active',
            version: 1,
            updatedAt: '2026-08-06T00:00:00.000Z',
            metadata: { providerKey: 'cloud.tencent' },
          },
        ],
      },
    })
    credentialApiMocks.createCredential.mockResolvedValue({
      data: { id: 'cred-inline-aliyun' },
      requestId: 'req_credential_create_ok',
      timestamp: '2026-08-06T00:00:00.000Z',
    })
  })

  it('点击添加云账号后展示第一步 Provider 选择卡片', async () => {
    const wrapper = mountView()

    await flushPromises()
    await openAccountWizard(wrapper)

    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('选择云服务提供商')
    expect(wrapper.text()).toContain('阿里云')
    expect(wrapper.text()).toContain('腾讯云')
    expect(wrapper.text()).toContain('SDK')
    expect(wrapper.text()).toContain('HMAC')
    expect(wrapper.findAll('.provider-card img')).toHaveLength(2)
  })

  it('阿里云向导保存时只提交凭据引用和阿里云作用域字段', async () => {
    const wrapper = mountView()

    await flushPromises()
    await openAccountWizard(wrapper)

    await clickButton(wrapper, '下一步')

    expect(wrapper.text()).toContain('云 Provider 凭据')
    expect(wrapper.text()).toContain('AccessKey ID')
    expect(wrapper.text()).toContain('AccessKey Secret')

    const displayNameInput = wrapper.get('input[placeholder="例如：生产阿里云账号"]')
    await displayNameInput.setValue('生产阿里云账号')
    await flushPromises()

    const credentialSelect = wrapper.get('.provider-credential-select select')
    await credentialSelect.setValue('cred-aliyun')
    await flushPromises()

    await clickButton(wrapper, '下一步')

    expect(wrapper.text()).toContain('资源组 ID')
    expect(wrapper.text()).toContain('企业项目 ID')
    expect(wrapper.text()).not.toContain('可用区')

    await wrapper.get('input[placeholder="可选，填写资源组 ID"]').setValue('rg-prod')
    await wrapper.get('input[placeholder="可选，填写企业项目 ID"]').setValue('ep-prod')
    await wrapper.get('input[placeholder="可选，填写自定义 API Endpoint"]').setValue('https://aliyun.example.com')
    await flushPromises()

    await clickButton(wrapper, '保存')

    expect(providerApiMocks.createCloudAccountAsset).toHaveBeenCalledTimes(1)
    expect(providerApiMocks.createCloudAccountAsset).toHaveBeenCalledWith({
      displayName: '生产阿里云账号',
      providerKey: 'cloud.aliyun',
      accountId: undefined,
      credentialRef: 'credential://cred-aliyun',
      scope: {
        resourceGroupId: 'rg-prod',
        enterpriseProjectId: 'ep-prod',
        endpoint: 'https://aliyun.example.com',
      },
    })
  })

  it('腾讯云第三步展示项目和可用区字段，并按腾讯云作用域提交', async () => {
    const wrapper = mountView()

    await flushPromises()
    await openAccountWizard(wrapper)

    const tencentCard = wrapper.findAll('.provider-card').find((item) => item.text().includes('腾讯云'))
    expect(tencentCard).toBeTruthy()
    await tencentCard!.trigger('click')
    await flushPromises()

    await clickButton(wrapper, '下一步')

    await wrapper.get('input[placeholder="例如：生产阿里云账号"]').setValue('生产腾讯云账号')
    await flushPromises()

    await wrapper.get('.provider-credential-select select').setValue('cred-tencent')
    await flushPromises()

    await clickButton(wrapper, '下一步')

    expect(wrapper.text()).toContain('项目 ID')
    expect(wrapper.text()).toContain('可用区')
    expect(wrapper.text()).not.toContain('资源组 ID')
    expect(wrapper.text()).not.toContain('企业项目 ID')

    await wrapper.get('input[placeholder="需要项目隔离时填写项目 ID"]').setValue('project-1')
    await wrapper.get('input[placeholder="例如：ap-guangzhou-3"]').setValue('ap-guangzhou-3')
    await flushPromises()

    await clickButton(wrapper, '保存')

    expect(providerApiMocks.createCloudAccountAsset).toHaveBeenCalledTimes(1)
    expect(providerApiMocks.createCloudAccountAsset).toHaveBeenCalledWith({
      displayName: '生产腾讯云账号',
      providerKey: 'cloud.tencent',
      accountId: undefined,
      credentialRef: 'credential://cred-tencent',
      scope: {
        projectId: 'project-1',
        availabilityZone: 'ap-guangzhou-3',
      },
    })
  })

  it('可在云账号向导内创建当前 Provider 的专用凭据并自动选中', async () => {
    credentialApiMocks.listCredentials.mockReset()
    credentialApiMocks.listCredentials
      .mockResolvedValueOnce({
        data: {
          items: [],
        },
      })
      .mockResolvedValue({
        data: {
          items: [{
            id: 'cred-inline-aliyun',
            name: '生产阿里云 AK',
            kind: 'CLOUD_PROVIDER',
            scopeType: 'global',
            status: 'active',
            version: 1,
            updatedAt: '2026-08-06T00:00:00.000Z',
            metadata: { providerKey: 'cloud.aliyun' },
          }],
        },
      })

    const wrapper = mountView()
    await flushPromises()
    await openAccountWizard(wrapper)
    await clickButton(wrapper, '下一步')
    await clickButton(wrapper, '添加凭据')

    expect(wrapper.text()).toContain('添加专用凭据')
    await wrapper.get('input[placeholder="例如：生产云服务凭据"]').setValue('生产阿里云 AK')
    const secretInputs = wrapper.findAll('.provider-inline-credential input[type="password"]')
    expect(secretInputs).toHaveLength(2)
    await secretInputs[0]!.setValue('LTAI5t-test')
    await secretInputs[1]!.setValue('secret-test')
    await clickButton(wrapper, '保存凭据')

    expect(credentialApiMocks.createCredential).toHaveBeenCalledWith({
      name: '生产阿里云 AK',
      kind: 'CLOUD_PROVIDER',
      scopeType: 'global',
      metadata: { providerKey: 'cloud.aliyun' },
      secretValues: {
        accessKeyId: { plainText: 'LTAI5t-test' },
        accessKeySecret: { plainText: 'secret-test' },
      },
    })

    await vi.waitFor(() => {
      expect((wrapper.get('.provider-credential-select select').element as HTMLSelectElement).value).toBe('cred-inline-aliyun')
    })
  })
})
