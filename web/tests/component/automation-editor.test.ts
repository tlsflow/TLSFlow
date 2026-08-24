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
    expect(payload.guardrails).toMatchObject({ requirePreview: true, requireDryRun: true, requireApproval: true })
    expect(payload.targetSelector).toMatchObject({ expiresWithinDays: 30, environments: ['production'] })
  })
})
