import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import GcPluginLogo from '@/design-system/components/GcPluginLogo.vue'

describe('GcPluginLogo', () => {
  it('详情和接入向导优先使用方形 Logo', () => {
    const wrapper = mount(GcPluginLogo, {
      props: {
        logoUrl: '/plugin-logos/example.svg',
        squareLogoUrl: '/plugin-logos/example-square.svg',
        fallbackText: 'E',
        alt: 'Example',
        size: 'detail',
      },
    })

    expect(wrapper.find('img').attributes('src')).toBe('/plugin-logos/example-square.svg')
  })

  it('缺少方形 Logo 时由 48 × 48 接入槽位回退横向 Logo', () => {
    const wrapper = mount(GcPluginLogo, {
      props: {
        logoUrl: '/plugin-logos/example.svg',
        fallbackText: 'E',
        alt: 'Example',
        size: 'onboarding',
      },
    })

    expect(wrapper.find('img').attributes('src')).toBe('/plugin-logos/example.svg')
    expect(wrapper.classes()).toContain('plugin-logo--onboarding')
  })
})
