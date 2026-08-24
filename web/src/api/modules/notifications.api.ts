import { apiClient } from '@/api/client'

export type NotificationChannelType = 'email' | 'wecom' | 'slack' | 'feishu' | 'dingtalk' | 'telegram' | 'webhook'

export interface NotificationChannel {
  id: string
  name: string
  type: NotificationChannelType
  status: 'active' | 'disabled' | 'deleted'
  config: Record<string, unknown>
  secretRefs: Record<string, string>
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unavailable'
  lastSucceededAt?: string
  lastFailedAt?: string
  lastLatencyMs?: number
  version: number
}

export interface NotificationDelivery {
  id: string
  requestId: string
  channelNameSnapshot: string
  channelType: NotificationChannelType
  status: string
  attemptCount: number
  failureCategory?: string
  failureMessage?: string
  latencyMs?: number
  deliveredAt?: string
  createdAt: string
}

export interface NotificationPage<T> { items: T[]; page: number; pageSize: number; total: number }

export function listNotificationChannels() { return apiClient.get<NotificationChannel[]>('/v1/notification-channels') }
export function createNotificationChannel(input: Omit<NotificationChannel, 'id' | 'healthStatus' | 'lastSucceededAt' | 'lastFailedAt' | 'lastLatencyMs' | 'version'>) {
  return apiClient.post<NotificationChannel>('/v1/notification-channels', input)
}
export function updateNotificationChannel(id: string, input: Partial<NotificationChannel> & { version: number }) {
  return apiClient.request<NotificationChannel>(`/v1/notification-channels/${id}`, { method: 'PATCH', body: input })
}
export function testNotificationChannel(id: string, target: Record<string, unknown>) {
  return apiClient.post(`/v1/notification-channels/${id}/actions/test`, { target })
}
export function listNotificationDeliveries() { return apiClient.get<NotificationPage<NotificationDelivery>>('/v1/notification-deliveries?pageSize=100') }
export function retryNotificationDelivery(id: string) { return apiClient.post<NotificationDelivery>(`/v1/notification-deliveries/${id}/actions/retry`) }
export function listNotificationRoutes() { return apiClient.get<Record<string, unknown>[]>('/v1/notification-routes') }
export function listNotificationTemplates() { return apiClient.get<Record<string, unknown>[]>('/v1/notification-templates') }
export function listNotificationSilences() { return apiClient.get<Record<string, unknown>[]>('/v1/notification-silences') }
export function createNotificationRoute(input: Record<string, unknown>) { return apiClient.post('/v1/notification-routes', input) }
export function saveNotificationTemplate(input: Record<string, unknown>) { return apiClient.post('/v1/notification-templates', input) }
export function createNotificationSilence(input: Record<string, unknown>) { return apiClient.post('/v1/notification-silences', input) }
