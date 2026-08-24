<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcPageHeader, GcSecretInput, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
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

const { t } = useI18n()
const activeTab = ref('channels')
const loading = ref(false)
const errorMessage = ref('')
const channels = ref<NotificationChannel[]>([])
const deliveries = ref<NotificationDelivery[]>([])
const routes = ref<Record<string, unknown>[]>([])
const templates = ref<Record<string, unknown>[]>([])
const silences = ref<Record<string, unknown>[]>([])
const form = reactive({ name: '', type: 'email' as NotificationChannelType, host: '', port: '587', from: '', secretRef: '', target: '' })
const routeForm = reactive({ name: '', channelId: '', source: 'monitor', priority: '100', dedupeWindowSeconds: '300' })
const templateForm = reactive({ templateKey: '', titleTemplate: '', bodyTemplate: '' })
const silenceForm = reactive({ name: '', reason: '', source: 'monitor', startsAt: '', endsAt: '' })

const tabs = computed(() => [
  { value: 'channels', label: t('notifications.tabs.channels') },
  { value: 'deliveries', label: t('notifications.tabs.deliveries') },
  { value: 'rules', label: t('notifications.tabs.rules') }
])

async function refresh() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [channelResult, deliveryResult, routeResult, templateResult, silenceResult] = await Promise.all([
      listNotificationChannels(), listNotificationDeliveries(), listNotificationRoutes(), listNotificationTemplates(), listNotificationSilences()
    ])
    channels.value = channelResult.data ?? []
    deliveries.value = deliveryResult.data?.items ?? []
    routes.value = routeResult.data ?? []
    templates.value = templateResult.data ?? []
    silences.value = silenceResult.data ?? []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('notifications.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

async function createChannel() {
  const secretKey = form.type === 'webhook' ? 'url' : form.type === 'email' ? 'password' : 'webhookUrl'
  const config = form.type === 'email' ? { host: form.host, port: Number(form.port), from: form.from, startTls: true } : {}
  await createNotificationChannel({ name: form.name, type: form.type, status: 'disabled', config, secretRefs: form.secretRef ? { [secretKey]: form.secretRef } : {} })
  Object.assign(form, { name: '', host: '', port: '587', from: '', secretRef: '', target: '' })
  await refresh()
}

async function toggleChannel(channel: NotificationChannel) {
  await updateNotificationChannel(channel.id, { version: channel.version, status: channel.status === 'active' ? 'disabled' : 'active' })
  await refresh()
}

async function testChannel(channel: NotificationChannel) {
  const target = channel.type === 'email' ? { to: form.target.split(',').map((item) => item.trim()).filter(Boolean) } : {}
  await testNotificationChannel(channel.id, target)
  await refresh()
}

async function retryDelivery(delivery: NotificationDelivery) {
  await retryNotificationDelivery(delivery.id)
  await refresh()
}

async function createRoute() {
  await createNotificationRoute({
    name: routeForm.name,
    priority: Number(routeForm.priority),
    matcher: routeForm.source ? { sources: [routeForm.source] } : {},
    channelTargets: [{ channelId: routeForm.channelId }],
    stopOnMatch: false,
    dedupeWindowSeconds: Number(routeForm.dedupeWindowSeconds)
  })
  Object.assign(routeForm, { name: '', channelId: '', source: 'monitor', priority: '100', dedupeWindowSeconds: '300' })
  await refresh()
}

async function saveTemplate() {
  await saveNotificationTemplate({
    templateKey: templateForm.templateKey,
    locale: 'zh-CN',
    titleTemplate: templateForm.titleTemplate,
    bodyTemplate: templateForm.bodyTemplate,
    requiredVariables: [],
    status: 'active'
  })
  Object.assign(templateForm, { templateKey: '', titleTemplate: '', bodyTemplate: '' })
  await refresh()
}

async function createSilence() {
  await createNotificationSilence({
    name: silenceForm.name,
    reason: silenceForm.reason,
    matcher: silenceForm.source ? { sources: [silenceForm.source] } : {},
    startsAt: new Date(silenceForm.startsAt).toISOString(),
    endsAt: new Date(silenceForm.endsAt).toISOString()
  })
  Object.assign(silenceForm, { name: '', reason: '', source: 'monitor', startsAt: '', endsAt: '' })
  await refresh()
}

onMounted(refresh)
</script>

<template>
  <section class="notifications-page">
    <GcPageHeader :title="t('notifications.title')" :description="t('notifications.description')">
      <template #actions><button class="gc-button" type="button" :disabled="loading" @click="refresh">{{ t('common.refresh') }}</button></template>
    </GcPageHeader>
    <p v-if="errorMessage" class="notifications-page__error" role="alert">{{ errorMessage }}</p>
    <GcTabs v-model="activeTab" :tabs="tabs" />

    <section v-if="activeTab === 'channels'" class="notifications-page__grid">
      <form class="gc-card notifications-page__form" @submit.prevent="createChannel">
        <h2>{{ t('notifications.channels.createTitle') }}</h2>
        <label><span>{{ t('notifications.fields.name') }}</span><input v-model="form.name" required /></label>
        <label><span>{{ t('notifications.fields.type') }}</span><select v-model="form.type"><option value="email">Email</option><option value="wecom">WeCom</option><option value="slack">Slack</option><option value="webhook">Webhook</option></select></label>
        <template v-if="form.type === 'email'">
          <label><span>{{ t('notifications.fields.smtpHost') }}</span><input v-model="form.host" required /></label>
          <label><span>{{ t('notifications.fields.smtpPort') }}</span><input v-model="form.port" type="number" required /></label>
          <label><span>{{ t('notifications.fields.from') }}</span><input v-model="form.from" type="email" required /></label>
        </template>
        <GcSecretInput v-model="form.secretRef" :label="t('notifications.fields.secretRef')" :placeholder="t('notifications.fields.secretRefPlaceholder')" />
        <label><span>{{ t('notifications.fields.testTarget') }}</span><input v-model="form.target" :placeholder="t('notifications.fields.testTargetPlaceholder')" /></label>
        <button class="gc-button" type="submit">{{ t('common.create') }}</button>
      </form>

      <div class="notifications-page__list">
        <article v-for="channel in channels" :key="channel.id" class="gc-card notifications-page__item">
          <div><h3>{{ channel.name }}</h3><p>{{ channel.type }}</p></div>
          <div class="notifications-page__status"><GcStatusTag :status="channel.status" /><GcStatusTag :status="channel.healthStatus" /></div>
          <dl><div><dt>{{ t('notifications.fields.lastSuccess') }}</dt><dd>{{ formatBrowserLocalTime(channel.lastSucceededAt) || t('common.notAvailable') }}</dd></div><div><dt>{{ t('notifications.fields.latency') }}</dt><dd>{{ channel.lastLatencyMs ?? t('common.notAvailable') }}</dd></div></dl>
          <div class="notifications-page__actions"><button type="button" @click="toggleChannel(channel)">{{ channel.status === 'active' ? t('common.disable') : t('common.enable') }}</button><button type="button" @click="testChannel(channel)">{{ t('notifications.actions.test') }}</button></div>
        </article>
      </div>
    </section>

    <section v-else-if="activeTab === 'deliveries'" class="notifications-page__list">
      <article v-for="delivery in deliveries" :key="delivery.id" class="gc-card notifications-page__item">
        <div><h3>{{ delivery.channelNameSnapshot }}</h3><p>{{ delivery.requestId }}</p></div><GcStatusTag :status="delivery.status" />
        <dl><div><dt>{{ t('notifications.fields.createdAt') }}</dt><dd>{{ formatBrowserLocalTime(delivery.createdAt) }}</dd></div><div><dt>{{ t('notifications.fields.failureCategory') }}</dt><dd>{{ delivery.failureCategory || t('common.notAvailable') }}</dd></div></dl>
        <button v-if="delivery.status === 'failed'" type="button" @click="retryDelivery(delivery)">{{ t('notifications.actions.retry') }}</button>
      </article>
    </section>

    <section v-else class="notifications-page__rules">
      <div class="notifications-page__summary">
        <article class="gc-card"><strong>{{ routes.length }}</strong><span>{{ t('notifications.summary.routes') }}</span></article>
        <article class="gc-card"><strong>{{ templates.length }}</strong><span>{{ t('notifications.summary.templates') }}</span></article>
        <article class="gc-card"><strong>{{ silences.length }}</strong><span>{{ t('notifications.summary.silences') }}</span></article>
      </div>
      <div class="notifications-page__rule-forms">
        <form class="gc-card notifications-page__form" @submit.prevent="createRoute">
          <h2>{{ t('notifications.rules.createRoute') }}</h2>
          <label><span>{{ t('notifications.fields.name') }}</span><input v-model="routeForm.name" required /></label>
          <label><span>{{ t('notifications.fields.channel') }}</span><select v-model="routeForm.channelId" required><option disabled value="">{{ t('notifications.fields.selectChannel') }}</option><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label>
          <label><span>{{ t('notifications.fields.source') }}</span><input v-model="routeForm.source" required /></label>
          <label><span>{{ t('notifications.fields.priority') }}</span><input v-model="routeForm.priority" type="number" required /></label>
          <label><span>{{ t('notifications.fields.dedupeWindow') }}</span><input v-model="routeForm.dedupeWindowSeconds" type="number" required /></label>
          <button type="submit">{{ t('common.create') }}</button>
        </form>
        <form class="gc-card notifications-page__form" @submit.prevent="saveTemplate">
          <h2>{{ t('notifications.rules.createTemplate') }}</h2>
          <label><span>{{ t('notifications.fields.templateKey') }}</span><input v-model="templateForm.templateKey" required /></label>
          <label><span>{{ t('notifications.fields.titleTemplate') }}</span><input v-model="templateForm.titleTemplate" required /></label>
          <label><span>{{ t('notifications.fields.bodyTemplate') }}</span><textarea v-model="templateForm.bodyTemplate" required /></label>
          <button type="submit">{{ t('common.save') }}</button>
        </form>
        <form class="gc-card notifications-page__form" @submit.prevent="createSilence">
          <h2>{{ t('notifications.rules.createSilence') }}</h2>
          <label><span>{{ t('notifications.fields.name') }}</span><input v-model="silenceForm.name" required /></label>
          <label><span>{{ t('notifications.fields.reason') }}</span><input v-model="silenceForm.reason" required /></label>
          <label><span>{{ t('notifications.fields.source') }}</span><input v-model="silenceForm.source" required /></label>
          <label><span>{{ t('notifications.fields.startsAt') }}</span><input v-model="silenceForm.startsAt" type="datetime-local" required /></label>
          <label><span>{{ t('notifications.fields.endsAt') }}</span><input v-model="silenceForm.endsAt" type="datetime-local" required /></label>
          <button type="submit">{{ t('common.create') }}</button>
        </form>
      </div>
    </section>
  </section>
</template>

<style scoped>
.notifications-page { display: grid; gap: var(--gc-space-5); }
.notifications-page__grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--gc-space-5); align-items: start; }
.notifications-page__form, .notifications-page__item { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-5); }
.notifications-page__form label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__form input, .notifications-page__form select, .notifications-page__form textarea { padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text); }
.notifications-page__form textarea { min-height: calc(var(--gc-space-10) * 2); resize: vertical; }
.notifications-page__list { display: grid; gap: var(--gc-space-3); }
.notifications-page__item { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
.notifications-page__item h3, .notifications-page__item p { margin: 0; }
.notifications-page__item p, .notifications-page__item dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.notifications-page__item dl { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.notifications-page__item dl div { display: grid; gap: var(--gc-space-1); }
.notifications-page__item dd { margin: 0; overflow-wrap: anywhere; }
.notifications-page__status, .notifications-page__actions { display: flex; gap: var(--gc-space-2); flex-wrap: wrap; }
.notifications-page__actions { grid-column: 1 / -1; }
.notifications-page__summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-4); }
.notifications-page__rules, .notifications-page__rule-forms { display: grid; gap: var(--gc-space-4); }
.notifications-page__rule-forms { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
.notifications-page__summary article { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-5); }
.notifications-page__summary strong { font-size: var(--gc-font-size-xl); color: var(--gc-color-primary); }
.notifications-page__error { margin: 0; padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-sm); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.gc-button, button { min-height: var(--gc-space-8); padding: 0 var(--gc-space-4); border: 0; border-radius: var(--gc-radius-sm); color: var(--gc-color-surface-solid); background: var(--gc-color-primary-strong); cursor: pointer; }
@media (max-width: 56.25rem) { .notifications-page__grid, .notifications-page__summary, .notifications-page__rule-forms { grid-template-columns: 1fr; } }
</style>
