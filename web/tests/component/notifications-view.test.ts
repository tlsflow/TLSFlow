import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import NotificationsView from '@/views/settings/NotificationsView.vue'

const apiMocks = vi.hoisted(() => ({
  listNotificationChannels: vi.fn(),
  listNotificationDeliveries: vi.fn(),
  listNotificationRoutes: vi.fn(),
  listNotificationTemplates: vi.fn(),
  listNotificationSilences: vi.fn(),
  createNotificationChannel: vi.fn(),
  createNotificationRoute: vi.fn(),
  createNotificationSilence: vi.fn(),
  saveNotificationTemplate: vi.fn(),
  updateNotificationChannel: vi.fn(),
  testNotificationChannel: vi.fn(),
  retryNotificationDelivery: vi.fn()
}))
const securityApiMocks = vi.hoisted(() => ({ createSecret: vi.fn() }))

vi.mock('@/api/modules/notifications.api', () => apiMocks)
vi.mock('@/api/modules/security.api', () => securityApiMocks)

describe('NotificationsView', () => {
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

  it('企微、Slack 和通用 Webhook 显示各自完整配置字段', async () => {
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

    await typeSelect.setValue('slack')
    expect(form.text()).toContain('Slack Incoming Webhook URL')

    await typeSelect.setValue('webhook')
    expect(form.text()).toContain('HTTP 方法')
    expect(form.text()).toContain('固定 Header（JSON）')
    expect(form.text()).toContain('HMAC-SHA256 签名密钥')
    expect(form.findAll('input[type="password"]').length).toBe(2)
  })
})
