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
        certificateAssetId: 'cert-1',
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
    expect(wrapper.findAll('select')).toHaveLength(1)
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('__LATEST__')
    expect([...wrapper.find('select').findAll('option')].map((option) => (option.element as HTMLOptionElement).value)).toEqual([
      '__LATEST__',
      'version-new',
      'version-old',
    ])
    expect(wrapper.find('select').findAll('option')[1]?.text()).toContain('version-new (2098-01-01 ~ 2099-01-01)')

    await wrapper.setProps({ certificateAssetId: 'cert-2' })
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('__LATEST__')
    expect(wrapper.find('select').findAll('option').map((option) => (option.element as HTMLOptionElement).value)).toEqual([
      '__LATEST__',
      'version-target',
    ])
    await wrapper.find('select').setValue('version-target')
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
        certificateAssetId: 'cert-1',
        certificateVersions: [{
          id: 'version-new',
          certificateAssetId: 'cert-1',
          status: 'active',
          deployable: true,
          notAfter: '2099-01-01T00:00:00.000Z',
        }],
      },
    })

    await wrapper.find('select').setValue('__LATEST__')
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
        certificateAssetId: 'cert-1',
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

  it('专属 ACME 模式显示证书状态并提交当前固定版本', async () => {
    const wrapper = mount(GcCertificateDeploymentForm, {
      global: { plugins: [i18n] },
      props: {
        applicationAsset: { id: 'asset-1', displayName: '支付网关' },
        siteName: '生产站点',
        certificate: { id: 'cert-1', primaryDomain: 'pay.example.com' },
        certificateAssetId: 'cert-1',
        certificateVersions: [{ id: 'version-1', certificateAssetId: 'cert-1', deployable: true, notAfter: '2099-01-01T00:00:00.000Z' }],
        supplyMode: 'dedicated',
        dedicatedDetails: {
          providerType: 'acme',
          hasCertificate: true,
          issuedAt: '2098-01-01T00:00:00.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          remainingDays: 100,
          certificateVersionId: 'version-1',
        },
      },
    })

    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.text()).toContain('ACME')
    expect(wrapper.text()).toContain('已存在')
    expect(wrapper.text()).toContain('100 天')
    expect(wrapper.find('button[type="submit"]').text()).toContain('部署此证书版本')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([[
      { certificateAssetId: 'cert-1', selectionMode: 'EXPLICIT', certificateVersionId: 'version-1' },
    ]])
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.find('button[type="submit"]').text()).toContain('重新申请证书')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')?.[1]).toEqual([{
      certificateAssetId: 'cert-1', selectionMode: 'EXPLICIT', certificateVersionId: 'version-1', reapply: true,
    }])
  })

  it('专属内部 CA 模式显示 CA 状态和私钥管理方式', async () => {
    const wrapper = mount(GcCertificateDeploymentForm, {
      global: { plugins: [i18n] },
      props: {
        applicationAsset: { id: 'asset-1', displayName: '支付网关' },
        certificate: null,
        certificateVersions: [],
        supplyMode: 'dedicated',
        dedicatedDetails: {
          providerType: 'internal_ca',
          providerName: '企业根 CA',
          providerStatus: 'active',
          custodyMode: 'managed_secret',
          hasCertificate: false,
        },
      },
    })

    expect(wrapper.findAll('select')).toHaveLength(0)
    expect(wrapper.text()).toContain('企业根 CA')
    expect(wrapper.text()).toContain('可用')
    expect(wrapper.text()).toContain('平台托管')
    expect(wrapper.text()).toContain('尚未签发')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true)
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('专属证书签发失败时显示失败原因并允许重新发起签发', async () => {
    const wrapper = mount(GcCertificateDeploymentForm, {
      global: { plugins: [i18n] },
      props: {
        applicationAsset: { id: 'asset-1', displayName: '支付网关' },
        certificate: null,
        certificateVersions: [],
        supplyMode: 'dedicated',
        dedicatedDetails: {
          providerType: 'internal_ca',
          providerName: '企业根 CA',
          providerStatus: 'active',
          custodyMode: 'managed_secret',
          hasCertificate: false,
          issuanceStatus: 'issue_failed',
          issuanceFailureCode: 'TASK_EXECUTOR_THROWN',
          issuanceFailureMessage: 'CA Provider 返回错误',
        },
      },
    })

    expect(wrapper.text()).toContain('签发失败')
    expect(wrapper.text()).toContain('CA Provider 返回错误')
    expect(wrapper.text()).toContain('TASK_EXECUTOR_THROWN')
    expect(wrapper.text()).not.toContain('专属证书申请已提交')
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toEqual([[
      { certificateAssetId: '', selectionMode: 'EXPLICIT', certificateVersionId: '', reapply: true },
    ]])
  })
})
