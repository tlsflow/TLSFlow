import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { createCertificateImportDraft } from '@/views/certificates/certificate-import.shared'
import CertificateFormatsView from '@/views/certificates/CertificateFormatsView.vue'
import CertificateImportForm from '@/views/certificates/CertificateImportForm.vue'
import CertificateTrustRootsModalContent from '@/views/certificates/CertificateTrustRootsModalContent.vue'
import CertificateUsagesView from '@/views/certificates/CertificateUsagesView.vue'

const certificateMocks = vi.hoisted(() => ({
  createCertificateFormat: vi.fn(),
  getCertificateTrustRootDetail: vi.fn(),
  getCertificateVersionDetail: vi.fn(),
  listCertificateFormats: vi.fn(),
  listCertificateTrustRoots: vi.fn(),
  listCertificateUsages: vi.fn(),
}))
const credentialMocks = vi.hoisted(() => ({
  createCredential: vi.fn(),
  listCredentials: vi.fn(),
}))
const acmeMocks = vi.hoisted(() => ({
  createAcmeCertificate: vi.fn(),
  getAcmeStatus: vi.fn(),
  listAcmeDnsProviders: vi.fn(),
  listAcmeProviders: vi.fn(),
}))

const routeState = vi.hoisted(() => ({ params: { id: 'certificate-1' }, query: {} }))

vi.mock('@/api/modules/certificates.api', () => certificateMocks)
vi.mock('@/api/modules/credentials.api', () => credentialMocks)
vi.mock('@/api/modules/internal-ca.api', () => ({ internalCaApi: acmeMocks }))
vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
  useRoute: () => routeState,
}))

function page(items: readonly Record<string, unknown>[]) {
  return { data: { items, page: 1, pageSize: 100, total: items.length } }
}

async function settle() {
  await flushPromises()
  await flushPromises()
}

describe('证书辅助页面', () => {
  beforeEach(() => {
    certificateMocks.createCertificateFormat.mockResolvedValue({ data: {} })
    certificateMocks.getCertificateTrustRootDetail.mockResolvedValue({ data: null })
    certificateMocks.getCertificateVersionDetail.mockResolvedValue({ data: null })
    certificateMocks.listCertificateFormats.mockResolvedValue(page([]))
    certificateMocks.listCertificateTrustRoots.mockResolvedValue(page([]))
    certificateMocks.listCertificateUsages.mockResolvedValue(page([]))
    acmeMocks.createAcmeCertificate.mockResolvedValue({ data: {} })
    acmeMocks.getAcmeStatus.mockResolvedValue({ data: { status: 'READY', provider: { id: 'provider-letsencrypt', name: 'Let’s Encrypt' } } })
    acmeMocks.listAcmeDnsProviders.mockResolvedValue({
      data: [{ id: 'cloudflare', name: 'Cloudflare', credentialTemplate: 'CLOUDFLARE_DNS_API_TOKEN=...' }],
    })
    acmeMocks.listAcmeProviders.mockResolvedValue({
      data: {
        items: [{
          id: 'provider-letsencrypt',
          name: 'Let’s Encrypt',
          type: 'acme',
          status: 'active',
          configuration: { isDefault: true },
        }],
      },
    })
    credentialMocks.createCredential.mockResolvedValue({ data: { id: 'dns-credential-1' } })
    credentialMocks.listCredentials.mockResolvedValue({
      data: {
        items: [{
          id: 'dns-credential-1',
          name: 'Cloudflare DNS',
          kind: 'DNS_PROVIDER',
          scopeType: 'global',
          status: 'active',
          version: 1,
          updatedAt: '2026-08-12T00:00:00.000Z',
          metadata: { providerId: 'cloudflare' },
        }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('格式配置页使用共享表单/表格，并把创建时间转换为浏览器本地时间', async () => {
    const createdAt = '2026-08-11T01:02:03.000Z'
    certificateMocks.listCertificateFormats.mockResolvedValue(page([{
      id: 'format-1',
      format: 'pem',
      status: 'READY',
      createdAt,
    }]))

    const wrapper = mount(CertificateFormatsView, {
      attachTo: document.body,
    })
    await settle()

    expect(wrapper.find('.certificate-formats__form-card.gc-pro-card').exists()).toBe(true)
    expect(wrapper.find('.gc-data-table.gc-data-table--dense').exists()).toBe(true)
    expect(wrapper.text()).toContain(formatBrowserLocalTime(createdAt))
    expect(wrapper.find('.gc-tag--success').exists()).toBe(true)
  })

  it('使用关系页保留表格空态和状态，并把更新时间转换为浏览器本地时间', async () => {
    const updatedAt = '2026-08-11T04:05:06.000Z'
    certificateMocks.listCertificateUsages.mockResolvedValue(page([{
      id: 'usage-1',
      domainName: 'example.com',
      resourceType: 'binding',
      resourceId: 'binding-1',
      status: 'ACTIVE',
      updatedAt,
    }]))

    const wrapper = mount(CertificateUsagesView, {
      attachTo: document.body,
    })
    await settle()

    expect(wrapper.find('.gc-data-table.gc-data-table--dense').exists()).toBe(true)
    expect(wrapper.text()).toContain('example.com')
    expect(wrapper.text()).toContain(formatBrowserLocalTime(updatedAt))
    expect(wrapper.find('.gc-tag--success').exists()).toBe(true)
  })

  it('导入表单从来源选择进入手工导入、校验审阅，并使用本地有效期时间', async () => {
    const draft = reactive(createCertificateImportDraft())
    const wrapper = mount(CertificateImportForm, {
      props: { draft },
    })

    expect(wrapper.findAll('.certificate-import-wizard__steps li')).toHaveLength(4)
    expect(wrapper.findAll('.certificate-import-wizard__source-card')).toHaveLength(2)
    expect(wrapper.find('.certificate-import-wizard__steps li.is-active')?.text()).toContain('添加方式')

    await wrapper.findAll('.certificate-import-wizard__source-card')[0]?.trigger('click')
    expect(wrapper.findAll('.gc-selection-card')).toHaveLength(4)
    expect(wrapper.find('.certificate-import-wizard__steps li.is-active')?.text()).toContain('格式与方式')

    const nextButton = () => wrapper.find('.certificate-import-wizard__footer-right .gc-button--primary')
    await nextButton().trigger('click')
    expect(wrapper.find('.certificate-import-wizard__material-card.gc-pro-card').exists()).toBe(true)

    draft.certificatePem = 'certificate'
    draft.privateKeyPem = 'private-key'
    await flushPromises()
    await nextButton().trigger('click')
    expect(wrapper.find('.certificate-import-wizard__panel--validation').exists()).toBe(true)

    const notBefore = '2026-08-11T01:02:03.000Z'
    const notAfter = '2027-08-11T01:02:03.000Z'
    await wrapper.setProps({
      validationResult: {
        sourceFormat: 'pem',
        importable: true,
        blockers: [],
        warnings: [],
        certificate: {
          commonName: 'example.com',
          sans: ['example.com'],
          issuer: { commonName: 'Example CA' },
          subject: { commonName: 'example.com' },
          serialNumber: 'serial-1',
          notBefore,
          notAfter,
          fingerprintSha256: 'fingerprint-1',
          publicKeyAlgorithm: 'RSA',
          signatureAlgorithm: 'SHA256-RSA',
        },
        privateKey: { provided: true, matched: true, source: 'input' },
        chain: { status: 'complete', order: [], diagnostics: [], certificateCount: 1, certificates: [] },
      },
    })
    await settle()

    expect(wrapper.text()).toContain(formatBrowserLocalTime(notBefore))
    expect(wrapper.text()).toContain(formatBrowserLocalTime(notAfter))
    expect(wrapper.find('.gc-tag--success').exists()).toBe(true)
  })

  it('ACME 来源打开统一申请弹层，并提供 HTTP-01、DNS-01 与提前续签字段', async () => {
    const draft = reactive(createCertificateImportDraft())
    const wrapper = mount(CertificateImportForm, {
      props: { draft },
      attachTo: document.body,
    })
    await settle()

    await wrapper.findAll('.certificate-import-wizard__source-card')[1]?.trigger('click')
    await settle()

    expect(wrapper.find('.certificate-import-wizard__panel--acme').exists()).toBe(false)
    expect(document.querySelector('.acme-page__form')).not.toBeNull()
    expect(document.body.textContent).toContain('HTTP-01')
    expect(document.body.textContent).toContain('DNS-01')
    expect(document.body.textContent).toContain('提前续签天数')
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Directory URL')
    expect(wrapper.text()).not.toContain('SecretRef')
  })

  it('ACME 来源不再渲染旧申请面板', async () => {
    acmeMocks.getAcmeStatus.mockResolvedValue({ data: { status: 'BLOCKED' } })
    const draft = reactive(createCertificateImportDraft())
    const wrapper = mount(CertificateImportForm, { props: { draft } })
    await settle()

    await wrapper.findAll('.certificate-import-wizard__source-card')[1]?.trigger('click')
    await settle()

    expect(wrapper.find('.certificate-import-wizard__panel--acme form').exists()).toBe(false)
    expect(acmeMocks.createAcmeCertificate).not.toHaveBeenCalled()
  })

  it('根证书弹层保留空态，并在有数据时展示统一详情状态和本地时间', async () => {
    const observedAt = '2026-08-11T07:08:09.000Z'
    certificateMocks.listCertificateTrustRoots.mockResolvedValue({
      data: {
        items: [{ id: 'root-1', fingerprintSha256: 'aa', subject: { commonName: 'Example Root' } }],
        managedSummary: { items: [] },
      },
    })
    certificateMocks.getCertificateTrustRootDetail.mockResolvedValue({
      data: {
        id: 'root-1',
        validationStatus: 'verified',
        serialNumber: 'serial-root-1',
        subject: { commonName: 'Example Root' },
        issuer: { commonName: 'Example Root' },
        notBefore: '2025-08-11T07:08:09.000Z',
        notAfter: '2030-08-11T07:08:09.000Z',
        observations: [{ id: 'observation-1', sourceType: 'manual', status: 'accepted', observedAt, observedFingerprint: 'aa' }],
      },
    })

    const wrapper = mount(CertificateTrustRootsModalContent, {
      props: { open: true },
      attachTo: document.body,
    })
    await settle()

    expect(wrapper.find('.trust-roots-modal__summary-card.gc-pro-card').exists()).toBe(true)
    expect(wrapper.find('.trust-roots-modal__item.gc-selection-card--selected').exists()).toBe(true)
    expect(wrapper.text()).toContain('Example Root')
    expect(wrapper.text()).toContain(formatBrowserLocalTime(observedAt))
    expect(wrapper.find('.gc-tag--success').exists()).toBe(true)
  })

  it('根证书刷新期间保留已有指标卡尺寸和内容', async () => {
    const response = {
      data: {
        items: [{ id: 'root-1', fingerprintSha256: 'aa', subject: { commonName: 'Example Root' } }],
        managedSummary: { items: [] },
      },
    }
    let resolveRefresh!: (value: typeof response) => void
    certificateMocks.listCertificateTrustRoots
      .mockResolvedValueOnce(response)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve
      }))

    const wrapper = mount(CertificateTrustRootsModalContent, {
      props: { open: true },
      attachTo: document.body,
    })
    await settle()

    expect(wrapper.findAll('.trust-roots-modal__summary-card')).toHaveLength(4)
    await wrapper.find('.trust-roots-modal__toolbar .gc-button').trigger('click')
    await flushPromises()

    expect(wrapper.find('.trust-roots-modal__state').exists()).toBe(false)
    expect(wrapper.findAll('.trust-roots-modal__summary-card')).toHaveLength(4)

    resolveRefresh(response)
    await settle()
  })
})
