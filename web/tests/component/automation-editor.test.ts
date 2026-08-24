import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AutomationEditor from '@/views/automations/AutomationEditor.vue'
import { listCertificates } from '@/api/modules/certificates.api'

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificates: vi.fn(async () => ({ data: { items: [{ id: 'certificate-a', name: 'example.com', primaryDomain: 'example.com', sans: ['api.example.com'] }] } })),
  listCertificateVersions: vi.fn(async () => ({ data: { items: [{ id: 'version-a', versionNo: 2 }, { id: 'version-b', versionNo: 1 }] } })),
}))

describe('AutomationEditor', () => {
  it('通过友好计划配置提交每周执行的目标条件、动作和安全护栏', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })
    expect(wrapper.find('.automation-editor__progress-bar').exists()).toBe(true)
    expect(wrapper.findAll('.automation-editor__steps li')).toHaveLength(3)
    expect(wrapper.get('.automation-editor__steps li').classes()).toContain('is-active')
    expect(wrapper.text()).not.toContain(i18n.global.t('automations.form.existingAssetTitle'))
    expect(wrapper.text()).not.toContain(i18n.global.t('automations.form.existingAssetDescription'))
    const domainPicker = wrapper.get('[data-testid="automation-certificate-domains"]')
    expect(domainPicker.element.tagName).toBe('SUMMARY')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    expect(vi.mocked(listCertificates)).toHaveBeenCalledWith({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    await wrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    expect(wrapper.text()).not.toContain(i18n.global.t('automations.form.scheduleHelp'))
    await wrapper.get('[data-testid="automation-trigger"]').setValue('schedule')
    await wrapper.get('[data-testid="automation-recurrence"]').setValue('weekly')
    await wrapper.get('[data-testid="automation-recurrence-time"]').setValue('03:15')
    await wrapper.find('select:not([data-testid])').setValue('1')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.findAll('input')[0].setValue('生产证书更新')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.trigger).toEqual({ type: 'schedule', cron: '15 3 * * 1', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['create_deployment_plan', 'execute_deployment_plan'])
    expect(payload.actions[0].config).toMatchObject({ planType: 'UPDATE', selectionMode: 'EXPLICIT' })
    expect(payload.actions[0].config).not.toHaveProperty('workflowTemplateId')
    expect(payload.guardrails).toMatchObject({ requirePreview: true, requireDryRun: true, requireApproval: true })
    expect(payload.targetSelector).toMatchObject({ certificateDomains: ['example.com'], certificateVersionSelection: 'latest' })
  })

  it('固定时间任务提交一次性 UTC 时刻，默认触发方式为外部 API', async () => {
    const apiWrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })
    await vi.waitFor(() => expect(apiWrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    await apiWrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await apiWrapper.get('[data-testid="automation-next"]').trigger('click')
    expect((apiWrapper.get('[data-testid="automation-trigger"]').element as HTMLSelectElement).value).toBe('api')

    await apiWrapper.get('[data-testid="automation-trigger"]').setValue('once')
    await apiWrapper.get('[data-testid="automation-once-run-at"]').setValue('2099-08-01T10:30')
    await apiWrapper.get('[data-testid="automation-next"]').trigger('click')
    await apiWrapper.findAll('input')[0].setValue('一次性证书更新')
    await apiWrapper.find('form').trigger('submit')

    const payload = apiWrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.trigger).toEqual({ type: 'once', runAt: new Date('2099-08-01T10:30').toISOString() })
  })

  it('可以指定证书域名和证书版本', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    await wrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await wrapper.get('[data-testid="automation-version-selection"]').setValue('specific')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-version-ids"] option')).toHaveLength(2))
    await wrapper.get('[data-testid="automation-certificate-version-ids"]').setValue(['version-a', 'version-b'])
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.findAll('input')[0].setValue('指定证书版本更新')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.targetSelector).toMatchObject({ certificateDomains: ['example.com'], certificateVersionSelection: 'specific', certificateVersionIds: ['version-a', 'version-b'] })
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['create_deployment_plan', 'execute_deployment_plan'])
  })
})
