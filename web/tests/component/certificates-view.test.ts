import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CertificatesView from '@/views/certificates/CertificatesView.vue'
import { usePermissionStore } from '@/stores/permission.store'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

async function waitFor(check: () => void, attempts = 10) {
  let lastError: unknown
  for (let index = 0; index < attempts; index += 1) {
    await flushPromises()
    try {
      check()
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

describe('CertificatesView', () => {
  const realDateNow = Date.now

  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['certificate.asset.read', 'certificate.import', 'certificate.lifecycle'])
    vi.spyOn(Date, 'now').mockImplementation(() => new Date('2026-06-10T00:00:00.000Z').getTime())
  })

  afterEach(() => {
    Date.now = realDateNow
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('资产筛选默认隐藏，并支持切换显示状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { items: [], page: 1, pageSize: 20, total: 0 },
    }), { status: 200 })))
    document.body.innerHTML = '<div id="gc-shell-hero-actions"></div>'

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await waitFor(() => {
      expect(document.querySelector('.certificate-page__filter-toggle')).not.toBeNull()
    })

    expect(wrapper.find('.certificate-page__toolbar').exists()).toBe(false)

    document.querySelector<HTMLButtonElement>('.certificate-page__filter-toggle')?.click()
    await flushPromises()
    expect(wrapper.find('.certificate-page__toolbar').exists()).toBe(true)

    document.querySelector<HTMLButtonElement>('.certificate-page__filter-toggle')?.click()
    await flushPromises()
    expect(wrapper.find('.certificate-page__toolbar').exists()).toBe(false)
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
        if (target.includes('pageSize=100')) {
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
                  sourceType: 'manual',
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
                  sourceType: 'acme',
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
                  sourceType: 'acme',
                },
              ],
              page: 1,
              pageSize: 100,
              total: 3,
            },
          }), { status: 200 })
        }

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
        return new Response(JSON.stringify({ data: { items: [], page: 1, pageSize: 20, total: 0 } }), { status: 200 })
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await waitFor(() => {
      expect(wrapper.findAll('.certificate-page__version-table tbody tr')).toHaveLength(3)
    })

    expect(wrapper.find('.certificate-page__version-table').exists()).toBe(true)
    expect(wrapper.find('.certificate-page__sort-row').exists()).toBe(false)
    expect(wrapper.find('.gc-data-table__footer').exists()).toBe(false)

    const tableText = wrapper.text()
    expect(tableText).toContain('开始日期')
    expect(tableText).toContain('结束日期')
    expect(tableText).toContain('添加方式')
    expect(tableText).not.toContain('至')

    const rows = wrapper.findAll('.certificate-page__version-table tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.text()).toContain('2025-01-01')
    expect(rows[0]?.text()).toContain('2025-01-02')
    expect(rows[0]?.text()).toContain('过期')
    expect(rows[0]?.text()).toContain('手动导入')
    expect(rows[0]?.findAll('.gc-tag').map((tag) => tag.classes())).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['gc-tag--muted']),
        expect.arrayContaining(['gc-tag--danger']),
      ]),
    )
    expect(rows[1]?.text()).toContain('2026-06-01')
    expect(rows[1]?.text()).toContain(formatBrowserLocalTime('2026-06-15T23:59:59.000Z', { includeTime: false }))
    expect(rows[1]?.text()).toContain('即将过期')
    expect(rows[1]?.text()).toContain('ACME')
    expect(rows[1]?.findAll('.gc-tag').map((tag) => tag.classes())).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['gc-tag--info']),
        expect.arrayContaining(['gc-tag--warning']),
      ]),
    )
    expect(rows[2]?.text()).toContain('2026-06-10')
    expect(rows[2]?.text()).toContain(formatBrowserLocalTime('2026-12-17T23:59:59.000Z', { includeTime: false }))
    expect(rows[2]?.text()).toContain('有效')
    expect(rows[2]?.text()).toContain('ACME')
    expect(rows[2]?.findAll('.gc-tag').map((tag) => tag.classes())).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['gc-tag--info']),
        expect.arrayContaining(['gc-tag--success']),
      ]),
    )

    const assetListText = wrapper.find('.certificate-page__asset-list').text()
    expect(assetListText).toContain('即将过期')

    const headerButtons = wrapper.findAll('.certificate-page__header-sort')
    const nameHeader = headerButtons.find((button) => button.text().includes('证书名称'))
    expect(nameHeader).toBeTruthy()
    await nameHeader!.trigger('click')
    await waitFor(() => {
      const sortedRows = wrapper.findAll('.certificate-page__version-table tbody tr')
      expect(sortedRows[0]?.text()).toContain('zeta.weichai.com')
    })

    const sortedRows = wrapper.findAll('.certificate-page__version-table tbody tr')
    expect(sortedRows[0]?.text()).toContain('zeta.weichai.com')
    expect(sortedRows[1]?.text()).toContain('beta.weichai.com')
    expect(sortedRows[2]?.text()).toContain('alpha.weichai.com')
  })

  it('证书版本支持删除确认，并在成功后刷新列表', async () => {
    let deletedVersionId = ''

    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
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

      if (target.includes('/certificate-versions/delete')) {
        const deleteUrl = new URL(target, 'https://example.test')
        deletedVersionId = String(deleteUrl.searchParams.get('id') ?? '')
        return new Response(JSON.stringify({ data: { id: deletedVersionId } }), { status: 200 })
      }

      if (target.includes('/certificate-versions')) {
        if (target.includes('pageSize=100')) {
          const items = deletedVersionId === 'certver-remove'
            ? [
                {
                  id: 'certver-keep',
                  certificateAssetId: 'asset-1',
                  commonName: 'keep.weichai.com',
                  notBefore: '2026-06-10T00:00:00.000Z',
                  notAfter: '2026-12-17T23:59:59.000Z',
                  issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                  subject: { commonName: 'keep.weichai.com' },
                  status: 'MANAGED',
                },
              ]
            : [
                {
                  id: 'certver-remove',
                  certificateAssetId: 'asset-1',
                  commonName: 'remove.weichai.com',
                  notBefore: '2026-06-01T00:00:00.000Z',
                  notAfter: '2026-06-15T23:59:59.000Z',
                  issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                  subject: { commonName: 'remove.weichai.com' },
                  status: 'MANAGED',
                },
                {
                  id: 'certver-keep',
                  certificateAssetId: 'asset-1',
                  commonName: 'keep.weichai.com',
                  notBefore: '2026-06-10T00:00:00.000Z',
                  notAfter: '2026-12-17T23:59:59.000Z',
                  issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                  subject: { commonName: 'keep.weichai.com' },
                  status: 'MANAGED',
                },
              ]

          return new Response(JSON.stringify({
            data: {
              items,
              page: 1,
              pageSize: 100,
              total: items.length,
            },
          }), { status: 200 })
        }

        if (target.includes('pageSize=1')) {
          return new Response(JSON.stringify({
            data: {
              items: [
                {
                  id: deletedVersionId === 'certver-remove' ? 'certver-keep' : 'certver-remove',
                  certificateAssetId: 'asset-1',
                  commonName: deletedVersionId === 'certver-remove' ? 'keep.weichai.com' : 'remove.weichai.com',
                  notBefore: '2026-06-01T00:00:00.000Z',
                  notAfter: '2026-06-15T23:59:59.000Z',
                  issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                  subject: { commonName: deletedVersionId === 'certver-remove' ? 'keep.weichai.com' : 'remove.weichai.com' },
                  status: 'MANAGED',
                },
              ],
              page: 1,
              pageSize: 1,
              total: 1,
            },
          }), { status: 200 })
        }

        return new Response(JSON.stringify({ data: { items: [], page: 1, pageSize: 20, total: 0 } }), { status: 200 })
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await waitFor(() => {
      expect(wrapper.findAll('.certificate-page__version-table tbody tr')).toHaveLength(2)
    })

    expect(wrapper.text()).toContain('remove.weichai.com')
    expect(wrapper.text()).toContain('keep.weichai.com')

    const deleteTrigger = wrapper.find('.certificate-page__row-actions .gc-button--danger')
    expect(deleteTrigger.exists()).toBe(true)
    await deleteTrigger.trigger('click')
    await vi.waitFor(() => expect(document.body.querySelector('.gc-confirm input')).toBeTruthy())
    const confirmInput = document.body.querySelector('.gc-confirm input') as HTMLInputElement | null
    expect(confirmInput).toBeTruthy()
    confirmInput!.value = 'DELETE'
    confirmInput!.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirmButton = document.body.querySelector('.gc-confirm footer .gc-button--danger') as HTMLButtonElement | null
    expect(confirmButton).toBeTruthy()
    confirmButton!.click()
    await flushPromises()

    await waitFor(() => {
      expect(deletedVersionId).toBe('certver-remove')
      expect(wrapper.text()).not.toContain('remove.weichai.com')
    })

    expect(wrapper.text()).toContain('keep.weichai.com')
  })

  it('域名列表会隐藏没有证书的记录，并合并同名域名', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)

      if (target.includes('/certificate-assets')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'asset-1',
                primaryDomain: '*.jacksonz.cn',
                sourceType: 'manual',
                currentVersion: { notAfter: '2026-09-07T18:18:38.000Z' },
              },
              {
                id: 'asset-2',
                primaryDomain: '*.jacksonz.cn',
                sourceType: 'manual',
              },
              {
                id: 'asset-3',
                primaryDomain: 'www.weichaipower.com',
                sourceType: 'manual',
                currentVersion: { notAfter: '2026-12-17T23:59:59.000Z' },
              },
            ],
            page: 1,
            pageSize: 20,
            total: 3,
          },
        }), { status: 200 })
      }

      if (target.includes('/certificate-versions')) {
        const parsed = new URL(target, 'https://example.test')
        const assetId = parsed.searchParams.get('filter[certificateAssetId]')

        if (target.includes('pageSize=1')) {
          if (assetId === 'asset-1') {
            return new Response(JSON.stringify({
              data: {
                items: [
                  {
                    id: 'certver-1',
                    certificateAssetId: 'asset-1',
                    commonName: '*.jacksonz.cn',
                    notBefore: '2026-06-09T18:18:39.000Z',
                    notAfter: '2026-09-07T18:18:38.000Z',
                    issuer: { commonName: 'Let\'s Encrypt' },
                    subject: { commonName: '*.jacksonz.cn' },
                    status: 'MANAGED',
                  },
                ],
                page: 1,
                pageSize: 1,
                total: 1,
              },
            }), { status: 200 })
          }

          if (assetId === 'asset-2') {
            return new Response(JSON.stringify({
              data: {
                items: [],
                page: 1,
                pageSize: 1,
                total: 0,
              },
            }), { status: 200 })
          }

          if (assetId === 'asset-3') {
            return new Response(JSON.stringify({
              data: {
                items: [
                  {
                    id: 'certver-3',
                    certificateAssetId: 'asset-3',
                    commonName: 'www.weichaipower.com',
                    notBefore: '2026-06-10T00:00:00.000Z',
                    notAfter: '2026-12-17T23:59:59.000Z',
                    issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                    subject: { commonName: 'www.weichaipower.com' },
                    status: 'MANAGED',
                  },
                ],
                page: 1,
                pageSize: 1,
                total: 1,
              },
            }), { status: 200 })
          }
        }

        if (target.includes('pageSize=100')) {
          if (assetId === 'asset-1') {
            return new Response(JSON.stringify({
              data: {
                items: [
                  {
                    id: 'certver-1',
                    certificateAssetId: 'asset-1',
                    commonName: '*.jacksonz.cn',
                    notBefore: '2026-06-09T18:18:39.000Z',
                    notAfter: '2026-09-07T18:18:38.000Z',
                    issuer: { commonName: 'Let\'s Encrypt' },
                    subject: { commonName: '*.jacksonz.cn' },
                    status: 'MANAGED',
                  },
                ],
                page: 1,
                pageSize: 100,
                total: 1,
              },
            }), { status: 200 })
          }

          if (assetId === 'asset-2') {
            return new Response(JSON.stringify({
              data: {
                items: [],
                page: 1,
                pageSize: 100,
                total: 0,
              },
            }), { status: 200 })
          }

          if (assetId === 'asset-3') {
            return new Response(JSON.stringify({
              data: {
                items: [
                  {
                    id: 'certver-3',
                    certificateAssetId: 'asset-3',
                    commonName: 'www.weichaipower.com',
                    notBefore: '2026-06-10T00:00:00.000Z',
                    notAfter: '2026-12-17T23:59:59.000Z',
                    issuer: { commonName: 'GeoTrust TLS RSA CA G1' },
                    subject: { commonName: 'www.weichaipower.com' },
                    status: 'MANAGED',
                  },
                ],
                page: 1,
                pageSize: 100,
                total: 1,
              },
            }), { status: 200 })
          }
        }

        return new Response(JSON.stringify({ data: { items: [], page: 1, pageSize: 20, total: 0 } }), { status: 200 })
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await waitFor(() => {
      expect(wrapper.findAll('.certificate-page__asset-item')).toHaveLength(2)
    })

    const assetListText = wrapper.find('.certificate-page__asset-list').text()
    expect((assetListText.match(/\*\.jacksonz\.cn/g) ?? [])).toHaveLength(1)
    expect(assetListText).toContain('www.weichaipower.com')
    expect(assetListText).not.toContain('暂无补充信息')

    await waitFor(() => {
      expect(wrapper.findAll('.certificate-page__version-table tbody tr')).toHaveLength(1)
    })
    expect(wrapper.text()).toContain('*.jacksonz.cn')
  })
})
