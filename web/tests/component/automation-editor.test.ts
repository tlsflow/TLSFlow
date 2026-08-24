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
          displayName: '生产 Nginx',
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
  listCertificateVersions: vi.fn(async () => ({
    data: {
      items: [
        { id: 'version-a', versionNo: 2 },
        { id: 'version-b', versionNo: 1 },
      ],
      total: 2,
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
    expect(wrapper.text()).not.toContain('系统为每个现有资产绑定创建独立更新计划，并复用 DeploymentPlan、Dry Run、审批和 ExecutionRun。')
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
    expect(wrapper.get('[data-testid="automation-name"]').attributes('placeholder')).toBe('example.com · 证书新版本事件 · 只更新指定应用资产')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.name).toBe('example.com · 证书新版本事件 · 只更新指定应用资产')
    expect(payload.trigger).toEqual({ type: 'certificate_version_created', sources: ['acme', 'manual_import'] })
    expect(payload.targetResolver).toMatchObject({ type: 'certificate_version_targets', assetIds: expect.arrayContaining(['asset-a', 'asset-b']) })
    expect(payload.targetSelector).toBeUndefined()
    expect(payload.filters).toEqual([
      { field: 'event.sourceType', operator: 'in', value: ['acme', 'manual_import'] },
      { field: 'event.domains', operator: 'contains_any', value: ['example.com'] },
    ])
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['create_deployment_plan', 'execute_deployment_plan'])
    expect(payload.guardrails).toMatchObject({ maxTargetsPerRun: 5000, requirePreview: true, requireDryRun: true, requireApproval: true })
  })

  it('一次性触发会提交浏览器本地时间对应的 UTC 时刻，并要求至少有范围锚点', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    await wrapper.get('[data-testid="automation-trigger"]').setValue('once')
    await wrapper.get('[data-testid="automation-once-run-at"]').setValue('2099-08-01T10:30')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    await wrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-name"]').setValue('一次性证书更新')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.name).toBe('一次性证书更新')
    expect(payload.trigger).toEqual({ type: 'once', runAt: new Date('2099-08-01T10:30').toISOString() })
    expect(payload.targetSelector).toMatchObject({ certificateDomains: ['example.com'], certificateVersionSelection: 'latest' })
  })

  it('轮询类自动化可以指定版本策略和精确版本', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    await wrapper.get('[data-testid="automation-trigger"]').setValue('api')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-version-selection"]').setValue('specific')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    await wrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-version-ids"] option')).toHaveLength(2))
    await wrapper.get('[data-testid="automation-certificate-version-ids"]').setValue(['version-a', 'version-b'])
    await wrapper.get('[data-testid="automation-name"]').setValue('API 指定版本更新')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.name).toBe('API 指定版本更新')
    expect(payload.targetSelector).toMatchObject({
      certificateDomains: ['example.com'],
      certificateVersionSelection: 'specific',
      certificateVersionIds: ['version-a', 'version-b'],
    })
    expect(payload.targetResolver).toMatchObject({ type: 'legacy_target_selector' })
  })
})
