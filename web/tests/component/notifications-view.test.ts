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
  updateNotificationChannel: vi.fn(),
  testNotificationChannel: vi.fn(),
  retryNotificationDelivery: vi.fn()
}))

vi.mock('@/api/modules/notifications.api', () => apiMocks)

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
          GcPageHeader: { template: '<header><slot name="actions" /></header>' },
          GcTabs: {
            props: ['modelValue'],
            template: '<nav><button @click="$emit(\'update:modelValue\', \'channels\')">channels</button></nav>'
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
    expect(wrapper.find('input[autocomplete="off"]').exists()).toBe(true)
  })
})
