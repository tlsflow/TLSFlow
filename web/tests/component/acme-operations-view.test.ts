import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AcmeOperationsView from '@/views/acme/AcmeOperationsView.vue'

const acmeMocks = vi.hoisted(() => ({
  getAcmeStatus: vi.fn(),
  listAcmeProviders: vi.fn(),
  listAcmeProviderProfiles: vi.fn(),
  listAcmeAccounts: vi.fn(),
  listAcmeDnsProviders: vi.fn(),
  listAcmeRenewalPolicies: vi.fn(),
  updateAcmeRenewalPolicy: vi.fn(),
  listAcmeRenewalJobs: vi.fn(),
  listAcmeOrders: vi.fn(),
  createAcmeAccount: vi.fn(),
  createAcmeProvider: vi.fn(),
  updateAcmeProvider: vi.fn(),
  testAcmeProvider: vi.fn(),
  createAcmeCertificate: vi.fn(),
  updateAcmeCertificate: vi.fn(),
  manualRenewAcmeCertificate: vi.fn(),
  deleteAcmeCertificate: vi.fn(),
  scanAcmeRenewalJobs: vi.fn(),
  retryAcmeRenewalJob: vi.fn(),
}))
const certificateMocks = vi.hoisted(() => ({
  listCertificates: vi.fn(),
  listCertificateVersions: vi.fn(),
}))
const credentialMocks = vi.hoisted(() => ({
  createCredential: vi.fn(),
  listCredentials: vi.fn(),
}))
const securityMocks = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
}))

vi.mock('@/api/modules/internal-ca.api', () => ({ internalCaApi: acmeMocks }))
vi.mock('@/api/modules/certificates.api', () => certificateMocks)
vi.mock('@/api/modules/credentials.api', () => credentialMocks)
vi.mock('@/api/modules/security.api', () => securityMocks)

const acmeProvider = {
  id: 'provider-letsencrypt',
  name: 'Let’s Encrypt',
  type: 'acme',
  status: 'active',
  configuration: {
    preset: 'letsencrypt',
    isDefault: true,
    isBuiltIn: true,
    directoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
  },
}

async function settle(): Promise<void> {
  await flushPromises()
  await flushPromises()
}

function findButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((item) => item.textContent?.trim() === label)
  if (!button) throw new Error(`未找到按钮：${label}`)
  return button
}

async function openCreateForm(): Promise<void> {
  findButton('申请证书').click()
  await settle()
}

async function confirmTerms(): Promise<void> {
  findButton('阅读条款').click()
  await settle()
  const checkbox = document.querySelector<HTMLInputElement>('.acme-page__terms input[type="checkbox"]')
  if (!checkbox) throw new Error('未找到服务条款确认框')
  checkbox.click()
  await settle()
  findButton('确认已读并同意').click()
  await settle()
}

function fillCreateForm(domains: string, email: string, renewalWindowDays = 7): HTMLFormElement {
  const form = document.querySelector<HTMLFormElement>('.acme-page__form')
  if (!form) throw new Error('未找到 ACME 申请表单')
  const domainInput = form.querySelector<HTMLTextAreaElement>('textarea')
  const emailInput = form.querySelector<HTMLInputElement>('input[type="email"]')
  const renewalInput = form.querySelector<HTMLInputElement>('input[type="number"][min="1"]')
  if (!domainInput || !emailInput || !renewalInput) throw new Error('申请表单字段不完整')
  domainInput.value = domains
  domainInput.dispatchEvent(new Event('input', { bubbles: true }))
  emailInput.value = email
  emailInput.dispatchEvent(new Event('input', { bubbles: true }))
  renewalInput.value = String(renewalWindowDays)
  renewalInput.dispatchEvent(new Event('input', { bubbles: true }))
  return form
}

describe('AcmeOperationsView', () => {
  beforeEach(() => {
    acmeMocks.getAcmeStatus.mockResolvedValue({
      data: { status: 'READY', provider: { id: acmeProvider.id, name: acmeProvider.name } },
    })
    acmeMocks.listAcmeProviders.mockResolvedValue({
      data: {
        items: [acmeProvider],
        presets: [{ key: 'letsencrypt', defaultDirectoryUrl: acmeProvider.configuration.directoryUrl, defaultAllowedChallenges: ['http-01', 'dns-01'] }],
      },
    })
    acmeMocks.listAcmeDnsProviders.mockResolvedValue({
      data: [{ id: 'cloudflare', name: 'Cloudflare', credentialTemplate: 'CLOUDFLARE_DNS_API_TOKEN=...' }],
    })
    acmeMocks.listAcmeAccounts.mockResolvedValue({ data: [] })
    acmeMocks.listAcmeProviderProfiles.mockResolvedValue({
      data: {
        items: [{
          key: 'letsencrypt',
          displayName: 'Let’s Encrypt',
          version: '2026-08-13.1',
          directory: { defaultUrl: acmeProvider.configuration.directoryUrl, userInputRequired: false },
          account: { eab: 'not_required' },
          form: { providerFields: ['profileKey', 'displayName', 'isDefault'], accountFields: ['contactEmail'] },
        }, {
          key: 'digicert',
          displayName: 'DigiCert',
          version: '2026-08-13.1',
          directory: { userInputRequired: true },
          account: { eab: 'discover' },
          form: { providerFields: ['profileKey', 'displayName', 'directoryUrl', 'isDefault'], accountFields: ['contactEmail', 'eabSecretRef'] },
        }],
      },
    })
    acmeMocks.listAcmeRenewalPolicies.mockResolvedValue({ data: [] })
    acmeMocks.updateAcmeRenewalPolicy.mockResolvedValue({ data: {} })
    acmeMocks.listAcmeRenewalJobs.mockResolvedValue({ data: [] })
    acmeMocks.listAcmeOrders.mockResolvedValue({ data: [] })
    acmeMocks.createAcmeAccount.mockResolvedValue({ data: { id: 'account-1' } })
    acmeMocks.createAcmeProvider.mockResolvedValue({ data: { id: 'provider-digicert' } })
    acmeMocks.updateAcmeProvider.mockResolvedValue({ data: acmeProvider })
    acmeMocks.testAcmeProvider.mockResolvedValue({ data: { reachable: true } })
    acmeMocks.createAcmeCertificate.mockResolvedValue({ data: { id: 'asset-1' } })
    acmeMocks.updateAcmeCertificate.mockResolvedValue({ data: {} })
    acmeMocks.manualRenewAcmeCertificate.mockResolvedValue({ data: {} })
    acmeMocks.deleteAcmeCertificate.mockResolvedValue({ data: {} })
    acmeMocks.scanAcmeRenewalJobs.mockResolvedValue({ data: [] })
    acmeMocks.retryAcmeRenewalJob.mockResolvedValue({ data: {} })
    certificateMocks.listCertificates.mockResolvedValue({ data: { items: [], total: 0 } })
    certificateMocks.listCertificateVersions.mockResolvedValue({ data: { items: [], total: 0 } })
    credentialMocks.createCredential.mockResolvedValue({ data: { id: 'dns-1' } })
    credentialMocks.listCredentials.mockResolvedValue({
      data: {
        items: [{
          id: 'dns-1',
          name: 'Cloudflare DNS',
          kind: 'DNS_PROVIDER',
          status: 'active',
          metadata: { providerId: 'cloudflare' },
        }],
        total: 1,
      },
    })
    securityMocks.listSecrets.mockResolvedValue({
      data: {
        items: [{
          id: 'eab-1',
          name: '已有 EAB',
          type: 'acme_eab',
          status: 'active',
          secretRef: 'secret://acme_eab/sec_eab#current',
        }],
        total: 1,
      },
    })
    securityMocks.createSecret.mockResolvedValue({
      data: { id: 'eab-2', secretRef: 'secret://acme_eab/sec_new#current' },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('默认提供 HTTP-01 申请，并传递提前续签天数且不要求 DNS 凭据', async () => {
    mount(AcmeOperationsView, { attachTo: document.body })
    await settle()
    await openCreateForm()

    const form = document.querySelector<HTMLFormElement>('.acme-page__form')
    if (!form) throw new Error('未找到 ACME 申请表单')
    expect(form.firstElementChild?.textContent).toContain('域名')
    expect(form.children[1]?.textContent).toContain('颁发机构')
    expect(form.children[2]?.textContent).toContain('证书名称')
    expect(document.body.textContent).toContain('HTTP-01')
    expect(document.body.textContent).toContain('DNS-01')
    expect(document.body.textContent).toContain('提前续签天数')
    expect(document.querySelector('.acme-page__dns-fields')).toBeNull()

    const populatedForm = fillCreateForm('example.com', 'admin@example.com', 14)
    await confirmTerms()
    populatedForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()

    expect(acmeMocks.createAcmeCertificate).toHaveBeenCalledWith(expect.objectContaining({
      domains: ['example.com'],
      contactEmail: 'admin@example.com',
      providerId: 'provider-letsencrypt',
      challengeType: 'http-01',
      dnsProvider: undefined,
      dnsCredentialId: undefined,
      dnsPropagationSeconds: undefined,
      renewalWindowDays: 14,
      termsOfServiceAgreed: true,
    }))
  })

  it('DNS-01 显示匹配的 Provider 凭据，并传递 DNS 配置', async () => {
    mount(AcmeOperationsView, { attachTo: document.body })
    await settle()
    await openCreateForm()

    const dnsRadio = document.querySelector<HTMLInputElement>('input[type="radio"][value="dns-01"]')
    if (!dnsRadio) throw new Error('未找到 DNS-01 选项')
    dnsRadio.click()
    await settle()

    const form = fillCreateForm('*.example.com, example.com', 'admin@example.com', 21)
    const dnsFields = document.querySelector<HTMLElement>('.acme-page__dns-fields')
    expect(dnsFields?.firstElementChild?.textContent).toContain('lego DNS Provider')
    expect(dnsFields?.children[1]?.textContent).toContain('DNS 传播等待秒数')
    const selects = form.querySelectorAll<HTMLSelectElement>('select')
    const dnsProviderSelect = [...selects].find((item) => [...item.options].some((option) => option.value === 'cloudflare'))
    if (!dnsProviderSelect) throw new Error('未找到 DNS Provider 选择框')
    dnsProviderSelect.value = 'cloudflare'
    dnsProviderSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    const credentialSection = document.querySelector<HTMLElement>('.gc-acme-dns-credential')
    expect(credentialSection?.classList.contains('acme-page__field--wide')).toBe(true)
    expect(document.querySelector('.gc-acme-dns-credential__content')).not.toBeNull()
    expect(document.querySelector('.gc-acme-dns-credential__controls')).not.toBeNull()
    const credentialSelect = document.querySelector<HTMLSelectElement>('.gc-acme-dns-credential select')
    if (!credentialSelect) throw new Error('未找到 DNS 凭据选择框')
    credentialSelect.value = 'dns-1'
    credentialSelect.dispatchEvent(new Event('change', { bubbles: true }))
    const propagationInput = form.querySelector<HTMLInputElement>('input[type="number"][min="0"]')
    if (!propagationInput) throw new Error('未找到 DNS 传播等待时间')
    propagationInput.value = '120'
    propagationInput.dispatchEvent(new Event('input', { bubbles: true }))

    await confirmTerms()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()

    expect(acmeMocks.createAcmeCertificate).toHaveBeenCalledWith(expect.objectContaining({
      domains: ['*.example.com', 'example.com'],
      challengeType: 'dns-01',
      dnsProvider: 'cloudflare',
      dnsCredentialId: 'dns-1',
      dnsPropagationSeconds: 120,
      renewalWindowDays: 21,
    }))
  })

  it('恢复 ACME 记录的到期、续签、任务、订单和详情关联', async () => {
    const futureDate = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString()
    certificateMocks.listCertificates.mockResolvedValue({
      data: {
        items: [{
          id: 'asset-1',
          name: '示例证书',
          primaryDomain: 'example.com',
          sans: ['www.example.com'],
          sourceType: 'acme',
          currentVersionId: 'version-1',
          status: 'active',
        }],
        total: 1,
      },
    })
    certificateMocks.listCertificateVersions.mockResolvedValue({
      data: { items: [{ id: 'version-1', certificateAssetId: 'asset-1', notAfter: futureDate }], total: 1 },
    })
    acmeMocks.listAcmeRenewalPolicies.mockResolvedValue({
      data: [{
        id: 'policy-1',
        certificateAssetId: 'asset-1',
        providerId: 'provider-letsencrypt',
        enabled: true,
        renewalWindowDays: 7,
        challengeType: 'http-01',
        maintenanceWindow: { contactEmail: 'admin@example.com', keyType: 'rsa', domains: ['example.com', 'www.example.com'] },
      }],
    })
    acmeMocks.listAcmeRenewalJobs.mockResolvedValue({
      data: [{
        id: 'job-1',
        policyId: 'policy-1',
        certificateAssetId: 'asset-1',
        acmeOrderId: 'order-1',
        status: 'failed',
        nextAttemptAt: futureDate,
        failureMessage: 'DNS validation failed',
      }],
    })
    acmeMocks.listAcmeOrders.mockResolvedValue({
      data: [{
        id: 'order-1',
        certificateAssetId: 'asset-1',
        identifiers: [{ value: 'example.com' }],
        status: 'valid',
        updatedAt: futureDate,
      }],
    })

    mount(AcmeOperationsView, { attachTo: document.body })
    await settle()

    expect(document.body.textContent).toContain('示例证书')
    expect(document.body.textContent).toContain('example.com, www.example.com')
    expect(document.body.textContent).toContain('剩余 33 天')
    expect(document.body.textContent).toContain('DNS validation failed')

    findButton('详情').click()
    await settle()
    expect(document.body.textContent).toContain('验证方式')
    expect(document.body.textContent).toContain('HTTP-01')
    expect(document.body.textContent).toContain('提前续签天数')
    expect(document.body.textContent).toContain('example.com')
    expect(document.body.textContent).toContain('DNS validation failed')
  })

  it('Provider 表单按后端 Profile 合同只提交最小配置字段', async () => {
    mount(AcmeOperationsView, { attachTo: document.body })
    await settle()

    findButton('ACME Provider 管理').click()
    await settle()
    findButton('新增 Provider').click()
    await settle()

    expect(document.body.textContent).toContain('Profile')
    expect(document.body.textContent).not.toContain('服务条款 URL')
    expect(document.body.textContent).not.toContain('允许的 Challenge')

    const form = document.querySelector<HTMLFormElement>('.acme-page__form')
    if (!form) throw new Error('未找到 Provider 表单')
    const selects = form.querySelectorAll<HTMLSelectElement>('select')
    const profileSelect = selects[0]
    if (!profileSelect) throw new Error('未找到 Profile 选择框')
    profileSelect.value = 'digicert'
    profileSelect.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()

    const inputs = form.querySelectorAll<HTMLInputElement>('input')
    const nameInput = [...inputs].find((item) => item.required && item.type !== 'url')
    const directoryInput = [...inputs].find((item) => item.type === 'url')
    const emailInput = [...inputs].find((item) => item.type === 'email')
    const eabSelect = [...form.querySelectorAll<HTMLSelectElement>('select')].find((item) =>
      [...item.options].some((option) => option.value === 'secret://acme_eab/sec_eab#current'))
    if (!nameInput || !directoryInput || !emailInput || !eabSelect) throw new Error('Provider 最小表单字段不完整')

    nameInput.value = 'DigiCert ACME'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    directoryInput.value = 'https://acme.example.digicert.com/directory'
    directoryInput.dispatchEvent(new Event('input', { bubbles: true }))
    emailInput.value = 'admin@example.com'
    emailInput.dispatchEvent(new Event('input', { bubbles: true }))
    eabSelect.value = 'secret://acme_eab/sec_eab#current'
    eabSelect.dispatchEvent(new Event('change', { bubbles: true }))

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await settle()

    expect(acmeMocks.createAcmeProvider).toHaveBeenCalledWith({
      displayName: 'DigiCert ACME',
      profileKey: 'digicert',
      directoryUrl: 'https://acme.example.digicert.com/directory',
      trustBundleSecretRef: undefined,
      isDefault: false,
    })
    expect(acmeMocks.createAcmeAccount).toHaveBeenCalledWith({
      providerId: 'provider-digicert',
      contact: ['mailto:admin@example.com'],
      termsOfServiceAgreed: true,
      eabSecretRef: 'secret://acme_eab/sec_eab#current',
    })
  })
})
