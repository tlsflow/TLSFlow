import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CertificatesView from '@/views/certificates/CertificatesView.vue'
import { usePermissionStore } from '@/stores/permission.store'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

describe('CertificatesView', () => {
  const realDateNow = Date.now

  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['certificate.asset.read', 'certificate.import'])
    vi.spyOn(Date, 'now').mockImplementation(() => new Date('2026-06-10T00:00:00.000Z').getTime())
  })

  afterEach(() => {
    Date.now = realDateNow
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('证书版本表格拆分开始结束日期，并在表头上排序', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)
      if (target.includes('/certificate-assets')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'asset-1',
                primaryDomain: '*.weichai.com',
                sourceType: 'DISCOVERED',
                currentVersion: { notAfter: '2026-12-17T23:59:59.000Z' },
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
          },
        }), { status: 200 })
      }

      if (target.includes('/certificate-versions')) {
        if (target.includes('asset-1') && target.includes('pageSize=1')) {
          return new Response(JSON.stringify({
            data: {
              items: [
                {
                  id: 'certver-soon',
                  certificateAssetId: 'asset-1',
                  commonName: 'soon.weichai.com',
                  notBefore: '2026-06-01T00:00:00.000Z',
                  notAfter: '2026-06-15T23:59:59.000Z',
                  issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                  subject: { commonName: 'soon.weichai.com' },
                  status: 'MANAGED',
                },
              ],
              page: 1,
              pageSize: 1,
              total: 1,
            },
          }), { status: 200 })
        }
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'certver-expired',
                certificateAssetId: 'asset-1',
                commonName: 'alpha.weichai.com',
                notBefore: '2025-01-01T00:00:00.000Z',
                notAfter: '2025-01-02T00:00:00.000Z',
                issuer: { commonName: 'DigiCert Global Root G2' },
                subject: { commonName: 'alpha.weichai.com' },
                status: 'EXPIRED',
              },
              {
                id: 'certver-soon',
                certificateAssetId: 'asset-1',
                commonName: 'beta.weichai.com',
                notBefore: '2026-06-01T00:00:00.000Z',
                notAfter: '2026-06-15T23:59:59.000Z',
                issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                subject: { commonName: 'beta.weichai.com' },
                status: 'MANAGED',
              },
              {
                id: 'certver-new',
                certificateAssetId: 'asset-1',
                commonName: 'zeta.weichai.com',
                notBefore: '2026-06-10T00:00:00.000Z',
                notAfter: '2026-12-17T23:59:59.000Z',
                issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                subject: { commonName: 'zeta.weichai.com' },
                status: 'MANAGED',
              },
            ],
            page: 1,
            pageSize: 20,
            total: 3,
          },
        }), { status: 200 })
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('.certificate-page__version-table').exists()).toBe(true)
    expect(wrapper.find('.certificate-page__sort-row').exists()).toBe(false)
    expect(wrapper.find('.gc-data-table__footer').exists()).toBe(false)

    const tableText = wrapper.text()
    expect(tableText).toContain('开始日期')
    expect(tableText).toContain('结束日期')
    expect(tableText).not.toContain('至')

    const rows = wrapper.findAll('.certificate-page__version-table tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('2025-01-01')
    expect(rows[0]?.text()).toContain('2025-01-02')
    expect(rows[0]?.text()).toContain('过期')
    expect(rows[1]?.text()).toContain('2026-06-01')
    expect(rows[1]?.text()).toContain('2026-06-15')
    expect(rows[1]?.text()).toContain('即将过期')
    expect(rows[2]?.text()).toContain('2026-06-10')
    expect(rows[2]?.text()).toContain('2026-12-17')
    expect(rows[2]?.text()).toContain('有效')

    const assetListText = wrapper.find('.certificate-page__asset-list').text()
    expect(assetListText).toContain('即将过期')

    const headerButtons = wrapper.findAll('.certificate-page__header-sort')
    const nameHeader = headerButtons.find((button) => button.text().includes('证书名称'))
    expect(nameHeader).toBeTruthy()
    await nameHeader!.trigger('click')
    await flushPromises()

    const sortedRows = wrapper.findAll('.certificate-page__version-table tbody tr')
    expect(sortedRows[0]?.text()).toContain('zeta.weichai.com')
    expect(sortedRows[1]?.text()).toContain('beta.weichai.com')
    expect(sortedRows[2]?.text()).toContain('alpha.weichai.com')
  })
})
