<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcPageToolbar, GcSecretInput, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { createSecret } from '@/api/modules/security.api'
import { usePermissionStore } from '@/stores/permission.store'
import {
  createNotificationChannel,
  createNotificationRoute,
  getNotificationSettings,
  listNotificationChannels,
  listNotificationDeliveries,
  listNotificationRoutes,
  listNotificationTemplates,
  getNotificationDelivery,
  previewNotificationTemplate,
  retryNotificationDelivery,
  saveNotificationTemplate,
  testNotificationChannel,
  updateNotificationChannel,
  updateNotificationSettings,
  type NotificationChannel,
  type NotificationChannelType,
  type NotificationDelivery,
  type NotificationDeliveryDetail
} from '@/api/modules/notifications.api'

interface NotificationRouteRecord {
  id: string
  name: string
  status: string
  priority: number
  matcher: { sources?: string[] }
  channelTargets: Array<{ channelId: string }>
  templateKey?: string
}

interface NotificationTemplateRecord {
  id: string
  templateKey: string
  locale: string
  titleTemplate: string
  status: string
  updatedAt: string
}

type DialogType = 'channel' | 'route' | 'template' | 'test' | null

const { t } = useI18n()
const permissionStore = usePermissionStore()
const canUpdateSettings = computed(() => permissionStore.hasPermission('settings.write'))
const activeTab = ref('channels')
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const activeDialog = ref<DialogType>(null)
const testingChannel = ref<NotificationChannel | null>(null)
const channels = ref<NotificationChannel[]>([])
const deliveries = ref<NotificationDelivery[]>([])
const selectedDeliveryDetail = ref<NotificationDeliveryDetail | null>(null)
const routes = ref<NotificationRouteRecord[]>([])
const templates = ref<NotificationTemplateRecord[]>([])
const notificationSettings = reactive({ version: 0, wecomPrivateOrigins: '', feishuPrivateOrigins: '', dingtalkPrivateOrigins: '' })
const channelForm = reactive({
  name: '',
  type: 'email' as NotificationChannelType,
  host: '',
  port: '587',
  from: '',
  smtpSecurity: 'starttls' as 'starttls' | 'ssl',
  username: '',
  password: '',
  deploymentMode: 'public' as 'public' | 'private',
  webhookUrl: '',
  method: 'POST',
  headersJson: '',
  signingSecret: '',
  botToken: '',
  chatId: '',
  messageThreadId: '' as string | number
})
const testForm = reactive({ target: '' })
const routeForm = reactive({ name: '', channelId: '', source: 'certificate.renewal.result', templateKey: '', priority: '100' })
const templateForm = reactive({ templateKey: '', titleTemplate: '', bodyTemplate: '' })

const tabs = computed(() => [
  { value: 'channels', label: t('notifications.tabs.channels') },
  { value: 'deliveries', label: t('notifications.tabs.deliveries') },
  { value: 'templates', label: t('notifications.summary.templates') },
  { value: 'routes', label: t('notifications.summary.routes') }
])

const dialogTitle = computed(() => {
  if (activeDialog.value === 'channel') return t('notifications.channels.createTitle')
  if (activeDialog.value === 'route') return t('notifications.rules.createRoute')
  if (activeDialog.value === 'template') return t('notifications.rules.createTemplate')
  if (activeDialog.value === 'test') return t('notifications.actions.testChannel', { name: testingChannel.value?.name ?? '' })
  return ''
})

function recordValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return t('notifications.values.notAvailable')
}

function routeChannelName(route: NotificationRouteRecord) {
  const channelId = route.channelTargets[0]?.channelId
  return channels.value.find((channel) => channel.id === channelId)?.name ?? recordValue(channelId)
}

function routeSource(route: NotificationRouteRecord) {
  return route.matcher.sources?.join(', ') || t('notifications.values.notAvailable')
}

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [settingsResult, channelResult, deliveryResult, routeResult, templateResult] = await Promise.all([
      getNotificationSettings(), listNotificationChannels(), listNotificationDeliveries(), listNotificationRoutes(), listNotificationTemplates()
    ])
    notificationSettings.version = settingsResult.data?.version ?? 0
    notificationSettings.wecomPrivateOrigins = settingsResult.data?.privateOrigins.wecom.join('\n') ?? ''
    notificationSettings.feishuPrivateOrigins = settingsResult.data?.privateOrigins.feishu.join('\n') ?? ''
    notificationSettings.dingtalkPrivateOrigins = settingsResult.data?.privateOrigins.dingtalk.join('\n') ?? ''
    channels.value = channelResult.data ?? []
    deliveries.value = deliveryResult.data?.items ?? []
    routes.value = (routeResult.data ?? []) as unknown as NotificationRouteRecord[]
    templates.value = (templateResult.data ?? []) as unknown as NotificationTemplateRecord[]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

function parsePrivateOrigins(value: string): string[] {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).map((item) => {
    let url: URL
    try { url = new URL(item) } catch { throw new Error(t('notifications.messages.privateOriginInvalid')) }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(t('notifications.messages.privateOriginInvalid'))
    }
    return url.origin
  }))]
}

async function saveNotificationSettings() {
  await submit(async () => {
    const result = await updateNotificationSettings({
      version: notificationSettings.version,
      wecomPrivateOrigins: parsePrivateOrigins(notificationSettings.wecomPrivateOrigins),
      feishuPrivateOrigins: parsePrivateOrigins(notificationSettings.feishuPrivateOrigins),
      dingtalkPrivateOrigins: parsePrivateOrigins(notificationSettings.dingtalkPrivateOrigins)
    })
    if (result.data) {
      notificationSettings.version = result.data.version
      notificationSettings.wecomPrivateOrigins = result.data.privateOrigins.wecom.join('\n')
      notificationSettings.feishuPrivateOrigins = result.data.privateOrigins.feishu.join('\n')
      notificationSettings.dingtalkPrivateOrigins = result.data.privateOrigins.dingtalk.join('\n')
    }
  })
}

function openDialog(dialog: Exclude<DialogType, 'test' | null>) {
  errorMessage.value = ''
  activeDialog.value = dialog
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

function assertPlatformWebhookUrl(type: 'feishu' | 'dingtalk', value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(t(`notifications.messages.${type}WebhookUrlInvalid`))
  }
  if (channelForm.deploymentMode === 'private') {
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(t(`notifications.messages.${type}WebhookUrlInvalid`))
    return
  }
  const valid = type === 'feishu'
    ? url.protocol === 'https:' && ['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname) && url.pathname.startsWith('/open-apis/bot/v2/hook/')
    : url.protocol === 'https:' && url.hostname === 'oapi.dingtalk.com' && url.pathname === '/robot/send'
  if (!valid) throw new Error(t(`notifications.messages.${type}WebhookUrlInvalid`))
}

async function createChannel() {
  await submit(async () => {
    const secretRefs: Record<string, string> = {}
    let config: Record<string, unknown> = {}
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
        host: channelForm.host.trim(),
        port: Number(channelForm.port),
        from: channelForm.from.trim(),
        secure: channelForm.smtpSecurity === 'ssl',
        startTls: channelForm.smtpSecurity === 'starttls',
        rejectUnauthorized: true
      }
    } else if (channelForm.type === 'wecom' || channelForm.type === 'slack') {
      if (channelForm.type === 'wecom') assertWeComWebhookUrl(channelForm.webhookUrl.trim())
      const webhookUrlRef = await saveChannelSecret('webhookUrl', channelForm.webhookUrl.trim(), 'api_token')
      if (!webhookUrlRef) throw new Error(t('notifications.messages.webhookUrlRequired'))
      secretRefs.webhookUrl = webhookUrlRef
    } else if (channelForm.type === 'feishu' || channelForm.type === 'dingtalk') {
      assertPlatformWebhookUrl(channelForm.type, channelForm.webhookUrl.trim())
      const [webhookUrlRef, signingSecretRef] = await Promise.all([
        saveChannelSecret('webhookUrl', channelForm.webhookUrl.trim(), 'api_token'),
        saveChannelSecret('signingSecret', channelForm.signingSecret, 'api_token')
      ])
      if (!webhookUrlRef) throw new Error(t('notifications.messages.webhookUrlRequired'))
      secretRefs.webhookUrl = webhookUrlRef
      if (signingSecretRef) secretRefs.signingSecret = signingSecretRef
    } else if (channelForm.type === 'telegram') {
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(channelForm.botToken.trim())) throw new Error(t('notifications.messages.telegramBotTokenInvalid'))
      const botTokenRef = await saveChannelSecret('botToken', channelForm.botToken.trim(), 'api_token')
      if (!botTokenRef) throw new Error(t('notifications.messages.botTokenRequired'))
      if (!channelForm.chatId.trim()) throw new Error(t('notifications.messages.chatIdRequired'))
      const messageThreadId = String(channelForm.messageThreadId).trim()
      if (messageThreadId && (!Number.isInteger(Number(messageThreadId)) || Number(messageThreadId) <= 0)) {
        throw new Error(t('notifications.messages.telegramMessageThreadIdInvalid'))
      }
      secretRefs.botToken = botTokenRef
      config = {
        chatId: channelForm.chatId.trim(),
        ...(messageThreadId ? { messageThreadId: Number(messageThreadId) } : {})
      }
    } else {
      const headers = webhookHeaders()
      const [urlRef, signingSecretRef] = await Promise.all([
        saveChannelSecret('webhookUrl', channelForm.webhookUrl.trim(), 'api_token'),
        saveChannelSecret('signingSecret', channelForm.signingSecret, 'api_token')
      ])
      if (!urlRef) throw new Error(t('notifications.messages.webhookUrlRequired'))
      secretRefs.url = urlRef
      if (signingSecretRef) secretRefs.signingSecret = signingSecretRef
      config = { method: channelForm.method, headers }
    }
    await createNotificationChannel({
      name: channelForm.name,
      type: channelForm.type,
      status: 'disabled',
      config,
      secretRefs
    })
    Object.assign(channelForm, {
      name: '', type: 'email', host: '', port: '587', from: '', smtpSecurity: 'starttls', username: '', password: '',
      deploymentMode: 'public', webhookUrl: '', method: 'POST', headersJson: '', signingSecret: '', botToken: '', chatId: '', messageThreadId: ''
    })
  })
}

function assertWeComWebhookUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(t('notifications.messages.wecomWebhookUrlInvalid'))
  }
  if (channelForm.deploymentMode === 'private') {
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(t('notifications.messages.wecomWebhookUrlInvalid'))
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

async function previewTemplate(template: NotificationTemplateRecord) {
  submitting.value = true
  try {
    const result = await previewNotificationTemplate({
      templateKey: template.templateKey,
      locale: template.locale,
      context: { status: t('notifications.values.notAvailable'), domain: 'example.com', certificateVersionId: 'preview', resourceId: 'preview', reportId: 'preview', reportType: 'certificate', title: t('notifications.values.notAvailable'), summary: t('notifications.values.notAvailable') }
    })
    const value = result.data
    errorMessage.value = value ? `${value.title}\n${value.body}` : t('notifications.messages.operationFailed')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.operationFailed')
  } finally {
    submitting.value = false
  }
}

async function createRoute() {
  await submit(async () => {
    await createNotificationRoute({
      name: routeForm.name,
      priority: Number(routeForm.priority),
      matcher: routeForm.source ? { sources: [routeForm.source] } : {},
      templateKey: routeForm.templateKey || undefined,
      channelTargets: [{ channelId: routeForm.channelId }],
      stopOnMatch: false
    })
    Object.assign(routeForm, { name: '', channelId: '', source: 'certificate.renewal.result', templateKey: '', priority: '100' })
  })
}

async function saveTemplate() {
  await submit(async () => {
    await saveNotificationTemplate({
      templateKey: templateForm.templateKey,
      locale: 'zh-CN',
      titleTemplate: templateForm.titleTemplate,
      bodyTemplate: templateForm.bodyTemplate,
      requiredVariables: [...new Set(`${templateForm.titleTemplate} ${templateForm.bodyTemplate}`.matchAll(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g))].map((match) => match[1]),
      status: 'active'
    })
    Object.assign(templateForm, { templateKey: '', titleTemplate: '', bodyTemplate: '' })
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
        <button v-if="activeTab === 'channels'" class="gc-button gc-button--primary" type="button" @click="openDialog('channel')">{{ t('notifications.actions.createChannel') }}</button>
        <button v-if="activeTab === 'routes'" class="gc-button gc-button--primary" type="button" @click="openDialog('route')">{{ t('notifications.actions.createRoute') }}</button>
        <button v-if="activeTab === 'templates'" class="gc-button gc-button--primary" type="button" @click="openDialog('template')">{{ t('notifications.actions.createTemplate') }}</button>
      </template>
      <template #tabs>
        <GcTabs v-model="activeTab" :tabs="tabs" />
      </template>
    </GcPageToolbar>

    <p v-if="loading" class="notifications-page__loading" role="status">{{ t('common.loading') }}</p>

    <section v-if="activeTab === 'channels'" class="notifications-page__section">
      <form class="gc-card notifications-page__settings" @submit.prevent="saveNotificationSettings">
        <header class="notifications-page__toolbar">
          <div>
            <h2>{{ t('notifications.settings.privateOriginsTitle') }}</h2>
            <p>{{ t('notifications.settings.privateOriginsDescription') }}</p>
          </div>
          <button v-if="canUpdateSettings" class="gc-button gc-button--primary" type="submit" :disabled="submitting">{{ t('notifications.actions.saveSettings') }}</button>
        </header>
        <div class="notifications-page__settings-grid">
          <label><span>{{ t('notifications.fields.wecomPrivateOrigins') }}</span><textarea v-model="notificationSettings.wecomPrivateOrigins" :readonly="!canUpdateSettings" :placeholder="t('notifications.fields.privateOriginsPlaceholder')" /></label>
          <label><span>{{ t('notifications.fields.feishuPrivateOrigins') }}</span><textarea v-model="notificationSettings.feishuPrivateOrigins" :readonly="!canUpdateSettings" :placeholder="t('notifications.fields.privateOriginsPlaceholder')" /></label>
          <label><span>{{ t('notifications.fields.dingtalkPrivateOrigins') }}</span><textarea v-model="notificationSettings.dingtalkPrivateOrigins" :readonly="!canUpdateSettings" :placeholder="t('notifications.fields.privateOriginsPlaceholder')" /></label>
        </div>
        <p class="notifications-page__form-hint">{{ t('notifications.messages.privateOriginsSecurityHint') }}</p>
      </form>
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
          </dl>
          <div class="notifications-page__actions">
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
          <p>{{ t('notifications.summary.recordCount', { count: deliveries.length }) }}</p>
        </div>
      </header>
      <div v-if="deliveries.length" class="notifications-page__list">
        <article v-for="delivery in deliveries" :key="delivery.id" class="gc-card notifications-page__item">
          <div><h3>{{ delivery.channelNameSnapshot }}</h3><p>{{ delivery.requestId }}</p></div>
          <GcStatusTag :status="delivery.status" />
          <dl>
            <div><dt>{{ t('notifications.fields.createdAt') }}</dt><dd>{{ formatBrowserLocalTime(delivery.createdAt) }}</dd></div>
            <div><dt>{{ t('notifications.fields.failureCategory') }}</dt><dd>{{ delivery.failureCategory || t('notifications.values.notAvailable') }}</dd></div>
            <div><dt>{{ t('notifications.fields.nextAttemptAt') }}</dt><dd>{{ formatBrowserLocalTime(delivery.nextAttemptAt) || t('notifications.values.notAvailable') }}</dd></div>
          </dl>
          <div class="notifications-page__actions">
            <button class="gc-button" type="button" @click="openDeliveryDetail(delivery)">{{ t('notifications.actions.detail') }}</button>
            <button v-if="delivery.status === 'failed'" class="gc-button" type="button" @click="retryDelivery(delivery)">{{ t('notifications.actions.retry') }}</button>
          </div>
          <div v-if="selectedDeliveryDetail?.delivery.id === delivery.id" class="notifications-page__detail">
            <p>{{ t('notifications.summary.attempts') }}: {{ selectedDeliveryDetail.attempts.length }}</p>
            <p>{{ t('notifications.summary.outbox') }}: {{ selectedDeliveryDetail.outbox.map((item) => item.status).join(', ') || t('notifications.values.notAvailable') }}</p>
          </div>
        </article>
      </div>
      <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.deliveries') }}</p>
    </section>

    <section v-else-if="activeTab === 'routes'" class="notifications-page__section">
        <header class="notifications-page__toolbar">
          <div><h2>{{ t('notifications.summary.routes') }}</h2><p>{{ t('notifications.summary.recordCount', { count: routes.length }) }}</p></div>
        </header>
        <div v-if="routes.length" class="notifications-page__list">
          <article v-for="route in routes" :key="route.id" class="gc-card notifications-page__item">
            <div><h3>{{ route.name }}</h3><p>{{ routeSource(route) }}</p></div><GcStatusTag :status="route.status" />
            <dl>
              <div><dt>{{ t('notifications.fields.channel') }}</dt><dd>{{ routeChannelName(route) }}</dd></div>
              <div><dt>{{ t('notifications.fields.templateKey') }}</dt><dd>{{ route.templateKey || t('notifications.values.notAvailable') }}</dd></div>
              <div><dt>{{ t('notifications.fields.priority') }}</dt><dd>{{ route.priority }}</dd></div>
            </dl>
          </article>
        </div>
        <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.routes') }}</p>
      </section>

    <section v-else-if="activeTab === 'templates'" class="notifications-page__section">
        <header class="notifications-page__toolbar">
          <div><h2>{{ t('notifications.summary.templates') }}</h2><p>{{ t('notifications.summary.recordCount', { count: templates.length }) }}</p></div>
        </header>
        <div v-if="templates.length" class="notifications-page__list">
          <article v-for="template in templates" :key="template.id" class="gc-card notifications-page__item">
            <div><h3>{{ template.templateKey }}</h3><p>{{ template.titleTemplate }}</p></div><GcStatusTag :status="template.status" />
            <dl>
              <div><dt>{{ t('notifications.fields.locale') }}</dt><dd>{{ template.locale }}</dd></div>
              <div><dt>{{ t('notifications.fields.updatedAt') }}</dt><dd>{{ formatBrowserLocalTime(template.updatedAt) }}</dd></div>
            </dl>
            <div class="notifications-page__actions"><button class="gc-button" type="button" @click="previewTemplate(template)">{{ t('notifications.actions.preview') }}</button></div>
          </article>
        </div>
        <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.templates') }}</p>
    </section>

    <GcModal :open="activeDialog !== null" :title="dialogTitle" size="lg" @update:open="(value) => { if (!value) closeDialog() }">
      <form v-if="activeDialog === 'channel'" id="notification-channel-form" class="notifications-page__form" @submit.prevent="createChannel">
        <label><span>{{ t('notifications.fields.name') }}</span><input v-model="channelForm.name" required /></label>
        <label><span>{{ t('notifications.fields.type') }}</span><select v-model="channelForm.type"><option value="email">{{ t('notifications.channelTypes.email') }}</option><option value="wecom">{{ t('notifications.channelTypes.wecom') }}</option><option value="slack">{{ t('notifications.channelTypes.slack') }}</option><option value="feishu">{{ t('notifications.channelTypes.feishu') }}</option><option value="dingtalk">{{ t('notifications.channelTypes.dingtalk') }}</option><option value="telegram">{{ t('notifications.channelTypes.telegram') }}</option><option value="webhook">{{ t('notifications.channelTypes.webhook') }}</option></select></label>
        <label v-if="channelForm.type === 'wecom' || channelForm.type === 'feishu' || channelForm.type === 'dingtalk'"><span>{{ t('notifications.fields.deploymentMode') }}</span><select v-model="channelForm.deploymentMode"><option value="public">{{ t('notifications.deploymentModes.public') }}</option><option value="private">{{ t('notifications.deploymentModes.private') }}</option></select></label>
        <p v-if="channelForm.deploymentMode === 'private' && (channelForm.type === 'wecom' || channelForm.type === 'feishu' || channelForm.type === 'dingtalk')" class="notifications-page__form-hint">{{ t('notifications.messages.privateDeploymentAllowlistHint') }}</p>
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
        <label><span>{{ t('notifications.fields.name') }}</span><input v-model="routeForm.name" required /></label>
        <label><span>{{ t('notifications.fields.channel') }}</span><select v-model="routeForm.channelId" required><option disabled value="">{{ t('notifications.fields.selectChannel') }}</option><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label>
        <label><span>{{ t('notifications.fields.eventType') }}</span><input v-model="routeForm.source" required /></label>
        <label><span>{{ t('notifications.fields.templateKey') }}</span><select v-model="routeForm.templateKey" required><option disabled value="">{{ t('notifications.fields.selectTemplate') }}</option><option v-for="template in templates" :key="template.id" :value="template.templateKey">{{ template.templateKey }}</option></select></label>
        <label><span>{{ t('notifications.fields.priority') }}</span><input v-model="routeForm.priority" type="number" required /></label>
      </form>
      <form v-else-if="activeDialog === 'template'" id="notification-template-form" class="notifications-page__form" @submit.prevent="saveTemplate">
        <label><span>{{ t('notifications.fields.templateKey') }}</span><input v-model="templateForm.templateKey" required /></label>
        <label><span>{{ t('notifications.fields.titleTemplate') }}</span><input v-model="templateForm.titleTemplate" required /></label>
        <label><span>{{ t('notifications.fields.bodyTemplate') }}</span><textarea v-model="templateForm.bodyTemplate" required /></label>
      </form>
      <template #actions>
        <button class="gc-button" type="button" :disabled="submitting" @click="closeDialog">{{ t('notifications.actions.cancel') }}</button>
        <button v-if="activeDialog" class="gc-button gc-button--primary" type="submit" :form="`notification-${activeDialog}-form`" :disabled="submitting">{{ activeDialog === 'test' ? t('notifications.actions.test') : t('notifications.actions.confirmCreate') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.notifications-page,
.notifications-page__section,
.notifications-page__rules,
.notifications-page__list,
.notifications-page__form,
.notifications-page__settings,
.notifications-page__settings-grid {
  display: grid;
}

.notifications-page { gap: var(--gc-space-5); }
.notifications-page__section, .notifications-page__rules, .notifications-page__list { gap: var(--gc-space-3); }
.notifications-page__settings { gap: var(--gc-space-4); padding: var(--gc-space-5); }
.notifications-page__settings-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); }
.notifications-page__settings-grid label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__settings-grid textarea { min-height: calc(var(--gc-space-10) * 2); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text); resize: vertical; }
.notifications-page__loading { margin: 0; padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); color: var(--gc-color-info); background: var(--gc-color-info-soft); font-weight: 750; }
.notifications-page__rules { gap: var(--gc-space-6); }
.notifications-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.notifications-page__toolbar h2, .notifications-page__toolbar p, .notifications-page__item h3, .notifications-page__item p { margin: 0; }
.notifications-page__toolbar p, .notifications-page__item p, .notifications-page__item dt, .notifications-page__form-hint { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__status, .notifications-page__actions { display: flex; gap: var(--gc-space-2); flex-wrap: wrap; }
.notifications-page__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-5); }
.notifications-page__item dl { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.notifications-page__item dl div { display: grid; gap: var(--gc-space-1); }
.notifications-page__item dd { margin: 0; overflow-wrap: anywhere; }
.notifications-page__actions { grid-column: 1 / -1; }
.notifications-page__empty { margin: 0; padding: var(--gc-space-8); color: var(--gc-color-text-muted); text-align: center; }
.notifications-page__form { gap: var(--gc-space-3); }
.notifications-page__form label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__form input, .notifications-page__form select, .notifications-page__form textarea { padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text); }
.notifications-page__form textarea { min-height: calc(var(--gc-space-10) * 2); resize: vertical; }
.notifications-page__error { margin: 0; padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-sm); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }

@media (max-width: 56.25rem) {
  .notifications-page__toolbar { align-items: stretch; flex-direction: column; }
  .notifications-page__item dl { grid-template-columns: 1fr; }
  .notifications-page__settings-grid { grid-template-columns: 1fr; }
}
</style>
