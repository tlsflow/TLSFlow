<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import GcPageHeader from '@/design-system/components/GcPageHeader.vue'
import GcStatusTag from '@/design-system/components/GcStatusTag.vue'
import { listAssets } from '@/api/modules/assets.api'
import { listPluginCatalog } from '@/api/modules/plugins.api'
import {
  acquireBrowserCredentialSession,
  cancelBrowserCredentialSession,
  createBrowserCredentialSession,
  getBrowserCredentialSession,
  type BrowserCredentialSession,
} from '@/api/modules/credentials.api'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

interface OptionItem {
  id: string
  label: string
}

const { t } = useI18n()
const assets = ref<OptionItem[]>([])
const plugins = ref<OptionItem[]>([])
const assetId = ref('')
const pluginVersionId = ref('')
const ttlSeconds = ref(900)
const session = ref<BrowserCredentialSession | null>(null)
const loading = ref(false)
const acquiring = ref(false)
const error = ref('')
let pollTimer: number | undefined

const canCreate = computed(() => Boolean(assetId.value && pluginVersionId.value && !loading.value))
const canAcquire = computed(() => session.value?.status === 'READY_FOR_ACQUISITION' && !acquiring.value)
const canCancel = computed(() => Boolean(session.value && !['SAVED', 'FAILED', 'EXPIRED', 'CLOSED'].includes(session.value.status)))

onMounted(() => {
  void loadOptions()
})

onUnmounted(() => {
  stopPolling()
})

async function loadOptions() {
  loading.value = true
  error.value = ''
  try {
    const [assetResult, pluginResult] = await Promise.all([
      listAssets({ page: 1, pageSize: 200 }),
      listPluginCatalog({ page: 1, pageSize: 200 }),
    ])
    assets.value = (assetResult.data?.items ?? []).map((item) => ({
      id: String(item.id ?? ''),
      label: String(item.displayName ?? item.address ?? item.name ?? item.id ?? ''),
    })).filter((item) => item.id)
    plugins.value = (pluginResult.data?.items ?? [])
      .filter((item) => Array.isArray(item.capabilities) && item.capabilities.some((capability) => readCapabilityKey(capability) === 'credential.acquire'))
      .map((item) => ({
        id: String(item.pluginVersionId ?? item.id ?? ''),
        label: String(item.displayName ?? item.name ?? item.pluginId ?? item.id ?? ''),
      }))
      .filter((item) => item.id)
    assetId.value ||= assets.value[0]?.id ?? ''
    pluginVersionId.value ||= plugins.value[0]?.id ?? ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.load')
  } finally {
    loading.value = false
  }
}

async function createSession() {
  if (!canCreate.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await createBrowserCredentialSession({
      assetId: assetId.value,
      pluginVersionId: pluginVersionId.value,
      ttlSeconds: ttlSeconds.value,
    })
    session.value = requireSessionData(result.data)
    startPolling()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.create')
  } finally {
    loading.value = false
  }
}

async function acquire() {
  if (!session.value || !canAcquire.value) return
  acquiring.value = true
  error.value = ''
  try {
    const result = await acquireBrowserCredentialSession(session.value.id)
    session.value = requireSessionData(result.data)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.acquire')
    await refreshSession()
  } finally {
    acquiring.value = false
  }
}

async function cancelSession() {
  if (!session.value || !canCancel.value) return
  loading.value = true
  error.value = ''
  try {
    const result = await cancelBrowserCredentialSession(session.value.id)
    session.value = requireSessionData(result.data)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.cancel')
  } finally {
    loading.value = false
  }
}

async function refreshSession() {
  if (!session.value) return
  const result = await getBrowserCredentialSession(session.value.id)
  session.value = requireSessionData(result.data)
}

function startPolling() {
  stopPolling()
  pollTimer = window.setInterval(() => {
    if (!session.value || ['SAVED', 'FAILED', 'EXPIRED', 'CLOSED'].includes(session.value.status)) {
      stopPolling()
      return
    }
    void refreshSession().catch(() => undefined)
  }, 5000)
}

function stopPolling() {
  if (pollTimer !== undefined) window.clearInterval(pollTimer)
  pollTimer = undefined
}

function readCapabilityKey(value: unknown): string {
  return value && typeof value === 'object' && 'key' in value ? String((value as { key?: unknown }).key ?? '') : String(value ?? '')
}

function requireSessionData(value: BrowserCredentialSession | undefined): BrowserCredentialSession {
  if (!value) throw new Error(t('credentials.browser.errors.emptyResponse'))
  return value
}

function localTime(value: string | undefined): string {
  return value ? formatBrowserLocalTime(value, { includeSeconds: false }) || t('common.notAvailable') : t('common.notAvailable')
}
</script>

<template>
  <section class="gc-page browser-credentials">
    <GcPageHeader :title="t('credentials.browser.title')" :description="t('credentials.browser.description')">
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="loadOptions">{{ t('credentials.actions.refresh') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="!canCreate" @click="createSession">{{ t('credentials.browser.actions.create') }}</button>
      </template>
    </GcPageHeader>

    <p v-if="error" class="browser-credentials__error" role="alert">{{ error }}</p>

    <section class="gc-card browser-credentials__panel">
      <div class="browser-credentials__form">
        <label class="gc-form-field">
          <span>{{ t('credentials.browser.fields.asset') }}</span>
          <select v-model="assetId" :disabled="loading || Boolean(session)">
            <option v-for="item in assets" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
        <label class="gc-form-field">
          <span>{{ t('credentials.browser.fields.plugin') }}</span>
          <select v-model="pluginVersionId" :disabled="loading || Boolean(session)">
            <option v-for="item in plugins" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
        <label class="gc-form-field">
          <span>{{ t('credentials.browser.fields.ttl') }}</span>
          <input v-model.number="ttlSeconds" type="number" min="60" max="3600" step="60" :disabled="loading || Boolean(session)">
        </label>
      </div>
    </section>

    <section v-if="session" class="gc-card browser-credentials__workspace">
      <header class="browser-credentials__status">
        <div>
          <h2>{{ t('credentials.browser.session.title') }}</h2>
          <p>{{ t('credentials.browser.session.expiresAt', { time: localTime(session.expiresAt) }) }}</p>
        </div>
        <GcStatusTag :status="session.status" />
      </header>

      <dl class="browser-credentials__facts">
        <div><dt>{{ t('credentials.browser.fields.plugin') }}</dt><dd>{{ session.capability.pluginId }}@{{ session.capability.pluginVersion }}</dd></div>
        <div><dt>{{ t('credentials.browser.fields.loginUrl') }}</dt><dd>{{ session.capability.loginUrl }}</dd></div>
        <div><dt>{{ t('credentials.browser.fields.outputs') }}</dt><dd>{{ session.capability.outputParameters.join(', ') }}</dd></div>
        <div v-if="session.credentialId"><dt>{{ t('credentials.browser.fields.credentialId') }}</dt><dd>{{ session.credentialId }}</dd></div>
      </dl>

      <div v-if="session.temporaryUrl" class="browser-credentials__vnc">
        <iframe :src="session.temporaryUrl" :title="t('credentials.browser.vncTitle')" />
      </div>

      <p v-if="session.errorMessage" class="browser-credentials__error" role="alert">{{ session.errorCode }} · {{ session.errorMessage }}</p>

      <footer class="browser-credentials__actions">
        <button class="gc-button" type="button" :disabled="!canCancel || loading" @click="cancelSession">{{ t('common.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="!canAcquire" @click="acquire">{{ acquiring ? t('credentials.browser.actions.acquiring') : t('credentials.browser.actions.acquire') }}</button>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.browser-credentials { display: grid; gap: var(--gc-space-5); }
.browser-credentials__error { margin: 0; padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); background: var(--gc-color-danger-bg); color: var(--gc-color-danger); }
.browser-credentials__panel, .browser-credentials__workspace { padding: var(--gc-space-5); }
.browser-credentials__form { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); }
.browser-credentials__status { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--gc-space-4); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); padding-bottom: var(--gc-space-4); }
.browser-credentials__status h2 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-lg); }
.browser-credentials__status p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.browser-credentials__facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-3); margin: var(--gc-space-4) 0; }
.browser-credentials__facts div { min-width: 0; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3); background: var(--gc-color-surface-soft); }
.browser-credentials__facts dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.browser-credentials__facts dd { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text); overflow-wrap: anywhere; }
.browser-credentials__vnc { height: 70vh; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); overflow: hidden; background: var(--gc-color-code-bg); }
.browser-credentials__vnc iframe { width: 100%; height: 100%; border: 0; }
.browser-credentials__actions { display: flex; justify-content: flex-end; gap: var(--gc-space-3); margin-top: var(--gc-space-4); }
</style>
