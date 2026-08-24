import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import AutomationsView from '@/views/automations/AutomationsView.vue'

vi.mock('@/api/modules/assets.api', () => ({
  listAssets: vi.fn(async () => ({
    data: {
      items: [],
      total: 0,
    },
  })),
}))

vi.mock('@/api/modules/automations.api', async () => {
  const actual = await vi.importActual<typeof import('@/api/modules/automations.api')>('@/api/modules/automations.api')
  return {
    ...actual,
    listAutomations: vi.fn(async () => []),
    listAutomationRuns: vi.fn(async () => []),
    createAutomation: vi.fn(),
    updateAutomation: vi.fn(),
    deleteAutomation: vi.fn(),
    automationAction: vi.fn(),
    runAutomation: vi.fn(),
  }
})

vi.mock('@/views/BusinessResourcePage.vue', () => ({
  default: defineComponent({
    name: 'BusinessResourcePageStub',
    props: {
      config: {
        type: Object,
        required: true,
      },
    },
    setup(props) {
      return () => h('div', { class: 'business-resource-page-stub' }, [
        h('button', {
          type: 'button',
          'data-testid': 'business-primary-action',
          onClick: () => (props.config as { primaryAction?: () => void }).primaryAction?.(),
        }, (props.config as { primaryActionLabel?: string }).primaryActionLabel ?? 'primary'),
      ])
    },
  }),
}))

vi.mock('@/design-system/components', async () => {
  const actual = await vi.importActual<typeof import('@/design-system/components')>('@/design-system/components')
  return {
    ...actual,
    GcModal: defineComponent({
      name: 'GcModalStub',
      props: {
        open: {
          type: Boolean,
          default: false,
        },
        title: {
          type: String,
          default: '',
        },
        description: {
          type: String,
          default: '',
        },
      },
      setup(props, { slots }) {
        return () => (props.open
          ? h('div', { class: 'gc-modal-stub', role: 'dialog' }, [
            h('h2', props.title),
            props.description ? h('p', props.description) : null,
            slots.default?.(),
            slots.footer?.(),
          ])
          : null)
      },
    }),
  }
})

vi.mock('@/views/automations/AutomationEditor.vue', () => ({
  default: defineComponent({
    name: 'AutomationEditorStub',
    setup() {
      return () => h('div', 'automation-editor-stub')
    },
  }),
}))

describe('AutomationsView', () => {
  it('使用业务表格页配置并支持打开新建弹窗', async () => {
    setActivePinia(createPinia())
    const wrapper = mount(AutomationsView, {
      global: {
        plugins: [i18n],
      },
    })

    const businessPage = wrapper.getComponent({ name: 'BusinessResourcePageStub' })
    const config = businessPage.props('config') as {
      showHeader?: boolean
      showMetrics?: boolean
      showDetailPanel?: boolean
      showActionPanel?: boolean
      columns: Array<{ key: string }>
      rowActions: Array<{ label: string }>
      primaryActionLabel: string
    }

    expect(config.showHeader).toBe(false)
    expect(config.showMetrics).toBe(false)
    expect(config.showDetailPanel).toBe(false)
    expect(config.showActionPanel).toBe(false)
    expect(config.columns.map((column) => column.key)).toEqual([
      'name',
      'status',
      'trigger',
      'targetScope',
      'nextRunAt',
      'lastRunAt',
      'actions',
    ])
    expect(config.rowActions.map((action) => action.label)).toEqual(expect.arrayContaining([
      '详情',
      '编辑',
      '复制',
      '启用',
      '停用',
      '立即执行',
      '运行历史',
      '删除',
    ]))

    await wrapper.get('[data-testid="business-primary-action"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('新建自动化')
    expect(wrapper.text()).toContain('automation-editor-stub')
  })
})
