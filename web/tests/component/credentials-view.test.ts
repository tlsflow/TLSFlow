import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { i18n } from '@/i18n'

const credentialMocks = vi.hoisted(() => ({
  acquireBrowserCredentialSession: vi.fn(),
  cancelBrowserCredentialSession: vi.fn(),
  createBrowserCredentialSession: vi.fn(),
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  getBrowserCredentialSession: vi.fn(),
  getCredential: vi.fn(),
  getCredentialUsage: vi.fn(),
  listCredentials: vi.fn(),
  updateCredential: vi.fn(),
  updateCredentialStatus: vi.fn(),
}))

const internalCaMocks = vi.hoisted(() => ({
  listAcmeDnsProviders: vi.fn(),
}))

vi.mock('@/api/modules/credentials.api', () => credentialMocks)
vi.mock('@/api/modules/plugins.api', () => ({ listPluginCatalog: vi.fn() }))
vi.mock('@/api/modules/internal-ca.api', () => ({ internalCaApi: internalCaMocks }))

import CredentialsView from '@/views/settings/CredentialsView.vue'

describe('CredentialsView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
    credentialMocks.listCredentials.mockResolvedValue({
      data: {
        items: [
          { id: 'dns-1', name: 'Cloudflare DNS', kind: 'DNS_PROVIDER', scopeType: 'global', status: 'active', version: 1, updatedAt: '2026-08-14T00:00:00.000Z' },
          { id: 'cloud-1', name: '阿里云', kind: 'CLOUD_PROVIDER', scopeType: 'global', status: 'active', version: 1, updatedAt: '2026-08-14T00:00:00.000Z' },
        ],
        page: 1,
        pageSize: 20,
        total: 2,
      },
    })
    internalCaMocks.listAcmeDnsProviders.mockResolvedValue({ data: [{ id: 'cloudflare', name: 'Cloudflare' }] })
    credentialMocks.createCredential.mockResolvedValue({ data: { id: 'dns-2' } })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('显示 DNS/云 Provider 类型，并为通用 DNS 凭据保存 Provider 元数据', async () => {
    mount(CredentialsView, { attachTo: document.body, global: { plugins: [i18n] } })
    await flushPromises()

    expect(document.body.textContent).toContain('DNS Provider 凭据')
    expect(document.body.textContent).toContain('云 Provider 凭据')

    const createButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '新建凭据')
    expect(createButton).toBeTruthy()
    createButton?.click()
    await flushPromises()

    const kindSelect = document.querySelector<HTMLSelectElement>('.credentials-editor select')
    expect(kindSelect).toBeTruthy()
    kindSelect!.value = 'DNS_PROVIDER'
    kindSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    await flushPromises()

    expect(internalCaMocks.listAcmeDnsProviders).toHaveBeenCalledTimes(1)
    const selects = [...document.querySelectorAll<HTMLSelectElement>('.credentials-editor select')]
    const dnsProviderSelect = selects.find((select) => [...select.options].some((option) => option.value === 'cloudflare'))
    expect(dnsProviderSelect).toBeTruthy()
    dnsProviderSelect!.value = 'cloudflare'
    dnsProviderSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    const nameInput = document.querySelector<HTMLInputElement>('.credentials-editor input')
    expect(nameInput).toBeTruthy()
    nameInput!.value = 'Cloudflare DNS'
    nameInput!.dispatchEvent(new Event('input', { bubbles: true }))
    const config = document.querySelector<HTMLTextAreaElement>('.credentials-dns-config textarea')
    expect(config).toBeTruthy()
    config!.value = 'CLOUDFLARE_DNS_API_TOKEN=test-token'
    config!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    const saveButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '保存')
    expect(saveButton).toBeTruthy()
    saveButton?.click()
    await flushPromises()

    expect(credentialMocks.createCredential).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'DNS_PROVIDER',
      scopeType: 'global',
      metadata: { providerId: 'cloudflare' },
      secretValues: { config: { plainText: 'CLOUDFLARE_DNS_API_TOKEN=test-token' } },
    }))
  })

  it('按全部使用关系展示影响范围', async () => {
    credentialMocks.getCredential.mockResolvedValue({
      data: {
        id: 'dns-1',
        name: 'Cloudflare DNS',
        kind: 'DNS_PROVIDER',
        scopeType: 'global',
        status: 'active',
        version: 1,
        updatedAt: '2026-08-14T00:00:00.000Z',
        createdAt: '2026-08-14T00:00:00.000Z',
        secretSlots: { config: 'secret://password/sec_dns#current' },
        metadata: { providerId: 'cloudflare' },
      },
    })
    credentialMocks.getCredentialUsage.mockResolvedValue({
      data: {
        credentialId: 'dns-1',
        total: 3,
        items: [
          { type: 'ACME_RENEWAL_POLICY', id: 'policy-1', name: 'example.com' },
          { type: 'CLOUD_ACCOUNT_ASSET', id: 'cloud-asset-1', name: '阿里云生产账号' },
          { type: 'BROWSER_CREDENTIAL_SESSION', id: 'session-1', name: 'https://login.example.test' },
        ],
      },
    })

    mount(CredentialsView, { attachTo: document.body, global: { plugins: [i18n] } })
    await flushPromises()

    const editButton = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === '编辑')
    expect(editButton).toBeTruthy()
    editButton?.click()
    await flushPromises()

    expect(document.body.textContent).toContain('ACME 证书（1）')
    expect(document.body.textContent).toContain('云账号资产（1）')
    expect(document.body.textContent).toContain('浏览器获取会话（1）')
    expect(document.body.textContent).toContain('example.com')
    expect(document.body.textContent).toContain('阿里云生产账号')
    expect(document.body.textContent).toContain('https://login.example.test')
    expect(document.body.textContent).not.toContain('设备（0）')
    expect(document.body.textContent).not.toContain('工作流（0）')
    expect(document.body.textContent).not.toContain('插件绑定（0）')
  })
})
