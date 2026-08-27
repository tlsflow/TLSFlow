import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CertificateDetailPanel from '@/views/certificates/CertificateDetailPanel.vue'

describe('CertificateDetailPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url)

      if (target.includes('/certificate-assets/detail')) {
        return new Response(JSON.stringify({
          data: {
            id: 'asset-jacksonz',
            name: '*.jacksonz.cn',
            primaryDomain: '*.jacksonz.cn',
          },
        }), { status: 200 })
      }

      if (target.includes('/certificate-versions/detail')) {
        return new Response(JSON.stringify({
          data: {
            id: 'ver-jacksonz',
            certificateAssetId: 'asset-jacksonz',
            commonName: '*.jacksonz.cn',
            notBefore: '2026-06-09T10:18:39.000Z',
            notAfter: '2026-09-07T10:18:38.000Z',
            fingerprintSha256: '22'.repeat(32),
            chainStatus: 'complete',
            sans: ['*.jacksonz.cn', 'jacksonz.cn'],
            subject: { commonName: '*.jacksonz.cn' },
            issuer: { commonName: 'Let\'s Encrypt' },
            chainCertificates: [],
          },
        }), { status: 200 })
      }

      if (target.includes('/certificate-versions/usage')) {
        return new Response(JSON.stringify({
          data: {
            usages: [
              {
                binding: {
                  id: 'binding-test-jacksonz',
                  certificateVersionId: 'ver-jacksonz',
                  domainName: 'test.jacksonz.cn',
                  bindingType: 'WINDOWS_CERT_STORE',
                  status: 'DISCOVERED',
                },
                siteAsset: {
                  id: 'site-asset-test-jacksonz',
                  siteName: 'Default Web Site',
                  hostHeader: 'test.jacksonz.cn',
                  port: 443,
                  protocol: 'HTTPS',
                  agentId: 'agent-jacksonz-01',
                  status: 'ACTIVE',
                },
                managedTarget: {
                  id: 'target-test-jacksonz',
                  agentId: 'agent-jacksonz-01',
                  targetKey: 'agent-jacksonz-01:site-binding:default web site:443:test.jacksonz.cn',
                  bindingKey: 'https/*:443:test.jacksonz.cn',
                  status: 'ACTIVE',
                },
                serviceAsset: {
                  id: 'service-asset-test-jacksonz',
                  address: 'test.jacksonz.cn',
                  displayName: '测试应用',
                  port: 443,
                  protocol: 'HTTPS',
                  status: 'ACTIVE',
                },
                service: {
                  id: 'service-test-jacksonz',
                  displayName: 'test.jacksonz.cn',
                  providerType: 'IIS',
                  status: 'ACTIVE',
                },
                host: {
                  id: 'host-test-jacksonz',
                  hostname: 'win-web-01',
                  displayName: 'Win Web 01',
                  agentId: 'agent-jacksonz-01',
                  primaryIp: '10.0.0.12',
                  status: 'ACTIVE',
                },
              },
              {
                binding: {
                  id: 'binding-stale-jacksonz',
                  domainName: 'stale.jacksonz.cn',
                  bindingType: 'WINDOWS_CERT_STORE',
                  status: 'DISCOVERED',
                },
                service: {
                  id: 'service-stale-jacksonz',
                  displayName: 'stale.jacksonz.cn',
                  providerType: 'IIS',
                  status: 'ACTIVE',
                },
              },
              {
                binding: {
                  id: 'binding-other-version-jacksonz',
                  certificateVersionId: 'ver-other-jacksonz',
                  domainName: 'test.jacksonz.cn',
                  bindingType: 'WINDOWS_CERT_STORE',
                  status: 'DISCOVERED',
                },
                siteAsset: {
                  id: 'site-asset-test-jacksonz',
                  siteName: 'Default Web Site',
                  hostHeader: 'test.jacksonz.cn',
                  port: 443,
                  protocol: 'HTTPS',
                  agentId: 'agent-jacksonz-01',
                  status: 'ACTIVE',
                },
                serviceAsset: {
                  id: 'service-asset-other-version-jacksonz',
                  address: 'test.jacksonz.cn',
                  port: 443,
                  protocol: 'HTTPS',
                  status: 'ACTIVE',
                },
                service: {
                  id: 'service-other-version-jacksonz',
                  displayName: 'test.jacksonz.cn',
                  providerType: 'IIS',
                  status: 'ACTIVE',
                },
              },
              {
                binding: {
                  id: 'binding-fallback-jacksonz',
                  certificateVersionId: 'ver-jacksonz',
                  domainName: 'fallback.jacksonz.cn',
                  bindingType: 'WINDOWS_CERT_STORE',
                  status: 'DISCOVERED',
                },
                serviceAsset: {
                  id: 'service-asset-fallback-jacksonz',
                  address: 'fallback.jacksonz.cn',
                  port: 443,
                  protocol: 'HTTPS',
                  status: 'ACTIVE',
                },
                service: {
                  id: 'service-fallback-jacksonz',
                  displayName: 'IIS',
                  providerType: 'IIS',
                  status: 'ACTIVE',
                },
              },
            ],
          },
        }), { status: 200 })
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('能把后端返回的嵌套 usage 结构渲染成关联资产表格', async () => {
    const wrapper = mount(CertificateDetailPanel, {
      attachTo: document.body,
      props: {
        assetId: 'asset-jacksonz',
        versionId: 'ver-jacksonz',
      },
    })

    await flushPromises()
    await flushPromises()

    const usageTab = wrapper.findAll('button').find((button) => button.text() === '关联资产')
    expect(usageTab).toBeTruthy()
    await usageTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('测试应用')
    expect(wrapper.text()).toContain('fallback.jacksonz.cn')
    expect(wrapper.text()).toContain('Win Web 01')
    expect(wrapper.text()).toContain('IIS')
    expect(wrapper.text()).toContain('Default Web Site')
    expect(wrapper.text()).toContain('WINDOWS_CERT_STORE')
    expect(wrapper.text()).toContain('平台绑定记录')
    expect(wrapper.text()).toContain('DISCOVERED')
    expect(wrapper.text()).not.toContain('stale.jacksonz.cn')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('暂无关联资产')
  })
})
