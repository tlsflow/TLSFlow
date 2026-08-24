import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import VersionView from '@/views/settings/VersionView.vue'

describe('版本信息页面', () => {
  it('只展示当前 GCAC 版本', () => {
    const wrapper = mount(VersionView, { global: { plugins: [i18n] } })

    expect(wrapper.text()).toContain('版本信息')
    expect(wrapper.text()).toContain('当前版本')
    expect(wrapper.text()).toContain('0.1.0')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
})
