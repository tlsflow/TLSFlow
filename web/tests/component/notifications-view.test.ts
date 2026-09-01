import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import NotificationsView from '@/views/settings/NotificationsView.vue'

const apiMocks = vi.hoisted(() => ({
  listNotificationChannels: vi.fn(),
  listNotificationDeliveries: vi.fn(),
  listNotificationEventDefinitions: vi.fn(),
  listNotificationRequests: vi.fn(),
  listNotificationRoutes: vi.fn(),
  listNotificationTemplates: vi.fn(),
  listNotificationSilences: vi.fn(),
  createNotificationChannel: vi.fn(),
  createNotificationRoute: vi.fn(),
  createNotificationSilence: vi.fn(),
  saveNotificationTemplate: vi.fn(),
  updateNotificationChannel: vi.fn(),
  updateNotificationRoute: vi.fn(),
  updateNotificationTemplate: vi.fn(),
  testNotificationChannel: vi.fn(),
  retryNotificationDelivery: vi.fn(),
  getNotificationDelivery: vi.fn(),
  previewNotificationTemplate: vi.fn()
}))
const securityApiMocks = vi.hoisted(() => ({ createSecret: vi.fn() }))

vi.mock('@/api/modules/notifications.api', () => apiMocks)
vi.mock('@/api/modules/security.api', () => securityApiMocks)
vi.mock('@/stores/permission.store', () => ({
  usePermissionStore: () => ({ hasPermission: (permission: string) => permission === 'settings.write' })
}))

describe('NotificationsView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [] })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationEventDefinitions.mockResolvedValue({ data: [
      { eventType: 'certificate.renewal.result', templateKey: 'certificate.renewal.result', source: 'certificate' },
      { eventType: 'certificate.status', templateKey: 'certificate.status', source: 'certificate' },
      { eventType: 'certificate.report', templateKey: 'certificate.report', source: 'certificate' },
      { eventType: 'certificate.expiry.warning', templateKey: 'certificate.expiry.warning', source: 'certificate' },
      { eventType: 'certificate.expired', templateKey: 'certificate.expired', source: 'certificate' },
      { eventType: 'certificate.revoked', templateKey: 'certificate.revoked', source: 'certificate' },
      { eventType: 'certificate.binding.drift', templateKey: 'certificate.binding.drift', source: 'certificate' },
      { eventType: 'certificate.report.failed', templateKey: 'certificate.report.failed', source: 'certificate' }
    ] })
    apiMocks.listNotificationRequests.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
  })

  it('加载期间显示统一工作台状态反馈', async () => {
    const pending = () => new Promise(() => {})
    apiMocks.listNotificationChannels.mockImplementation(pending)
    apiMocks.listNotificationDeliveries.mockImplementation(pending)
    apiMocks.listNotificationRequests.mockImplementation(pending)
    apiMocks.listNotificationRoutes.mockImplementation(pending)
    apiMocks.listNotificationTemplates.mockImplementation(pending)
    apiMocks.listNotificationSilences.mockImplementation(pending)

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: { GcTabs: { props: ['modelValue'], template: '<nav />' } },
      },
    })
    await flushPromises()

    expect(wrapper.find('.gc-page.notifications-page').exists()).toBe(true)
    expect(wrapper.get('.notifications-page__loading').text()).toContain('加载中')
  })

  it('事件定义以紧凑列表展示八类预置场景并默认禁用', async () => {
    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav />' },
          GcStatusTag: { props: ['status'], template: '<span class="status">{{ status }}</span>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.findAll('.notifications-page__event-row')).toHaveLength(8)
    expect(wrapper.findAll('.notifications-page__event-row .status').every((item) => item.text() === 'disabled')).toBe(true)
    expect(wrapper.findAll('.notifications-page__event-row').every((item) => item.find('dl').exists() === false)).toBe(true)
  })

  it('加载渠道与投递，并且不显示 Secret 明文', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({
      data: [{
        id: 'channel-1', name: '企业 Slack', type: 'slack', status: 'active', config: {},
        secretRefs: { webhookUrl: 'secret://api_token/slack#current' }, healthStatus: 'healthy',
        lastSucceededAt: '2026-07-21T08:00:00.000Z', lastLatencyMs: 120, version: 1
      }]
    })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: {
            props: ['modelValue'],
            template: '<nav><button @click="$emit(\'update:modelValue\', \'channels\')">channels</button></nav>'
          },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')

    expect(wrapper.text()).toContain('企业 Slack')
    expect(wrapper.text()).toContain('healthy')
    expect(wrapper.text()).not.toContain('secret://api_token/slack#current')
    expect(wrapper.text()).not.toContain('plaintext-token')
    expect(wrapper.find('#notification-channel-form').exists()).toBe(false)

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建通知渠道')
    expect(createButton).toBeDefined()
    await createButton?.trigger('click')

    expect(wrapper.find('#notification-channel-form').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('SecretRef')
    expect(wrapper.find('input[type="password"][autocomplete="new-password"]').exists()).toBe(true)
  })

  it('私有化平台地址不再显示为全局通知设置', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [] })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })
    const wrapper = mount(NotificationsView, { global: { plugins: [i18n], stubs: { GcTabs: { props: ['modelValue'], template: '<nav />' } } } })
    await flushPromises()
    expect(wrapper.find('form.notifications-page__settings').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('保存设置')
  })

  it('Slack Webhook 明文只写入 Secret 服务，渠道请求只保存 SecretRef', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [] })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })
    securityApiMocks.createSecret.mockResolvedValue({ data: { id: 'sec-slack', secretRef: 'secret://api_token/sec-slack#current' } })
    apiMocks.createNotificationChannel.mockResolvedValue({ data: { id: 'channel-slack' } })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'channels\')">channels</button></nav>' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')

    expect(wrapper.text()).toContain('暂无通知渠道')
    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建通知渠道')
    await createButton?.trigger('click')
    const form = wrapper.get('#notification-channel-form')
    await form.get('input:not([type="password"])').setValue('生产 Slack')
    await form.get('select').setValue('slack')
    await form.get('input[type="password"]').setValue('https://hooks.slack.com/services/plaintext-token')
    await form.trigger('submit')
    await flushPromises()

    expect(securityApiMocks.createSecret).toHaveBeenCalledWith(expect.objectContaining({
      type: 'api_token',
      plainText: 'https://hooks.slack.com/services/plaintext-token'
    }))
    expect(apiMocks.createNotificationChannel).toHaveBeenCalledWith(expect.objectContaining({
      name: '生产 Slack',
      type: 'slack',
      config: {},
      secretRefs: { webhookUrl: 'secret://api_token/sec-slack#current' }
    }))
    expect(JSON.stringify(apiMocks.createNotificationChannel.mock.calls)).not.toContain('plaintext-token')
  })

  it('七种渠道显示各自真实协议配置字段', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [] })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'channels\')">channels</button></nav>' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建通知渠道')
    await createButton?.trigger('click')
    const form = wrapper.get('#notification-channel-form')
    const typeSelect = form.get('select')

    await typeSelect.setValue('wecom')
    expect(form.text()).toContain('企业微信群机器人 Webhook URL')
    expect(form.text()).toContain('私有化平台地址')

    await typeSelect.setValue('slack')
    expect(form.text()).toContain('Slack Incoming Webhook URL')

    await typeSelect.setValue('feishu')
    expect(form.text()).toContain('飞书自定义机器人 Webhook URL')
    expect(form.text()).toContain('飞书签名密钥')

    await typeSelect.setValue('dingtalk')
    expect(form.text()).toContain('钉钉自定义机器人 Webhook URL')
    expect(form.text()).toContain('钉钉加签密钥')

    await typeSelect.setValue('telegram')
    expect(form.text()).toContain('Telegram Bot Token')
    expect(form.text()).toContain('Telegram Chat ID')
    expect(form.text()).toContain('Telegram Topic ID（可选）')
    expect(form.text()).toContain('官方 Bot API sendMessage')

    await typeSelect.setValue('webhook')
    expect(form.text()).toContain('HTTP 方法')
    expect(form.text()).toContain('固定 Header（JSON）')
    expect(form.text()).toContain('HMAC-SHA256 签名密钥')
    expect(form.findAll('input[type="password"]').length).toBe(2)
  })

  it('企业微信私有化地址保存到当前渠道配置而非全局设置', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [] })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })
    securityApiMocks.createSecret.mockResolvedValue({ data: { id: 'sec-wecom-private', secretRef: 'secret://api_token/sec-wecom-private#current' } })
    apiMocks.createNotificationChannel.mockResolvedValue({ data: { id: 'channel-wecom-private' } })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'channels\')">channels</button></nav>' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建通知渠道')
    await createButton?.trigger('click')
    const form = wrapper.get('#notification-channel-form')
    await form.get('input:not([type="password"])').setValue('私有企业微信')
    await form.get('select').setValue('wecom')
    const privateOriginField = form.findAll('label').find((label) => label.text().includes('私有化平台地址'))
    await privateOriginField!.get('input').setValue('https://wecom.example.internal')
    await form.get('input[type="password"]').setValue('https://wecom.example.internal/custom/webhook?key=plaintext-token')
    await form.trigger('submit')
    await flushPromises()

    expect(apiMocks.createNotificationChannel).toHaveBeenCalledWith(expect.objectContaining({
      name: '私有企业微信',
      type: 'wecom',
      config: { privateOrigin: 'https://wecom.example.internal' },
      secretRefs: { webhookUrl: 'secret://api_token/sec-wecom-private#current' }
    }))
    const request = JSON.stringify(apiMocks.createNotificationChannel.mock.calls)
    expect(request).not.toContain('privateOrigins')
    expect(request).not.toContain('plaintext-token')
  })

  it('编辑私有化渠道时只更新当前渠道的 Origin，不要求重填密文', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({
      data: [{
        id: 'channel-wecom-private', name: '私有企业微信', type: 'wecom', status: 'disabled',
        config: { privateOrigin: 'https://wecom.old.internal' }, secretRefs: { webhookUrl: 'secret://api_token/wecom#current' },
        healthStatus: 'unknown', version: 7
      }]
    })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })
    apiMocks.updateNotificationChannel.mockResolvedValue({ data: { id: 'channel-wecom-private' } })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'channels\')">channels</button></nav>' },
          GcModal: { props: ['open', 'title'], template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>' },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')
    const editButton = wrapper.findAll('button').find((button) => button.text() === '编辑')
    await editButton?.trigger('click')
    const form = wrapper.get('#notification-channel-form')
    const privateOriginField = form.findAll('label').find((label) => label.text().includes('私有化平台地址'))
    await privateOriginField!.get('input').setValue('https://wecom.new.internal')
    await form.trigger('submit')
    await flushPromises()
    expect(apiMocks.updateNotificationChannel).toHaveBeenCalledWith('channel-wecom-private', {
      version: 7,
      name: '私有企业微信',
      config: { privateOrigin: 'https://wecom.new.internal' }
    })
  })

  it('Telegram Bot Token 只写入 Secret 服务，渠道请求使用固定 Bot API 配置', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [] })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })
    securityApiMocks.createSecret.mockResolvedValue({ data: { id: 'sec-telegram', secretRef: 'secret://api_token/sec-telegram#current' } })
    apiMocks.createNotificationChannel.mockResolvedValue({ data: { id: 'channel-telegram' } })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'channels\')">channels</button></nav>' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建通知渠道')
    await createButton?.trigger('click')
    const form = wrapper.get('#notification-channel-form')
    await form.get('input:not([type="password"])').setValue('生产 Telegram')
    await form.get('select').setValue('telegram')
    await form.get('input[type="password"]').setValue('123456:plaintext-token')
    const chatIdField = form.findAll('label').find((label) => label.text().includes('Telegram Chat ID'))
    const topicIdField = form.findAll('label').find((label) => label.text().includes('Telegram Topic ID'))
    await chatIdField!.get('input').setValue('-100123456')
    await topicIdField!.get('input').setValue('7')
    await form.trigger('submit')
    await flushPromises()

    expect(securityApiMocks.createSecret).toHaveBeenCalledWith(expect.objectContaining({
      type: 'api_token',
      plainText: '123456:plaintext-token'
    }))
    expect(apiMocks.createNotificationChannel, wrapper.text()).toHaveBeenCalledWith(expect.objectContaining({
      name: '生产 Telegram',
      type: 'telegram',
      config: { chatId: '-100123456', messageThreadId: 7 },
      secretRefs: { botToken: 'secret://api_token/sec-telegram#current' }
    }))
    expect(JSON.stringify(apiMocks.createNotificationChannel.mock.calls)).not.toContain('plaintext-token')
  })

  it('事件定义固定证书来源并使用事件类型匹配', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [{ id: 'channel-1', name: '运维邮件', type: 'email', status: 'active', config: {}, secretRefs: {}, healthStatus: 'healthy', version: 1 }] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [{ id: 'template-1', templateKey: 'certificate.status', locale: 'zh-CN', titleTemplate: '状态 {{status}}', bodyTemplate: '正文', requiredVariables: ['status'], status: 'active', updatedAt: '2026-08-28T00:00:00.000Z', version: 2 }] })
    apiMocks.createNotificationRoute.mockResolvedValue({ data: { id: 'route-1' } })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'events\')">events</button></nav>' },
          GcModal: { props: ['open', 'title'], template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>' },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('事件定义')
    const configureButtons = wrapper.findAll('button').filter((button) => button.text() === '配置')
    await configureButtons[1]?.trigger('click')
    const form = wrapper.get('#notification-route-form')
    const selects = form.findAll('select')
    await selects[0].setValue('channel-1')
    await selects[1].setValue('certificate.status')
    await form.trigger('submit')
    await flushPromises()

    expect(apiMocks.createNotificationRoute).toHaveBeenCalledWith(expect.objectContaining({
      matcher: { sources: ['certificate'], eventTypes: ['certificate.status'] },
      templateKey: 'certificate.status',
      channelTargets: [{ channelId: 'channel-1' }]
    }))
  })

  it('事件页展示全部预置证书场景且不提供新增事件入口', async () => {
    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav />' },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()

    expect(wrapper.text()).toContain('证书续期结果')
    expect(wrapper.text()).toContain('证书状态变更')
    expect(wrapper.text()).toContain('证书定期报表')
    expect(wrapper.findAll('button').some((button) => button.text() === '新建事件定义')).toBe(false)
  })

  it('投递记录按失败状态筛选，并显示关联事件和重试进度', async () => {
    apiMocks.listNotificationDeliveries.mockResolvedValue({
      data: { items: [{ id: 'delivery-1', requestId: 'request-1', channelNameSnapshot: '运维邮件', channelType: 'email', status: 'failed', attemptCount: 2, maxAttempts: 3, failureCategory: 'network', createdAt: '2026-08-28T00:00:00.000Z' }], page: 1, pageSize: 100, total: 1 }
    })
    apiMocks.listNotificationRequests.mockResolvedValue({
      data: { items: [{ id: 'request-1', source: 'certificate', eventType: 'certificate.status', templateKey: 'certificate.status', status: 'failed', createdAt: '2026-08-28T00:00:00.000Z' }], page: 1, pageSize: 100, total: 1 }
    })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'deliveries\')">deliveries</button></nav>' },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')

    expect(wrapper.text()).toContain('certificate.status')
    expect(wrapper.text()).toContain('第 2 / 3 次')
    await wrapper.get('.notifications-page__filter select').setValue('failed')
    expect(wrapper.text()).toContain('重新投递')
  })

  it('模板预览在模态框内显示，不复用错误提示区域', async () => {
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [{ id: 'template-1', templateKey: 'certificate.status', locale: 'zh-CN', titleTemplate: '证书 {{domain}}', bodyTemplate: '状态 {{status}}', requiredVariables: ['domain', 'status'], status: 'active', updatedAt: '2026-08-28T00:00:00.000Z', version: 1 }] })
    apiMocks.previewNotificationTemplate.mockResolvedValue({ data: { title: '证书 example.com', body: '状态 active', missingVariables: [], templateVersion: 1 } })

    const wrapper = mount(NotificationsView, {
      global: {
        plugins: [i18n],
        stubs: {
          GcTabs: { props: ['modelValue'], template: '<nav><button @click="$emit(\'update:modelValue\', \'templates\')">templates</button></nav>' },
          GcModal: { props: ['open', 'title'], template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>' },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()
    await wrapper.get('nav button').trigger('click')
    const previewButton = wrapper.findAll('button').find((button) => button.text() === '预览')
    await previewButton?.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="dialog"]').text()).toContain('证书 example.com')
    expect(wrapper.find('.notifications-page__error').exists()).toBe(false)
  })
})
