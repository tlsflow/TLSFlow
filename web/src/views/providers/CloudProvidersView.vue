<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { ApiClientError } from '@/api/client'
import {
  createCloudAccountAsset,
  deleteCloudAccountAsset,
  getCloudAccountAsset,
  listCloudAccountAssets,
  updateCloudAccountAsset,
} from '@/api/modules/providers.api'
import type { ApiRecord } from '@/api/modules/common'
import { type CredentialKind } from '@/api/modules/credentials.api'
import { getUnifiedPluginUiResources, listPluginCatalog } from '@/api/modules/plugins.api'
import { GcCredentialSelect, GcModal } from '@/design-system/components'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import type { ViewRow } from '@/composables/useBusinessPage'

type AccountWizardStep = 1 | 2

interface CloudProviderFormField {
  key: string
  type: 'objectRef' | 'secretRef' | 'string' | 'artifactRef'
  required: boolean
  labelKey?: string
}

interface CloudProviderDefinition {
  pluginId: string
  pluginVersionId: string
  displayName: string
  fields: CloudProviderFormField[]
  messages: Record<string, string>
  available: boolean
  unavailableReason?: string
}

const credentialKinds: CredentialKind[] = ['CLOUD_PROVIDER']
const { t, locale } = useI18n()
const route = useRoute?.() ?? { query: {} as Record<string, string | string[] | undefined> }
const requestError = ref('')
const notice = ref('')
const accountFormOpen = ref(false)
const editingAccountId = ref('')
const editingAccountVersion = ref<number | null>(null)
const actionLoading = ref('')
const reloadKey = ref(0)
const accountFormStep = ref<AccountWizardStep>(1)
const accountError = ref('')
const cloudProviders = ref<CloudProviderDefinition[]>([])
const cloudProvidersLoading = ref(false)
const cloudProvidersError = ref('')
const cloudDetailOpen = ref(false)
const selectedCloudAsset = ref<ApiRecord | null>(null)

const accountDraft = reactive({
  displayName: '',
  providerKey: '',
  accountId: '',
  credentialRef: '',
})

const scopeDraft = reactive({
  endpoint: '',
  metadataJson: '{}',
})

const selectedProvider = computed(() => accountDraft.providerKey.trim() || cloudProviders.value.find((provider) => provider.available)?.pluginId || null)
const selectedProviderDefinition = computed(() => cloudProviders.value.find((provider) => provider.pluginId === selectedProvider.value))
const providerFormFields = computed(() => (selectedProviderDefinition.value?.fields ?? []).filter((field) => field.type === 'string'))
const isEditing = computed(() => Boolean(editingAccountId.value))
const selectedCredentialRef = computed(() => {
  const credentialId = accountDraft.credentialRef.trim()
  return credentialId ? `credential://${credentialId}` : ''
})
const scopeValidationError = computed(() => {
  try {
    parseObjectJson(scopeDraft.metadataJson)
    return ''
  } catch (cause) {
    return cause instanceof Error ? cause.message : t('providers.messages.metadataInvalid')
  }
})
const accountReady = computed(() => Boolean(
  selectedProviderDefinition.value?.available
  && accountDraft.displayName.trim()
  && accountDraft.credentialRef.trim()
  && !scopeValidationError.value,
))
const accountWizardState = computed<'ready' | 'incomplete' | 'locked'>(() => {
  if (accountReady.value) return 'ready'
  if (selectedProvider.value && accountDraft.displayName.trim() && accountDraft.credentialRef.trim()) return 'incomplete'
  return 'locked'
})
const accountFormTitle = computed(() => (isEditing.value ? t('providers.actions.edit') : t('providers.actions.add')))
const accountFormDescription = computed(() => t('providers.wizard.panels.assetDescription'))
const accountCredentialSummary = computed(() => selectedCredentialRef.value || t('providers.messages.credentialRequired'))

const accountScopeSummary = computed(() => {
  const items: string[] = []
  if (scopeDraft.endpoint.trim()) items.push(`${t('providers.fields.endpoint')}：${scopeDraft.endpoint.trim()}`)
  const metadata = parseObjectJsonSafely(scopeDraft.metadataJson)
  if (Object.keys(metadata).length > 0) items.push(`${t('providers.fields.metadataJson')}：${Object.keys(metadata).join(' / ')}`)
  return items.length > 0 ? items.join(' · ') : t('providers.messages.scopeEmpty')
})

const resourceFieldValues = reactive<Record<string, string>>({})

const config = computed<BusinessPageConfig>(() => ({
  title: t('providers.page.title'),
  description: t('providers.page.description'),
  readPermission: 'cloud_account_asset.read',
  primaryPermission: 'cloud_account_asset.create',
  primaryActionLabel: t('providers.actions.add'),
  primaryAction: openAccountForm,
  moduleName: 'cloud-providers',
  resourceName: t('providers.sections.accounts'),
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  showTotalInPagination: true,
  columns: [
    { key: 'name', title: t('providers.fields.displayName'), candidates: ['displayName', 'id'] },
    { key: 'provider', title: t('providers.fields.provider'), candidates: ['providerKey'], format: (record) => stringValue(record.providerKey) },
    { key: 'accountId', title: t('providers.fields.accountId'), candidates: ['accountId'] },
    { key: 'scope', title: t('providers.fields.scope'), candidates: ['scope'], format: (record) => scopeLabel(record.scope) },
    { key: 'status', title: t('providers.fields.status'), candidates: ['status'], kind: 'status' },
    { key: 'updatedAt', title: t('providers.fields.updatedAt'), candidates: ['updatedAt'], kind: 'date' },
    { key: 'actions', title: t('providers.fields.actions'), candidates: [] },
  ],
  metrics: [],
  emptyTitle: t('providers.messages.noAccounts'),
  emptyDescription: t('providers.messages.noAccounts'),
  load: () => listCloudAccountAssets(),
  actions: [],
  rowActions: [
    { label: t('providers.actions.edit'), permission: 'cloud_account_asset.update', reloadAfterRun: false, run: async (row) => openEditForm(row) },
    {
      label: t('providers.actions.delete'),
      permission: 'cloud_account_asset.delete',
      danger: true,
      confirmText: t('providers.messages.deleteConfirmText'),
      riskText: t('providers.messages.deleteRisk'),
      run: removeAccount,
    },
  ],
}))

onMounted(async () => {
  const cloudAssetId = typeof route.query.cloudAssetId === 'string' ? route.query.cloudAssetId : ''
  if (route.query.detailModal !== '1' || !cloudAssetId) return
  try {
    const result = await getCloudAccountAsset(cloudAssetId)
    selectedCloudAsset.value = result.data ?? null
    if (!selectedCloudAsset.value) return
    cloudDetailOpen.value = true
  } catch {
    // 列表页自身负责展示加载错误，搜索跳转不重复弹出提示。
  }
})

function openAccountForm(): void {
  editingAccountId.value = ''
  editingAccountVersion.value = null
  accountError.value = ''
  accountFormStep.value = 1
  Object.assign(accountDraft, { displayName: '', providerKey: '', accountId: '', credentialRef: '' })
  resetScopeDraft()
  accountFormOpen.value = true
  void loadCloudProviders()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readCloudFormFields(value: unknown): CloudProviderFormField[] {
  const form = asRecord(asRecord(value).forms).cloud
  const fields = Array.isArray(asRecord(form).fields) ? asRecord(form).fields as unknown[] : []
  return fields.flatMap((item) => {
    const field = asRecord(item)
    const type = field.type
    if (typeof field.key !== 'string' || !['objectRef', 'secretRef', 'string', 'artifactRef'].includes(String(type))) return []
    return [{ key: field.key, type: type as CloudProviderFormField['type'], required: field.required === true, ...(typeof field.labelKey === 'string' ? { labelKey: field.labelKey } : {}) }]
  })
}

function readCloudMessages(value: unknown): Record<string, string> {
  const messages = asRecord(asRecord(value).locale).messages
  return Object.fromEntries(Object.entries(asRecord(messages)).flatMap(([key, text]) => typeof text === 'string' ? [[key, text]] : []))
}

function providerLabel(provider: CloudProviderDefinition | undefined, key: string | undefined): string {
  return (key && provider?.messages[key]) || key || t('common.notAvailable')
}

async function loadCloudProviders(preferredPluginId = accountDraft.providerKey): Promise<void> {
  cloudProvidersLoading.value = true
  cloudProvidersError.value = ''
  try {
    const result = await listPluginCatalog({ page: 1, pageSize: 200, filters: { locale: locale.value } })
    const candidates = (result.data?.items ?? []).filter((item) =>
      item.status === 'ENABLED'
      && Array.isArray(item.capabilities)
      && item.capabilities.some((capability) => String((capability as Record<string, unknown>).key ?? capability) === 'cloud.service.connection-test'))
    const loaded = await Promise.all(candidates.map(async (item): Promise<CloudProviderDefinition> => {
      const pluginVersionId = String(item.pluginVersionId ?? item.id ?? '')
      try {
        const resourceResult = await getUnifiedPluginUiResources(pluginVersionId, locale.value)
        const fields = readCloudFormFields(resourceResult.data)
        const messages = readCloudMessages(resourceResult.data)
        const displayName = String(item.displayName ?? messages[item.displayNameKey] ?? item.pluginId)
        return {
          pluginId: item.pluginId,
          pluginVersionId,
          displayName,
          fields,
          messages,
          available: fields.length > 0,
          ...(fields.length > 0 ? {} : { unavailableReason: 'PLUGIN_FORM_MISSING' }),
        }
      } catch (cause) {
        return {
          pluginId: item.pluginId,
          pluginVersionId,
          displayName: String(item.displayName ?? item.pluginId),
          fields: [],
          messages: {},
          available: false,
          unavailableReason: cause instanceof Error ? cause.message : 'PLUGIN_UI_RESOURCE_UNAVAILABLE',
        }
      }
    }))
    cloudProviders.value = loaded.sort((left, right) => left.displayName.localeCompare(right.displayName))
    if (!cloudProviders.value.some((provider) => provider.pluginId === accountDraft.providerKey)) {
      accountDraft.providerKey = cloudProviders.value.find((provider) => provider.pluginId === preferredPluginId && provider.available)?.pluginId
        ?? cloudProviders.value.find((provider) => provider.available)?.pluginId
        ?? ''
    }
  } catch (cause) {
    cloudProviders.value = []
    cloudProvidersError.value = cause instanceof Error ? cause.message : t('providers.messages.loadFailed')
  } finally {
    cloudProvidersLoading.value = false
  }
}

function openEditForm(row: ViewRow): void {
  editingAccountId.value = row.id
  editingAccountVersion.value = typeof row.raw.version === 'number' ? row.raw.version : null
  accountError.value = ''
  accountFormStep.value = 1
  Object.assign(accountDraft, {
    displayName: stringValue(row.raw.displayName),
    providerKey: stringValue(row.raw.providerKey),
    accountId: stringValue(row.raw.accountId),
    credentialRef: credentialIdFromRef(stringValue(row.raw.credentialRef)),
  })
  fillScopeDraft(row.raw.scope)
  void loadCloudProviders(accountDraft.providerKey)
  accountFormOpen.value = true
}

function goNextAccountStep(): void {
  if (accountFormStep.value === 1 && selectedProvider.value) accountFormStep.value = 2
}

function goPreviousAccountStep(): void {
  if (accountFormStep.value === 2) accountFormStep.value = 1
}

function accountStepState(step: AccountWizardStep): 'done' | 'active' | 'pending' {
  if (accountFormStep.value > step) return 'done'
  if (accountFormStep.value === step) return 'active'
  return 'pending'
}

async function saveAccount(): Promise<void> {
  accountError.value = ''
  if (!accountReady.value) {
    accountError.value = scopeValidationError.value || t('providers.messages.credentialRequired')
    return
  }
  actionLoading.value = editingAccountId.value ? `update:${editingAccountId.value}` : 'create'
  try {
    const payload = {
      displayName: accountDraft.displayName.trim(),
      accountId: accountDraft.accountId.trim() || undefined,
      credentialRef: selectedCredentialRef.value,
      scope: buildScope(),
    }
    if (editingAccountId.value) {
      if (!editingAccountVersion.value) {
        throw new Error(t('providers.messages.versionUnavailable'))
      }
      await updateCloudAccountAsset({ id: editingAccountId.value, expectedVersion: editingAccountVersion.value, ...payload })
      notice.value = t('providers.messages.updated')
    } else {
      await createCloudAccountAsset({
        ...payload,
        providerKey: selectedProvider.value,
        pluginVersionId: selectedProviderDefinition.value?.pluginVersionId,
      })
      notice.value = t('providers.messages.saved')
    }
    accountFormOpen.value = false
    reloadKey.value += 1
  } catch (cause) {
    accountError.value = errorMessage(cause, t('providers.messages.createFailed'))
  } finally {
    actionLoading.value = ''
  }
}

async function removeAccount(row: ViewRow): Promise<void> {
  actionLoading.value = `delete:${row.id}`
  requestError.value = ''
  try {
    await deleteCloudAccountAsset(row.id)
    notice.value = t('providers.messages.deleted')
  } catch (cause) {
    requestError.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

function buildScope(): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  if (scopeDraft.endpoint.trim()) scope.endpoint = scopeDraft.endpoint.trim()
  const metadata = parseObjectJsonSafely(scopeDraft.metadataJson)
  for (const field of providerFormFields.value) {
    const value = resourceFieldValues[field.key]?.trim()
    if (value) metadata[field.key] = value
  }
  if (Object.keys(metadata).length > 0) scope.metadata = metadata
  return scope
}

function fillScopeDraft(value: unknown): void {
  const scope = isRecord(value) ? value : {}
  scopeDraft.endpoint = stringValue(scope.endpoint)
  const metadata = isRecord(scope.metadata) ? scope.metadata : {}
  for (const key of Object.keys(resourceFieldValues)) delete resourceFieldValues[key]
  for (const [key, value] of Object.entries(metadata)) if (typeof value === 'string') resourceFieldValues[key] = value
  scopeDraft.metadataJson = JSON.stringify(metadata, null, 2)
}

function resetScopeDraft(): void {
  scopeDraft.endpoint = ''
  scopeDraft.metadataJson = '{}'
  for (const key of Object.keys(resourceFieldValues)) delete resourceFieldValues[key]
}

function parseObjectJson(value: string): Record<string, unknown> {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '{}') return {}
  const parsed = JSON.parse(trimmed) as unknown
  if (!isRecord(parsed)) throw new Error(t('providers.messages.metadataInvalid'))
  return parsed
}

function parseObjectJsonSafely(value: string): Record<string, unknown> {
  try { return parseObjectJson(value) } catch { return {} }
}

function credentialIdFromRef(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('credential://') ? trimmed.slice('credential://'.length).split('#', 1)[0]?.trim() || '' : ''
}

function scopeLabel(value: unknown): string {
  if (!isRecord(value)) return t('common.notAvailable')
  const items: string[] = []
  if (stringValue(value.endpoint)) items.push(`${t('providers.fields.endpoint')}：${stringValue(value.endpoint)}`)
  if (isRecord(value.metadata) && Object.keys(value.metadata).length > 0) items.push(`${t('providers.fields.metadataJson')}：${Object.keys(value.metadata).join(' / ')}`)
  return items.length > 0 ? items.join(' · ') : t('providers.messages.scopeEmpty')
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiClientError) return cause.message
  return cause instanceof Error && cause.message ? cause.message : fallback
}
</script>

<template>
  <main class="gc-page provider-page">
    <p v-if="requestError" class="provider-message provider-message--error">{{ requestError }}</p>
    <p v-if="notice" class="provider-message provider-message--success">{{ notice }}</p>
    <BusinessResourcePage :key="reloadKey" :config="config" />

    <GcModal
      v-model:open="cloudDetailOpen"
      :title="selectedCloudAsset ? (stringValue(selectedCloudAsset.displayName) || t('providers.detail.title')) : t('providers.detail.title')"
      :description="t('providers.detail.description')"
      size="lg"
    >
      <dl v-if="selectedCloudAsset" class="provider-detail">
        <div><dt>{{ t('providers.fields.provider') }}</dt><dd>{{ selectedCloudAsset.providerKey }}</dd></div>
        <div><dt>{{ t('providers.fields.accountId') }}</dt><dd>{{ selectedCloudAsset.accountId || t('common.notAvailable') }}</dd></div>
        <div><dt>{{ t('providers.fields.status') }}</dt><dd>{{ selectedCloudAsset.status }}</dd></div>
        <div><dt>{{ t('providers.fields.scope') }}</dt><dd>{{ scopeLabel(selectedCloudAsset.scope) }}</dd></div>
        <div><dt>{{ t('providers.fields.updatedAt') }}</dt><dd>{{ selectedCloudAsset.updatedAt || t('common.notAvailable') }}</dd></div>
      </dl>
    </GcModal>

    <GcModal v-model:open="accountFormOpen" :title="accountFormTitle" :description="accountFormDescription" size="xl" :close-on-backdrop="false">
      <div class="provider-wizard">
        <ol class="provider-wizard__steps" :aria-label="t('providers.wizard.ariaLabel')">
          <li :class="`is-${accountStepState(1)}`">
            <button type="button" class="provider-wizard__step-button" :disabled="accountFormStep === 1" @click="accountFormStep = 1">
              <span class="provider-wizard__step-index">1</span>
              <span><strong>{{ t('providers.wizard.steps.provider') }}</strong><small>{{ t('providers.wizard.stepDescriptions.provider') }}</small></span>
            </button>
          </li>
          <li :class="`is-${accountStepState(2)}`">
            <button type="button" class="provider-wizard__step-button" :disabled="!selectedProvider || accountFormStep === 2" @click="accountFormStep = 2">
              <span class="provider-wizard__step-index">2</span>
              <span><strong>{{ t('providers.wizard.steps.asset') }}</strong><small>{{ t('providers.wizard.stepDescriptions.asset') }}</small></span>
            </button>
          </li>
        </ol>

        <section v-if="accountFormStep === 1" class="provider-wizard__panel">
          <header class="provider-wizard__panel-header">
            <div><h3>{{ t('providers.wizard.panels.providerTitle') }}</h3><p>{{ t('providers.wizard.panels.providerDescription') }}</p></div>
            <span class="provider-wizard__state" :class="`is-${accountWizardState}`">{{ t(`providers.wizard.state.${accountWizardState}`) }}</span>
          </header>
          <label class="provider-field provider-field--wide">
            <span>{{ t('providers.fields.provider') }}</span>
            <select v-model="accountDraft.providerKey" required :disabled="isEditing || cloudProvidersLoading">
              <option value="" disabled>{{ t('providers.messages.providerRequired') }}</option>
              <option v-for="provider in cloudProviders" :key="provider.pluginVersionId" :value="provider.pluginId" :disabled="!provider.available">
                {{ provider.displayName }}<template v-if="!provider.available"> · {{ provider.unavailableReason }}</template>
              </option>
            </select>
            <small v-if="selectedProviderDefinition">{{ selectedProviderDefinition.pluginId }}@{{ selectedProviderDefinition.pluginVersionId }}</small>
            <small v-if="cloudProvidersError" class="provider-wizard__error">{{ cloudProvidersError }}</small>
            <small v-else-if="!cloudProvidersLoading && cloudProviders.length === 0" class="provider-wizard__error">{{ t('providers.messages.providerUnavailable') }}</small>
          </label>
          <p v-if="isEditing" class="provider-wizard__hint">{{ t('providers.messages.providerLocked') }}</p>
        </section>

        <section v-else class="provider-wizard__panel">
          <header class="provider-wizard__panel-header">
            <div><h3>{{ t('providers.wizard.panels.assetTitle') }}</h3><p>{{ t('providers.wizard.panels.assetDescription') }}</p></div>
            <span class="provider-wizard__state is-active">{{ t('providers.wizard.state.active') }}</span>
          </header>
          <div class="provider-wizard__summary">
            <div><span>{{ t('providers.wizard.summary.provider') }}</span><strong>{{ selectedProvider ?? t('common.notAvailable') }}</strong></div>
            <div><span>{{ t('providers.wizard.summary.account') }}</span><strong>{{ accountDraft.displayName || t('common.notAvailable') }}</strong></div>
            <div><span>{{ t('providers.wizard.summary.credential') }}</span><strong>{{ accountCredentialSummary }}</strong></div>
          </div>
          <div class="provider-wizard__grid">
            <label class="provider-field"><span>{{ t('providers.fields.displayName') }}</span><input v-model="accountDraft.displayName" required :placeholder="t('providers.placeholders.displayName')" /></label>
            <label class="provider-field"><span>{{ t('providers.fields.accountId') }}</span><input v-model="accountDraft.accountId" :placeholder="t('providers.placeholders.accountId')" /></label>
            <div class="provider-credential-select provider-field--wide">
              <GcCredentialSelect v-model="accountDraft.credentialRef" :label="t('providers.fields.credentialProfile')" :hint="t('providers.messages.credentialSelectHint')" :required="true" :accepted-kinds="credentialKinds" />
            </div>
            <label v-for="field in providerFormFields" :key="field.key" class="provider-field">
              <span>{{ providerLabel(selectedProviderDefinition, field.labelKey) }}</span>
              <input v-model="resourceFieldValues[field.key]" :required="field.required" />
            </label>
            <label class="provider-field provider-field--wide"><span>{{ t('providers.fields.endpoint') }}</span><input v-model="scopeDraft.endpoint" :placeholder="t('providers.placeholders.endpoint')" /></label>
            <label class="provider-field provider-field--wide"><span>{{ t('providers.fields.metadataJson') }}</span><textarea v-model="scopeDraft.metadataJson" /><small>{{ t('providers.messages.metadataHint') }}</small></label>
          </div>
          <p v-if="scopeValidationError" class="provider-wizard__error">{{ scopeValidationError }}</p>
          <div class="provider-wizard__preview"><div><span>{{ t('providers.fields.scope') }}</span><strong>{{ accountScopeSummary }}</strong></div></div>
        </section>
        <p v-if="accountError" class="provider-wizard__error">{{ accountError }}</p>
      </div>
      <template #actions>
        <button class="gc-button" type="button" @click="accountFormOpen = false">{{ t('providers.actions.cancel') }}</button>
        <button class="gc-button" type="button" :disabled="accountFormStep === 1 || Boolean(actionLoading)" @click="goPreviousAccountStep">{{ t('providers.actions.previous') }}</button>
        <button v-if="accountFormStep === 1" class="gc-button gc-button--primary" type="button" :disabled="!selectedProvider" @click="goNextAccountStep">{{ t('providers.actions.next') }}</button>
        <button v-else class="gc-button gc-button--primary" type="button" :disabled="!accountReady || Boolean(actionLoading)" @click="saveAccount">{{ t('providers.actions.save') }}</button>
      </template>
    </GcModal>

  </main>
</template>

<style scoped>
.provider-page { display: grid; gap: var(--gc-space-3); }
.provider-detail { display: grid; gap: var(--gc-space-3); margin: 0; }
.provider-detail div { display: grid; grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr); gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); }
.provider-detail dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 800; }
.provider-detail dd { margin: 0; color: var(--gc-color-text); overflow-wrap: anywhere; }
.provider-message { margin: 0; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: var(--gc-space-3); color: var(--gc-color-text-muted); }
.provider-message--error { color: var(--gc-color-danger); border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-bg); }
.provider-message--success { color: var(--gc-color-success); border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.provider-wizard, .provider-wizard__panel { display: grid; gap: var(--gc-space-4); }
.provider-wizard__steps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-2); padding: 0; margin: 0; list-style: none; }
.provider-wizard__steps li { margin: 0; }
.provider-wizard__step-button { width: 100%; min-height: var(--gc-space-12); display: flex; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); color: var(--gc-color-text); text-align: left; }
.provider-wizard__steps li.is-active .provider-wizard__step-button, .provider-wizard__steps li.is-done .provider-wizard__step-button { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); }
.provider-wizard__step-button:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.provider-wizard__step-index { display: grid; place-items: center; flex: 0 0 auto; inline-size: var(--gc-space-8); block-size: var(--gc-space-8); border-radius: var(--gc-radius-md); color: var(--gc-color-primary); background: var(--gc-color-surface-solid); font-weight: 900; }
.provider-wizard__step-button span:last-child { display: grid; gap: var(--gc-space-1); min-width: 0; }
.provider-wizard__step-button strong, .provider-wizard__panel-header h3, .provider-wizard__summary strong, .provider-wizard__preview strong { overflow-wrap: anywhere; }
.provider-wizard__step-button strong { font-size: var(--gc-font-size-sm); line-height: 1.2; }
.provider-wizard__step-button small, .provider-wizard__panel-header p, .provider-wizard__hint, .provider-field small { color: var(--gc-color-text-muted); line-height: 1.5; }
.provider-wizard__panel { padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); }
.provider-wizard__panel-header { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--gc-space-3); }
.provider-wizard__panel-header h3, .provider-wizard__panel-header p { margin: 0; }
.provider-wizard__panel-header h3 { color: var(--gc-color-text); font-size: var(--gc-font-size-lg); line-height: 1.2; }
.provider-wizard__panel-header p { margin-top: var(--gc-space-1); font-size: var(--gc-font-size-sm); }
.provider-wizard__state { flex: 0 0 auto; padding: 0 var(--gc-space-3); min-height: var(--gc-space-8); display: inline-flex; align-items: center; border-radius: var(--gc-radius-md); color: var(--gc-color-text-muted); background: var(--gc-color-surface-soft); font-size: var(--gc-font-size-xs); font-weight: 850; }
.provider-wizard__state.is-ready { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.provider-wizard__state.is-active { color: var(--gc-color-info); background: var(--gc-color-info-soft); }
.provider-wizard__state.is-incomplete { color: var(--gc-color-warning); background: var(--gc-color-warning-soft); }
.provider-wizard__provider-grid, .provider-wizard__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.provider-field { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text); }
.provider-field span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.provider-field input, .provider-field textarea { width: 100%; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-surface-solid); font: inherit; }
.provider-field textarea { min-height: var(--gc-space-12); resize: vertical; }
.provider-field--wide { grid-column: 1 / -1; }
.provider-credential-select { min-width: 0; }
.provider-wizard__summary, .provider-wizard__preview { display: grid; gap: var(--gc-space-2); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.provider-wizard__summary div, .provider-wizard__preview div { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); }
.provider-wizard__summary span, .provider-wizard__preview span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.provider-wizard__summary strong, .provider-wizard__preview strong { color: var(--gc-color-text); font-size: var(--gc-font-size-sm); line-height: 1.35; }
.provider-wizard__error { margin: 0; color: var(--gc-color-danger); font-weight: 850; }
@media (max-width: 48rem) {
  .provider-wizard__steps, .provider-wizard__provider-grid, .provider-wizard__grid, .provider-wizard__summary, .provider-wizard__preview { grid-template-columns: 1fr; }
  .provider-field--wide { grid-column: auto; }
  .provider-wizard__panel-header { display: grid; }
}
</style>
