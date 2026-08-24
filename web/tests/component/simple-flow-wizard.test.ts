import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GcSimpleFlowWizard from '@/design-system/components/GcSimpleFlowWizard.vue'
import type { SimpleFlowSection } from '@/design-system/components/GcSimpleFlowWizard.vue'

describe('GcSimpleFlowWizard', () => {
  const mockSections: SimpleFlowSection[] = [
    {
      id: 'certificates',
      label: '证书管理',
      help: '查看和管理所有证书',
      helpLabel: '证书管理帮助',
    },
    {
      id: 'applications',
      label: '应用关联',
      help: '查看证书在哪些应用中使用',
      helpLabel: '应用关联帮助',
    },
  ]

  it('renders sections correctly', () => {
    const wrapper = mount(GcSimpleFlowWizard, {
      props: {
        sections: mockSections,
        activeSection: 'certificates',
        title: '证书与应用管理',
        ariaLabel: '简化流程向导',
      },
    })

    expect(wrapper.find('h1').text()).toBe('证书与应用管理')
    expect(wrapper.findAll('.gc-simple-flow-wizard__section')).toHaveLength(2)
  })

  it('emits select event when section is clicked', async () => {
    const wrapper = mount(GcSimpleFlowWizard, {
      props: {
        sections: mockSections,
        activeSection: 'certificates',
        title: '证书与应用管理',
        ariaLabel: '简化流程向导',
      },
    })

    const sections = wrapper.findAll('.gc-simple-flow-wizard__section')
    await sections[1].trigger('click')

    expect(wrapper.emitted('select')).toBeTruthy()
    expect(wrapper.emitted('select')?.[0]).toEqual(['applications'])
  })

  it('applies active class to active section', () => {
    const wrapper = mount(GcSimpleFlowWizard, {
      props: {
        sections: mockSections,
        activeSection: 'applications',
        title: '证书与应用管理',
        ariaLabel: '简化流程向导',
      },
    })

    const sections = wrapper.findAll('.gc-simple-flow-wizard__section')
    expect(sections[0].classes()).not.toContain('is-active')
    expect(sections[1].classes()).toContain('is-active')
  })

  it('renders subtitle when provided', () => {
    const wrapper = mount(GcSimpleFlowWizard, {
      props: {
        sections: mockSections,
        activeSection: 'certificates',
        title: '证书与应用管理',
        subtitle: '管理证书和查看哪些应用在使用它们',
        ariaLabel: '简化流程向导',
      },
    })

    expect(wrapper.text()).toContain('管理证书和查看哪些应用在使用它们')
  })

  it('renders actions slot content', () => {
    const wrapper = mount(GcSimpleFlowWizard, {
      props: {
        sections: mockSections,
        activeSection: 'certificates',
        title: '证书与应用管理',
        ariaLabel: '简化流程向导',
      },
      slots: {
        actions: '<button>导入证书</button>',
      },
    })

    expect(wrapper.html()).toContain('导入证书')
  })

  it('renders default slot content', () => {
    const wrapper = mount(GcSimpleFlowWizard, {
      props: {
        sections: mockSections,
        activeSection: 'certificates',
        title: '证书与应用管理',
        ariaLabel: '简化流程向导',
      },
      slots: {
        default: '<div class="test-content">证书列表内容</div>',
      },
    })

    expect(wrapper.find('.test-content').text()).toBe('证书列表内容')
  })

  it('sets aria-current on active section', () => {
    const wrapper = mount(GcSimpleFlowWizard, {
      props: {
        sections: mockSections,
        activeSection: 'certificates',
        title: '证书与应用管理',
        ariaLabel: '简化流程向导',
      },
    })

    const sections = wrapper.findAll('.gc-simple-flow-wizard__section')
    expect(sections[0].attributes('aria-current')).toBe('step')
    expect(sections[1].attributes('aria-current')).toBeUndefined()
  })
})
