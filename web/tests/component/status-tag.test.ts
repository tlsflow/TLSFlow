import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GcStatusTag from '@/design-system/components/GcStatusTag.vue'

describe('GcStatusTag', () => {
  it('渲染中文状态', () => {
    const wrapper = mount(GcStatusTag, { props: { status: 'SUCCESS' } })
    expect(wrapper.text()).toBe('成功')
  })
})
