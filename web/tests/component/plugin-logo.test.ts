import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GcPluginLogo from '@/design-system/components/GcPluginLogo.vue'

describe('GcPluginLogo', () => {
  it('详情和接入向导优先使用方形 Logo', () => {
    const wrapper = mount(GcPluginLogo, {
      props: {
        logoUrl: '/api/v1/plugin-versions/plugin-version-example/resources/logos/horizontal',
        squareLogoUrl: '/api/v1/plugin-versions/plugin-version-example/resources/logos/square',
        fallbackText: 'E',
        alt: 'Example',
        size: 'detail',
      },
    })

    expect(wrapper.find('img').attributes('src')).toBe('/api/v1/plugin-versions/plugin-version-example/resources/logos/square')
  })

  it('缺少方形 Logo 时由 48 × 48 接入槽位回退横向 Logo', () => {
    const wrapper = mount(GcPluginLogo, {
      props: {
        logoUrl: '/api/v1/plugin-versions/plugin-version-example/resources/logos/horizontal',
        fallbackText: 'E',
        alt: 'Example',
        size: 'onboarding',
      },
    })

    expect(wrapper.find('img').attributes('src')).toBe('/api/v1/plugin-versions/plugin-version-example/resources/logos/horizontal')
    expect(wrapper.classes()).toContain('plugin-logo--onboarding')
  })
})
