import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GcButton from '@/design-system/components/GcButton.vue'
import GcCard from '@/design-system/components/GcCard.vue'
import GcProgressBar from '@/design-system/components/GcProgressBar.vue'
import GcSelectionCard from '@/design-system/components/GcSelectionCard.vue'

describe('Cloud Security Pro 共享组件', () => {
  it('GcButton 提供四种变体并在忙碌时禁止提交', () => {
    const wrapper = mount(GcButton, {
      props: { variant: 'primary', type: 'submit', loading: true },
      slots: { default: '提交' },
    })

    const button = wrapper.get('button')
    expect(button.classes()).toContain('gc-button--primary')
    expect(button.attributes('type')).toBe('submit')
    expect(button.attributes('aria-busy')).toBe('true')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('GcCard 按 Header、Body、Footer 插槽建立稳定结构', () => {
    const wrapper = mount(GcCard, {
      slots: {
        header: '<h2>标题</h2>',
        body: '<p>正文</p>',
        footer: '<button>操作</button>',
      },
    })

    expect(wrapper.find('.gc-pro-card__header').text()).toBe('标题')
    expect(wrapper.find('.gc-pro-card__body').text()).toBe('正文')
    expect(wrapper.find('.gc-pro-card__footer').text()).toBe('操作')
  })

  it('GcProgressBar 归一化边界值并映射 StatusTone', () => {
    const wrapper = mount(GcProgressBar, {
      props: { value: 120, max: 100, tone: 'success', ariaLabel: '证书有效期进度' },
      slots: { default: '已完成' },
    })

    const progress = wrapper.get('[role="progressbar"]')
    expect(progress.classes()).toContain('gc-progress--success')
    expect(progress.attributes('aria-valuenow')).toBe('100')
    expect(progress.get('.gc-progress__fill').attributes('style')).toContain('width: 100%')
    expect(progress.text()).toBe('已完成')
  })

  it('GcSelectionCard 通过受控事件切换选择状态', async () => {
    const wrapper = mount(GcSelectionCard, {
      props: { title: '证书部署', description: '选择部署目标' },
    })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    expect(wrapper.emitted('select')).toEqual([[true]])
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('false')

    await wrapper.setProps({ modelValue: true })
    expect(wrapper.get('button').classes()).toContain('gc-selection-card--selected')
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('true')
  })
})
