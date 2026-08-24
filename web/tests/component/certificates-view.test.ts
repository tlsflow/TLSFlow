import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CertificatesView from '@/views/certificates/CertificatesView.vue'
import { useAppStore } from '@/stores/app.store'
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

  it('资产筛选默认隐藏，并通过 Shell 操作槽切换显示状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { items: [], page: 1, pageSize: 20, total: 0 },
    }), { status: 200 })))
    document.body.innerHTML = '<div id="gc-shell-hero-actions"></div>'

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    const filterToggleSelector = '.certificate-page__toolbar-actions .gc-button'
    await waitFor(() => {
      expect(document.querySelector(filterToggleSelector)).not.toBeNull()
    })

    expect(wrapper.find('.certificate-page__header').exists()).toBe(false)
    expect(wrapper.findAll('.certificate-page__metric')).toHaveLength(3)
    expect(wrapper.find('.certificate-page__toolbar').exists()).toBe(false)

    document.querySelector<HTMLButtonElement>(filterToggleSelector)?.click()
    await flushPromises()
    expect(wrapper.find('.certificate-page__toolbar').exists()).toBe(true)

    document.querySelector<HTMLButtonElement>(filterToggleSelector)?.click()
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
                  sourceType: 'external_api',
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
                  sourceType: 'external_api',
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
                  sourceType: 'external_api',
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
      expect(wrapper.find('.certificate-page__asset-record-trigger').exists()).toBe(true)
    })

    const assetRecord = wrapper.find('.certificate-page__asset-record')
    const recordTrigger = assetRecord.find('.certificate-page__asset-record-trigger')
    const panelId = recordTrigger.attributes('aria-controls')
    const footerVersionsTrigger = assetRecord.find('.certificate-page__asset-versions-trigger')

    expect(recordTrigger.attributes('aria-expanded')).toBe('false')
    expect(recordTrigger.attributes('aria-label')).toContain('*.weichai.com')
    expect(panelId).toBe('certificate-versions-dialog-asset-1')
    expect(assetRecord.find(`#${panelId}`).exists()).toBe(false)
    expect(footerVersionsTrigger.attributes('aria-controls')).toBe(panelId)
    expect(footerVersionsTrigger.attributes('aria-expanded')).toBe('false')
    expect(footerVersionsTrigger.text()).toBe('SSL 证书列表')
    expect(footerVersionsTrigger.text()).not.toContain('详情')
    expect(footerVersionsTrigger.attributes('aria-label')).toContain('SSL 证书列表')

    await footerVersionsTrigger.trigger('click')
    await waitFor(() => {
      expect(document.body.querySelectorAll('.certificate-page__version-table tbody tr')).toHaveLength(3)
    })

    expect(recordTrigger.attributes('aria-expanded')).toBe('true')
    expect(footerVersionsTrigger.attributes('aria-expanded')).toBe('true')
    const versionModalPanel = document.body.querySelector<HTMLElement>(`#${panelId}`)
    expect(versionModalPanel).not.toBeNull()
    expect(versionModalPanel?.getAttribute('role')).toBe('region')
    expect(versionModalPanel?.getAttribute('aria-labelledby')).toBe(recordTrigger.attributes('id'))

    expect(document.body.querySelector('.certificate-page__version-table')).not.toBeNull()
    expect(document.body.querySelector('.certificate-page__sort-row')).toBeNull()
    expect(document.body.querySelector('.gc-data-table__footer')).toBeNull()

    const tableText = document.body.textContent ?? ''
    expect(tableText).toContain('开始日期')
    expect(tableText).toContain('结束日期')
    expect(tableText).toContain('添加方式')
    expect(tableText).not.toContain('至')

    const rows = [...document.body.querySelectorAll<HTMLTableRowElement>('.certificate-page__version-table tbody tr')]
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('2025-01-01')
    expect(rows[0]?.textContent).toContain('2025-01-02')
    expect(rows[0]?.textContent).toContain('过期')
    expect(rows[0]?.textContent).toContain('手动导入')
    expect([...rows[0]!.querySelectorAll('.gc-tag')].map((tag) => [...tag.classList])).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['gc-tag--muted']),
        expect.arrayContaining(['gc-tag--danger']),
      ]),
    )
    expect(rows[1]?.textContent).toContain('2026-06-01')
    expect(rows[1]?.textContent).toContain(formatBrowserLocalTime('2026-06-15T23:59:59.000Z', { includeTime: false }))
    expect(rows[1]?.textContent).toContain('即将过期')
    expect(rows[1]?.textContent).toContain('外部 API')
    expect([...rows[1]!.querySelectorAll('.gc-tag')].map((tag) => [...tag.classList])).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['gc-tag--info']),
        expect.arrayContaining(['gc-tag--warning']),
      ]),
    )
    expect(rows[2]?.textContent).toContain('2026-06-10')
    expect(rows[2]?.textContent).toContain(formatBrowserLocalTime('2026-12-17T23:59:59.000Z', { includeTime: false }))
    expect(rows[2]?.textContent).toContain('有效')
    expect(rows[2]?.textContent).toContain('外部 API')
    expect([...rows[2]!.querySelectorAll('.gc-tag')].map((tag) => [...tag.classList])).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['gc-tag--info']),
        expect.arrayContaining(['gc-tag--success']),
      ]),
    )

    const assetCard = wrapper.find('.certificate-page__asset-card')
    expect(assetCard.exists()).toBe(true)
    expect(assetCard.text()).toContain('即将过期')
    expect(assetCard.text()).toContain(formatBrowserLocalTime('2026-06-15T23:59:59.000Z', { includeTime: false }))
    expect(assetCard.text()).toContain('外部 API')
    expect(assetCard.find('.certificate-page__asset-card-kicker').exists()).toBe(false)
    expect(assetCard.find('.certificate-page__asset-card-chevron').exists()).toBe(false)
    const validityProgress = assetCard.get('[role="progressbar"]')
    expect(validityProgress.classes()).toContain('gc-progress--outlined')

    const headerButtons = [...document.body.querySelectorAll<HTMLButtonElement>('.certificate-page__header-sort')]
    const nameHeader = headerButtons.find((button) => button.textContent?.includes('证书名称'))
    expect(nameHeader).toBeTruthy()
    nameHeader!.click()
    await waitFor(() => {
      const sortedRows = [...document.body.querySelectorAll<HTMLTableRowElement>('.certificate-page__version-table tbody tr')]
      expect(sortedRows[0]?.textContent).toContain('zeta.weichai.com')
    })

    const sortedRows = [...document.body.querySelectorAll<HTMLTableRowElement>('.certificate-page__version-table tbody tr')]
    expect(sortedRows[0]?.textContent).toContain('zeta.weichai.com')
    expect(sortedRows[1]?.textContent).toContain('beta.weichai.com')
    expect(sortedRows[2]?.textContent).toContain('alpha.weichai.com')
  })

  it('用户视图也使用最新证书版本的来源摘要', async () => {
    useAppStore().setViewMode('user')
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)
      if (target.includes('/certificate-assets')) {
        return new Response(JSON.stringify({
          data: {
            items: [{
              id: 'asset-user',
              primaryDomain: '*.weichai.com',
              sourceType: 'unknown',
            }],
            page: 1,
            pageSize: 20,
            total: 1,
          },
        }), { status: 200 })
      }
      if (target.includes('/certificate-versions')) {
        return new Response(JSON.stringify({
          data: {
            items: [{
              id: 'certver-user',
              certificateAssetId: 'asset-user',
              notBefore: '2026-06-01T00:00:00.000Z',
              notAfter: '2026-12-17T23:59:59.000Z',
              sourceType: 'external_api',
              status: 'MANAGED',
            }],
            page: 1,
            pageSize: 1,
            total: 1,
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await waitFor(() => {
      expect(wrapper.find('.certificate-simple-view__field-value').exists()).toBe(true)
    })

    expect(wrapper.findAll('.certificate-simple-view__field-value')[1]?.text()).toBe('外部 API')
  })

  it('快速切换证书记录时不会展示旧请求返回的版本', async () => {
    let resolveFirstVersionRequest: ((response: Response) => void) | undefined
    const firstVersionRequest = new Promise<Response>((resolve) => {
      resolveFirstVersionRequest = resolve
    })

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)
      if (target.includes('/certificate-assets')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'asset-a',
                primaryDomain: 'alpha.weichai.com',
                sourceType: 'manual',
                currentVersion: { notAfter: '2026-12-17T23:59:59.000Z' },
              },
              {
                id: 'asset-b',
                primaryDomain: 'beta.weichai.com',
                sourceType: 'manual',
                currentVersion: { notAfter: '2026-12-17T23:59:59.000Z' },
              },
            ],
            page: 1,
            pageSize: 20,
            total: 2,
          },
        }), { status: 200 })
      }

      if (target.includes('/certificate-versions')) {
        const parsed = new URL(target, 'https://example.test')
        const assetId = parsed.searchParams.get('filter[certificateAssetId]')
        const pageSize = parsed.searchParams.get('pageSize')

        if (pageSize === '1') {
          return new Response(JSON.stringify({
            data: {
              items: [
                {
                  id: `lifecycle-${assetId}`,
                  certificateAssetId: assetId,
                  commonName: assetId === 'asset-a' ? 'alpha.weichai.com' : 'beta.weichai.com',
                  notAfter: '2026-12-17T23:59:59.000Z',
                  status: 'MANAGED',
                },
              ],
              page: 1,
              pageSize: 1,
              total: 1,
            },
          }), { status: 200 })
        }

        if (pageSize === '100' && assetId === 'asset-a') {
          return firstVersionRequest
        }

        if (pageSize === '100' && assetId === 'asset-b') {
          return new Response(JSON.stringify({
            data: {
              items: [
                {
                  id: 'certver-current-b',
                  certificateAssetId: 'asset-b',
                  commonName: 'current.beta.weichai.com',
                  notBefore: '2026-06-10T00:00:00.000Z',
                  notAfter: '2026-12-17T23:59:59.000Z',
                  issuer: { commonName: 'Beta Issuer' },
                  subject: { commonName: 'current.beta.weichai.com' },
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
    }))

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await waitFor(() => {
      expect(wrapper.findAll('.certificate-page__asset-record-trigger')).toHaveLength(2)
    })

    const recordTriggers = () => wrapper.findAll('.certificate-page__asset-record-trigger')
    const firstPanelId = recordTriggers()[0]?.attributes('aria-controls')
    const secondPanelId = recordTriggers()[1]?.attributes('aria-controls')
    expect(firstPanelId).toBe('certificate-versions-dialog-asset-a')
    expect(secondPanelId).toBe('certificate-versions-dialog-asset-b')
    expect(new Set(recordTriggers().map((trigger) => trigger.attributes('aria-controls'))).size).toBe(2)

    await recordTriggers()[0]!.trigger('click')
    await waitFor(() => {
      expect(resolveFirstVersionRequest).toBeDefined()
      expect(document.body.querySelector(`#${firstPanelId}`)).not.toBeNull()
    })

    await recordTriggers()[1]!.trigger('click')
    await waitFor(() => {
      expect(document.body.querySelectorAll(`#${secondPanelId} .certificate-page__version-table tbody tr`)).toHaveLength(1)
    })

    expect(document.body.querySelector(`#${firstPanelId}`)).toBeNull()
    expect(document.body.querySelector(`#${secondPanelId}`)?.textContent).toContain('current.beta.weichai.com')
    expect(document.body.querySelector(`#${secondPanelId}`)?.textContent).not.toContain('stale.alpha.weichai.com')

    const resolvePendingRequest = resolveFirstVersionRequest
    expect(resolvePendingRequest).toBeDefined()
    resolvePendingRequest!(new Response(JSON.stringify({
      data: {
        items: [
          {
            id: 'certver-stale-a',
            certificateAssetId: 'asset-a',
            commonName: 'stale.alpha.weichai.com',
            notBefore: '2026-06-10T00:00:00.000Z',
            notAfter: '2026-12-17T23:59:59.000Z',
            issuer: { commonName: 'Alpha Issuer' },
            subject: { commonName: 'stale.alpha.weichai.com' },
            status: 'MANAGED',
          },
        ],
        page: 1,
        pageSize: 100,
        total: 1,
      },
    }), { status: 200 }))

    await flushPromises()
    expect(document.body.querySelector(`#${secondPanelId}`)?.textContent).toContain('current.beta.weichai.com')
    expect(document.body.querySelector(`#${secondPanelId}`)?.textContent).not.toContain('stale.alpha.weichai.com')
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
      expect(wrapper.find('.certificate-page__asset-record-trigger').exists()).toBe(true)
    })
    await wrapper.find('.certificate-page__asset-record-trigger').trigger('click')
    await waitFor(() => {
      expect(document.body.querySelectorAll('.certificate-page__version-table tbody tr')).toHaveLength(2)
    })

    expect(document.body.textContent).toContain('remove.weichai.com')
    expect(document.body.textContent).toContain('keep.weichai.com')

    const deleteTrigger = document.body.querySelector<HTMLButtonElement>('.certificate-page__row-actions .gc-button--danger')
    expect(deleteTrigger).not.toBeNull()
    deleteTrigger?.click()
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
      expect(document.body.textContent).not.toContain('remove.weichai.com')
    })

    expect(document.body.textContent).toContain('keep.weichai.com')
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
      expect(wrapper.findAll('.certificate-page__asset-card')).toHaveLength(2)
    })

    expect(wrapper.find('.certificate-page__asset-card-list').exists()).toBe(true)
    const presentationButtons = wrapper.findAll('.certificate-page__presentation-toggle-button')
    expect(presentationButtons).toHaveLength(2)
    expect(wrapper.find('.certificate-page__asset-card-list--cards').exists()).toBe(true)
    expect(presentationButtons[0]?.attributes('aria-pressed')).toBe('true')
    expect(presentationButtons[1]?.attributes('aria-pressed')).toBe('false')
    await presentationButtons[1]!.trigger('click')
    expect(wrapper.find('.certificate-page__asset-card-list--list').exists()).toBe(true)
    expect(presentationButtons[0]?.attributes('aria-pressed')).toBe('false')
    expect(presentationButtons[1]?.attributes('aria-pressed')).toBe('true')
    await presentationButtons[0]!.trigger('click')
    expect(wrapper.find('.certificate-page__asset-card-list--cards').exists()).toBe(true)
    expect(wrapper.find('.certificate-page__asset-list').exists()).toBe(false)

    const assetCardText = wrapper.find('.certificate-page__asset-card-list').text()
    expect((assetCardText.match(/\*\.jacksonz\.cn/g) ?? [])).toHaveLength(1)
    expect(assetCardText).toContain('www.weichaipower.com')
    expect(assetCardText).not.toContain('暂无补充信息')

    await wrapper.find('.certificate-page__asset-record-trigger').trigger('click')
    await waitFor(() => {
      expect(document.body.querySelectorAll('.certificate-page__version-table tbody tr')).toHaveLength(1)
    })
    expect(document.body.textContent).toContain('*.jacksonz.cn')
  })
})
