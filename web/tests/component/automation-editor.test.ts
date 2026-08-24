import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AutomationEditor from '@/views/automations/AutomationEditor.vue'
import { listAssets } from '@/api/modules/assets.api'
import { listCertificates } from '@/api/modules/certificates.api'

vi.mock('@/api/modules/assets.api', () => ({
  listAssets: vi.fn(async () => ({
    data: {
      items: [
        {
          id: 'asset-a',
          displayName: '生产应用',
          environment: 'production',
          domainName: 'prod.example.com',
          targetBindingDetail: { certificateBindings: [{ domainName: 'example.com' }] },
        },
        {
          id: 'asset-b',
          displayName: '灰度 Ingress',
          environment: 'staging',
          domainName: 'staging.example.com',
          targetBindingDetail: { certificateBindings: [{ domainName: 'example.com' }] },
        },
      ],
      total: 2,
    },
  })),
}))

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificates: vi.fn(async () => ({
    data: {
      items: [
        { id: 'certificate-a', name: 'example.com', primaryDomain: 'example.com', sans: ['api.example.com'] },
      ],
      total: 1,
    },
  })),
}))

describe('AutomationEditor', () => {
  it('证书新版本事件支持“只更新指定应用资产”并提交固定执行模型', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    expect(wrapper.find('.automation-editor__progress-bar').exists()).toBe(true)
    expect(wrapper.findAll('.automation-editor__steps li')).toHaveLength(3)
    expect(wrapper.get('.automation-editor__steps li').classes()).toContain('is-active')

    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    expect(wrapper.text()).not.toContain('先确定这条自动化会如何更新资产，再决定额外条件和安全控制。')
    await wrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await wrapper.get('[data-testid="automation-scope-selected-assets"]').trigger('click')
    await vi.waitFor(() => expect(vi.mocked(listAssets)).toHaveBeenCalled())
    expect(wrapper.findAll('[data-testid="automation-available-asset-option"]')).toHaveLength(2)
    await wrapper.findAll('[data-testid="automation-available-asset-option"]')[0]?.setValue(true)
    await wrapper.findAll('[data-testid="automation-available-asset-option"]')[1]?.setValue(true)
    await wrapper.get('[data-testid="automation-transfer-add"]').trigger('click')
    expect(wrapper.findAll('[data-testid="automation-chosen-asset-option"]')).toHaveLength(2)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')

    expect(vi.mocked(listCertificates)).toHaveBeenCalledWith({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    expect(wrapper.find('[data-testid="automation-certificate-tags"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="automation-target-environments"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="automation-target-owners"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="automation-name"]').attributes('placeholder')).toBe('example.com · 按需执行 · 只更新指定应用资产')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.name).toBe('example.com · 按需执行 · 只更新指定应用资产')
    expect(payload.trigger).toEqual({ type: 'on_demand' })
    expect(payload.targetResolver).toMatchObject({ type: 'certificate_version_targets', assetIds: expect.arrayContaining(['asset-a', 'asset-b']) })
    expect(Object.prototype.hasOwnProperty.call(payload, 'targetSelector')).toBe(false)
    expect(payload.filters).toEqual([{ field: 'event.domains', operator: 'contains_any', value: ['example.com'] }])
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['send_notification'])
    expect(payload.guardrails).toMatchObject({ maxTargetsPerRun: 5000, requirePreview: true, requireDryRun: false, requireApproval: true })
  })

  it('只提供证书新版本事件并始终提交 canonical targetResolver', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    expect(wrapper.findAll('[data-testid="automation-trigger"] option')).toHaveLength(1)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    await wrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-name"]').setValue('证书事件更新')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.name).toBe('证书事件更新')
    expect(payload.targetResolver).toEqual({ type: 'certificate_version_targets' })
    expect(Object.prototype.hasOwnProperty.call(payload, 'targetSelector')).toBe(false)
    expect(payload.trigger).toEqual({ type: 'on_demand' })
  })
})
