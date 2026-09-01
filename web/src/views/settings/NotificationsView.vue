<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcPageToolbar, GcSecretInput, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { createSecret } from '@/api/modules/security.api'
import {
  createNotificationChannel,
  createNotificationRoute,
  listNotificationChannels,
  listNotificationDeliveries,
  listNotificationEventDefinitions,
  listNotificationRequests,
  listNotificationRoutes,
  listNotificationTemplates,
  getNotificationDelivery,
  previewNotificationTemplate,
  retryNotificationDelivery,
  saveNotificationTemplate,
  testNotificationChannel,
  updateNotificationChannel,
  updateNotificationRoute,
  updateNotificationTemplate,
  type NotificationChannel,
  type NotificationChannelType,
  type NotificationDelivery,
  type NotificationDeliveryDetail,
  type NotificationEventDefinition,
  type NotificationRequest,
  type NotificationRoute,
  type NotificationTemplate
} from '@/api/modules/notifications.api'

type DialogType = 'channel' | 'route' | 'template' | 'test' | 'preview' | null

const { t } = useI18n()
const activeTab = ref('events')
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const activeDialog = ref<DialogType>(null)
const testingChannel = ref<NotificationChannel | null>(null)
const editingChannel = ref<NotificationChannel | null>(null)
const editingRoute = ref<NotificationRoute | null>(null)
const editingTemplate = ref<NotificationTemplate | null>(null)
const previewedTemplate = ref<NotificationTemplate | null>(null)
const templatePreview = ref<{ title: string; body: string; missingVariables: string[]; templateVersion: number } | null>(null)
const channels = ref<NotificationChannel[]>([])
const deliveries = ref<NotificationDelivery[]>([])
const requests = ref<NotificationRequest[]>([])
const selectedDeliveryDetail = ref<NotificationDeliveryDetail | null>(null)
const deliveryStatusFilter = ref('all')
const routes = ref<NotificationRoute[]>([])
const eventDefinitions = ref<NotificationEventDefinition[]>([])
const templates = ref<NotificationTemplate[]>([])
const channelForm = reactive({
  name: '',
  type: 'email' as NotificationChannelType,
  host: '',
  port: '587',
  from: '',
  smtpSecurity: 'starttls' as 'starttls' | 'ssl',
  username: '',
  password: '',
  privateOrigin: '',
  webhookUrl: '',
  method: 'POST',
  headersJson: '',
  signingSecret: '',
  botToken: '',
  chatId: '',
  messageThreadId: '' as string | number
})
const testForm = reactive({ target: '' })
const routeForm = reactive({ name: '', channelId: '', eventType: 'certificate.renewal.result', templateKey: '', priority: '100' })
const templateForm = reactive({ templateKey: '', titleTemplate: '', bodyTemplate: '' })

const tabs = computed(() => [
  { value: 'events', label: t('notifications.tabs.events') },
  { value: 'templates', label: t('notifications.tabs.templates') },
  { value: 'channels', label: t('notifications.tabs.channels') },
  { value: 'deliveries', label: t('notifications.tabs.deliveries') },
])

const certificateEventTypes = computed(() => [
  { value: 'certificate.renewal.result', label: t('notifications.eventTypes.renewalResult') },
  { value: 'certificate.status', label: t('notifications.eventTypes.status') },
  { value: 'certificate.report', label: t('notifications.eventTypes.report') },
  { value: 'certificate.expiry.warning', label: t('notifications.eventTypes.expiryWarning') },
  { value: 'certificate.expired', label: t('notifications.eventTypes.expired') },
  { value: 'certificate.revoked', label: t('notifications.eventTypes.revoked') },
  { value: 'certificate.binding.drift', label: t('notifications.eventTypes.bindingDrift') },
  { value: 'certificate.report.failed', label: t('notifications.eventTypes.reportFailed') }
])

const templateOptions = computed(() => {
  const options = new Map(templates.value.map((template) => [template.templateKey, template.templateKey]))
  for (const definition of eventDefinitions.value) options.set(definition.templateKey, definition.templateKey)
  return [...options.values()]
})

function eventDefinitionLabel(eventType: string) {
  return certificateEventTypes.value.find((item) => item.value === eventType)?.label ?? eventType
}

function eventDefinitionDescription(eventType: string) {
  if (eventType === 'certificate.renewal.result') return t('notifications.events.renewalResultDescription')
  if (eventType === 'certificate.status') return t('notifications.events.statusDescription')
  if (eventType === 'certificate.report') return t('notifications.events.reportDescription')
  if (eventType === 'certificate.expiry.warning') return t('notifications.events.expiryWarningDescription')
  if (eventType === 'certificate.expired') return t('notifications.events.expiredDescription')
  if (eventType === 'certificate.revoked') return t('notifications.events.revokedDescription')
  if (eventType === 'certificate.binding.drift') return t('notifications.events.bindingDriftDescription')
  if (eventType === 'certificate.report.failed') return t('notifications.events.reportFailedDescription')
  return eventType
}

function routeForEvent(eventType: string) {
  return routes.value.find((route) => {
    const eventTypes = route.matcher.eventTypes ?? []
    const sources = route.matcher.sources ?? []
    const matchesEvent = eventTypes.includes(eventType) || (!eventTypes.length && sources.includes(eventType))
    const matchesSource = !sources.length || sources.includes('certificate') || sources.includes(eventType)
    return matchesEvent && matchesSource
  })
}

const deliveryStatusFilters = computed(() => [
  { value: 'all', label: t('notifications.deliveryFilters.all') },
  { value: 'failed', label: t('notifications.deliveryFilters.failed') },
  { value: 'retrying', label: t('notifications.deliveryFilters.retrying') },
  { value: 'queued', label: t('notifications.deliveryFilters.queued') },
  { value: 'delivered', label: t('notifications.deliveryFilters.delivered') }
])

const filteredDeliveries = computed(() => deliveryStatusFilter.value === 'all'
  ? deliveries.value
  : deliveries.value.filter((delivery) => delivery.status === deliveryStatusFilter.value))
const previewMissingVariables = computed(() => templatePreview.value?.missingVariables ?? [])

const dialogTitle = computed(() => {
  if (activeDialog.value === 'channel') return t(editingChannel.value ? 'notifications.channels.editTitle' : 'notifications.channels.createTitle')
  if (activeDialog.value === 'route') return t(editingRoute.value ? 'notifications.events.editTitle' : 'notifications.events.createTitle')
  if (activeDialog.value === 'template') return t(editingTemplate.value ? 'notifications.templates.editTitle' : 'notifications.templates.createTitle')
  if (activeDialog.value === 'test') return t('notifications.actions.testChannel', { name: testingChannel.value?.name ?? '' })
  if (activeDialog.value === 'preview') return t('notifications.templates.previewTitle', { key: previewedTemplate.value?.templateKey ?? '' })
  return ''
})

function recordValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return t('notifications.values.notAvailable')
}

function routeChannelName(route: NotificationRoute) {
  const channelId = route.channelTargets[0]?.channelId
  return channels.value.find((channel) => channel.id === channelId)?.name ?? recordValue(channelId)
}

function routeEventType(route: NotificationRoute) {
  return route.matcher.eventTypes?.join(', ') ?? route.matcher.sources?.join(', ') ?? t('notifications.values.notAvailable')
}

function requestForDelivery(delivery: NotificationDelivery) {
  return requests.value.find((request) => request.id === delivery.requestId)
}

function deliveryEventType(delivery: NotificationDelivery) {
  return requestForDelivery(delivery)?.eventType ?? t('notifications.values.notAvailable')
}

function deliveryTemplateKey(delivery: NotificationDelivery) {
  return requestForDelivery(delivery)?.templateKey ?? t('notifications.values.notAvailable')
}

function deliveryAttemptSummary(delivery: NotificationDelivery) {
  return t('notifications.summary.attemptProgress', { current: delivery.attemptCount, total: delivery.maxAttempts })
}

function attemptStatus(success: boolean | undefined, finishedAt: string | undefined) {
  if (success === true) return 'delivered'
  return finishedAt ? 'failed' : 'sending'
}

function isPrivatePlatform(type: NotificationChannelType) {
  return type === 'wecom' || type === 'feishu' || type === 'dingtalk'
}

function channelPrivateOrigin(channel: NotificationChannel) {
  return typeof channel.config.privateOrigin === 'string' ? channel.config.privateOrigin : ''
}

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [channelResult, deliveryResult, requestResult, eventDefinitionResult, routeResult, templateResult] = await Promise.all([
      listNotificationChannels(), listNotificationDeliveries(), listNotificationRequests(), listNotificationEventDefinitions(), listNotificationRoutes(), listNotificationTemplates()
    ])
    channels.value = channelResult.data ?? []
    deliveries.value = deliveryResult.data?.items ?? []
    requests.value = requestResult.data?.items ?? []
    eventDefinitions.value = eventDefinitionResult.data ?? []
    routes.value = routeResult.data ?? []
    templates.value = templateResult.data ?? []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

function openDialog(dialog: Exclude<DialogType, 'test' | 'preview' | null>) {
  errorMessage.value = ''
  if (dialog === 'channel') {
    editingChannel.value = null
    resetChannelForm()
  }
  if (dialog === 'route') {
    editingRoute.value = null
    resetRouteForm()
  }
  if (dialog === 'template') {
    editingTemplate.value = null
    resetTemplateForm()
  }
  activeDialog.value = dialog
}

function openEventConfig(definition: NotificationEventDefinition) {
  const existing = routeForEvent(definition.eventType)
  editingRoute.value = existing ?? null
  Object.assign(routeForm, {
    name: existing?.name ?? `${eventDefinitionLabel(definition.eventType)}通知`,
    channelId: existing?.channelTargets[0]?.channelId ?? '',
    eventType: definition.eventType,
    templateKey: existing?.templateKey ?? definition.templateKey,
    priority: String(existing?.priority ?? 100)
  })
  errorMessage.value = ''
  activeDialog.value = 'route'
}

function openTestDialog(channel: NotificationChannel) {
  testForm.target = ''
  testingChannel.value = channel
  activeDialog.value = 'test'
}

function closeDialog() {
  if (submitting.value) return
  activeDialog.value = null
  testingChannel.value = null
  editingChannel.value = null
  editingRoute.value = null
  editingTemplate.value = null
  previewedTemplate.value = null
  templatePreview.value = null
}

async function submit(action: () => Promise<void>) {
  submitting.value = true
  errorMessage.value = ''
  try {
    await action()
    activeDialog.value = null
    testingChannel.value = null
    await refresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.operationFailed')
  } finally {
    submitting.value = false
  }
}

async function saveChannelSecret(field: string, plainText: string, type: 'password' | 'api_token') {
  if (!plainText.trim()) return undefined
  const secret = await createSecret({
    name: t('notifications.secrets.name', { channel: channelForm.name.trim(), field: t(`notifications.secrets.fields.${field}`) }),
    type,
    scopeType: 'global',
    plainText,
    metadata: { notificationChannel: true, channelType: channelForm.type, field }
  })
  const secretRef = String(secret.data?.secretRef ?? '')
  if (!secretRef) throw new Error(t('notifications.messages.createSecretFailed'))
  return secretRef
}

function webhookHeaders() {
  const source = channelForm.headersJson.trim()
  if (!source) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    throw new Error(t('notifications.messages.invalidHeaders'))
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(t('notifications.messages.invalidHeaders'))
  }
  return parsed as Record<string, unknown>
}

function privateOriginFromForm() {
  const value = channelForm.privateOrigin.trim()
  if (!value) return undefined
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(t('notifications.messages.privateOriginInvalid'))
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(t('notifications.messages.privateOriginInvalid'))
  }
  return url.origin
}

function assertPlatformWebhookUrl(type: 'feishu' | 'dingtalk', value: string, privateOrigin?: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(t(`notifications.messages.${type}WebhookUrlInvalid`))
  }
  if (privateOrigin) {
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== privateOrigin) {
      throw new Error(t('notifications.messages.privateOriginMismatch'))
    }
    return
  }
  const valid = type === 'feishu'
    ? url.protocol === 'https:' && ['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname) && url.pathname.startsWith('/open-apis/bot/v2/hook/')
    : url.protocol === 'https:' && url.hostname === 'oapi.dingtalk.com' && url.pathname === '/robot/send'
  if (!valid) throw new Error(t(`notifications.messages.${type}WebhookUrlInvalid`))
}

function resetChannelForm() {
  Object.assign(channelForm, {
    name: '', type: 'email', host: '', port: '587', from: '', smtpSecurity: 'starttls', username: '', password: '',
    privateOrigin: '', webhookUrl: '', method: 'POST', headersJson: '', signingSecret: '', botToken: '', chatId: '', messageThreadId: ''
  })
}

function openEditChannel(channel: NotificationChannel) {
  const config = channel.config
  editingChannel.value = channel
  Object.assign(channelForm, {
    name: channel.name,
    type: channel.type,
    host: typeof config.host === 'string' ? config.host : '',
    port: typeof config.port === 'number' ? String(config.port) : '587',
    from: typeof config.from === 'string' ? config.from : '',
    smtpSecurity: config.secure === true ? 'ssl' : 'starttls',
    username: '',
    password: '',
    privateOrigin: channelPrivateOrigin(channel),
    webhookUrl: '',
    method: typeof config.method === 'string' ? config.method : 'POST',
    headersJson: config.headers && typeof config.headers === 'object' ? JSON.stringify(config.headers, null, 2) : '',
    signingSecret: '',
    botToken: '',
    chatId: typeof config.chatId === 'string' ? config.chatId : '',
    messageThreadId: typeof config.messageThreadId === 'number' ? String(config.messageThreadId) : ''
  })
  errorMessage.value = ''
  activeDialog.value = 'channel'
}

async function saveChannel() {
  await submit(async () => {
    const existing = editingChannel.value
    const secretRefs: Record<string, string> = {}
    let config: Record<string, unknown> = existing ? { ...existing.config } : {}
    if (channelForm.type === 'email') {
      if (Boolean(channelForm.username.trim()) !== Boolean(channelForm.password.trim())) {
        throw new Error(t('notifications.messages.smtpCredentialsPairRequired'))
      }
      const [usernameRef, passwordRef] = await Promise.all([
        saveChannelSecret('smtpUsername', channelForm.username.trim(), 'password'),
        saveChannelSecret('smtpPassword', channelForm.password, 'password')
      ])
      if (usernameRef) secretRefs.username = usernameRef
      if (passwordRef) secretRefs.password = passwordRef
      config = {
        ...config,
        host: channelForm.host.trim(),
        port: Number(channelForm.port),
        from: channelForm.from.trim(),
        secure: channelForm.smtpSecurity === 'ssl',
        startTls: channelForm.smtpSecurity === 'starttls',
        rejectUnauthorized: true
      }
    } else if (channelForm.type === 'wecom' || channelForm.type === 'slack') {
      const privateOrigin = isPrivatePlatform(channelForm.type) ? privateOriginFromForm() : undefined
      if (channelForm.type === 'wecom' && channelForm.webhookUrl.trim()) {
        assertWeComWebhookUrl(channelForm.webhookUrl.trim(), privateOrigin)
      }
      const webhookUrlRef = await saveChannelSecret('webhookUrl', channelForm.webhookUrl.trim(), 'api_token')
      if (!webhookUrlRef && !existing) throw new Error(t('notifications.messages.webhookUrlRequired'))
      if (webhookUrlRef) secretRefs.webhookUrl = webhookUrlRef
      if (privateOrigin) config.privateOrigin = privateOrigin
      else delete config.privateOrigin
    } else if (channelForm.type === 'feishu' || channelForm.type === 'dingtalk') {
      const privateOrigin = privateOriginFromForm()
      if (channelForm.webhookUrl.trim()) {
        assertPlatformWebhookUrl(channelForm.type, channelForm.webhookUrl.trim(), privateOrigin)
      }
      const [webhookUrlRef, signingSecretRef] = await Promise.all([
        saveChannelSecret('webhookUrl', channelForm.webhookUrl.trim(), 'api_token'),
        saveChannelSecret('signingSecret', channelForm.signingSecret, 'api_token')
      ])
      if (!webhookUrlRef && !existing) throw new Error(t('notifications.messages.webhookUrlRequired'))
      if (webhookUrlRef) secretRefs.webhookUrl = webhookUrlRef
      if (signingSecretRef) secretRefs.signingSecret = signingSecretRef
      if (privateOrigin) config.privateOrigin = privateOrigin
      else delete config.privateOrigin
    } else if (channelForm.type === 'telegram') {
      if (channelForm.botToken.trim() && !/^\d+:[A-Za-z0-9_-]+$/.test(channelForm.botToken.trim())) throw new Error(t('notifications.messages.telegramBotTokenInvalid'))
      const botTokenRef = await saveChannelSecret('botToken', channelForm.botToken.trim(), 'api_token')
      if (!botTokenRef && !existing) throw new Error(t('notifications.messages.botTokenRequired'))
      if (!channelForm.chatId.trim()) throw new Error(t('notifications.messages.chatIdRequired'))
      const messageThreadId = String(channelForm.messageThreadId).trim()
      if (messageThreadId && (!Number.isInteger(Number(messageThreadId)) || Number(messageThreadId) <= 0)) {
        throw new Error(t('notifications.messages.telegramMessageThreadIdInvalid'))
      }
      if (botTokenRef) secretRefs.botToken = botTokenRef
      config = {
        ...config,
        chatId: channelForm.chatId.trim(),
        ...(messageThreadId ? { messageThreadId: Number(messageThreadId) } : {})
      }
      if (!messageThreadId) delete config.messageThreadId
    } else {
      const headers = webhookHeaders()
      const [urlRef, signingSecretRef] = await Promise.all([
        saveChannelSecret('webhookUrl', channelForm.webhookUrl.trim(), 'api_token'),
        saveChannelSecret('signingSecret', channelForm.signingSecret, 'api_token')
      ])
      if (!urlRef && !existing) throw new Error(t('notifications.messages.webhookUrlRequired'))
      if (urlRef) secretRefs.url = urlRef
      if (signingSecretRef) secretRefs.signingSecret = signingSecretRef
      config = { ...config, method: channelForm.method, headers }
    }
    if (existing) {
      await updateNotificationChannel(existing.id, {
        version: existing.version,
        name: channelForm.name,
        config,
        ...(Object.keys(secretRefs).length ? { secretRefs } : {})
      })
    } else {
      await createNotificationChannel({
        name: channelForm.name,
        type: channelForm.type,
        status: 'disabled',
        config,
        secretRefs
      })
    }
    resetChannelForm()
    editingChannel.value = null
  })
}

function assertWeComWebhookUrl(value: string, privateOrigin?: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(t('notifications.messages.wecomWebhookUrlInvalid'))
  }
  if (privateOrigin) {
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== privateOrigin) {
      throw new Error(t('notifications.messages.privateOriginMismatch'))
    }
    return
  }
  if (url.protocol !== 'https:' || url.hostname !== 'qyapi.weixin.qq.com' || url.pathname !== '/cgi-bin/webhook/send') {
    throw new Error(t('notifications.messages.wecomWebhookUrlInvalid'))
  }
}

async function toggleChannel(channel: NotificationChannel) {
  await submit(async () => {
    await updateNotificationChannel(channel.id, { version: channel.version, status: channel.status === 'active' ? 'disabled' : 'active' })
  })
}

async function testChannel() {
  const channel = testingChannel.value
  if (!channel) return
  await submit(async () => {
    const target = channel.type === 'email'
      ? { to: testForm.target.split(',').map((item) => item.trim()).filter(Boolean) }
      : {}
    await testNotificationChannel(channel.id, target)
  })
}

async function retryDelivery(delivery: NotificationDelivery) {
  await submit(async () => {
    await retryNotificationDelivery(delivery.id)
  })
}

async function openDeliveryDetail(delivery: NotificationDelivery) {
  submitting.value = true
  try {
    const result = await getNotificationDelivery(delivery.id)
    selectedDeliveryDetail.value = result.data ?? null
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.operationFailed')
  } finally {
    submitting.value = false
  }
}

function resetRouteForm() {
  Object.assign(routeForm, { name: '', channelId: '', eventType: 'certificate.renewal.result', templateKey: '', priority: '100' })
}

async function toggleRoute(route: NotificationRoute) {
  await submit(async () => {
    await updateNotificationRoute(route.id, {
      version: route.version,
      status: route.status === 'active' ? 'disabled' : 'active'
    })
  })
}

function resetTemplateForm() {
  Object.assign(templateForm, { templateKey: '', titleTemplate: '', bodyTemplate: '' })
}

function openEditTemplate(template: NotificationTemplate) {
  editingTemplate.value = template
  Object.assign(templateForm, {
    templateKey: template.templateKey,
    titleTemplate: template.titleTemplate,
    bodyTemplate: template.bodyTemplate
  })
  errorMessage.value = ''
  activeDialog.value = 'template'
}

function templateRequiredVariables() {
  return [...new Set(`${templateForm.titleTemplate} ${templateForm.bodyTemplate}`.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g))].map((match) => match[1])
}

async function toggleTemplate(template: NotificationTemplate) {
  await submit(async () => {
    await updateNotificationTemplate(template.id, {
      templateKey: template.templateKey,
      locale: template.locale,
      titleTemplate: template.titleTemplate,
      bodyTemplate: template.bodyTemplate,
      requiredVariables: template.requiredVariables,
      status: template.status === 'active' ? 'disabled' : 'active',
      version: template.version
    })
  })
}

async function previewTemplate(template: NotificationTemplate) {
  submitting.value = true
  errorMessage.value = ''
  try {
    const result = await previewNotificationTemplate({
      templateKey: template.templateKey,
      locale: template.locale,
      context: {
        certificate: { domain: 'example.com', status: 'active', versionId: 'preview' },
        report: { id: 'preview', type: 'certificate' },
        status: 'active', domain: 'example.com', daysRemaining: 7, certificateVersionId: 'preview', resourceId: 'preview', reportId: 'preview', reportType: 'certificate', errorMessage: t('notifications.values.notAvailable'), title: t('notifications.values.notAvailable'), summary: t('notifications.values.notAvailable')
      }
    })
    templatePreview.value = result.data ?? null
    previewedTemplate.value = template
    activeDialog.value = 'preview'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.operationFailed')
  } finally {
    submitting.value = false
  }
}

async function createRoute() {
  await submit(async () => {
    const input = {
      name: routeForm.name,
      priority: Number(routeForm.priority),
      matcher: { sources: ['certificate'], eventTypes: [routeForm.eventType] },
      templateKey: routeForm.templateKey,
      channelTargets: [{ channelId: routeForm.channelId }],
      stopOnMatch: false
    }
    if (editingRoute.value) {
      await updateNotificationRoute(editingRoute.value.id, { ...input, version: editingRoute.value.version })
    } else {
      await createNotificationRoute(input)
    }
    resetRouteForm()
    editingRoute.value = null
  })
}

async function saveTemplate() {
  await submit(async () => {
    const input = {
      templateKey: templateForm.templateKey,
      locale: 'zh-CN',
      titleTemplate: templateForm.titleTemplate,
      bodyTemplate: templateForm.bodyTemplate,
      requiredVariables: templateRequiredVariables(),
      status: editingTemplate.value?.status ?? 'active'
    }
    if (editingTemplate.value) {
      await updateNotificationTemplate(editingTemplate.value.id, { ...input, version: editingTemplate.value.version })
    } else {
      await saveNotificationTemplate(input)
    }
    resetTemplateForm()
    editingTemplate.value = null
  })
}

onMounted(refresh)
</script>

<template>
  <section class="gc-page notifications-page">
    <p v-if="errorMessage" class="notifications-page__error" role="alert">{{ errorMessage }}</p>
    <GcPageToolbar>
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="refresh">{{ t('common.refresh') }}</button>
      </template>
      <template #primary>
        <button v-if="activeTab === 'templates'" class="gc-button gc-button--primary" type="button" @click="openDialog('template')">{{ t('notifications.actions.createTemplate') }}</button>
        <button v-if="activeTab === 'channels'" class="gc-button gc-button--primary" type="button" @click="openDialog('channel')">{{ t('notifications.actions.createChannel') }}</button>
      </template>
      <template #tabs>
        <GcTabs v-model="activeTab" :tabs="tabs" />
      </template>
    </GcPageToolbar>

    <p v-if="loading" class="notifications-page__loading" role="status">{{ t('common.loading') }}</p>

    <section v-if="activeTab === 'events'" class="notifications-page__section">
      <header class="notifications-page__toolbar">
        <div>
          <h2>{{ t('notifications.sections.events') }}</h2>
          <p>{{ t('notifications.events.description') }}</p>
        </div>
      </header>
      <div v-if="eventDefinitions.length" class="notifications-page__list">
        <div v-for="definition in eventDefinitions" :key="definition.eventType" class="notifications-page__event-row">
          <div class="notifications-page__event-main"><h3>{{ eventDefinitionLabel(definition.eventType) }}</h3><p>{{ eventDefinitionDescription(definition.eventType) }}</p></div>
          <div class="notifications-page__event-field"><span>{{ t('notifications.fields.templateKey') }}</span><strong>{{ routeForEvent(definition.eventType)?.templateKey ?? definition.templateKey }}</strong></div>
          <div class="notifications-page__event-field"><span>{{ t('notifications.fields.channel') }}</span><strong>{{ routeForEvent(definition.eventType) ? routeChannelName(routeForEvent(definition.eventType)!) : t('notifications.values.notConfigured') }}</strong></div>
          <div class="notifications-page__event-status"><GcStatusTag :status="routeForEvent(definition.eventType)?.status ?? 'disabled'" /></div>
          <div class="notifications-page__event-actions">
            <button class="gc-button" type="button" @click="openEventConfig(definition)">{{ routeForEvent(definition.eventType) ? t('common.edit') : t('notifications.actions.configure') }}</button>
            <button v-if="routeForEvent(definition.eventType)" class="gc-button" type="button" @click="toggleRoute(routeForEvent(definition.eventType)!)">{{ routeForEvent(definition.eventType)?.status === 'active' ? t('notifications.actions.disable') : t('notifications.actions.enable') }}</button>
          </div>
        </div>
      </div>
      <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.eventDefinitions') }}</p>
    </section>

    <section v-else-if="activeTab === 'templates'" class="notifications-page__section">
      <header class="notifications-page__toolbar">
        <div><h2>{{ t('notifications.sections.templates') }}</h2><p>{{ t('notifications.summary.recordCount', { count: templates.length }) }}</p></div>
      </header>
      <div v-if="templates.length" class="notifications-page__list">
        <article v-for="template in templates" :key="template.id" class="gc-card notifications-page__item">
          <div><h3>{{ template.templateKey }}</h3><p>{{ template.titleTemplate }}</p></div><GcStatusTag :status="template.status" />
          <dl>
            <div><dt>{{ t('notifications.fields.locale') }}</dt><dd>{{ template.locale }}</dd></div>
            <div><dt>{{ t('notifications.fields.variables') }}</dt><dd>{{ template.requiredVariables.join(', ') || t('notifications.values.notAvailable') }}</dd></div>
            <div><dt>{{ t('notifications.fields.updatedAt') }}</dt><dd>{{ formatBrowserLocalTime(template.updatedAt) }}</dd></div>
          </dl>
          <div class="notifications-page__actions">
            <button class="gc-button" type="button" @click="openEditTemplate(template)">{{ t('common.edit') }}</button>
            <button class="gc-button" type="button" @click="previewTemplate(template)">{{ t('notifications.actions.preview') }}</button>
            <button class="gc-button" type="button" @click="toggleTemplate(template)">{{ template.status === 'active' ? t('notifications.actions.disable') : t('notifications.actions.enable') }}</button>
          </div>
        </article>
      </div>
      <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.templates') }}</p>
    </section>

    <section v-else-if="activeTab === 'channels'" class="notifications-page__section">
      <header class="notifications-page__toolbar">
        <div>
          <h2>{{ t('notifications.sections.channels') }}</h2>
          <p>{{ t('notifications.summary.recordCount', { count: channels.length }) }}</p>
        </div>
      </header>
      <div v-if="channels.length" class="notifications-page__list">
        <article v-for="channel in channels" :key="channel.id" class="gc-card notifications-page__item">
          <div><h3>{{ channel.name }}</h3><p>{{ channel.type }}</p></div>
          <div class="notifications-page__status"><GcStatusTag :status="channel.status" /><GcStatusTag :status="channel.healthStatus" /></div>
          <dl>
            <div><dt>{{ t('notifications.fields.lastSuccess') }}</dt><dd>{{ formatBrowserLocalTime(channel.lastSucceededAt) || t('notifications.values.notAvailable') }}</dd></div>
            <div><dt>{{ t('notifications.fields.latency') }}</dt><dd>{{ channel.lastLatencyMs ?? t('notifications.values.notAvailable') }}</dd></div>
            <div v-if="channelPrivateOrigin(channel)"><dt>{{ t('notifications.fields.privateOrigin') }}</dt><dd>{{ channelPrivateOrigin(channel) }}</dd></div>
          </dl>
          <div class="notifications-page__actions">
            <button class="gc-button" type="button" @click="openEditChannel(channel)">{{ t('common.edit') }}</button>
            <button class="gc-button" type="button" @click="toggleChannel(channel)">{{ channel.status === 'active' ? t('notifications.actions.disable') : t('notifications.actions.enable') }}</button>
            <button class="gc-button" type="button" @click="openTestDialog(channel)">{{ t('notifications.actions.test') }}</button>
          </div>
        </article>
      </div>
      <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.channels') }}</p>
    </section>

    <section v-else-if="activeTab === 'deliveries'" class="notifications-page__section">
      <header class="notifications-page__toolbar">
        <div>
          <h2>{{ t('notifications.sections.deliveries') }}</h2>
          <p>{{ t('notifications.summary.recordCount', { count: filteredDeliveries.length }) }}</p>
        </div>
        <label class="notifications-page__filter"><span>{{ t('notifications.fields.deliveryStatus') }}</span><select v-model="deliveryStatusFilter"><option v-for="filter in deliveryStatusFilters" :key="filter.value" :value="filter.value">{{ filter.label }}</option></select></label>
      </header>
      <div v-if="filteredDeliveries.length" class="notifications-page__list">
        <article v-for="delivery in filteredDeliveries" :key="delivery.id" class="gc-card notifications-page__item">
          <div><h3>{{ deliveryEventType(delivery) }}</h3><p>{{ delivery.channelNameSnapshot }}</p></div>
          <GcStatusTag :status="delivery.status" />
          <dl>
            <div><dt>{{ t('notifications.fields.templateKey') }}</dt><dd>{{ deliveryTemplateKey(delivery) }}</dd></div>
            <div><dt>{{ t('notifications.fields.attempts') }}</dt><dd>{{ deliveryAttemptSummary(delivery) }}</dd></div>
            <div><dt>{{ t('notifications.fields.failureCategory') }}</dt><dd>{{ delivery.failureCategory || t('notifications.values.notAvailable') }}</dd></div>
            <div><dt>{{ t('notifications.fields.nextAttemptAt') }}</dt><dd>{{ formatBrowserLocalTime(delivery.nextAttemptAt) || t('notifications.values.notAvailable') }}</dd></div>
          </dl>
          <div class="notifications-page__actions">
            <button class="gc-button" type="button" @click="openDeliveryDetail(delivery)">{{ t('notifications.actions.detail') }}</button>
            <button v-if="delivery.status === 'failed'" class="gc-button" type="button" @click="retryDelivery(delivery)">{{ t('notifications.actions.retry') }}</button>
          </div>
          <div v-if="selectedDeliveryDetail?.delivery.id === delivery.id" class="notifications-page__detail">
            <section>
              <h4>{{ t('notifications.summary.attempts') }}</h4>
              <p v-if="!selectedDeliveryDetail.attempts.length" class="notifications-page__form-hint">{{ t('notifications.empty.attempts') }}</p>
              <ol v-else class="notifications-page__attempts">
                <li v-for="attempt in selectedDeliveryDetail.attempts" :key="attempt.id">
                  <span>{{ t('notifications.summary.attemptNumber', { number: attempt.attemptNo }) }}</span>
                  <GcStatusTag :status="attemptStatus(attempt.success, attempt.finishedAt)" />
                  <span>{{ formatBrowserLocalTime(attempt.finishedAt || attempt.startedAt) }}</span>
                  <span>{{ attempt.failureCategory || t('notifications.values.notAvailable') }}</span>
                </li>
              </ol>
            </section>
            <section>
              <h4>{{ t('notifications.summary.outbox') }}</h4>
              <p v-if="!selectedDeliveryDetail.outbox.length" class="notifications-page__form-hint">{{ t('notifications.empty.outbox') }}</p>
              <ol v-else class="notifications-page__attempts">
                <li v-for="item in selectedDeliveryDetail.outbox" :key="item.id">
                  <span>{{ t('notifications.summary.dispatchGeneration', { generation: item.dispatchGeneration }) }}</span>
                  <GcStatusTag :status="item.status" />
                  <span>{{ formatBrowserLocalTime(item.nextAttemptAt) }}</span>
                  <span>{{ item.lastError || t('notifications.values.notAvailable') }}</span>
                </li>
              </ol>
            </section>
          </div>
        </article>
      </div>
      <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.deliveries') }}</p>
    </section>

    <GcModal :open="activeDialog !== null" :title="dialogTitle" size="lg" @update:open="(value) => { if (!value) closeDialog() }">
      <form v-if="activeDialog === 'channel'" id="notification-channel-form" class="notifications-page__form" @submit.prevent="saveChannel">
        <label><span>{{ t('notifications.fields.name') }}</span><input v-model="channelForm.name" required /></label>
        <label><span>{{ t('notifications.fields.type') }}</span><select v-model="channelForm.type" :disabled="editingChannel !== null"><option value="email">{{ t('notifications.channelTypes.email') }}</option><option value="wecom">{{ t('notifications.channelTypes.wecom') }}</option><option value="slack">{{ t('notifications.channelTypes.slack') }}</option><option value="feishu">{{ t('notifications.channelTypes.feishu') }}</option><option value="dingtalk">{{ t('notifications.channelTypes.dingtalk') }}</option><option value="telegram">{{ t('notifications.channelTypes.telegram') }}</option><option value="webhook">{{ t('notifications.channelTypes.webhook') }}</option></select></label>
        <template v-if="isPrivatePlatform(channelForm.type)">
          <label><span>{{ t('notifications.fields.privateOrigin') }}</span><input v-model="channelForm.privateOrigin" type="url" :placeholder="t('notifications.fields.privateOriginPlaceholder')" /></label>
          <p class="notifications-page__form-hint">{{ t('notifications.messages.privateOriginHint') }}</p>
        </template>
        <template v-if="channelForm.type === 'email'">
          <label><span>{{ t('notifications.fields.smtpHost') }}</span><input v-model="channelForm.host" required /></label>
          <label><span>{{ t('notifications.fields.smtpPort') }}</span><input v-model="channelForm.port" type="number" required /></label>
          <label><span>{{ t('notifications.fields.from') }}</span><input v-model="channelForm.from" type="email" required /></label>
          <label><span>{{ t('notifications.fields.smtpSecurity') }}</span><select v-model="channelForm.smtpSecurity"><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option></select></label>
          <GcSecretInput v-model="channelForm.username" :label="t('notifications.fields.smtpUsername')" :placeholder="t('notifications.fields.optionalSecretValuePlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
          <GcSecretInput v-model="channelForm.password" :label="t('notifications.fields.smtpPassword')" :placeholder="t('notifications.fields.secretValuePlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
        </template>
        <template v-else-if="channelForm.type === 'wecom'">
          <GcSecretInput v-model="channelForm.webhookUrl" :label="t('notifications.fields.wecomWebhookUrl')" :placeholder="t('notifications.fields.webhookUrlPlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
        </template>
        <template v-else-if="channelForm.type === 'slack'">
          <GcSecretInput v-model="channelForm.webhookUrl" :label="t('notifications.fields.slackWebhookUrl')" :placeholder="t('notifications.fields.webhookUrlPlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
        </template>
        <template v-else-if="channelForm.type === 'feishu'">
          <GcSecretInput v-model="channelForm.webhookUrl" :label="t('notifications.fields.feishuWebhookUrl')" :placeholder="t('notifications.fields.webhookUrlPlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
          <GcSecretInput v-model="channelForm.signingSecret" :label="t('notifications.fields.feishuSigningSecret')" :placeholder="t('notifications.fields.optionalSecretValuePlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
        </template>
        <template v-else-if="channelForm.type === 'dingtalk'">
          <GcSecretInput v-model="channelForm.webhookUrl" :label="t('notifications.fields.dingtalkWebhookUrl')" :placeholder="t('notifications.fields.webhookUrlPlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
          <GcSecretInput v-model="channelForm.signingSecret" :label="t('notifications.fields.dingtalkSigningSecret')" :placeholder="t('notifications.fields.optionalSecretValuePlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
        </template>
        <template v-else-if="channelForm.type === 'telegram'">
          <GcSecretInput v-model="channelForm.botToken" :label="t('notifications.fields.telegramBotToken')" :placeholder="t('notifications.fields.secretValuePlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
          <label><span>{{ t('notifications.fields.telegramChatId') }}</span><input v-model="channelForm.chatId" required /></label>
          <label><span>{{ t('notifications.fields.telegramMessageThreadId') }}</span><input v-model="channelForm.messageThreadId" type="number" min="1" /></label>
          <p class="notifications-page__form-hint">{{ t('notifications.messages.telegramUsesBotApi') }}</p>
        </template>
        <template v-else>
          <GcSecretInput v-model="channelForm.webhookUrl" :label="t('notifications.fields.webhookUrl')" :placeholder="t('notifications.fields.webhookUrlPlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
          <label><span>{{ t('notifications.fields.webhookMethod') }}</span><select v-model="channelForm.method"><option value="POST">POST</option><option value="PUT">PUT</option><option value="PATCH">PATCH</option></select></label>
          <label><span>{{ t('notifications.fields.webhookHeaders') }}</span><textarea v-model="channelForm.headersJson" :placeholder="t('notifications.fields.webhookHeadersPlaceholder')" /></label>
          <GcSecretInput v-model="channelForm.signingSecret" :label="t('notifications.fields.signingSecret')" :placeholder="t('notifications.fields.optionalSecretValuePlaceholder')" :hint="t('notifications.messages.secretStoredHint')" />
        </template>
      </form>
      <form v-else-if="activeDialog === 'test'" id="notification-test-form" class="notifications-page__form" @submit.prevent="testChannel">
        <label v-if="testingChannel?.type === 'email'"><span>{{ t('notifications.fields.testTarget') }}</span><input v-model="testForm.target" :placeholder="t('notifications.fields.testTargetPlaceholder')" required /></label>
        <p v-else class="notifications-page__form-hint">{{ t('notifications.messages.testUsesChannelTarget') }}</p>
      </form>
      <form v-else-if="activeDialog === 'route'" id="notification-route-form" class="notifications-page__form" @submit.prevent="createRoute">
        <label><span>{{ t('notifications.fields.source') }}</span><input :value="t('notifications.values.certificateSource')" disabled /></label>
        <label><span>{{ t('notifications.fields.eventType') }}</span><input :value="eventDefinitionLabel(routeForm.eventType)" disabled /></label>
        <label><span>{{ t('notifications.fields.channel') }}</span><select v-model="routeForm.channelId" required><option disabled value="">{{ t('notifications.fields.selectChannel') }}</option><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label>
        <label><span>{{ t('notifications.fields.templateKey') }}</span><select v-model="routeForm.templateKey" required><option disabled value="">{{ t('notifications.fields.selectTemplate') }}</option><option v-for="templateKey in templateOptions" :key="templateKey" :value="templateKey">{{ templateKey }}</option></select></label>
      </form>
      <form v-else-if="activeDialog === 'template'" id="notification-template-form" class="notifications-page__form" @submit.prevent="saveTemplate">
        <label><span>{{ t('notifications.fields.templateKey') }}</span><input v-model="templateForm.templateKey" :disabled="editingTemplate !== null" required /></label>
        <label><span>{{ t('notifications.fields.titleTemplate') }}</span><input v-model="templateForm.titleTemplate" required /></label>
        <label><span>{{ t('notifications.fields.bodyTemplate') }}</span><textarea v-model="templateForm.bodyTemplate" required /></label>
      </form>
      <section v-else-if="activeDialog === 'preview'" class="notifications-page__preview">
        <p v-if="previewMissingVariables.length" class="notifications-page__preview-warning">{{ t('notifications.templates.missingVariables', { variables: previewMissingVariables.join(', ') }) }}</p>
        <template v-else>
          <h4>{{ templatePreview?.title }}</h4>
          <p>{{ templatePreview?.body }}</p>
        </template>
      </section>
      <template #actions>
        <button class="gc-button" type="button" :disabled="submitting" @click="closeDialog">{{ activeDialog === 'preview' ? t('common.close') : t('notifications.actions.cancel') }}</button>
        <button v-if="activeDialog && activeDialog !== 'preview'" class="gc-button gc-button--primary" type="submit" :form="`notification-${activeDialog}-form`" :disabled="submitting">{{ activeDialog === 'test' ? t('notifications.actions.test') : editingChannel || editingRoute || editingTemplate ? t('common.save') : t('notifications.actions.confirmCreate') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.notifications-page,
.notifications-page__section,
.notifications-page__rules,
.notifications-page__list,
.notifications-page__form {
  display: grid;
}

.notifications-page { gap: var(--gc-space-5); }
.notifications-page__section, .notifications-page__rules, .notifications-page__list { gap: var(--gc-space-3); }
.notifications-page__loading { margin: 0; padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); color: var(--gc-color-info); background: var(--gc-color-info-soft); font-weight: 750; }
.notifications-page__rules { gap: var(--gc-space-6); }
.notifications-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.notifications-page__toolbar h2, .notifications-page__toolbar p, .notifications-page__item h3, .notifications-page__item p { margin: 0; }
.notifications-page__toolbar p, .notifications-page__item p, .notifications-page__item dt, .notifications-page__form-hint { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__status, .notifications-page__actions { display: flex; gap: var(--gc-space-2); flex-wrap: wrap; }
.notifications-page__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-5); }
.notifications-page__event-row { display: grid; grid-template-columns: minmax(15rem, 2fr) minmax(11rem, 1fr) minmax(10rem, 1fr) auto auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); }
.notifications-page__event-main, .notifications-page__event-field { min-width: 0; }
.notifications-page__event-main h3, .notifications-page__event-main p, .notifications-page__event-field span, .notifications-page__event-field strong { margin: 0; }
.notifications-page__event-main p, .notifications-page__event-field span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__event-field { display: grid; gap: var(--gc-space-1); }
.notifications-page__event-field strong { overflow-wrap: anywhere; font-weight: 600; }
.notifications-page__event-actions { display: flex; gap: var(--gc-space-2); flex-wrap: wrap; justify-content: flex-end; }
.notifications-page__item dl { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.notifications-page__item dl div { display: grid; gap: var(--gc-space-1); }
.notifications-page__item dd { margin: 0; overflow-wrap: anywhere; }
.notifications-page__actions { grid-column: 1 / -1; }
.notifications-page__filter { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__filter select { min-inline-size: calc(var(--gc-space-10) * 2); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text); }
.notifications-page__detail { grid-column: 1 / -1; display: grid; gap: var(--gc-space-4); padding: var(--gc-space-4); border-top: var(--gc-space-hairline) solid var(--gc-color-border); background: var(--gc-color-surface-muted); }
.notifications-page__detail h4, .notifications-page__detail p, .notifications-page__preview h4, .notifications-page__preview p { margin: 0; }
.notifications-page__detail section { display: grid; gap: var(--gc-space-2); }
.notifications-page__attempts { display: grid; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.notifications-page__attempts li { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__preview { display: grid; gap: var(--gc-space-3); white-space: pre-wrap; }
.notifications-page__preview-warning { padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-warning-border); color: var(--gc-color-warning); background: var(--gc-color-warning-soft); }
.notifications-page__empty { margin: 0; padding: var(--gc-space-8); color: var(--gc-color-text-muted); text-align: center; }
.notifications-page__form { gap: var(--gc-space-3); }
.notifications-page__form label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__form input, .notifications-page__form select, .notifications-page__form textarea { padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text); }
.notifications-page__form textarea { min-height: calc(var(--gc-space-10) * 2); resize: vertical; }
.notifications-page__error { margin: 0; padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-sm); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }

@media (max-width: 56.25rem) {
  .notifications-page__toolbar { align-items: stretch; flex-direction: column; }
  .notifications-page__event-row { grid-template-columns: 1fr auto; }
  .notifications-page__event-main { grid-column: 1 / -1; }
  .notifications-page__event-actions { grid-column: 1 / -1; justify-content: flex-start; }
  .notifications-page__item dl { grid-template-columns: 1fr; }
  .notifications-page__attempts li { grid-template-columns: 1fr; }
}
</style>
