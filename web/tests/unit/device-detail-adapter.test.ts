import { describe, expect, it } from 'vitest'
import { DeviceDetailAdapterRegistry } from '@/views/devices/details/device-detail.adapter'

describe('统一设备详情证书适配', () => {
  it('从阿里云 remoteCertificate 恢复绑定证书并关联项目证书版本', () => {
    const context = new DeviceDetailAdapterRegistry().buildContext({
      certificates: [{
        id: 'certver-project',
        certificateAssetId: 'certasset-project',
        certificateVersionId: 'certver-project',
        name: '*.jacksonz.cn',
        subject: 'CN=*.jacksonz.cn',
        notAfter: '2026-10-25T06:47:55.000Z',
        fingerprintSha256: 'AA'.repeat(32),
        status: 'active',
      }],
      sites: [{
        id: 'site-1',
        siteAssetId: 'site-1',
        kind: 'cloud.resource',
        frameworkType: 'cloud.resource',
        name: 'nas-cdn.jacksonz.cn',
        bindings: [{
          id: 'binding-1',
          bindingKey: 'cloud.aliyun:cdn.domain:nas-cdn.jacksonz.cn',
          bindingType: 'CUSTOM',
          status: 'DISCOVERED',
          metadata: {
            remoteCertificate: {
              certId: '26492717',
              certName: 'cert-nas-cdn.jacksonz.cn-1786074225490',
              certDomainName: '*.jacksonz.cn',
              certStartTime: '2026-07-27T06:47:56Z',
              certExpireTime: '2026-10-25T06:47:55Z',
            },
          },
        }],
        metadata: {},
      }],
    })

    const certificate = context.sites[0]?.bindings[0]?.certificate
    expect(certificate?.name).toBe('cert-nas-cdn.jacksonz.cn-1786074225490')
    expect(certificate?.certificateAssetId).toBe('certasset-project')
    expect(certificate?.certificateVersionId).toBe('certver-project')
  })
})
