import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import DeviceSiteCard from '@/views/devices/details/cards/DeviceSiteCard.vue'

describe('站点证书卡', () => {
  it('只展示配置实际绑定的证书，不渲染旧接口残留的识别证书', () => {
    const wrapper = mount(DeviceSiteCard, {
      props: {
        site: {
          id: 'site-1',
          siteAssetId: 'site-asset-1',
          kind: 'web.site',
          frameworkType: 'web.nginx',
          name: 'nginx.example.test',
          endpoint: { address: '10.0.0.10', port: 8443, protocol: 'HTTPS', hostName: 'nginx.example.test' },
          bindings: [{
            id: 'binding-1',
            bindingKey: 'nginx-8443',
            bindingType: 'PEM_FILES',
            status: 'ACTIVE',
            certificate: { name: 'configured.example.test', subject: 'CN=configured.example.test' },
            // 模拟历史接口仍返回的字段。新的详情模型和组件都必须忽略它。
            observedCertificate: { name: 'wrong-default.example.test', subject: 'CN=wrong-default.example.test' },
            driftStatus: 'DRIFTED',
            replacement: { allowed: false },
          }],
          metadata: {},
        } as never,
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.findAll('.agent-detail-modal__certificate-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('configured.example.test')
    expect(wrapper.text()).not.toContain('wrong-default.example.test')
  })
})
