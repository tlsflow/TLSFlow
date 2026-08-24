import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GcDeploymentWizard from '@/design-system/components/GcDeploymentWizard.vue'

describe('GcDeploymentWizard 部署计划选择', () => {
  it('部署计划只选择证书版本和应用资产，不再选择证书产物配置', async () => {
    const wrapper = mount(GcDeploymentWizard, {
      props: {
        certificates: [
          { id: 'cert-1', primaryDomain: 'example.com' },
        ],
        certificateVersions: [
          {
            id: 'certver-1',
            certificateAssetId: 'cert-1',
            notBefore: '2026-06-01T00:00:00.000Z',
            notAfter: '2026-12-01T00:00:00.000Z',
          },
        ],
        certificateFormats: [
          {
            id: 'fmt-nginx',
            certificateVersionId: 'certver-1',
            format: 'pem',
            containsPrivateKey: false,
            parameters: {
              systemPlatform: 'linux',
              runtimePlatform: 'nginx',
              configName: 'Linux-NGINX-PEM',
              extension: 'pem',
              generatePrivateKeyFile: true,
            },
          },
          {
            id: 'fmt-iis',
            format: 'pfx',
            containsPrivateKey: true,
            parameters: {
              systemPlatform: 'windows',
              runtimePlatform: 'iis',
              configName: 'Windows-IIS-PFX',
              extension: 'pfx',
            },
          },
        ],
        targets: [
          {
            id: 'target-1',
            applicationAssetId: 'asset-1',
            name: 'test.local',
            siteName: 'TEST02.jacksonz.cn',
            bindingSummary: '*:443:test.local',
          },
        ],
      },
    })

    expect(wrapper.text()).not.toContain('证书产物配置')
    expect(wrapper.text()).not.toContain('Linux-NGINX-PEM')
    expect(wrapper.text()).not.toContain('Windows-IIS-PFX')
    expect(wrapper.text()).toContain('部署向导')
    expect(wrapper.text()).toContain('步骤 1 / 3')
    expect(wrapper.text()).toContain('1. 证书材料')
    expect(wrapper.text()).not.toContain('3. 预检与提交')

    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    expect(wrapper.text()).toContain('2. 部署目标')

    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    expect(wrapper.text()).toContain('3. 预检与提交')

    await wrapper.findAll('button').find((button) => button.text() === '保存计划')!.trigger('click')
    const emitted = wrapper.emitted('save')
    expect(emitted).toBeTruthy()
    expect(emitted?.[0]?.[0]).toMatchObject({
      applicationAssetId: 'asset-1',
      targetIds: ['target-1'],
    })
    expect(emitted?.[0]?.[0]).not.toHaveProperty('certificateFormatId')
  })

  it('证书资产按域名去重，版本下拉展示同域名下的多个证书版本', async () => {
    const wrapper = mount(GcDeploymentWizard, {
      props: {
        certificates: [
          { id: 'cert-1', primaryDomain: '*.jacksonz.cn' },
          { id: 'cert-2', primaryDomain: '*.jacksonz.cn' },
        ],
        certificateVersions: [
          {
            id: 'certver-old',
            certificateAssetId: 'cert-1',
            notBefore: '2026-01-01T00:00:00.000Z',
            notAfter: '2026-04-01T00:00:00.000Z',
          },
          {
            id: 'certver-new',
            certificateAssetId: 'cert-2',
            notBefore: '2026-06-09T00:00:00.000Z',
            notAfter: '2026-09-07T00:00:00.000Z',
          },
        ],
        certificateFormats: [
          {
            id: 'fmt-new',
            certificateVersionId: 'certver-new',
            format: 'pfx',
            containsPrivateKey: true,
            parameters: { configName: 'Windows-IIS-PFX' },
          },
        ],
        targets: [
          {
            id: 'target-1',
            applicationAssetId: 'asset-1',
            name: 'test.local',
            siteName: 'TEST02.jacksonz.cn',
            bindingSummary: '*:443:test.local',
          },
        ],
      },
    })

    const certificateSelect = wrapper.findAll('select')[0].element as HTMLSelectElement
    const versionSelect = wrapper.findAll('select')[1].element as HTMLSelectElement

    expect([...certificateSelect.options].map((option) => option.textContent?.trim())).toEqual(['*.jacksonz.cn'])
    expect([...versionSelect.options].map((option) => option.value)).toEqual(['__LATEST__', 'certver-new', 'certver-old'])
    expect(versionSelect.options[0]?.textContent).toContain('始终自动选择最新可部署证书')
  })

  it('编辑 LATEST_AUTO 计划时保留自动跟随最新版本语义，而不是回填成固定版本', async () => {
    const wrapper = mount(GcDeploymentWizard, {
      props: {
        certificates: [
          { id: 'cert-1', primaryDomain: '*.jacksonz.cn' },
        ],
        certificateVersions: [
          {
            id: 'certver-old',
            certificateAssetId: 'cert-1',
            notBefore: '2026-01-01T00:00:00.000Z',
            notAfter: '2026-04-01T00:00:00.000Z',
          },
          {
            id: 'certver-new',
            certificateAssetId: 'cert-1',
            notBefore: '2026-06-09T00:00:00.000Z',
            notAfter: '2026-09-07T00:00:00.000Z',
          },
        ],
        certificateFormats: [
          {
            id: 'fmt-new',
            certificateVersionId: 'certver-new',
            format: 'pfx',
            containsPrivateKey: true,
            parameters: { configName: 'Windows-IIS-PFX' },
          },
        ],
        targets: [
          {
            id: 'target-1',
            applicationAssetId: 'asset-1',
            name: 'test.local',
            siteName: 'TEST02.jacksonz.cn',
            bindingSummary: '*:443:test.local',
          },
        ],
        initialPlan: {
          certificateId: 'cert-1',
          certificateVersionId: 'certver-old',
          applicationAssetId: 'asset-1',
          selectionMode: 'LATEST_AUTO',
        },
      },
    })

    const versionSelect = wrapper.findAll('select')[1].element as HTMLSelectElement
    expect(versionSelect.value).toBe('__LATEST__')

    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '下一步')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '保存计划')!.trigger('click')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      selectionMode: 'LATEST_AUTO',
      certificateVersionId: 'certver-new',
    })
  })
})
