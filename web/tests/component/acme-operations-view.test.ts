import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AcmeOperationsView from '@/views/acme/AcmeOperationsView.vue'

const acmeMocks = vi.hoisted(() => ({
  getAcmeStatus: vi.fn(),
  listAcmeProviders: vi.fn(),
  listAcmeRenewalPolicies: vi.fn(),
  listAcmeRenewalJobs: vi.fn(),
  listAcmeOrders: vi.fn(),
  createAcmeCertificate: vi.fn(),
  manualRenewAcmeCertificate: vi.fn(),
  deleteAcmeCertificate: vi.fn(),
  scanAcmeRenewalJobs: vi.fn(),
  retryAcmeRenewalJob: vi.fn(),
}))
const certificateMocks = vi.hoisted(() => ({ listCertificates: vi.fn() }))
const credentialMocks = vi.hoisted(() => ({ listCredentials: vi.fn() }))

vi.mock('@/api/modules/internal-ca.api', () => ({ internalCaApi: acmeMocks }))
vi.mock('@/api/modules/certificates.api', () => certificateMocks)
vi.mock('@/api/modules/credentials.api', () => credentialMocks)

async function settle() {
  await flushPromises()
  await flushPromises()
}

describe('AcmeOperationsView', () => {
  beforeEach(() => {
    acmeMocks.getAcmeStatus.mockResolvedValue({ data: { status: 'READY', provider: { name: 'Let’s Encrypt' } } })
    acmeMocks.listAcmeProviders.mockResolvedValue({ data: { items: [], presets: [] } })
    acmeMocks.listAcmeRenewalPolicies.mockResolvedValue({ data: [] })
    acmeMocks.listAcmeRenewalJobs.mockResolvedValue({ data: [] })
    acmeMocks.listAcmeOrders.mockResolvedValue({ data: [] })
    acmeMocks.createAcmeCertificate.mockResolvedValue({ data: { id: 'asset-1' } })
    acmeMocks.manualRenewAcmeCertificate.mockResolvedValue({ data: {} })
    acmeMocks.deleteAcmeCertificate.mockResolvedValue({ data: {} })
    acmeMocks.scanAcmeRenewalJobs.mockResolvedValue({ data: [] })
    acmeMocks.retryAcmeRenewalJob.mockResolvedValue({ data: {} })
    certificateMocks.listCertificates.mockResolvedValue({ data: { items: [], total: 0 } })
    credentialMocks.listCredentials.mockResolvedValue({
      data: { items: [{ id: 'dns-1', name: 'DNS Profile', kind: 'DNS_PROVIDER', status: 'active' }], total: 1 },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('加载宿主 ACME 状态并展示六项申请表单', async () => {
    const wrapper = mount(AcmeOperationsView, { attachTo: document.body })
    await settle()

    expect(wrapper.text()).toContain('ACME 证书自动化')
    expect(wrapper.text()).toContain('Let’s Encrypt')
    await wrapper.find('button.gc-button--primary').trigger('click')
    await settle()
    expect(document.querySelector('.acme-page__form')).not.toBeNull()
    expect(document.body.textContent).not.toContain('Directory URL')
    expect(document.body.textContent).not.toContain('SecretRef')
    expect(document.querySelectorAll('.acme-page__form input')).toHaveLength(3)
  })

  it('显示 ACME Provider 管理入口，并读取租户级 Provider 列表', async () => {
    acmeMocks.listAcmeProviders.mockResolvedValue({
      data: {
        items: [{
          id: 'provider-letsencrypt',
          name: 'Let’s Encrypt',
          type: 'acme',
          status: 'active',
          endpoint: 'https://acme-v02.api.letsencrypt.org/directory',
          configuration: { preset: 'letsencrypt', isDefault: true, isBuiltIn: true },
        }],
        presets: [{ key: 'letsencrypt', defaultDirectoryUrl: 'https://acme-v02.api.letsencrypt.org/directory', defaultAllowedChallenges: ['http-01', 'dns-01'] }],
      },
    })
    const wrapper = mount(AcmeOperationsView, { attachTo: document.body })
    await settle()

    expect(wrapper.text()).toContain('ACME Provider 管理')
    expect(wrapper.text()).toContain('Let’s Encrypt')
    await wrapper.findAll('button').find((button) => button.text() === 'ACME Provider 管理')?.trigger('click')
    await settle()
    expect(document.body.textContent).toContain('Directory URL')
    expect(document.body.textContent).toContain('内置')
    expect(document.body.textContent).toContain('默认')
  })

  it('提交申请固定调用宿主 ACME certificates API，不触发 Runner', async () => {
    const wrapper = mount(AcmeOperationsView, { attachTo: document.body })
    await settle()
    await wrapper.find('button.gc-button--primary').trigger('click')
    await settle()
    const inputs = document.querySelectorAll<HTMLInputElement>('.acme-page__form input')
    if (inputs[0]) inputs[0].value = 'example.com'
    inputs[0]?.dispatchEvent(new Event('input', { bubbles: true }))
    if (inputs[1]) inputs[1].value = 'admin@example.com'
    inputs[1]?.dispatchEvent(new Event('input', { bubbles: true }))
    const credentialSelect = document.querySelector<HTMLSelectElement>('.gc-credential-select select')
    if (credentialSelect) {
      credentialSelect.value = 'dns-1'
      credentialSelect.dispatchEvent(new Event('change', { bubbles: true }))
    }
    document.querySelector<HTMLFormElement>('.acme-page__form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()

    expect(acmeMocks.createAcmeCertificate).toHaveBeenCalledWith(expect.objectContaining({
      domains: ['example.com'],
      contactEmail: 'admin@example.com',
      providerId: undefined,
      dnsCredentialId: 'dns-1',
      challengeType: 'dns-01',
      keyType: 'rsa',
      autoRenew: true,
    }))
    expect(acmeMocks.createAcmeCertificate).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('Plugin Runner')
  })
})
