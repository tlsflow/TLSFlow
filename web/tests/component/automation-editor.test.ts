import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AutomationEditor from '@/views/automations/AutomationEditor.vue'

describe('AutomationEditor', () => {
  it('提交定时自动化的目标条件、动作和安全护栏', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })
    const inputs = wrapper.findAll('input')

    await inputs[0].setValue('生产证书更新')
    await wrapper.find('select').setValue('schedule')
    await wrapper.findAll('input')[1].setValue('15 3 * * *')
    await wrapper.findAll('input')[2].setValue('Asia/Shanghai')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.trigger).toEqual({ type: 'schedule', cron: '15 3 * * *', timeZone: 'Asia/Shanghai' })
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['create_deployment_plan', 'execute_deployment_plan'])
    expect(payload.actions[0].config).toMatchObject({ planType: 'UPDATE', selectionMode: 'EXPLICIT' })
    expect(payload.actions[0].config).not.toHaveProperty('workflowTemplateId')
    expect(payload.guardrails).toMatchObject({ requirePreview: true, requireDryRun: true, requireApproval: true })
    expect(payload.targetSelector).toMatchObject({ expiresWithinDays: 30, environments: ['production'] })
  })

  it('可以指定证书并只创建部署计划而不执行', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })
    const inputs = wrapper.findAll('input')

    await inputs[0].setValue('只创建计划')
    await wrapper.get('[data-testid="automation-certificate-ids"]').setValue('cert-a, cert-b')
    await wrapper.get('[data-testid="automation-plan-mode"]').setValue('create_only')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.targetSelector.certificateIds).toEqual(['cert-a', 'cert-b'])
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual(['create_deployment_plan'])
  })
})
