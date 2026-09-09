<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  checkSystemUpdate,
  getSystemUpdateSettings,
  updateSystemUpdateChannel,
  type SystemUpdateCheck,
  type UpdateChannel,
} from '@/api/modules/system.api'
import { usePermissionStore } from '@/stores/permission.store'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import { gcacVersion } from '@/version'

const { t } = useI18n()
const permissionStore = usePermissionStore()
const canWrite = computed(() => permissionStore.hasPermission('settings.system.write'))
const loading = ref(false)
const saving = ref(false)
const checking = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const channel = ref<UpdateChannel>('stable')
const settingsVersion = ref(1)
const checkResult = ref<SystemUpdateCheck | null>(null)

const channelOptions = computed(() => [
  { value: 'stable' as const, label: t('settings.version.channels.stable'), description: t('settings.version.channels.stableDescription') },
  { value: 'dev' as const, label: t('settings.version.channels.dev'), description: t('settings.version.channels.devDescription') },
])

const resultTone = computed(() => {
  if (!checkResult.value) return 'muted'
  if (!checkResult.value.updateAvailable) return 'success'
  if (checkResult.value.relation === 'downgrade' || checkResult.value.relation === 'channel_switch') return 'warning'
  return 'info'
})

function relationLabel(relation: SystemUpdateCheck['relation']): string {
  return t(`settings.version.relations.${relation}`)
}

function statusLabel(result: SystemUpdateCheck): string {
  if (!result.updateAvailable && result.relation !== 'channel_switch') return t('settings.version.status.current')
  return relationLabel(result.relation)
}

async function loadSettings(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await getSystemUpdateSettings()
    if (!result.data) throw new Error(t('settings.version.errors.emptySettings'))
    channel.value = result.data.channel
    settingsVersion.value = result.data.version
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('settings.version.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

async function saveChannel(): Promise<void> {
  if (!canWrite.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await updateSystemUpdateChannel(channel.value, settingsVersion.value)
    if (!result.data) throw new Error(t('settings.version.errors.emptySettings'))
    channel.value = result.data.channel
    settingsVersion.value = result.data.version
    checkResult.value = null
    successMessage.value = t('settings.version.messages.channelSaved')
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('settings.version.errors.saveFailed')
  } finally {
    saving.value = false
  }
}

async function runCheck(): Promise<void> {
  if (checking.value) return
  checking.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await checkSystemUpdate(channel.value)
    if (!result.data) throw new Error(t('settings.version.errors.emptyCheck'))
    checkResult.value = result.data
  } catch (cause) {
    checkResult.value = null
    errorMessage.value = cause instanceof Error ? cause.message : t('settings.version.errors.checkFailed')
  } finally {
    checking.value = false
  }
}

onMounted(() => { void loadSettings() })
</script>

<template>
  <section class="gc-page version-page">
    <header class="version-page__header">
      <div>
        <p class="version-page__eyebrow">{{ t('settings.version.eyebrow') }}</p>
        <h2>{{ t('settings.version.title') }}</h2>
        <p>{{ t('settings.version.description') }}</p>
      </div>
    </header>

    <p v-if="loading" class="version-page__state">{{ t('common.loading') }}</p>
    <p v-if="errorMessage" class="gc-form-error" role="alert">{{ errorMessage }}</p>
    <p v-if="successMessage" class="version-page__success" role="status">{{ successMessage }}</p>

    <section class="version-page__grid">
      <article class="gc-card version-page__card">
        <span class="version-page__label">{{ t('settings.version.currentVersion') }}</span>
        <strong class="version-page__value">{{ gcacVersion }}</strong>
        <dl class="version-page__details">
          <div>
            <dt>{{ t('settings.version.product') }}</dt>
            <dd>{{ t('app.brand') }}</dd>
          </div>
        </dl>
      </article>

      <form class="gc-card version-page__card version-page__channel-card" @submit.prevent="saveChannel">
        <div class="version-page__card-heading">
          <div>
            <span class="version-page__label">{{ t('settings.version.channelLabel') }}</span>
            <p>{{ t('settings.version.channelDescription') }}</p>
          </div>
          <span v-if="!canWrite" class="version-page__readonly">{{ t('settings.version.readonly') }}</span>
        </div>
        <fieldset :disabled="loading || saving || !canWrite" class="version-page__options">
          <legend class="sr-only">{{ t('settings.version.channelLabel') }}</legend>
          <label v-for="option in channelOptions" :key="option.value" class="version-page__option">
            <input v-model="channel" type="radio" name="update-channel" :value="option.value" :aria-label="option.label">
            <span>
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
            </span>
          </label>
        </fieldset>
        <footer class="version-page__actions">
          <button class="gc-button gc-button--primary" type="submit" :disabled="loading || saving || !canWrite">
            {{ saving ? t('settings.version.actions.saving') : t('settings.version.actions.save') }}
          </button>
        </footer>
      </form>
    </section>

    <section class="gc-card version-page__check-card">
      <div class="version-page__card-heading">
        <div>
          <span class="version-page__label">{{ t('settings.version.checkTitle') }}</span>
          <p>{{ t('settings.version.checkDescription') }}</p>
        </div>
        <button class="gc-button" type="button" :disabled="loading || checking" @click="runCheck">
          {{ checking ? t('settings.version.actions.checking') : t('settings.version.actions.check') }}
        </button>
      </div>

      <p v-if="!checkResult" class="version-page__state">{{ t('settings.version.checkEmpty') }}</p>
      <template v-else>
        <div class="version-page__status" :class="`version-page__status--${resultTone}`" role="status">
          <strong>{{ statusLabel(checkResult) }}</strong>
          <span>{{ t('settings.version.lastChecked', { time: formatBrowserLocalTime(checkResult.checkedAt) || t('common.notAvailable') }) }}</span>
        </div>
        <dl class="version-page__details version-page__release-details">
          <div>
            <dt>{{ t('settings.version.targetVersion') }}</dt>
            <dd>{{ checkResult.targetVersion }}</dd>
          </div>
          <div>
            <dt>{{ t('settings.version.publishedAt') }}</dt>
            <dd>{{ formatBrowserLocalTime(checkResult.publishedAt) || t('common.notAvailable') }}</dd>
          </div>
          <div class="version-page__notes">
            <dt>{{ t('settings.version.releaseNotes') }}</dt>
            <dd>{{ checkResult.releaseNotes }}</dd>
          </div>
        </dl>
        <div v-if="checkResult.updateAvailable" class="version-page__manual">
          <h3>{{ t('settings.version.manualTitle') }}</h3>
          <p>{{ t('settings.version.manualDescription') }}</p>
          <label>
            <span>{{ t('settings.version.installScriptCommand') }}</span>
            <code>{{ checkResult.commands.installScript }}</code>
          </label>
          <label>
            <span>{{ t('settings.version.composeCommand') }}</span>
            <code>{{ checkResult.commands.compose }}</code>
          </label>
        </div>
      </template>
    </section>
  </section>
</template>

<style scoped>
.version-page {
  display: grid;
  gap: var(--gc-space-5);
}

.version-page__header,
.version-page__card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
}

.version-page__header h2,
.version-page__header p,
.version-page__card-heading p {
  margin: 0;
}

.version-page__header p:not(.version-page__eyebrow),
.version-page__card-heading p {
  color: var(--gc-color-text-muted);
  line-height: 1.6;
}

.version-page__eyebrow {
  margin: 0 0 var(--gc-space-2);
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  text-transform: uppercase;
}

.version-page__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--gc-space-5);
}

.version-page__card,
.version-page__check-card {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-6);
}

.version-page__card {
  align-content: start;
}

.version-page__label,
.version-page__manual label > span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.version-page__value {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-2xl);
  line-height: 1;
}

.version-page__details {
  display: grid;
  gap: var(--gc-space-3);
  margin: 0;
  padding-top: var(--gc-space-4);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-soft);
}

.version-page__details div {
  display: grid;
  gap: var(--gc-space-1);
}

.version-page__details dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.version-page__details dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  font-weight: 700;
}

.version-page__options {
  display: grid;
  gap: var(--gc-space-3);
  margin: 0;
  padding: 0;
  border: 0;
}

.version-page__option {
  display: flex;
  align-items: flex-start;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  cursor: pointer;
}

.version-page__option:has(input:checked) {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.version-page__option input {
  flex: 0 0 auto;
  margin-top: var(--gc-space-1);
  accent-color: var(--gc-color-primary);
}

.version-page__option span {
  display: grid;
  gap: var(--gc-space-1);
}

.version-page__option small {
  color: var(--gc-color-text-muted);
  line-height: 1.5;
}

.version-page__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gc-space-3);
}

.version-page__readonly,
.version-page__state {
  color: var(--gc-color-text-muted);
}

.version-page__success {
  color: var(--gc-color-success);
}

.version-page__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
}

.version-page__status span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.version-page__status--success {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
  border-color: var(--gc-color-success-border);
}

.version-page__status--warning {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
  border-color: var(--gc-color-warning-border);
}

.version-page__status--info {
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
  border-color: var(--gc-color-info-border);
}

.version-page__manual {
  display: grid;
  gap: var(--gc-space-3);
  padding-top: var(--gc-space-4);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-soft);
}

.version-page__manual h3,
.version-page__manual p {
  margin: 0;
}

.version-page__manual p {
  color: var(--gc-color-text-muted);
}

.version-page__manual label {
  display: grid;
  gap: var(--gc-space-2);
}

.version-page__manual code {
  display: block;
  overflow-x: auto;
  padding: var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-raised);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-sm);
  font-family: var(--gc-font-family-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sr-only {
  position: absolute;
  inline-size: var(--gc-border-width-default);
  block-size: var(--gc-border-width-default);
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (max-width: 48rem) {
  .version-page__grid {
    grid-template-columns: 1fr;
  }

  .version-page__header,
  .version-page__card-heading,
  .version-page__status {
    flex-direction: column;
  }

  .version-page__actions {
    justify-content: stretch;
  }

  .version-page__actions .gc-button {
    inline-size: 100%;
  }
}
</style>
