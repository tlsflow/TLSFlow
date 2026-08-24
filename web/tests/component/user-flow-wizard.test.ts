import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GcUserFlowWizard, { type UserFlowStep } from '@/design-system/components/GcUserFlowWizard.vue'

const steps: UserFlowStep[] = [
  { id: 'certificates', label: '证书', help: '证书说明', helpLabel: '证书提示' },
  { id: 'applications', label: '应用', help: '应用说明', helpLabel: '应用提示', completed: true },
  { id: 'deployments', label: '部署', help: '部署说明', helpLabel: '部署提示' },
]

describe('GcUserFlowWizard', () => {
  it('渲染三段流程并标记当前步骤', () => {
    const wrapper = mount(GcUserFlowWizard, {
      props: {
        steps,
        activeStep: 'applications',
        title: '应用',
        help: '当前步骤说明',
        helpLabel: '当前步骤提示',
        ariaLabel: '用户流程',
      },
    })

    expect(wrapper.findAll('.gc-user-flow-wizard__step')).toHaveLength(3)
    expect(wrapper.find('.gc-user-flow-wizard__step.is-active').text()).toContain('应用')
    expect(wrapper.find('.gc-user-flow-wizard__step.is-complete').text()).toContain('证书')
    expect(wrapper.findAll('[role="tooltip"]')).toHaveLength(4)
  })

  it('点击流程段发送步骤选择事件', async () => {
    const wrapper = mount(GcUserFlowWizard, {
      props: {
        steps,
        activeStep: 'certificates',
        title: '证书',
        help: '当前步骤说明',
        helpLabel: '当前步骤提示',
        ariaLabel: '用户流程',
      },
    })

    await wrapper.findAll('.gc-user-flow-wizard__step-button')[2].trigger('click')

    expect(wrapper.emitted('select')).toEqual([['deployments']])
  })
})
