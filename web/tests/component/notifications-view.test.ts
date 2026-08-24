import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import NotificationsView from '@/views/settings/NotificationsView.vue'

const apiMocks = vi.hoisted(() => ({
  listNotificationChannels: vi.fn(),
  listNotificationDeliveries: vi.fn(),
  listNotificationRoutes: vi.fn(),
  listNotificationTemplates: vi.fn(),
  listNotificationSilences: vi.fn(),
  getNotificationSettings: vi.fn(),
  createNotificationChannel: vi.fn(),
  createNotificationRoute: vi.fn(),
  createNotificationSilence: vi.fn(),
  saveNotificationTemplate: vi.fn(),
  updateNotificationChannel: vi.fn(),
  testNotificationChannel: vi.fn(),
  retryNotificationDelivery: vi.fn(),
  updateNotificationSettings: vi.fn()
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
    apiMocks.getNotificationSettings.mockResolvedValue({ data: { tenantId: 'tenant-1', privateOrigins: { wecom: [], feishu: [], dingtalk: [] }, version: 0 } })
    apiMocks.updateNotificationSettings.mockResolvedValue({ data: { tenantId: 'tenant-1', privateOrigins: { wecom: [], feishu: [], dingtalk: [] }, version: 1 } })
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

  it('系统管理员可以保存三种私有化平台 Origin', async () => {
    apiMocks.listNotificationChannels.mockResolvedValue({ data: [] })
    apiMocks.listNotificationDeliveries.mockResolvedValue({ data: { items: [], page: 1, pageSize: 100, total: 0 } })
    apiMocks.listNotificationRoutes.mockResolvedValue({ data: [] })
    apiMocks.listNotificationTemplates.mockResolvedValue({ data: [] })
    apiMocks.listNotificationSilences.mockResolvedValue({ data: [] })
    apiMocks.getNotificationSettings.mockResolvedValue({
      data: { tenantId: 'tenant-1', privateOrigins: { wecom: ['https://wecom.old.internal'], feishu: [], dingtalk: [] }, version: 3 }
    })
    apiMocks.updateNotificationSettings.mockResolvedValue({
      data: { tenantId: 'tenant-1', privateOrigins: { wecom: ['https://wecom.internal'], feishu: ['https://feishu.internal:8443'], dingtalk: ['https://dingtalk.internal'] }, version: 4 }
    })

    const wrapper = mount(NotificationsView, { global: { plugins: [i18n], stubs: { GcTabs: { props: ['modelValue'], template: '<nav />' } } } })
    await flushPromises()
    const settingsForm = wrapper.get('form.notifications-page__settings')
    const fields = settingsForm.findAll('textarea')
    await fields[0]!.setValue('https://wecom.internal/path?token=secret')
    await settingsForm.trigger('submit')
    await flushPromises()
    expect(apiMocks.updateNotificationSettings).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('精确 HTTPS Origin')

    await fields[0]!.setValue('https://wecom.internal')
    await fields[1]!.setValue('https://feishu.internal:8443')
    await fields[2]!.setValue('https://dingtalk.internal')
    await settingsForm.trigger('submit')
    await flushPromises()
    expect(apiMocks.updateNotificationSettings).toHaveBeenCalledWith({
      version: 3,
      wecomPrivateOrigins: ['https://wecom.internal'],
      feishuPrivateOrigins: ['https://feishu.internal:8443'],
      dingtalkPrivateOrigins: ['https://dingtalk.internal']
    })
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
          GcTabs: { props: ['modelValue'], template: '<nav />' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()

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
          GcTabs: { props: ['modelValue'], template: '<nav />' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建通知渠道')
    await createButton?.trigger('click')
    const form = wrapper.get('#notification-channel-form')
    const typeSelect = form.get('select')

    await typeSelect.setValue('wecom')
    expect(form.text()).toContain('企业微信群机器人 Webhook URL')
    expect(form.text()).toContain('部署模式')
    expect(form.text()).toContain('公有云')
    expect(form.text()).toContain('私有化部署')

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

  it('企业微信私有化模式允许企业 HTTPS 地址且渠道记录不保存白名单配置', async () => {
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
          GcTabs: { props: ['modelValue'], template: '<nav />' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text() === '新建通知渠道')
    await createButton?.trigger('click')
    const form = wrapper.get('#notification-channel-form')
    await form.get('input:not([type="password"])').setValue('私有企业微信')
    await form.get('select').setValue('wecom')
    const deploymentField = form.findAll('label').find((label) => label.text().includes('部署模式'))
    await deploymentField!.get('select').setValue('private')
    expect(form.text()).toContain('受信任 HTTPS Origin 白名单')
    await form.get('input[type="password"]').setValue('https://wecom.example.internal/custom/webhook?key=plaintext-token')
    await form.trigger('submit')
    await flushPromises()

    expect(apiMocks.createNotificationChannel).toHaveBeenCalledWith(expect.objectContaining({
      name: '私有企业微信',
      type: 'wecom',
      config: {},
      secretRefs: { webhookUrl: 'secret://api_token/sec-wecom-private#current' }
    }))
    const request = JSON.stringify(apiMocks.createNotificationChannel.mock.calls)
    expect(request).not.toContain('deploymentMode')
    expect(request).not.toContain('privateOrigins')
    expect(request).not.toContain('plaintext-token')
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
          GcTabs: { props: ['modelValue'], template: '<nav />' },
          GcModal: {
            props: ['open', 'title'],
            template: '<section v-if="open" role="dialog"><h2>{{ title }}</h2><slot /><slot name="actions" /></section>'
          },
          GcStatusTag: { props: ['status'], template: '<span>{{ status }}</span>' }
        }
      }
    })
    await flushPromises()

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
})
