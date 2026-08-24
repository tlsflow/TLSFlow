import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { i18n } from '@/i18n'
import GlobalSearchModal from '@/views/global-search/GlobalSearchModal.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  getCertificateVersionDetail: vi.fn(),
  listAssets: vi.fn(),
  listCertificates: vi.fn(),
  listCertificateTrustRoots: vi.fn(),
  listCertificateVersions: vi.fn(),
  listCloudAccountAssets: vi.fn(),
  listManagedDevices: vi.fn(),
  listPluginCatalog: vi.fn(),
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock('@/api/modules/assets.api', () => ({
  listAssets: apiMocks.listAssets,
}))
vi.mock('@/api/modules/certificates.api', () => ({
  getCertificateVersionDetail: apiMocks.getCertificateVersionDetail,
  listCertificates: apiMocks.listCertificates,
  listCertificateTrustRoots: apiMocks.listCertificateTrustRoots,
  listCertificateVersions: apiMocks.listCertificateVersions,
}))
vi.mock('@/api/modules/devices.api', () => ({
  listManagedDevices: apiMocks.listManagedDevices,
}))
vi.mock('@/api/modules/providers.api', () => ({
  listCloudAccountAssets: apiMocks.listCloudAccountAssets,
}))
vi.mock('@/api/modules/plugins.api', () => ({
  listPluginCatalog: apiMocks.listPluginCatalog,
}))
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
}))

const GcModalStub = defineComponent({
  props: { open: Boolean },
  template: '<div v-if="open" class="gc-modal"><slot /></div>',
})

const GcEmptyStateStub = defineComponent({
  template: '<div class="gc-empty-state"><slot /></div>',
})

function page(items: readonly Record<string, unknown>[]) {
  return { data: { items, page: 1, pageSize: 100, total: items.length } }
}

async function settle() {
  await flushPromises()
  await flushPromises()
}

function mountSearch() {
  return mount(GlobalSearchModal, {
    props: { open: true },
    global: {
      plugins: [i18n],
      stubs: {
        GcModal: GcModalStub,
        GcEmptyState: GcEmptyStateStub,
      },
    },
  })
}

describe('GlobalSearchModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions([
      'certificate.asset.read',
      'service_asset.read',
      'host.read',
      'cloud_account_asset.read',
      'plugin.read',
      'settings.read',
      'credential.read',
      'notification.channel.read',
      'security.user.read',
      'security.role.read',
      'security.identity_source.read',
    ])

    apiMocks.listCertificates.mockResolvedValue(page([{
      id: 'certificate-1',
      name: 'api.example.com',
      primaryDomain: 'api.example.com',
      currentVersionId: 'version-1',
      sourceType: 'manual',
    }]))
    apiMocks.listCertificateVersions.mockResolvedValue(page([{
      id: 'version-1',
      certificateAssetId: 'certificate-1',
      commonName: 'api.example.com',
      fingerprintSha256: 'leaf-fingerprint',
      serialNumber: 'leaf-serial',
      sans: ['api.example.com'],
    }]))
    apiMocks.getCertificateVersionDetail.mockResolvedValue({
      data: {
        chainCertificates: [
          {
            fingerprintSha256: 'intermediate-fingerprint',
            displayName: 'Intermediate CA',
            commonName: 'Intermediate CA',
            role: 'intermediate',
            subject: { commonName: 'Intermediate CA' },
            issuer: { commonName: 'Root CA' },
            serialNumber: 'intermediate-serial',
          },
          {
            fingerprintSha256: 'root-chain-fingerprint',
            displayName: 'Root CA',
            commonName: 'Root CA',
            role: 'root',
          },
        ],
      },
    })
    apiMocks.listCertificateTrustRoots.mockResolvedValue(page([{
      id: 'root-1',
      fingerprintSha256: 'root-fingerprint',
      subject: { commonName: 'Root CA' },
      issuer: { commonName: 'Root CA' },
      serialNumber: 'root-serial',
      validationStatus: 'verified',
    }]))
    apiMocks.listAssets.mockResolvedValue(page([{
      id: 'application-1',
      displayName: 'search-app',
      address: 'app.example.com',
    }]))
    apiMocks.listManagedDevices.mockResolvedValue(page([{
      id: 'device-1',
      displayName: 'search-device',
      hostname: 'device.example.com',
    }]))
    apiMocks.listCloudAccountAssets.mockResolvedValue(page([{
      id: 'cloud-1',
      displayName: 'search-cloud',
      providerKey: 'aliyun',
    }]))
    apiMocks.listPluginCatalog.mockResolvedValue(page([{
      id: 'plugin-1',
      pluginVersionId: 'plugin-version-1',
      pluginId: 'search-plugin',
      displayName: 'search-plugin',
      version: '1.0.0',
    }]))
    routerMock.push.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('按服务器证书、中间证书和根证书的真实数据来源分类', async () => {
    const wrapper = mountSearch()

    await wrapper.get('input').setValue('Intermediate CA')
    await settle()
    expect(wrapper.text()).toContain('Intermediate CA')
    expect(wrapper.text()).toContain('中间证书')
    expect(wrapper.text()).not.toContain('服务器证书')

    await wrapper.get('input').setValue('Root CA')
    await settle()
    expect(wrapper.text()).toContain('Root CA')
    expect(wrapper.text()).toContain('根证书')

    await wrapper.get('input').setValue('api.example.com')
    await settle()
    expect(wrapper.text()).toContain('服务器证书')
  })

  it('使用卡片式结果和图标容器展示搜索结果', async () => {
    const wrapper = mountSearch()

    await wrapper.get('input').setValue('api.example.com')
    await settle()

    expect(wrapper.find('.global-search__result').classes()).toContain('global-search__result')
    expect(wrapper.find('.global-search__result-icon').element.tagName).toBe('SPAN')
    expect(wrapper.find('.global-search__result-icon svg').exists()).toBe(true)
    expect(wrapper.find('.global-search__result-arrow svg').exists()).toBe(true)
  })

  it('搜索设备资产和插件，并按权限隐藏未授权远程资源', async () => {
    const wrapper = mountSearch()

    await wrapper.get('input').setValue('search-device')
    await settle()
    expect(wrapper.text()).toContain('search-device')
    expect(wrapper.text()).toContain('设备')

    await wrapper.get('input').setValue('search-plugin')
    await settle()
    expect(wrapper.text()).toContain('search-plugin')
    expect(wrapper.text()).toContain('插件')

    usePermissionStore().setPermissions(['settings.read'])
    await wrapper.get('input').setValue('search-app')
    await settle()
    expect(wrapper.text()).not.toContain('search-app')
    expect(apiMocks.listAssets).toHaveBeenCalledTimes(2)
  })

  it('只通过当前可见菜单搜索系统设置', async () => {
    usePermissionStore().setPermissions(['settings.read'])
    const wrapper = mountSearch()

    await wrapper.get('input').setValue('系统设置')
    await settle()
    expect(wrapper.text()).toContain('系统设置')
    expect(wrapper.text()).toContain('系统设置')
    expect(apiMocks.listCertificates).not.toHaveBeenCalled()
    expect(apiMocks.listAssets).not.toHaveBeenCalled()
    expect(apiMocks.listManagedDevices).not.toHaveBeenCalled()
    expect(apiMocks.listCloudAccountAssets).not.toHaveBeenCalled()
    expect(apiMocks.listPluginCatalog).not.toHaveBeenCalled()
  })

  it('点击根证书和中间证书结果时携带正确的路由参数', async () => {
    const wrapper = mountSearch()

    await wrapper.get('input').setValue('root-fingerprint')
    await settle()
    await wrapper.find('.global-search__result').trigger('click')
    expect(routerMock.push).toHaveBeenLastCalledWith({
      path: '/certificates',
      query: { rootId: 'root-1' },
    })
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.setProps({ open: true })
    await wrapper.get('input').setValue('Intermediate CA')
    await settle()
    await wrapper.find('.global-search__result').trigger('click')
    expect(routerMock.push).toHaveBeenLastCalledWith({
      path: '/certificates/certificate-1',
      query: { versionId: 'version-1' },
    })
  })
})
