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
  nextAttemptAt?: string
  dispatchGeneration?: number
  dispatchTaskId?: string
  renderedTitle?: string
  renderedBody?: string
}

export interface NotificationDeliveryAttempt {
  id: string
  attemptNo: number
  startedAt: string
  finishedAt?: string
  success?: boolean
  retryable?: boolean
  failureCategory?: string
  failureMessage?: string
  latencyMs?: number
}

export interface NotificationDeliveryOutbox {
  id: string
  dispatchGeneration: number
  status: string
  attempts: number
  nextAttemptAt: string
  taskId?: string
  lastError?: string
}

export interface NotificationDeliveryDetail {
  delivery: NotificationDelivery
  attempts: NotificationDeliveryAttempt[]
  outbox: NotificationDeliveryOutbox[]
}

export interface NotificationSettings {
  tenantId: string
  privateOrigins: { wecom: string[]; feishu: string[]; dingtalk: string[] }
  updatedBy?: string
  updatedAt?: string
  version: number
}

export interface NotificationPage<T> { items: T[]; page: number; pageSize: number; total: number }

export function getNotificationSettings() { return apiClient.get<NotificationSettings>('/v1/notification-settings') }
export function updateNotificationSettings(input: { version: number; wecomPrivateOrigins: string[]; feishuPrivateOrigins: string[]; dingtalkPrivateOrigins: string[] }) {
  return apiClient.request<NotificationSettings>('/v1/notification-settings', { method: 'PATCH', body: input })
}
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
export function getNotificationDelivery(id: string) { return apiClient.get<NotificationDeliveryDetail>(`/v1/notification-deliveries/${id}`) }
export function retryNotificationDelivery(id: string) { return apiClient.post<{ deliveryId: string; dispatchGeneration: number; attemptNo: number; taskKey: string }>(`/v1/notification-deliveries/${id}/actions/retry`) }
export function previewNotificationTemplate(input: Record<string, unknown>) { return apiClient.post<{ title: string; body: string; missingVariables: string[]; templateVersion: number }>('/v1/notification-templates/preview', input) }
export function listNotificationRoutes() { return apiClient.get<Record<string, unknown>[]>('/v1/notification-routes') }
export function listNotificationTemplates() { return apiClient.get<Record<string, unknown>[]>('/v1/notification-templates') }
export function listNotificationSilences() { return apiClient.get<Record<string, unknown>[]>('/v1/notification-silences') }
export function createNotificationRoute(input: Record<string, unknown>) { return apiClient.post('/v1/notification-routes', input) }
export function saveNotificationTemplate(input: Record<string, unknown>) { return apiClient.post('/v1/notification-templates', input) }
export function createNotificationSilence(input: Record<string, unknown>) { return apiClient.post('/v1/notification-silences', input) }
