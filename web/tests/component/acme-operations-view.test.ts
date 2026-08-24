import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AcmeOperationsView from '@/views/acme/AcmeOperationsView.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

function acmeVersion(id: string, createdAt: string, notAfter: string) {
  return {
    id,
    certificateAssetId: 'asset-acme-1',
    versionNo: 2,
    commonName: '*.codingns.com',
    sans: ['*.codingns.com'],
    issuer: { commonName: 'Let\'s Encrypt' },
    subject: { commonName: '*.codingns.com' },
    serialNumber: '01',
    notBefore: '2026-08-05T00:00:00.000Z',
    notAfter,
    fingerprintSha256: `${id}`.padEnd(64, 'a').slice(0, 64),
    publicKeyAlgorithm: 'rsa',
    signatureAlgorithm: 'sha256WithRSAEncryption',
    leafStorageRef: `artifact://certificate-leaf/${id}`,
    hasPrivateKey: false,
    chainCertificateRefs: [],
    chainOrder: [],
    chainDiagnostics: [],
    chainStatus: 'valid',
    deployable: true,
    activationState: 'staged',
    sourceType: 'acme',
    status: 'active',
    createdBy: 'user-acme',
    createdAt,
  }
}

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_ok',
    timestamp: '2026-08-06T00:00:00.000Z',
  }
}

describe('AcmeOperationsView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T10:18:38.000Z'))
    const requestedUrls: string[] = []
    const firstPageVersions = [
      acmeVersion('certver-acme-1', '2026-08-05T04:00:00.000Z', '2026-09-07T10:18:38.000Z'),
      ...Array.from({ length: 199 }, (_, index) => acmeVersion(
        `certver-acme-filler-${index + 1}`,
        '2026-08-05T00:00:00.000Z',
        '2026-08-20T00:00:00.000Z',
      )),
    ]

    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)
      requestedUrls.push(target)

      if (target.includes('/certificate-assets')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'asset-acme-1',
                name: '*.codingns.com',
                primaryDomain: '*.codingns.com',
                sans: ['*.codingns.com'],
                sourceType: 'acme',
                status: 'active',
                tags: ['acme'],
                createdBy: 'user-acme',
                createdAt: '2026-08-05T00:00:00.000Z',
                updatedAt: '2026-08-05T00:00:00.000Z',
              },
            ],
            page: 1,
            pageSize: 200,
            total: 1,
          },
        }), { status: 200 })
      }

      if (target.includes('/certificate-versions')) {
        const parsed = new URL(target, 'https://example.test')
        const page = Number(parsed.searchParams.get('page') ?? '1')
        const pageSize = Number(parsed.searchParams.get('pageSize') ?? '0')
        if (pageSize > 200) {
          throw new Error(`非法 pageSize: ${pageSize}`)
        }
        const items = page === 1
          ? firstPageVersions
          : [
              acmeVersion('certver-acme-tail-1', '2026-08-04T23:00:00.000Z', '2026-08-21T00:00:00.000Z'),
            ]
        return new Response(JSON.stringify({
          data: {
            items,
            page,
            pageSize,
            total: 201,
          },
          requestId: 'req_ok',
          timestamp: '2026-08-06T00:00:00.000Z',
        }), { status: 200 })
      }

      if (target.includes('/acme/providers')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'provider-acme-1',
                name: 'Let\'s Encrypt',
                type: 'acme',
                status: 'active',
                configuration: {
                  directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
                  allowedChallenges: ['http-01', 'dns-01'],
                  isDefault: true,
                  isBuiltIn: true,
                },
              },
            ],
            presets: [],
          },
        }), { status: 200 })
      }

      if (target.includes('/ca-providers')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'provider-acme-1',
              name: 'Let\'s Encrypt',
              type: 'acme',
              status: 'active',
              configuration: {
                directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
                allowedChallenges: ['http-01', 'dns-01'],
                isDefault: true,
                isBuiltIn: true,
              },
            },
          ],
        }), { status: 200 })
      }

      if (target.includes('/acme/accounts')) {
        return new Response(JSON.stringify({
          data: [
          {
            id: 'account-acme-1',
            tenantId: 'default',
            providerId: 'provider-acme-1',
            directoryUrlHash: 'directory-hash',
            accountUrl: 'https://acme.example.test/acct/1',
            accountKeySecretRef: 'secret://certificate_private_key/account#current',
            contact: ['mailto:ops@example.com'],
            status: 'active',
            createdAt: '2026-08-05T00:00:00.000Z',
            updatedAt: '2026-08-05T00:00:00.000Z',
          },
        ],
        }), { status: 200 })
      }

      if (target.includes('/acme/dns-providers')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }

      if (target.includes('/acme/renewal-policies')) {
        return new Response(JSON.stringify({
          data: [
          {
            id: 'policy-acme-1',
            certificateAssetId: 'asset-acme-1',
            providerId: 'provider-acme-1',
            accountId: 'account-acme-1',
            enabled: true,
            renewalWindowDays: 7,
            challengeType: 'dns-01',
            rotateKeyOnRenewal: true,
            deploymentMode: 'manual',
            maxAttempts: 5,
            backoffSeconds: 300,
            status: 'active',
            version: 1,
            createdBy: 'user-acme',
            createdAt: '2026-08-05T00:00:00.000Z',
            updatedAt: '2026-08-05T00:00:00.000Z',
            maintenanceWindow: {
              contactEmail: 'ops@example.com',
              domains: ['*.codingns.com'],
              keyType: 'rsa',
            },
          },
        ],
        }), { status: 200 })
      }

      if (target.includes('/acme/orders')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'order-acme-1',
              certificateRequestId: 'request-acme-1',
              certificateAssetId: 'asset-acme-1',
              status: 'valid',
              externalOrderUrl: 'https://acme.example.test/order/1',
              identifiers: [
                { type: 'dns', value: '*.codingns.com' },
              ],
              authorizationCount: 1,
              challengeCount: 1,
              createdAt: '2026-08-05T00:00:00.000Z',
              updatedAt: '2026-08-05T00:10:00.000Z',
            },
          ],
        }), { status: 200 })
      }

      if (target.includes('/acme/renewal-jobs')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))

    vi.stubGlobal('__ACME_REQUESTED_URLS__', requestedUrls)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete (globalThis as typeof globalThis & { __ACME_REQUESTED_URLS__?: string[] }).__ACME_REQUESTED_URLS__
    document.body.innerHTML = ''
  })

  it('能从 ACME 版本列表回填 staged 证书的到期时间和下次续签剩余天数', async () => {
    const wrapper = mount(AcmeOperationsView, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    })

    await flushPromises()
    await flushPromises()

    const expectedExpiry = formatBrowserLocalTime('2026-09-07T10:18:38.000Z', { includeSeconds: false }) || ''
    const expectedRenewalCountdown = '剩余 25 天'
    expect(wrapper.text()).toContain(expectedExpiry)
    expect(wrapper.text()).toContain(expectedRenewalCountdown)

    const detailButton = wrapper.findAll('button').find((button) => button.text() === '详情')
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(document.body.textContent ?? '').toContain(expectedExpiry)
    expect(document.body.textContent ?? '').toContain(expectedRenewalCountdown)
    expect(document.body.textContent ?? '').toContain('提前续签')
    expect(document.body.textContent ?? '').toContain('7')
    expect(document.body.textContent ?? '').toContain('ACME 提供者')
    expect(document.body.textContent ?? '').toContain("Let's Encrypt")
    expect(document.body.textContent ?? '').toContain('*.codingns.com')
    expect(document.body.textContent ?? '').not.toContain('暂无 ACME 订单')
    const requestedUrls = (globalThis as typeof globalThis & { __ACME_REQUESTED_URLS__?: string[] }).__ACME_REQUESTED_URLS__ ?? []
    const versionRequests = requestedUrls.filter((item) => item.includes('/certificate-versions'))
    expect(versionRequests.length).toBe(2)
    expect(versionRequests.every((item) => item.includes('pageSize=200'))).toBe(true)
  })

  it('进入续签窗口后显示已进入续签窗口', async () => {
    vi.setSystemTime(new Date('2026-08-31T10:18:39.000Z'))

    const wrapper = mount(AcmeOperationsView, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    })

    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('已进入续签窗口')

    const detailButton = wrapper.findAll('button').find((button) => button.text() === '详情')
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(document.body.textContent ?? '').toContain('已进入续签窗口')
  })

  it('DNS-01 没有本地订单时显示准确说明', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)

      if (target.includes('/certificate-assets')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'asset-acme-1',
                name: '*.codingns.com',
                primaryDomain: '*.codingns.com',
                sans: ['*.codingns.com'],
                sourceType: 'acme',
                status: 'active',
                tags: ['acme'],
                createdBy: 'user-acme',
                createdAt: '2026-08-05T00:00:00.000Z',
                updatedAt: '2026-08-05T00:00:00.000Z',
              },
            ],
            page: 1,
            pageSize: 200,
            total: 1,
          },
        }), { status: 200 })
      }

      if (target.includes('/certificate-versions')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              acmeVersion('certver-acme-1', '2026-08-05T04:00:00.000Z', '2026-09-07T10:18:38.000Z'),
            ],
            page: 1,
            pageSize: 200,
            total: 1,
          },
          requestId: 'req_ok',
          timestamp: '2026-08-06T00:00:00.000Z',
        }), { status: 200 })
      }

      if (target.includes('/acme/providers')) {
        return new Response(JSON.stringify({
          data: {
            items: [
              {
                id: 'provider-acme-1',
                name: 'Let\'s Encrypt',
                type: 'acme',
                status: 'active',
                configuration: {
                  directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
                  allowedChallenges: ['http-01', 'dns-01'],
                  isDefault: true,
                  isBuiltIn: true,
                },
              },
            ],
            presets: [],
          },
        }), { status: 200 })
      }

      if (target.includes('/ca-providers')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'provider-acme-1',
              name: 'Let\'s Encrypt',
              type: 'acme',
              status: 'active',
              configuration: {
                directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
                allowedChallenges: ['http-01', 'dns-01'],
                isDefault: true,
                isBuiltIn: true,
              },
            },
          ],
        }), { status: 200 })
      }

      if (target.includes('/acme/accounts')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      if (target.includes('/acme/dns-providers')) return new Response(JSON.stringify({ data: [] }), { status: 200 })

      if (target.includes('/acme/renewal-policies')) {
        return new Response(JSON.stringify({
          data: [
            {
              id: 'policy-acme-1',
              certificateAssetId: 'asset-acme-1',
              providerId: 'provider-acme-1',
              accountId: 'account-acme-1',
              enabled: true,
              renewalWindowDays: 7,
              challengeType: 'dns-01',
              rotateKeyOnRenewal: true,
              deploymentMode: 'manual',
              maxAttempts: 5,
              backoffSeconds: 300,
              status: 'active',
              version: 1,
              createdBy: 'user-acme',
              createdAt: '2026-08-05T00:00:00.000Z',
              updatedAt: '2026-08-05T00:00:00.000Z',
              maintenanceWindow: {
                contactEmail: 'ops@example.com',
                domains: ['*.codingns.com'],
                keyType: 'rsa',
              },
            },
          ],
        }), { status: 200 })
      }

      if (target.includes('/acme/orders')) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      if (target.includes('/acme/renewal-jobs')) return new Response(JSON.stringify({ data: [] }), { status: 200 })

      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))

    const wrapper = mount(AcmeOperationsView, {
      attachTo: document.body,
      global: { plugins: [i18n] },
    })

    await flushPromises()
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text() === '详情')
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(document.body.textContent ?? '').toContain('当前 DNS-01 由 lego 直接向 ACME CA 申请证书，GCAC 暂未落本地 ACME 订单记录。')
  })
})
