import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import AutomationsView from '@/views/automations/AutomationsView.vue'
import { previewAutomation, runAutomation } from '@/api/modules/automations.api'

vi.mock('@/api/modules/assets.api', () => ({
  listApplications: vi.fn(async () => ({
    data: {
      items: [],
      total: 0,
    },
  })),
}))

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificates: vi.fn(async () => ({
    data: {
      items: [{ id: 'cert-asset-1', primaryDomain: 'example.com' }],
      total: 1,
    },
  })),
  listCertificateVersions: vi.fn(async () => ({
    data: {
      items: [{
        id: 'cert-version-1',
        certificateAssetId: 'cert-asset-1',
        commonName: 'example.com',
        notAfter: '2027-01-01T00:00:00.000Z',
        createdAt: '2026-08-27T00:00:00.000Z',
      }],
      total: 1,
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
    previewAutomation: vi.fn(async () => ({
      previewId: 'preview-1',
      totalMatched: 1,
      executableCount: 1,
      excludedCount: 0,
      excludedReasons: {},
      items: [{
        target: {
          certificateId: 'cert-asset-1',
          certificateName: 'example.com',
          certificateVersionId: 'cert-version-1',
          assetId: 'app-asset-1',
          assetName: 'example-app',
        },
        executable: true,
      }],
    })),
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
            slots.actions?.(),
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

  it('按需自动化点击立即执行会打开证书版本选择窗口', async () => {
    setActivePinia(createPinia())
    const wrapper = mount(AutomationsView, {
      global: {
        plugins: [i18n],
      },
    })

    const businessPage = wrapper.getComponent({ name: 'BusinessResourcePageStub' })
    const config = businessPage.props('config') as {
      rowActions: Array<{ label: string; run?: (row: unknown) => Promise<void> }>
    }
    const runNowAction = config.rowActions.find((action) => action.label === '立即执行')
    expect(runNowAction?.run).toBeTypeOf('function')

    await runNowAction?.run?.({
      id: 'automation-1',
      name: 'example.com · 按需执行',
      status: 'active',
      raw: {
        id: 'automation-1',
        name: 'example.com · 按需执行',
        status: 'active',
        version: 1,
        currentVersion: 1,
        configuration: {
          trigger: { type: 'on_demand' },
          targetResolver: { type: 'certificate_version_targets', assetIds: ['app-asset-1'] },
          actions: [],
          guardrails: {
            maxTargetsPerRun: 10,
            concurrencyLimit: 1,
            requirePreview: true,
            requireDryRun: false,
            requireApproval: false,
          },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('手动执行')
    expect(wrapper.text()).toContain('请选择一个证书版本后再执行。')
  })

  it('手动执行有效期降级目标前必须二次确认', async () => {
    vi.mocked(previewAutomation).mockResolvedValueOnce({
      previewId: 'preview-downgrade',
      totalMatched: 1,
      executableCount: 1,
      excludedCount: 0,
      excludedReasons: {},
      versionImpactSummary: { total: 1, upgrade: 0, same: 0, downgrade: 1, missingCurrent: 0 },
      items: [{
        target: {
          certificateName: '*.jacksonz.cn',
          certificateVersionId: 'cert-version-1',
          assetId: 'app-asset-1',
          assetName: 'ikuai.jacksonz.cn',
          currentCertificateNotAfter: '2026-11-04T00:00:00.000Z',
          targetCertificateNotAfter: '2026-10-30T00:00:00.000Z',
          certificateVersionImpact: 'downgrade',
          bindingId: 'binding-1',
        },
        executable: true,
      }],
    })
    vi.mocked(runAutomation).mockResolvedValueOnce({
      id: 'run-downgrade',
      automationId: 'automation-1',
      automationNameSnapshot: '降级更新',
      automationVersion: 1,
      triggerType: 'on_demand',
      status: 'queued',
      targetSummary: { total: 1, pending: 1, running: 0, waiting_approval: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 },
      createdAt: '2026-08-27T00:00:00.000Z',
    } as never)
    setActivePinia(createPinia())
    const wrapper = mount(AutomationsView, {
      global: {
        plugins: [i18n],
      },
    })
    const businessPage = wrapper.getComponent({ name: 'BusinessResourcePageStub' })
    const config = businessPage.props('config') as {
      rowActions: Array<{ label: string; run?: (row: unknown) => Promise<void> }>
    }
    await config.rowActions.find((action) => action.label === '立即执行')?.run?.({
      id: 'automation-1',
      raw: {
        id: 'automation-1',
        name: '降级更新',
        status: 'active',
        version: 1,
        currentVersion: 1,
        configuration: {
          trigger: { type: 'on_demand' },
          targetResolver: { type: 'certificate_version_targets', assetIds: ['app-asset-1'] },
          actions: [],
          guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false },
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('可执行 1 项')
    await wrapper.findAll('button').find((button) => button.text() === '开始执行')?.trigger('click')
    expect(wrapper.text()).toContain('确认降低证书有效期')
    expect(runAutomation).not.toHaveBeenCalled()

    await wrapper.findAll('button').find((button) => button.text() === '确认并执行')?.trigger('click')
    await flushPromises()
    expect(runAutomation).toHaveBeenCalledWith('automation-1', 1, expect.objectContaining({
      allowCertificateDowngrade: true,
      confirmCertificateDowngrade: true,
    }))
  })
})
