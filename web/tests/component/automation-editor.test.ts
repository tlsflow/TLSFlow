import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AutomationEditor from '@/views/automations/AutomationEditor.vue'

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificates: vi.fn(async () => ({ data: { items: [{ id: 'certificate-a', name: 'example.com', primaryDomain: 'example.com', sans: [] }] } })),
  listCertificateVersions: vi.fn(async () => ({ data: { items: [{ id: 'version-a', versionNo: 2 }, { id: 'version-b', versionNo: 1 }] } })),
}))

describe('AutomationEditor', () => {
  it('提交定时自动化的目标条件、动作和安全护栏', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })
    await wrapper.findAll('input')[0].setValue('生产证书更新')
    await wrapper.get('[data-testid="automation-certificate-domains"]').setValue('example.com, api.example.com')
    await wrapper.get('[data-testid="automation-trigger"]').setValue('schedule')
    await wrapper.findAll('input')[2].setValue('15 3 * * *')
    await wrapper.findAll('input')[3].setValue('Asia/Shanghai')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.trigger).toEqual({ type: 'schedule', cron: '15 3 * * *', timeZone: 'Asia/Shanghai' })
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['create_deployment_plan', 'execute_deployment_plan'])
    expect(payload.actions[0].config).toMatchObject({ planType: 'UPDATE', selectionMode: 'EXPLICIT' })
    expect(payload.actions[0].config).not.toHaveProperty('workflowTemplateId')
    expect(payload.guardrails).toMatchObject({ requirePreview: true, requireDryRun: true, requireApproval: true })
    expect(payload.targetSelector).toMatchObject({ certificateDomains: ['example.com', 'api.example.com'], certificateVersionSelection: 'latest' })
  })

  it('可以指定证书域名和证书版本', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    await wrapper.findAll('input')[0].setValue('指定证书版本更新')
    await wrapper.get('[data-testid="automation-certificate-domains"]').setValue('example.com')
    await wrapper.get('[data-testid="automation-version-selection"]').setValue('specific')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-version-ids"] option')).toHaveLength(2))
    await wrapper.get('[data-testid="automation-certificate-version-ids"]').setValue(['version-a', 'version-b'])
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.targetSelector).toMatchObject({ certificateDomains: ['example.com'], certificateVersionSelection: 'specific', certificateVersionIds: ['version-a', 'version-b'] })
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['create_deployment_plan', 'execute_deployment_plan'])
  })
})
