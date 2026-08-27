import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import AutomationEditor from '@/views/automations/AutomationEditor.vue'
import { listAssets } from '@/api/modules/assets.api'
import { listCertificates } from '@/api/modules/certificates.api'

vi.mock('@/api/modules/assets.api', () => ({
  listAssets: vi.fn(async () => ({
    data: {
      items: [
        {
          id: 'asset-a',
          displayName: '生产应用',
          environment: 'production',
          domainName: 'prod.example.com',
          targetBindingDetail: { certificateBindings: [{ domainName: 'example.com' }] },
        },
        {
          id: 'asset-b',
          displayName: '灰度 Ingress',
          environment: 'staging',
          domainName: 'staging.example.com',
          targetBindingDetail: { certificateBindings: [{ domainName: 'example.com' }] },
        },
      ],
      total: 2,
    },
  })),
}))

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificates: vi.fn(async () => ({
    data: {
      items: [
        { id: 'certificate-a', name: 'example.com', primaryDomain: 'example.com', sans: ['api.example.com'] },
      ],
      total: 1,
    },
  })),
}))

describe('AutomationEditor', () => {
  it('证书新版本事件支持“只更新指定应用资产”并提交事件来源过滤', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    expect(wrapper.find('.automation-editor__progress-bar').exists()).toBe(true)
    expect(wrapper.findAll('.automation-editor__steps li')).toHaveLength(3)
    expect(wrapper.get('.automation-editor__steps li').classes()).toContain('is-active')
    expect(wrapper.text()).toContain('ACME 自动续期')
    expect(wrapper.text()).not.toContain('外部来源')

    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-certificate-domain-option"]')).toHaveLength(1))
    expect(wrapper.text()).not.toContain('先确定这条自动化会如何更新资产，再决定额外条件和安全控制。')
    await wrapper.get('[data-testid="automation-certificate-domain-option"]').setValue(true)
    await wrapper.get('[data-testid="automation-scope-selected-assets"]').trigger('click')
    await vi.waitFor(() => expect(vi.mocked(listAssets)).toHaveBeenCalled())
    expect(wrapper.findAll('[data-testid="automation-available-asset-option"]')).toHaveLength(2)
    await wrapper.findAll('[data-testid="automation-available-asset-option"]')[0]?.setValue(true)
    await wrapper.findAll('[data-testid="automation-available-asset-option"]')[1]?.setValue(true)
    await wrapper.get('[data-testid="automation-transfer-add"]').trigger('click')
    expect(wrapper.findAll('[data-testid="automation-chosen-asset-option"]')).toHaveLength(2)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')

    expect(vi.mocked(listCertificates)).toHaveBeenCalledWith({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    expect(wrapper.find('[data-testid="automation-certificate-tags"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="automation-target-environments"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="automation-target-owners"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="automation-name"]').attributes('placeholder')).toBe('example.com · 证书新版本事件 · 只更新指定应用资产')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.name).toBe('example.com · 证书新版本事件 · 只更新指定应用资产')
    expect(payload.trigger).toEqual({ type: 'certificate_version_created', sources: ['acme_issue', 'manual_import'] })
    expect(payload.targetResolver).toMatchObject({ type: 'certificate_version_targets', assetIds: expect.arrayContaining(['asset-a', 'asset-b']) })
    expect(Object.prototype.hasOwnProperty.call(payload, 'targetSelector')).toBe(false)
    expect(payload.filters).toEqual([
      { field: 'event.sourceType', operator: 'in', value: ['acme_issue', 'manual_import'] },
      { field: 'event.domains', operator: 'contains_any', value: ['example.com'] },
    ])
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual([
      'create_deployment_plan',
      'execute_deployment_plan',
      'send_notification',
    ])
    expect(payload.actions[0]).toMatchObject({
      type: 'create_deployment_plan',
      position: 1,
      config: { planType: 'UPDATE', selectionMode: 'EXPLICIT' },
    })
    expect(payload.actions[1]).toMatchObject({
      type: 'execute_deployment_plan',
      position: 2,
      config: { source: 'created_by_previous_action' },
    })
    expect(payload.actions[2]).toMatchObject({
      type: 'send_notification',
      position: 3,
    })
    expect(payload.guardrails).toMatchObject({ maxTargetsPerRun: 5000, requirePreview: true, requireDryRun: false, requireApproval: true })
  })

  it('恢复全部触发器选项并始终提交 canonical targetResolver', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })

    expect(wrapper.findAll('[data-testid="automation-trigger"] option')).toHaveLength(5)
    expect(wrapper.find('[data-testid="automation-trigger"] option[value="once"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="automation-trigger"] option[value="schedule"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="automation-trigger"] option[value="api"]').exists()).toBe(true)
  })

  it('编辑已有周期触发器时保留真实配置', async () => {
    const wrapper = mount(AutomationEditor, {
      props: {
        automation: {
          id: 'automation-schedule',
          name: '夜间证书检查',
          description: '周期任务',
          status: 'active',
          currentVersion: 2,
          version: 2,
          configuration: {
            trigger: { type: 'schedule', cron: '30 1 * * 1', timeZone: 'Asia/Shanghai' },
            filters: [{ field: 'target.assetId', operator: 'in', value: ['asset-a'] }],
            targetResolver: { type: 'certificate_version_targets', assetIds: ['asset-a'] },
            actions: [{ type: 'send_notification', position: 1, config: {} }],
            guardrails: { maxTargetsPerRun: 5000, concurrencyLimit: 2, requirePreview: true, requireDryRun: false, requireApproval: false },
          },
        },
      },
      global: { plugins: [i18n] },
    })

    expect((wrapper.get('[data-testid="automation-trigger"]').element as HTMLSelectElement).value).toBe('schedule')
    expect(wrapper.find('[data-testid="automation-recurrence"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="automation-recurrence-time"]').element as HTMLInputElement).value).toBe('01:30')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.trigger).toEqual({ type: 'schedule', cron: '30 1 * * 1', timeZone: 'Asia/Shanghai' })
    expect(payload.actions.map((action: { type: string }) => action.type)).toEqual([
      'create_deployment_plan',
      'execute_deployment_plan',
      'send_notification',
    ])
  })

  it('编辑非标准 Cron 时保留原表达式', async () => {
    const wrapper = mount(AutomationEditor, {
      props: {
        automation: {
          id: 'automation-custom-cron', name: '自定义周期', status: 'active', currentVersion: 1, version: 1,
          configuration: {
            trigger: { type: 'schedule', cron: '*/5 * * * *', timeZone: 'Asia/Shanghai' },
            targetResolver: { type: 'certificate_version_targets' }, actions: [],
            guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: false, requireDryRun: false, requireApproval: false },
          },
        },
      },
      global: { plugins: [i18n] },
    })

    expect((wrapper.get('[data-testid="automation-recurrence"]').element as HTMLSelectElement).value).toBe('custom')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.find('form').trigger('submit')
    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.trigger).toEqual({ type: 'schedule', cron: '*/5 * * * *', timeZone: 'Asia/Shanghai' })
  })

  it('一次性触发器提交 ISO 时间，编辑输入保持本地时间', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })
    await wrapper.get('[data-testid="automation-trigger"]').setValue('once')
    expect(wrapper.find('[data-testid="automation-once-run-at"]').exists()).toBe(true)
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.trigger.type).toBe('once')
    expect(payload.trigger.runAt).toMatch(/Z$/)
  })

  it('按需兼容触发器仍保留 on_demand 类型', async () => {
    const wrapper = mount(AutomationEditor, { global: { plugins: [i18n] } })
    await wrapper.get('[data-testid="automation-trigger"]').setValue('on_demand')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.targetResolver).toEqual({ type: 'certificate_version_targets' })
    expect(payload.trigger).toEqual({ type: 'on_demand' })
  })

  it('编辑时只保留当前应用资产清单，保存覆盖历史残留 ID', async () => {
    vi.mocked(listAssets).mockResolvedValueOnce({
      data: {
        items: [
          { id: 'asset-a', displayName: '生产应用', environment: 'production' },
          { id: 'asset-b', displayName: '灰度应用', environment: 'staging' },
        ],
        total: 2,
      },
    } as never)

    const wrapper = mount(AutomationEditor, {
      props: {
        automation: {
          id: 'automation-stale-assets',
          name: '证书更新',
          status: 'active',
          currentVersion: 3,
          version: 3,
          configuration: {
            trigger: { type: 'on_demand' },
            filters: [{ field: 'target.assetId', operator: 'in', value: ['asset-a', 'deleted-1', 'asset-b'] }],
            targetResolver: { type: 'certificate_version_targets', assetIds: ['asset-a', 'deleted-1', 'asset-b'] },
            actions: [],
            guardrails: { maxTargetsPerRun: 10, concurrencyLimit: 1, requirePreview: true, requireDryRun: false, requireApproval: false },
          },
        },
      },
      global: { plugins: [i18n] },
    })

    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await vi.waitFor(() => expect(wrapper.findAll('[data-testid="automation-chosen-asset-option"]')).toHaveLength(2))
    expect(wrapper.text()).not.toContain('deleted-1')
    await wrapper.get('[data-testid="automation-next"]').trigger('click')
    await wrapper.find('form').trigger('submit')

    const payload = wrapper.emitted('save')?.[0]?.[0] as Record<string, any>
    expect(payload.targetResolver).toEqual({ type: 'certificate_version_targets', assetIds: ['asset-a', 'asset-b'] })
    expect(payload.filters).toEqual([])
  })
})
