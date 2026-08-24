<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcModal, GcSecretInput, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { createSecret } from '@/api/modules/security.api'
import {
  createNotificationChannel,
  createNotificationRoute,
  createNotificationSilence,
  listNotificationChannels,
  listNotificationDeliveries,
  listNotificationRoutes,
  listNotificationSilences,
  listNotificationTemplates,
  retryNotificationDelivery,
  saveNotificationTemplate,
  testNotificationChannel,
  updateNotificationChannel,
  type NotificationChannel,
  type NotificationChannelType,
  type NotificationDelivery
} from '@/api/modules/notifications.api'

interface NotificationRouteRecord {
  id: string
  name: string
  status: string
  priority: number
  matcher: { sources?: string[] }
  channelTargets: Array<{ channelId: string }>
  dedupeWindowSeconds: number
}

interface NotificationTemplateRecord {
  id: string
  templateKey: string
  locale: string
  titleTemplate: string
  status: string
  updatedAt: string
}

interface NotificationSilenceRecord {
  id: string
  name: string
  status: string
  matcher: { sources?: string[] }
  reason: string
  startsAt: string
  endsAt: string
}

type DialogType = 'channel' | 'route' | 'template' | 'silence' | 'test' | null

const { t } = useI18n()
const activeTab = ref('channels')
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const activeDialog = ref<DialogType>(null)
const testingChannel = ref<NotificationChannel | null>(null)
const channels = ref<NotificationChannel[]>([])
const deliveries = ref<NotificationDelivery[]>([])
const routes = ref<NotificationRouteRecord[]>([])
const templates = ref<NotificationTemplateRecord[]>([])
const silences = ref<NotificationSilenceRecord[]>([])
const channelForm = reactive({
  name: '',
  type: 'email' as NotificationChannelType,
  host: '',
  port: '587',
  from: '',
  smtpSecurity: 'starttls' as 'starttls' | 'ssl',
  username: '',
  password: '',
  webhookUrl: '',
  method: 'POST',
  headersJson: '',
  signingSecret: ''
})
const testForm = reactive({ target: '' })
const routeForm = reactive({ name: '', channelId: '', source: 'monitor', priority: '100', dedupeWindowSeconds: '300' })
const templateForm = reactive({ templateKey: '', titleTemplate: '', bodyTemplate: '' })
const silenceForm = reactive({ name: '', reason: '', source: 'monitor', startsAt: '', endsAt: '' })

const tabs = computed(() => [
  { value: 'channels', label: t('notifications.tabs.channels') },
  { value: 'deliveries', label: t('notifications.tabs.deliveries') },
  { value: 'rules', label: t('notifications.tabs.rules') }
])

const dialogTitle = computed(() => {
  if (activeDialog.value === 'channel') return t('notifications.channels.createTitle')
  if (activeDialog.value === 'route') return t('notifications.rules.createRoute')
  if (activeDialog.value === 'template') return t('notifications.rules.createTemplate')
  if (activeDialog.value === 'silence') return t('notifications.rules.createSilence')
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
    const [channelResult, deliveryResult, routeResult, templateResult, silenceResult] = await Promise.all([
      listNotificationChannels(), listNotificationDeliveries(), listNotificationRoutes(), listNotificationTemplates(), listNotificationSilences()
    ])
    channels.value = channelResult.data ?? []
    deliveries.value = deliveryResult.data?.items ?? []
    routes.value = (routeResult.data ?? []) as unknown as NotificationRouteRecord[]
    templates.value = (templateResult.data ?? []) as unknown as NotificationTemplateRecord[]
    silences.value = (silenceResult.data ?? []) as unknown as NotificationSilenceRecord[]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.loadFailed')
  } finally {
    loading.value = false
  }
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
      const webhookUrlRef = await saveChannelSecret('webhookUrl', channelForm.webhookUrl.trim(), 'api_token')
      if (!webhookUrlRef) throw new Error(t('notifications.messages.webhookUrlRequired'))
      secretRefs.webhookUrl = webhookUrlRef
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
      webhookUrl: '', method: 'POST', headersJson: '', signingSecret: ''
    })
  })
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

async function createRoute() {
  await submit(async () => {
    await createNotificationRoute({
      name: routeForm.name,
      priority: Number(routeForm.priority),
      matcher: routeForm.source ? { sources: [routeForm.source] } : {},
      channelTargets: [{ channelId: routeForm.channelId }],
      stopOnMatch: false,
      dedupeWindowSeconds: Number(routeForm.dedupeWindowSeconds)
    })
    Object.assign(routeForm, { name: '', channelId: '', source: 'monitor', priority: '100', dedupeWindowSeconds: '300' })
  })
}

async function saveTemplate() {
  await submit(async () => {
    await saveNotificationTemplate({
      templateKey: templateForm.templateKey,
      locale: 'zh-CN',
      titleTemplate: templateForm.titleTemplate,
      bodyTemplate: templateForm.bodyTemplate,
      requiredVariables: [],
      status: 'active'
    })
    Object.assign(templateForm, { templateKey: '', titleTemplate: '', bodyTemplate: '' })
  })
}

async function createSilence() {
  await submit(async () => {
    await createNotificationSilence({
      name: silenceForm.name,
      reason: silenceForm.reason,
      matcher: silenceForm.source ? { sources: [silenceForm.source] } : {},
      startsAt: new Date(silenceForm.startsAt).toISOString(),
      endsAt: new Date(silenceForm.endsAt).toISOString()
    })
    Object.assign(silenceForm, { name: '', reason: '', source: 'monitor', startsAt: '', endsAt: '' })
  })
}

onMounted(refresh)
</script>

<template>
  <section class="notifications-page">
    <p v-if="errorMessage" class="notifications-page__error" role="alert">{{ errorMessage }}</p>
    <GcTabs v-model="activeTab" :tabs="tabs" />

    <section v-if="activeTab === 'channels'" class="notifications-page__section">
      <header class="notifications-page__toolbar">
        <div>
          <h2>{{ t('notifications.sections.channels') }}</h2>
          <p>{{ t('notifications.summary.recordCount', { count: channels.length }) }}</p>
        </div>
        <div class="notifications-page__toolbar-actions">
          <button class="notifications-page__button notifications-page__button--secondary" type="button" :disabled="loading" @click="refresh">{{ t('common.refresh') }}</button>
          <button class="notifications-page__button" type="button" @click="openDialog('channel')">{{ t('notifications.actions.createChannel') }}</button>
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
            <button type="button" @click="toggleChannel(channel)">{{ channel.status === 'active' ? t('notifications.actions.disable') : t('notifications.actions.enable') }}</button>
            <button type="button" @click="openTestDialog(channel)">{{ t('notifications.actions.test') }}</button>
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
        <button class="notifications-page__button notifications-page__button--secondary" type="button" :disabled="loading" @click="refresh">{{ t('common.refresh') }}</button>
      </header>
      <div v-if="deliveries.length" class="notifications-page__list">
        <article v-for="delivery in deliveries" :key="delivery.id" class="gc-card notifications-page__item">
          <div><h3>{{ delivery.channelNameSnapshot }}</h3><p>{{ delivery.requestId }}</p></div>
          <GcStatusTag :status="delivery.status" />
          <dl>
            <div><dt>{{ t('notifications.fields.createdAt') }}</dt><dd>{{ formatBrowserLocalTime(delivery.createdAt) }}</dd></div>
            <div><dt>{{ t('notifications.fields.failureCategory') }}</dt><dd>{{ delivery.failureCategory || t('notifications.values.notAvailable') }}</dd></div>
          </dl>
          <div v-if="delivery.status === 'failed'" class="notifications-page__actions">
            <button type="button" @click="retryDelivery(delivery)">{{ t('notifications.actions.retry') }}</button>
          </div>
        </article>
      </div>
      <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.deliveries') }}</p>
    </section>

    <section v-else class="notifications-page__rules">
      <section class="notifications-page__section">
        <header class="notifications-page__toolbar">
          <div><h2>{{ t('notifications.summary.routes') }}</h2><p>{{ t('notifications.summary.recordCount', { count: routes.length }) }}</p></div>
          <button class="notifications-page__button" type="button" @click="openDialog('route')">{{ t('notifications.actions.createRoute') }}</button>
        </header>
        <div v-if="routes.length" class="notifications-page__list">
          <article v-for="route in routes" :key="route.id" class="gc-card notifications-page__item">
            <div><h3>{{ route.name }}</h3><p>{{ routeSource(route) }}</p></div><GcStatusTag :status="route.status" />
            <dl>
              <div><dt>{{ t('notifications.fields.channel') }}</dt><dd>{{ routeChannelName(route) }}</dd></div>
              <div><dt>{{ t('notifications.fields.priority') }}</dt><dd>{{ route.priority }}</dd></div>
              <div><dt>{{ t('notifications.fields.dedupeWindow') }}</dt><dd>{{ route.dedupeWindowSeconds }}</dd></div>
            </dl>
          </article>
        </div>
        <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.routes') }}</p>
      </section>

      <section class="notifications-page__section">
        <header class="notifications-page__toolbar">
          <div><h2>{{ t('notifications.summary.templates') }}</h2><p>{{ t('notifications.summary.recordCount', { count: templates.length }) }}</p></div>
          <button class="notifications-page__button" type="button" @click="openDialog('template')">{{ t('notifications.actions.createTemplate') }}</button>
        </header>
        <div v-if="templates.length" class="notifications-page__list">
          <article v-for="template in templates" :key="template.id" class="gc-card notifications-page__item">
            <div><h3>{{ template.templateKey }}</h3><p>{{ template.titleTemplate }}</p></div><GcStatusTag :status="template.status" />
            <dl>
              <div><dt>{{ t('notifications.fields.locale') }}</dt><dd>{{ template.locale }}</dd></div>
              <div><dt>{{ t('notifications.fields.updatedAt') }}</dt><dd>{{ formatBrowserLocalTime(template.updatedAt) }}</dd></div>
            </dl>
          </article>
        </div>
        <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.templates') }}</p>
      </section>

      <section class="notifications-page__section">
        <header class="notifications-page__toolbar">
          <div><h2>{{ t('notifications.summary.silences') }}</h2><p>{{ t('notifications.summary.recordCount', { count: silences.length }) }}</p></div>
          <button class="notifications-page__button" type="button" @click="openDialog('silence')">{{ t('notifications.actions.createSilence') }}</button>
        </header>
        <div v-if="silences.length" class="notifications-page__list">
          <article v-for="silence in silences" :key="silence.id" class="gc-card notifications-page__item">
            <div><h3>{{ silence.name }}</h3><p>{{ silence.reason }}</p></div><GcStatusTag :status="silence.status" />
            <dl>
              <div><dt>{{ t('notifications.fields.source') }}</dt><dd>{{ silence.matcher.sources?.join(', ') || t('notifications.values.notAvailable') }}</dd></div>
              <div><dt>{{ t('notifications.fields.startsAt') }}</dt><dd>{{ formatBrowserLocalTime(silence.startsAt) }}</dd></div>
              <div><dt>{{ t('notifications.fields.endsAt') }}</dt><dd>{{ formatBrowserLocalTime(silence.endsAt) }}</dd></div>
            </dl>
          </article>
        </div>
        <p v-else class="gc-card notifications-page__empty">{{ t('notifications.empty.silences') }}</p>
      </section>
    </section>

    <GcModal :open="activeDialog !== null" :title="dialogTitle" size="lg" @update:open="(value) => { if (!value) closeDialog() }">
      <form v-if="activeDialog === 'channel'" id="notification-channel-form" class="notifications-page__form" @submit.prevent="createChannel">
        <label><span>{{ t('notifications.fields.name') }}</span><input v-model="channelForm.name" required /></label>
        <label><span>{{ t('notifications.fields.type') }}</span><select v-model="channelForm.type"><option value="email">Email</option><option value="wecom">WeCom</option><option value="slack">Slack</option><option value="webhook">Webhook</option></select></label>
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
        <label><span>{{ t('notifications.fields.source') }}</span><input v-model="routeForm.source" required /></label>
        <label><span>{{ t('notifications.fields.priority') }}</span><input v-model="routeForm.priority" type="number" required /></label>
        <label><span>{{ t('notifications.fields.dedupeWindow') }}</span><input v-model="routeForm.dedupeWindowSeconds" type="number" required /></label>
      </form>
      <form v-else-if="activeDialog === 'template'" id="notification-template-form" class="notifications-page__form" @submit.prevent="saveTemplate">
        <label><span>{{ t('notifications.fields.templateKey') }}</span><input v-model="templateForm.templateKey" required /></label>
        <label><span>{{ t('notifications.fields.titleTemplate') }}</span><input v-model="templateForm.titleTemplate" required /></label>
        <label><span>{{ t('notifications.fields.bodyTemplate') }}</span><textarea v-model="templateForm.bodyTemplate" required /></label>
      </form>
      <form v-else-if="activeDialog === 'silence'" id="notification-silence-form" class="notifications-page__form" @submit.prevent="createSilence">
        <label><span>{{ t('notifications.fields.name') }}</span><input v-model="silenceForm.name" required /></label>
        <label><span>{{ t('notifications.fields.reason') }}</span><input v-model="silenceForm.reason" required /></label>
        <label><span>{{ t('notifications.fields.source') }}</span><input v-model="silenceForm.source" required /></label>
        <label><span>{{ t('notifications.fields.startsAt') }}</span><input v-model="silenceForm.startsAt" type="datetime-local" required /></label>
        <label><span>{{ t('notifications.fields.endsAt') }}</span><input v-model="silenceForm.endsAt" type="datetime-local" required /></label>
      </form>
      <template #actions>
        <button class="notifications-page__button notifications-page__button--secondary" type="button" :disabled="submitting" @click="closeDialog">{{ t('notifications.actions.cancel') }}</button>
        <button v-if="activeDialog" class="notifications-page__button" type="submit" :form="`notification-${activeDialog}-form`" :disabled="submitting">{{ activeDialog === 'test' ? t('notifications.actions.test') : t('notifications.actions.confirmCreate') }}</button>
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
.notifications-page__rules { gap: var(--gc-space-6); }
.notifications-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.notifications-page__toolbar h2, .notifications-page__toolbar p, .notifications-page__item h3, .notifications-page__item p { margin: 0; }
.notifications-page__toolbar p, .notifications-page__item p, .notifications-page__item dt, .notifications-page__form-hint { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__toolbar-actions, .notifications-page__status, .notifications-page__actions { display: flex; gap: var(--gc-space-2); flex-wrap: wrap; }
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
.notifications-page__button, .notifications-page__actions button { min-height: var(--gc-space-8); padding: 0 var(--gc-space-4); border: 0; border-radius: var(--gc-radius-sm); color: var(--gc-color-text-inverse); background: var(--gc-color-primary-strong); cursor: pointer; }
.notifications-page__button--secondary { border: var(--gc-space-hairline) solid var(--gc-color-border); color: var(--gc-color-text); background: var(--gc-color-surface); }
.notifications-page__button:disabled, .notifications-page__actions button:disabled { cursor: default; }
.notifications-page__error { margin: 0; padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-sm); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }

@media (max-width: 56.25rem) {
  .notifications-page__toolbar { align-items: stretch; flex-direction: column; }
  .notifications-page__item dl { grid-template-columns: 1fr; }
}
</style>
