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

const routeState = vi.hoisted(() => ({ params: { id: 'certificate-1' }, query: {} }))

vi.mock('@/api/modules/certificates.api', () => certificateMocks)
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

  it('导入表单保留三步流转，并使用选择卡、状态标签和本地有效期时间', async () => {
    const draft = reactive(createCertificateImportDraft())
    const wrapper = mount(CertificateImportForm, {
      props: { draft },
    })

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
})
