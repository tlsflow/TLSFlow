import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import GcStatusTag from '@/design-system/components/GcStatusTag.vue'

describe('GcStatusTag', () => {
  it('渲染中文状态', () => {
    const wrapper = mount(GcStatusTag, {
      props: { status: 'SUCCESS' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toBe('成功')
  })

  it('渲染启用状态的成功色标签', () => {
    const wrapper = mount(GcStatusTag, {
      props: { status: 'active' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toBe('已启用')
    expect(wrapper.classes()).toContain('gc-tag--success')
  })

  it('支持业务页面覆盖标签文案和色调', () => {
    const wrapper = mount(GcStatusTag, {
      props: { status: 'unknown', label: '外部来源', tone: 'info' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toBe('外部来源')
    expect(wrapper.classes()).toContain('gc-tag--info')
  })
})
