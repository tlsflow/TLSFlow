import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CertificatesView from '@/views/certificates/CertificatesView.vue'
import { usePermissionStore } from '@/stores/permission.store'

describe('CertificatesView', () => {
  let localStore: Record<string, string>

  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['certificate.asset.read', 'certificate.import'])
    localStore = {}
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => localStore[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { localStore[key] = String(value) }),
      removeItem: vi.fn((key: string) => { delete localStore[key] }),
      clear: vi.fn(() => { localStore = {} })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('导入证书只把私钥放进 POST body，不写 URL、localStorage 或 console', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const privateKey = '-----BEGIN PRIVATE KEY-----\\nPRIVATE_SECRET_MATERIAL\\n-----END PRIVATE KEY-----'
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)
      if (target.includes('/certificate-assets')) {
        return new Response(JSON.stringify({
          data: { items: [], page: 1, pageSize: 20, total: 0 },
          requestId: 'req_cert_list',
          timestamp: '2026-06-09T00:00:00.000Z'
        }), { status: 200 })
      }
      return new Response(JSON.stringify({
        data: {
          asset: { id: 'certasset-1' },
          version: { id: 'certver-1', hasPrivateKey: true }
        },
        requestId: 'req_cert_import',
        timestamp: '2026-06-09T00:00:00.000Z'
      }), { status: 201 })
    }))

    const wrapper = mount(CertificatesView, { attachTo: document.body })
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂无证书资产'))

    await wrapper.findAll('button').find((button) => button.text() === '导入证书')?.trigger('click')
    const textareas = document.querySelectorAll('textarea')
    textareas[0]!.value = '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----'
    textareas[0]!.dispatchEvent(new Event('input', { bubbles: true }))
    textareas[2]!.value = privateKey
    textareas[2]!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    document.querySelectorAll('button').forEach((button) => {
      if (button.textContent?.trim() === '确认导入') button.click()
    })
    await flushPromises()

    const importCall = vi.mocked(fetch).mock.calls.find((call) => String(call[0]).includes('/certificate-versions/import'))
    expect(importCall).toBeTruthy()
    expect(String(importCall?.[0])).not.toContain('PRIVATE_SECRET_MATERIAL')
    expect(JSON.parse(String(importCall?.[1]?.body))).toMatchObject({ privateKeyPem: privateKey })
    expect(JSON.stringify(localStore)).not.toContain('PRIVATE_SECRET_MATERIAL')
    expect(consoleError.mock.calls.flat().join('\n')).not.toContain('PRIVATE_SECRET_MATERIAL')
    expect(consoleWarn.mock.calls.flat().join('\n')).not.toContain('PRIVATE_SECRET_MATERIAL')
  })
})
