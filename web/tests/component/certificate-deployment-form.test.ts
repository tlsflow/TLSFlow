import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import GcCertificateDeploymentForm from '@/design-system/components/GcCertificateDeploymentForm.vue'

describe('GcCertificateDeploymentForm', () => {
  it('锁定资产上下文并默认选择自动应用最新版本指针', async () => {
    const wrapper = mount(GcCertificateDeploymentForm, {
      global: { plugins: [i18n] },
      props: {
        applicationAsset: {
          id: 'asset-1',
          displayName: '支付网关',
          address: 'pay.example.com',
          port: 443,
          protocol: 'HTTPS',
        },
        siteName: '生产站点',
        certificate: { id: 'cert-1', primaryDomain: '*.example.com' },
        certificates: [
          { id: 'cert-1', name: '当前证书', primaryDomain: '*.example.com' },
          { id: 'cert-2', name: '目标证书', primaryDomain: '*.example.com' },
        ],
        certificateVersions: [
          {
            id: 'version-old',
            certificateAssetId: 'cert-1',
            status: 'active',
            deployable: true,
            notBefore: '2089-01-01T00:00:00.000Z',
            notAfter: '2090-01-01T00:00:00.000Z',
          },
          {
            id: 'version-new',
            certificateAssetId: 'cert-1',
            status: 'active',
            deployable: true,
            notBefore: '2098-01-01T00:00:00.000Z',
            notAfter: '2099-01-01T00:00:00.000Z',
          },
          {
            id: 'version-target',
            certificateAssetId: 'cert-2',
            status: 'active',
            deployable: true,
            notBefore: '2097-01-01T00:00:00.000Z',
            notAfter: '2098-01-01T00:00:00.000Z',
          },
        ],
      },
    })

    expect(wrapper.text()).toContain('支付网关')
    expect(wrapper.text()).toContain('生产站点')
    expect(wrapper.text()).toContain('*.example.com')
    expect((wrapper.findAll('select')[0]!.element as HTMLSelectElement).value).toBe('cert-1')
    expect((wrapper.findAll('select')[1]!.element as HTMLSelectElement).value).toBe('__LATEST__')
    expect([...wrapper.findAll('select')[1]!.findAll('option')].map((option) => (option.element as HTMLOptionElement).value)).toEqual([
      '__LATEST__',
      'version-new',
      'version-old',
    ])
    expect(wrapper.findAll('select')[1]!.findAll('option')[1]?.text()).toContain('version-new (2098-01-01 ~ 2099-01-01)')

    await wrapper.findAll('select')[0]!.setValue('cert-2')
    expect((wrapper.findAll('select')[1]!.element as HTMLSelectElement).value).toBe('__LATEST__')
    expect(wrapper.findAll('select')[1]!.findAll('option').map((option) => (option.element as HTMLOptionElement).value)).toEqual([
      '__LATEST__',
      'version-target',
    ])
    await wrapper.findAll('select')[1]!.setValue('version-target')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([[
      { certificateAssetId: 'cert-2', selectionMode: 'EXPLICIT', certificateVersionId: 'version-target' },
    ]])
  })

  it('选择最新版本指针时提交 LATEST_AUTO 和最新版本种子', async () => {
    const wrapper = mount(GcCertificateDeploymentForm, {
      global: { plugins: [i18n] },
      props: {
        applicationAsset: { id: 'asset-1', displayName: '支付网关' },
        siteName: '生产站点',
        certificate: { id: 'cert-1', primaryDomain: '*.example.com' },
        certificates: [{ id: 'cert-1', name: '当前证书', primaryDomain: '*.example.com' }],
        certificateVersions: [{
          id: 'version-new',
          certificateAssetId: 'cert-1',
          status: 'active',
          deployable: true,
          notAfter: '2099-01-01T00:00:00.000Z',
        }],
      },
    })

    await wrapper.findAll('select')[1]!.setValue('__LATEST__')
    expect(wrapper.text()).toContain('自动应用当前证书的最新版本')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([[
      { certificateAssetId: 'cert-1', selectionMode: 'LATEST_AUTO', certificateVersionId: 'version-new' },
    ]])
  })

  it('展示预检失败项的详情和检查证据', () => {
    const wrapper = mount(GcCertificateDeploymentForm, {
      global: { plugins: [i18n] },
      props: {
        applicationAsset: { id: 'asset-1', displayName: '支付网关' },
        siteName: '生产站点',
        certificate: { id: 'cert-1', primaryDomain: '*.example.com' },
        certificateVersions: [],
        preflightChecks: [{
          key: 'deployment_input_snapshot:target-1',
          label: '部署输入快照',
          status: 'failed',
          detail: '部署输入快照已过期，请重新创建部署计划。',
          evidence: { deploymentPlanTargetId: 'target-1', errorCode: 'RESOURCE_NOT_FOUND' },
        }],
      },
    })

    expect(wrapper.text()).toContain('部署输入快照')
    expect(wrapper.text()).toContain('失败')
    expect(wrapper.text()).toContain('部署输入快照已过期，请重新创建部署计划。')
    expect(wrapper.get('summary').text()).toBe('检查证据')
    expect(wrapper.get('pre').text()).toContain('"errorCode": "RESOURCE_NOT_FOUND"')
  })
})
