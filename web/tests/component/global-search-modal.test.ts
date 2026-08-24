import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { i18n } from '@/i18n'
import GlobalSearchModal from '@/views/global-search/GlobalSearchModal.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  searchGlobal: vi.fn(),
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock('@/api/modules/global-search.api', () => ({
  searchGlobal: apiMocks.searchGlobal,
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
    const permissionStore = usePermissionStore()
    permissionStore.setPermissions([
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

    apiMocks.searchGlobal.mockImplementation(async (query: string) => {
      const all = [
        { id: 'certificate-asset:1', title: 'api.example.com', type: 'serverCertificate', category: 'certificates', path: '/certificates', query: { versionsModal: '1', assetId: 'certificate-1' }, keywords: ['api.example.com'] },
        { id: 'certificate-intermediate:1', title: 'Intermediate CA', type: 'intermediateCertificate', category: 'certificates', path: '/certificates', query: { versionsModal: '1', assetId: 'certificate-1' }, keywords: ['Intermediate CA', 'intermediate-fingerprint'] },
        { id: 'certificate-root:1', title: 'Root CA', type: 'rootCertificate', category: 'certificates', path: '/certificates', query: { rootId: 'root-1' }, keywords: ['root-fingerprint'] },
        { id: 'device:1', title: 'search-device', type: 'device', category: 'assets', path: '/assets/devices', query: { detailModal: '1', deviceId: 'device-1' }, keywords: ['search-device'] },
        { id: 'application:1', title: 'search-app', type: 'application', category: 'assets', path: '/assets', query: { detailModal: '1', assetId: 'application-1' }, keywords: ['search-app'] },
        { id: 'plugin:1', title: 'search-plugin', type: 'plugin', category: 'plugins', path: '/plugins', query: { detailModal: '1', pluginVersionId: 'plugin-version-1' }, keywords: ['search-plugin'] },
      ]
      const needle = query.toLowerCase()
      const visible = all.filter((item) => {
        if (item.type === 'application' && !permissionStore.hasPermission('service_asset.read')) return false
        if (item.type === 'device' && !permissionStore.hasPermission('host.read')) return false
        if (item.type === 'plugin' && !permissionStore.hasPermission('plugin.read')) return false
        if (item.type === 'serverCertificate' && !permissionStore.hasPermission('certificate.asset.read')) return false
        return true
      })
      return { data: { items: visible.filter((item) => [item.title, ...item.keywords].some((value) => value.toLowerCase().includes(needle))) } }
    })
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
    expect(apiMocks.searchGlobal).toHaveBeenCalledTimes(3)
  })

  it('只通过当前可见菜单搜索系统设置', async () => {
    usePermissionStore().setPermissions(['settings.read'])
    const wrapper = mountSearch()

    await wrapper.get('input').setValue('系统设置')
    await settle()
    expect(wrapper.text()).toContain('系统设置')
    expect(wrapper.text()).toContain('系统设置')
    expect(apiMocks.searchGlobal).toHaveBeenCalledTimes(1)
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
      path: '/certificates',
      query: { versionsModal: '1', assetId: 'certificate-1' },
    })
  })
})
