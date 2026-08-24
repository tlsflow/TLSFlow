<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import {
  createCloudAccountAsset,
  deleteCloudAccountAsset,
  discoverCloudAccountAsset,
  executeProviderCapability,
  listCloudAccountAssets,
  listProviderCapabilities,
  listProviders,
  testCloudAccountAsset,
} from '@/api/modules/providers.api'
import type { ApiRecord } from '@/api/modules/common'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

const { t, locale } = useI18n()
const loading = ref(false)
const error = ref('')
const notice = ref('')
const providers = ref<ApiRecord[]>([])
const capabilities = ref<ApiRecord[]>([])
const accounts = ref<ApiRecord[]>([])
const accountFormOpen = ref(false)
const operationFormOpen = ref(false)
const selectedAccount = ref<ApiRecord | null>(null)
const actionLoading = ref('')

const accountDraft = reactive({
  displayName: '',
  providerKey: 'cloud.aliyun',
  accountId: '',
  credentialRef: '',
  scope: '{}',
})

const operationDraft = reactive({
  frameworkType: 'cloud.aliyun.cdn',
  operationKey: 'certificate.deploy',
  domain: '',
  resourceId: '',
  certificateId: '',
  checkpointId: '',
  certificatePem: '',
  privateKeyPem: '',
})

const providerOptions = computed(() => providers.value.map((item) => ({
  value: stringValue(item.providerKey),
  label: providerLabel(stringValue(item.providerKey)),
})).filter((item) => item.value))

const accountCapabilities = computed(() =>
  capabilities.value.filter((item) => stringValue(item.providerKey) === stringValue(selectedAccount.value?.providerKey)),
)

onMounted(() => void load())
watch(locale, () => void load())

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [providerResult, capabilityResult, accountResult] = await Promise.all([
      listProviders(),
      listProviderCapabilities(),
      listCloudAccountAssets(),
    ])
    providers.value = records(providerResult)
    capabilities.value = records(capabilityResult)
    accounts.value = records(accountResult)
    if (!accountDraft.providerKey && providerOptions.value[0]) accountDraft.providerKey = providerOptions.value[0].value
  } catch (cause) {
    error.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    loading.value = false
  }
}

function openAccountForm(): void {
  Object.assign(accountDraft, {
    displayName: '',
    providerKey: providerOptions.value[0]?.value || 'cloud.aliyun',
    accountId: '',
    credentialRef: '',
    scope: '{}',
  })
  accountFormOpen.value = true
}

async function saveAccount(): Promise<void> {
  actionLoading.value = 'create'
  error.value = ''
  try {
    await createCloudAccountAsset({
      displayName: accountDraft.displayName.trim(),
      providerKey: accountDraft.providerKey,
      accountId: accountDraft.accountId.trim() || undefined,
      credentialRef: accountDraft.credentialRef.trim(),
      scope: parseScope(accountDraft.scope),
    })
    accountFormOpen.value = false
    notice.value = t('providers.messages.saved')
    await load()
  } catch (cause) {
    error.value = errorMessage(cause, t('providers.messages.createFailed'))
  } finally {
    actionLoading.value = ''
  }
}

async function testAccount(account: ApiRecord): Promise<void> {
  const id = stringValue(account.id)
  if (!id) return
  actionLoading.value = `test:${id}`
  error.value = ''
  try {
    await testCloudAccountAsset(id)
    notice.value = t('providers.messages.testCompleted')
  } catch (cause) {
    error.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

async function discoverAccount(account: ApiRecord): Promise<void> {
  const id = stringValue(account.id)
  if (!id) return
  actionLoading.value = `discover:${id}`
  error.value = ''
  try {
    const result = await discoverCloudAccountAsset(id)
    const summary = readRecord(result.data)
    const projection = readRecord(readRecord(summary.resultSummary).projection)
    notice.value = t('providers.messages.discoverySummary', {
      frameworks: numberValue(projection.frameworks),
      sites: numberValue(projection.sites),
      managedTargets: numberValue(projection.managedTargets),
    })
  } catch (cause) {
    error.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

async function removeAccount(account: ApiRecord): Promise<void> {
  const id = stringValue(account.id)
  if (!id) return
  actionLoading.value = `delete:${id}`
  error.value = ''
  try {
    await deleteCloudAccountAsset(id)
    notice.value = t('providers.messages.deleted')
    await load()
  } catch (cause) {
    error.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

function openOperation(account: ApiRecord): void {
  selectedAccount.value = account
  operationDraft.frameworkType = `${stringValue(account.providerKey)}.cdn`
  operationDraft.operationKey = 'certificate.deploy'
  Object.assign(operationDraft, {
    domain: '',
    resourceId: '',
    certificateId: '',
    checkpointId: '',
    certificatePem: '',
    privateKeyPem: '',
  })
  operationFormOpen.value = true
}

async function runOperation(): Promise<void> {
  const accountId = stringValue(selectedAccount.value?.id)
  if (!accountId) return
  actionLoading.value = `execute:${accountId}`
  error.value = ''
  try {
    const result = await executeProviderCapability(accountId, {
      frameworkType: operationDraft.frameworkType,
      operationKey: operationDraft.operationKey,
      target: {
        frameworkType: operationDraft.frameworkType,
        resourceId: operationDraft.resourceId || operationDraft.domain,
        domain: operationDraft.domain || undefined,
      },
      input: {
        certificateId: operationDraft.certificateId || undefined,
        checkpointId: operationDraft.checkpointId || undefined,
        certificatePem: operationDraft.certificatePem || undefined,
        privateKeyPem: operationDraft.privateKeyPem || undefined,
      },
    })
    const checkpointId = stringValue(readRecord(result.data).checkpointId)
    notice.value = checkpointId
      ? `${t('providers.messages.operationCompleted')} ${t('providers.fields.checkpointId')}: ${checkpointId}`
      : t('providers.messages.operationCompleted')
    operationFormOpen.value = false
  } catch (cause) {
    error.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

function providerLabel(providerKey: string): string {
  const token = providerKey.split('.').at(-1) || providerKey
  const label = t(`providers.providerNames.${token}`)
  return label === `providers.providerNames.${token}` ? providerKey : label
}

function operationLabel(operationKey: string): string {
  const token = operationKey.replaceAll('.', '_')
  const label = t(`providers.operationNames.${token}`)
  return label === `providers.operationNames.${token}` ? operationKey : label
}

function frameworkLabel(frameworkType: string): string {
  return frameworkType.split('.').at(-1)?.toUpperCase() || frameworkType
}

function records(result: { data?: unknown }): ApiRecord[] {
  const data = readRecord(result.data)
  return Array.isArray(data.items) ? data.items.filter(isRecord) : []
}

function parseScope(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!isRecord(parsed)) throw new Error(t('providers.fields.scope'))
  return parsed
}

function readRecord(value: unknown): ApiRecord {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiClientError) return cause.message
  return cause instanceof Error && cause.message ? cause.message : fallback
}
</script>

<template>
  <main class="provider-page">
    <header class="provider-page__header">
      <div>
        <p class="provider-page__eyebrow">{{ t('providers.sections.providers') }}</p>
        <h1>{{ t('providers.page.title') }}</h1>
        <p>{{ t('providers.page.description') }}</p>
      </div>
      <div class="provider-page__actions">
        <button class="gc-button" type="button" :disabled="loading" @click="load">{{ t('providers.actions.refresh') }}</button>
        <button class="gc-button gc-button--primary" type="button" @click="openAccountForm">{{ t('providers.actions.add') }}</button>
      </div>
    </header>

    <p v-if="error" class="provider-message provider-message--error">{{ error }}</p>
    <p v-if="notice" class="provider-message provider-message--success">{{ notice }}</p>

    <section class="provider-section" :aria-label="t('providers.sections.providers')">
      <div class="provider-section__heading">
        <h2>{{ t('providers.sections.providers') }}</h2>
        <span>{{ providers.length }}</span>
      </div>
      <div v-if="providers.length" class="provider-grid">
        <article v-for="provider in providers" :key="String(provider.providerKey)" class="provider-card">
          <div class="provider-card__header">
            <div>
              <h3>{{ providerLabel(stringValue(provider.providerKey)) }}</h3>
              <p>{{ stringValue(provider.providerKey) }}</p>
            </div>
            <span class="provider-status">{{ t('providers.status.active') }}</span>
          </div>
          <dl class="provider-card__facts">
            <div><dt>{{ t('providers.fields.framework') }}</dt><dd>{{ readStringArray(provider.supportedProducts).join(', ') || t('common.notAvailable') }}</dd></div>
            <div><dt>{{ t('providers.fields.operation') }}</dt><dd>{{ readStringArray(provider.supportedOperations).length }}</dd></div>
          </dl>
        </article>
      </div>
      <p v-else class="provider-empty">{{ t('providers.messages.noProviders') }}</p>
    </section>

    <section class="provider-section" :aria-label="t('providers.sections.accounts')">
      <div class="provider-section__heading">
        <h2>{{ t('providers.sections.accounts') }}</h2>
        <span>{{ accounts.length }}</span>
      </div>
      <div v-if="accounts.length" class="account-list">
        <article v-for="account in accounts" :key="String(account.id)" class="account-row">
          <div class="account-row__main">
            <div class="account-row__title">
              <strong>{{ stringValue(account.displayName) }}</strong>
              <span>{{ providerLabel(stringValue(account.providerKey)) }}</span>
            </div>
            <dl class="account-row__facts">
              <div><dt>{{ t('providers.fields.accountId') }}</dt><dd>{{ stringValue(account.accountId) || t('common.notAvailable') }}</dd></div>
              <div><dt>{{ t('providers.fields.credentialRef') }}</dt><dd>{{ stringValue(account.credentialRef).replace(/#.*$/, '#…') }}</dd></div>
              <div><dt>{{ t('providers.fields.scope') }}</dt><dd>{{ JSON.stringify(account.scope || {}) }}</dd></div>
              <div><dt>{{ t('providers.fields.updatedAt') }}</dt><dd>{{ formatMaybeLocalTime(stringValue(account.updatedAt)) }}</dd></div>
            </dl>
          </div>
          <div class="account-row__actions">
            <button class="gc-button" type="button" :disabled="Boolean(actionLoading)" @click="testAccount(account)">{{ t('providers.actions.test') }}</button>
            <button class="gc-button" type="button" :disabled="Boolean(actionLoading)" @click="discoverAccount(account)">{{ t('providers.actions.discover') }}</button>
            <button class="gc-button gc-button--primary" type="button" :disabled="Boolean(actionLoading)" @click="openOperation(account)">{{ t('providers.actions.execute') }}</button>
            <button class="gc-button gc-button--danger" type="button" :disabled="Boolean(actionLoading)" @click="removeAccount(account)">{{ t('providers.actions.delete') }}</button>
          </div>
        </article>
      </div>
      <p v-else class="provider-empty">{{ t('providers.messages.noAccounts') }}</p>
    </section>

    <GcModal v-model:open="accountFormOpen" :title="t('providers.actions.add')" size="lg" :close-on-backdrop="false">
      <form class="provider-form" :aria-label="t('providers.aria.accountForm')" @submit.prevent="saveAccount">
        <label><span>{{ t('providers.fields.displayName') }}</span><input v-model="accountDraft.displayName" required :placeholder="t('providers.placeholders.displayName')" /></label>
        <label><span>{{ t('providers.fields.provider') }}</span><select v-model="accountDraft.providerKey"><option v-for="item in providerOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        <label><span>{{ t('providers.fields.accountId') }}</span><input v-model="accountDraft.accountId" :placeholder="t('providers.placeholders.accountId')" /></label>
        <label class="provider-form__wide"><span>{{ t('providers.fields.credentialRef') }}</span><input v-model="accountDraft.credentialRef" required :placeholder="t('providers.placeholders.credentialRef')" /><small>{{ t('providers.messages.credentialHint') }}</small></label>
        <label class="provider-form__wide"><span>{{ t('providers.fields.scope') }}</span><textarea v-model="accountDraft.scope" required :placeholder="t('providers.placeholders.scope')" /><small>{{ t('providers.messages.scopeHint') }}</small></label>
      </form>
      <template #actions>
        <button class="gc-button" type="button" @click="accountFormOpen = false">{{ t('providers.actions.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="actionLoading === 'create'" @click="saveAccount">{{ t('providers.actions.save') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="operationFormOpen" :title="t('providers.sections.operation')" size="xl" :close-on-backdrop="false">
      <form class="provider-form" :aria-label="t('providers.aria.operationForm')" @submit.prevent="runOperation">
        <label><span>{{ t('providers.fields.framework') }}</span><select v-model="operationDraft.frameworkType"><option v-for="item in accountCapabilities.filter((entry) => stringValue(entry.operationKey).startsWith('certificate.'))" :key="`${item.frameworkType}:${item.operationKey}`" :value="String(item.frameworkType)">{{ frameworkLabel(String(item.frameworkType)) }}</option></select></label>
        <label><span>{{ t('providers.fields.operation') }}</span><select v-model="operationDraft.operationKey"><option v-for="item in accountCapabilities.filter((entry) => String(entry.frameworkType) === operationDraft.frameworkType)" :key="String(item.operationKey)" :value="String(item.operationKey)">{{ operationLabel(String(item.operationKey)) }}</option></select></label>
        <label><span>{{ t('providers.fields.domain') }}</span><input v-model="operationDraft.domain" :placeholder="t('providers.placeholders.domain')" /></label>
        <label><span>{{ t('providers.fields.resourceId') }}</span><input v-model="operationDraft.resourceId" :placeholder="t('providers.placeholders.resourceId')" /></label>
        <label><span>{{ t('providers.fields.certificateId') }}</span><input v-model="operationDraft.certificateId" :placeholder="t('providers.placeholders.certificateId')" /></label>
        <label><span>{{ t('providers.fields.checkpointId') }}</span><input v-model="operationDraft.checkpointId" :placeholder="t('providers.placeholders.checkpointId')" /></label>
        <label class="provider-form__wide"><span>{{ t('providers.fields.certificatePem') }}</span><textarea v-model="operationDraft.certificatePem" :placeholder="t('providers.placeholders.certificatePem')" /></label>
        <label class="provider-form__wide"><span>{{ t('providers.fields.privateKeyPem') }}</span><textarea v-model="operationDraft.privateKeyPem" :placeholder="t('providers.placeholders.privateKeyPem')" /></label>
        <p class="provider-form__hint">{{ t('providers.messages.rollbackHint') }}</p>
      </form>
      <template #actions>
        <button class="gc-button" type="button" @click="operationFormOpen = false">{{ t('providers.actions.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="Boolean(actionLoading)" @click="runOperation">{{ t('providers.actions.execute') }}</button>
      </template>
    </GcModal>
  </main>
</template>

<script lang="ts">
import { GcModal } from '@/design-system/components'
export default { components: { GcModal } }

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
</script>

<style scoped>
.provider-page { display: grid; gap: var(--gc-space-5); }
.provider-page__header, .provider-section__heading, .account-row, .account-row__title, .account-row__actions, .provider-page__actions { display: flex; align-items: center; }
.provider-page__header, .provider-section__heading, .account-row { justify-content: space-between; gap: var(--gc-space-4); }
.provider-page__header { padding-block: var(--gc-space-2); }
.provider-page__eyebrow { margin: 0 0 var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-bold); text-transform: uppercase; }
.provider-page h1, .provider-page h2, .provider-page h3, .provider-page p { margin: 0; }
.provider-page h1 { color: var(--gc-color-text); font-size: var(--gc-font-size-2xl); }
.provider-page__header > div:first-child { display: grid; gap: var(--gc-space-1); }
.provider-page__header > div:first-child > p:last-child { color: var(--gc-color-text-muted); }
.provider-page__actions, .account-row__actions { flex-wrap: wrap; justify-content: flex-end; }
.provider-section { display: grid; gap: var(--gc-space-3); }
.provider-section__heading { border-bottom: 1px solid var(--gc-color-border); padding-bottom: var(--gc-space-2); }
.provider-section__heading h2 { font-size: var(--gc-font-size-lg); }
.provider-section__heading span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.provider-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: var(--gc-space-3); }
.provider-card, .account-row { border: 1px solid var(--gc-color-border); background: var(--gc-color-surface-raised); border-radius: var(--gc-radius-md); }
.provider-card { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); }
.provider-card__header { display: flex; justify-content: space-between; gap: var(--gc-space-3); }
.provider-card__header h3 { font-size: var(--gc-font-size-md); }
.provider-card__header p, .account-row__title span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.provider-status { color: var(--gc-color-success); font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-bold); }
.provider-card__facts, .account-row__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; }
.provider-card__facts div, .account-row__facts div { display: grid; gap: var(--gc-space-1); min-width: 0; }
.provider-card__facts dt, .account-row__facts dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.provider-card__facts dd, .account-row__facts dd { margin: 0; color: var(--gc-color-text); overflow-wrap: anywhere; }
.account-list { display: grid; gap: var(--gc-space-3); }
.account-row { align-items: stretch; padding: var(--gc-space-4); }
.account-row__main { display: grid; gap: var(--gc-space-3); min-width: 0; flex: 1; }
.account-row__title { gap: var(--gc-space-2); flex-wrap: wrap; }
.account-row__facts { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.account-row__actions { align-content: center; min-width: 14rem; }
.provider-empty, .provider-message, .provider-form__hint { color: var(--gc-color-text-muted); }
.provider-message { padding: var(--gc-space-3); border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-sm); }
.provider-message--error { color: var(--gc-color-danger); border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-bg); }
.provider-message--success { color: var(--gc-color-success); border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.provider-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.provider-form label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text); font-size: var(--gc-font-size-sm); }
.provider-form__wide { grid-column: 1 / -1; }
.provider-form input, .provider-form select, .provider-form textarea { width: 100%; border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-solid); color: var(--gc-color-text); padding: var(--gc-space-2); font: inherit; }
.provider-form textarea { min-height: 5rem; resize: vertical; }
.provider-form small { color: var(--gc-color-text-muted); }
@media (max-width: 48rem) {
  .provider-page__header, .account-row { align-items: stretch; flex-direction: column; }
  .provider-page__actions, .account-row__actions { justify-content: flex-start; }
  .account-row__facts, .provider-form { grid-template-columns: 1fr; }
  .provider-form__wide { grid-column: auto; }
}
</style>
