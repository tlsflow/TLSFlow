import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AcmeCertificateRequestModal from '@/views/acme/AcmeCertificateRequestModal.vue'

const acmeMocks = vi.hoisted(() => ({
  getAcmeStatus: vi.fn(),
  listAcmeProviders: vi.fn(),
  listAcmeDnsProviders: vi.fn(),
  createAcmeCertificate: vi.fn(),
}))

vi.mock('@/api/modules/internal-ca.api', () => ({ internalCaApi: acmeMocks }))

async function settle(): Promise<void> {
  await flushPromises()
  await flushPromises()
}

describe('AcmeCertificateRequestModal', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en-US'
    acmeMocks.getAcmeStatus.mockResolvedValue({
      data: { status: 'READY', provider: { id: 'caprov_letsencrypt', name: "Let's Encrypt" } },
    })
    acmeMocks.listAcmeProviders.mockResolvedValue({
      data: {
        items: [{
          id: 'caprov_letsencrypt',
          name: "Let's Encrypt",
          type: 'acme',
          status: 'active',
          configuration: { isDefault: true },
        }],
      },
    })
    acmeMocks.listAcmeDnsProviders.mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    i18n.global.locale.value = 'zh-CN'
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('英文界面异步加载 Provider 后仍保持默认选中并通过原生校验', async () => {
    mount(AcmeCertificateRequestModal, { attachTo: document.body, props: { open: true } })
    await settle()

    const select = document.querySelector<HTMLSelectElement>('.acme-page__form select')
    expect(select).toBeTruthy()
    expect(select?.value).toBe('caprov_letsencrypt')
    expect(select?.checkValidity()).toBe(true)
  })

  it('Provider 列表暂时为空时使用状态接口的 Provider ID 作为回退值', async () => {
    acmeMocks.listAcmeProviders.mockResolvedValueOnce({ data: { items: [] } })
    mount(AcmeCertificateRequestModal, { attachTo: document.body, props: { open: true } })
    await settle()

    const select = document.querySelector<HTMLSelectElement>('.acme-page__form select')
    expect(select?.value).toBe('caprov_letsencrypt')
    expect(select?.checkValidity()).toBe(true)
  })
})
