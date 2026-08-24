<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { listCertificates } from '@/api/modules/certificates.api'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  GcButton,
  GcCard,
  GcConfirmAction,
  GcCredentialSelect,
  GcDataTable,
  GcModal,
  GcPageToolbar,
  GcStatusTag,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

type AcmeStatus = 'READY' | 'BLOCKED' | 'UNKNOWN'
type AcmeProvider = InternalCaRecord & {
  id?: string
  name?: string
  endpoint?: string
  status?: string
  configuration?: InternalCaRecord
}
type AcmeProviderPreset = InternalCaRecord & {
  key?: string
  defaultDirectoryUrl?: string
  defaultAllowedChallenges?: string[]
}

const { t } = useI18n()
const loading = ref(false)
const actionPending = ref(false)
const error = ref('')
const status = ref<AcmeStatus>('UNKNOWN')
const providerName = ref('')
const assets = ref<ApiRecord[]>([])
const policies = ref<InternalCaRecord[]>([])
const jobs = ref<InternalCaRecord[]>([])
const orders = ref<InternalCaRecord[]>([])
const providers = ref<AcmeProvider[]>([])
const providerPresets = ref<AcmeProviderPreset[]>([])
const formOpen = ref(false)
const providerDialogOpen = ref(false)
const providerEditorOpen = ref(false)
const formError = ref('')
const providerError = ref('')
const providerEditingId = ref('')
const providerTestId = ref('')
const providerTestResult = ref('')
const selectedAssetId = ref('')
const retryingJobId = ref('')
const draft = reactive({
  providerId: '',
  domains: '',
  contactEmail: '',
  dnsCredentialId: '',
  keyType: 'rsa',
  autoRenew: true,
})
const providerDraft = reactive({
  name: '',
  preset: 'letsencrypt',
  directoryUrl: '',
  termsOfServiceUrl: '',
  allowedChallenges: ['http-01', 'dns-01'],
  isDefault: false,
})

const policyByAssetId = computed(() => new Map(
  policies.value
    .map((item) => [text(item.certificateAssetId), item] as const)
    .filter(([id]) => Boolean(id)),
))
const managedAssets = computed(() => assets.value.filter((asset) => (
  text(asset.sourceType).toLowerCase() === 'acme' || policyByAssetId.value.has(text(asset.id))
)))
const activeJobs = computed(() => jobs.value.filter((job) => ['scheduled', 'retry_waiting', 'issuing'].includes(text(job.status))))
const failedJobs = computed(() => jobs.value.filter((job) => ['failed', 'rollback_required'].includes(text(job.status))))
const assetColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'domains', title: t('acme.list.columns.domains') },
  { key: 'status', title: t('acme.list.columns.status') },
  { key: 'expiresAt', title: t('acme.list.columns.expiresAt') },
  { key: 'renewal', title: t('acme.list.columns.renewal') },
  { key: 'actions', title: t('acme.list.columns.actions') },
])
const jobColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'status', title: t('acme.jobs.status') },
  { key: 'nextAttemptAt', title: t('acme.jobs.nextAttemptAt') },
  { key: 'failureMessage', title: t('acme.jobs.failure') },
  { key: 'actions', title: t('acme.list.columns.actions') },
])
const orderColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'status', title: t('acme.order.status') },
  { key: 'updatedAt', title: t('acme.order.updatedAt') },
])
const statusTone = computed(() => status.value === 'READY' ? 'success' : status.value === 'BLOCKED' ? 'warning' : 'muted')
const canSubmit = computed(() => status.value === 'READY' && draft.domains.trim() && draft.contactEmail.trim() && draft.dnsCredentialId.trim())
const activeProviders = computed(() => providers.value.filter((item) => text(item.type, 'acme') === 'acme' && text(item.status, 'active') === 'active'))
const defaultProvider = computed(() => activeProviders.value.find((item) => providerConfig(item).isDefault === true) ?? activeProviders.value[0])

onMounted(() => {
  void loadAll()
})

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [statusResult, assetResult, policyResult, jobResult, orderResult, providerResult] = await Promise.allSettled([
      internalCaApi.getAcmeStatus(),
      listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      internalCaApi.listAcmeRenewalPolicies(),
      internalCaApi.listAcmeRenewalJobs(),
      internalCaApi.listAcmeOrders(),
      internalCaApi.listAcmeProviders(),
    ])
    if (statusResult.status === 'fulfilled') {
      const statusData = statusResult.value.data ?? {}
      status.value = normalizeStatus(statusData.status)
      providerName.value = text((statusData.provider as InternalCaRecord | undefined)?.name, t('acme.issuer.letsencrypt'))
    }
    if (assetResult.status === 'fulfilled') assets.value = [...(assetResult.value.data?.items ?? [])]
    if (policyResult.status === 'fulfilled') policies.value = readRecords(policyResult.value.data)
    if (jobResult.status === 'fulfilled') jobs.value = readRecords(jobResult.value.data)
    if (orderResult.status === 'fulfilled') orders.value = readRecords(orderResult.value.data)
    if (providerResult.status === 'fulfilled') {
      const data = providerResult.value.data ?? {}
      providers.value = Array.isArray(data) ? [...data] : Array.isArray(data.items) ? [...data.items] : []
      providerPresets.value = Array.isArray(data.presets) ? [...data.presets] : []
      if (!providerName.value && defaultProvider.value) providerName.value = text(defaultProvider.value.name, t('acme.issuer.letsencrypt'))
    }
    const failures = [statusResult, assetResult, policyResult, jobResult, orderResult, providerResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length && assets.value.length === 0 && jobs.value.length === 0 && orders.value.length === 0) {
      const first = failures[0]?.reason
      error.value = first instanceof ApiClientError ? first.message : t('acme.messages.loadFailed')
    }
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  Object.assign(draft, { providerId: text(defaultProvider.value?.id), domains: '', contactEmail: '', dnsCredentialId: '', keyType: 'rsa', autoRenew: true })
  formError.value = ''
  formOpen.value = true
}

function openProviderSettings(): void {
  providerError.value = ''
  providerTestResult.value = ''
  providerDialogOpen.value = true
}

function openProviderEditor(provider?: AcmeProvider): void {
  providerError.value = ''
  providerEditingId.value = text(provider?.id)
  const configuration = providerConfig(provider)
  const preset = text(configuration.preset, 'letsencrypt')
  const presetDefinition = providerPresets.value.find((item) => text(item.key) === preset)
  Object.assign(providerDraft, {
    name: text(provider?.name),
    preset,
    directoryUrl: text(configuration.directoryUrl, text(provider?.endpoint, text(presetDefinition?.defaultDirectoryUrl))),
    termsOfServiceUrl: text(configuration.termsOfServiceUrl),
    allowedChallenges: Array.isArray(configuration.allowedChallenges)
      ? configuration.allowedChallenges.map(String)
      : (Array.isArray(presetDefinition?.defaultAllowedChallenges) ? [...presetDefinition.defaultAllowedChallenges] : ['http-01', 'dns-01']),
    isDefault: configuration.isDefault === true,
  })
  providerDialogOpen.value = false
  providerEditorOpen.value = true
}

async function saveProvider(): Promise<void> {
  if (!providerDraft.name.trim() || !providerDraft.directoryUrl.trim() || providerDraft.allowedChallenges.length === 0) {
    providerError.value = t('acme.provider.messages.required')
    return
  }
  actionPending.value = true
  providerError.value = ''
  try {
    const payload = {
      name: providerDraft.name.trim(),
      preset: providerDraft.preset,
      directoryUrl: providerDraft.directoryUrl.trim(),
      termsOfServiceUrl: providerDraft.termsOfServiceUrl.trim() || undefined,
      allowedChallenges: providerDraft.allowedChallenges,
      isDefault: providerDraft.isDefault,
    }
    if (providerEditingId.value) await internalCaApi.updateAcmeProvider(providerEditingId.value, payload)
    else await internalCaApi.createAcmeProvider(payload)
    providerEditorOpen.value = false
    notify(t('acme.provider.messages.saved'), 'success')
    await loadAll()
    providerDialogOpen.value = true
  } catch (caught) {
    providerError.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

async function testProvider(provider: AcmeProvider): Promise<void> {
  const providerId = text(provider.id)
  if (!providerId) return
  providerTestId.value = providerId
  providerTestResult.value = ''
  try {
    const result = await internalCaApi.testAcmeProvider(providerId)
    const reachable = result.data?.reachable === true
    providerTestResult.value = reachable ? t('acme.provider.messages.tested') : t('acme.provider.messages.testFailed')
    notify(providerTestResult.value, reachable ? 'success' : 'warning')
  } catch (caught) {
    providerTestResult.value = caught instanceof ApiClientError ? caught.message : t('acme.provider.messages.testFailed')
  } finally {
    providerTestId.value = ''
  }
}

async function submitCreate(): Promise<void> {
  if (!canSubmit.value) {
    formError.value = t('acme.messages.requiredFields')
    return
  }
  actionPending.value = true
  formError.value = ''
  try {
    await internalCaApi.createAcmeCertificate({
      providerId: draft.providerId || undefined,
      domains: normalizeDomains(draft.domains),
      contactEmail: draft.contactEmail.trim(),
      dnsCredentialId: draft.dnsCredentialId,
      challengeType: 'dns-01',
      keyType: draft.keyType,
      autoRenew: draft.autoRenew,
    })
    formOpen.value = false
    notify(t('acme.messages.created'), 'success')
    await loadAll()
  } catch (caught) {
    formError.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

async function renew(asset: ApiRecord): Promise<void> {
  const id = text(asset.id)
  if (!id) return
  await runAction(() => internalCaApi.manualRenewAcmeCertificate(id), t('acme.messages.renewed'))
}

async function remove(asset: ApiRecord): Promise<void> {
  const id = text(asset.id)
  if (!id) return
  await runAction(() => internalCaApi.deleteAcmeCertificate(id), t('acme.messages.deleted'))
}

async function scan(): Promise<void> {
  await runAction(() => internalCaApi.scanAcmeRenewalJobs(), t('acme.messages.scanned'))
}

async function retry(job: InternalCaRecord): Promise<void> {
  const id = text(job.id)
  if (!id) return
  retryingJobId.value = id
  await runAction(() => internalCaApi.retryAcmeRenewalJob(id), t('acme.messages.retried'))
  retryingJobId.value = ''
}

async function runAction(action: () => Promise<unknown>, successMessage: string): Promise<void> {
  actionPending.value = true
  error.value = ''
  try {
    await action()
    notify(successMessage, 'success')
    await loadAll()
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

function notify(message: string, tone: 'success' | 'warning' | 'danger' | 'info'): void {
  window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message, tone } }))
}

function assetPolicy(asset: ApiRecord): InternalCaRecord | undefined {
  return policyByAssetId.value.get(text(asset.id))
}

function providerConfig(provider: AcmeProvider | undefined): InternalCaRecord {
  return provider?.configuration && typeof provider.configuration === 'object' && !Array.isArray(provider.configuration)
    ? provider.configuration
    : {}
}

function assetStatus(asset: ApiRecord): string {
  const id = text(asset.id)
  const latest = jobs.value
    .filter((job) => text(job.certificateAssetId) === id || text(job.policyId) === text(assetPolicy(asset)?.id))
    .sort((left, right) => dateValue(right.updatedAt ?? right.createdAt) - dateValue(left.updatedAt ?? left.createdAt))[0]
  return text(latest?.status, text(asset.status, 'unknown'))
}

function assetDomains(asset: ApiRecord): string {
  return [text(asset.primaryDomain), ...(Array.isArray(asset.sans) ? asset.sans.map(String) : [])].filter(Boolean).join(', ') || t('acme.list.notAvailable')
}

function assetExpiresAt(asset: ApiRecord): string {
  const currentVersion = asset.currentVersion && typeof asset.currentVersion === 'object' ? asset.currentVersion as InternalCaRecord : undefined
  return formatBrowserLocalTime(currentVersion?.notAfter, { includeSeconds: false }) || t('acme.list.notAvailable')
}

function renewalLabel(asset: ApiRecord): string {
  const policy = assetPolicy(asset)
  if (!policy) return t('acme.list.notAvailable')
  return policy.enabled === true || text(policy.enabled) === 'true' ? t('acme.list.enabled') : t('acme.list.disabled')
}

function statusLabel(value: unknown): string {
  const key = text(value, 'unknown')
  return t(`acme.states.${key}`, key)
}

function normalizeDomains(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))]
}

function normalizeStatus(value: unknown): AcmeStatus {
  return value === 'READY' || value === 'BLOCKED' ? value : 'UNKNOWN'
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function readRecords(value: unknown): InternalCaRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value) && Array.isArray(value.items)) return value.items.filter(isRecord)
  return []
}

function isRecord(value: unknown): value is InternalCaRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function dateValue(value: unknown): number {
  const parsed = Date.parse(text(value))
  return Number.isFinite(parsed) ? parsed : 0
}
</script>

<template>
  <section class="acme-page">
    <GcPageToolbar class="acme-page__toolbar">
      <template #actions>
        <GcButton variant="secondary" :disabled="loading || actionPending" :aria-label="t('acme.aria.refresh')" @click="loadAll">{{ t('acme.actions.refresh') }}</GcButton>
        <GcButton variant="secondary" :disabled="loading || actionPending" @click="scan">{{ t('acme.actions.scan') }}</GcButton>
        <GcButton variant="secondary" :disabled="actionPending" @click="openProviderSettings">{{ t('acme.provider.title') }}</GcButton>
      </template>
      <template #primary>
        <GcButton variant="primary" :disabled="actionPending || status !== 'READY'" :aria-label="t('acme.aria.add')" @click="openCreate">{{ t('acme.actions.add') }}</GcButton>
      </template>
    </GcPageToolbar>

    <p v-if="error" class="acme-page__error" role="alert">{{ error }}</p>
    <header class="acme-page__intro">
      <div>
        <h2>{{ t('acme.title') }}</h2>
        <p>{{ t('acme.description') }}</p>
      </div>
      <GcStatusTag :status="status" :label="t(`acme.status.${status === 'READY' ? 'ready' : status === 'BLOCKED' ? 'blocked' : 'unknown'}`)" :tone="statusTone" />
    </header>

    <div class="acme-page__summary">
      <GcCard as="article"><strong>{{ managedAssets.length }}</strong><span>{{ t('acme.summary.managed') }}</span></GcCard>
      <GcCard as="article"><strong>{{ activeJobs.length }}</strong><span>{{ t('acme.summary.activeJobs') }}</span></GcCard>
      <GcCard as="article"><strong>{{ failedJobs.length }}</strong><span>{{ t('acme.summary.failures') }}</span></GcCard>
      <GcCard as="article"><strong>{{ providerName || t('acme.list.notAvailable') }}</strong><span>{{ t('acme.summary.provider') }}</span></GcCard>
    </div>

    <GcDataTable :columns="assetColumns" :rows="managedAssets" :loading="loading" :empty-text="t('acme.list.empty')" :aria-label="t('acme.title')" dense>
      <template #cell-domains="{ row }"><strong>{{ assetDomains(row) }}</strong></template>
      <template #cell-status="{ row }"><GcStatusTag :status="assetStatus(row)" :label="statusLabel(assetStatus(row))" /></template>
      <template #cell-expiresAt="{ row }">{{ assetExpiresAt(row) }}</template>
      <template #cell-renewal="{ row }">{{ renewalLabel(row) }}</template>
      <template #cell-actions="{ row }">
        <div class="acme-page__row-actions">
          <GcButton variant="secondary" :disabled="actionPending" @click="renew(row)">{{ t('acme.actions.renew') }}</GcButton>
          <GcConfirmAction :action-name="t('acme.actions.delete')" :disabled="actionPending" @confirm="remove(row)" />
        </div>
      </template>
    </GcDataTable>

    <GcDataTable :columns="jobColumns" :rows="jobs" :loading="loading" :empty-text="t('acme.jobs.empty')" :aria-label="t('acme.jobs.title')" dense>
      <template #header-status>{{ t('acme.jobs.status') }}</template>
      <template #cell-status="{ row }"><GcStatusTag :status="text(row.status, 'unknown')" :label="statusLabel(row.status)" /></template>
      <template #cell-nextAttemptAt="{ row }">{{ formatBrowserLocalTime(row.nextAttemptAt, { includeSeconds: false }) || t('acme.list.notAvailable') }}</template>
      <template #cell-failureMessage="{ row }">{{ text(row.failureMessage, t('acme.list.notAvailable')) }}</template>
      <template #cell-actions="{ row }">
        <GcButton v-if="failedJobs.includes(row)" variant="secondary" :loading="retryingJobId === text(row.id)" :disabled="actionPending" @click="retry(row)">{{ t('acme.actions.retry') }}</GcButton>
      </template>
    </GcDataTable>

    <GcDataTable :columns="orderColumns" :rows="orders.slice(0, 10)" :loading="loading" :empty-text="t('acme.order.empty')" :aria-label="t('acme.order.title')" dense>
      <template #cell-status="{ row }"><GcStatusTag :status="text(row.status, 'unknown')" :label="statusLabel(row.status)" /></template>
      <template #cell-updatedAt="{ row }">{{ formatBrowserLocalTime(row.updatedAt, { includeSeconds: false }) || t('acme.list.notAvailable') }}</template>
    </GcDataTable>

    <GcModal v-model:open="formOpen" size="lg" :title="t('acme.form.title')" :description="t('acme.form.description')" :busy="actionPending" :error="formError">
      <form class="acme-page__form" @submit.prevent="submitCreate">
        <label class="gc-form-field">
          <span>{{ t('acme.fields.issuer') }}</span>
          <select v-model="draft.providerId" required>
            <option v-for="provider in activeProviders" :key="text(provider.id)" :value="text(provider.id)">
              {{ text(provider.name, text(provider.id)) }}
            </option>
            <option v-if="!activeProviders.length" value="">{{ providerName || t('acme.issuer.letsencrypt') }}</option>
          </select>
        </label>
        <label class="gc-form-field"><span>{{ t('acme.fields.domains') }}</span><input v-model="draft.domains" :placeholder="t('acme.placeholders.domains')" required /></label>
        <label class="gc-form-field"><span>{{ t('acme.fields.email') }}</span><input v-model="draft.contactEmail" type="email" :placeholder="t('acme.placeholders.email')" required /></label>
        <GcCredentialSelect v-model="draft.dnsCredentialId" :label="t('acme.fields.dnsCredential')" :accepted-kinds="['DNS_PROVIDER']" required />
        <label class="gc-form-field"><span>{{ t('acme.fields.keyType') }}</span><select v-model="draft.keyType"><option value="rsa">{{ t('acme.keyTypes.rsa') }}</option><option value="ecdsa">{{ t('acme.keyTypes.ecdsa') }}</option></select></label>
        <label class="acme-page__checkbox"><input v-model="draft.autoRenew" type="checkbox" /> <span>{{ t('acme.fields.autoRenew') }}</span></label>
        <footer class="acme-page__form-actions"><GcButton variant="secondary" :disabled="actionPending" @click="formOpen = false">{{ t('acme.actions.close') }}</GcButton><GcButton variant="primary" type="submit" :loading="actionPending" :disabled="!canSubmit">{{ t('acme.form.submit') }}</GcButton></footer>
      </form>
    </GcModal>

    <GcModal v-model:open="providerDialogOpen" size="lg" :title="t('acme.provider.title')" :description="t('acme.provider.description')" :busy="actionPending" :error="providerError">
      <div class="acme-page__provider-list">
        <article v-for="provider in activeProviders" :key="text(provider.id)" class="acme-page__provider">
          <div>
            <strong>{{ text(provider.name, text(provider.id)) }}</strong>
            <small>{{ t('acme.provider.fields.directoryUrl') }}：{{ text(providerConfig(provider).directoryUrl, text(provider.endpoint)) }}</small>
          </div>
          <div class="acme-page__row-actions">
            <GcStatusTag v-if="providerConfig(provider).isDefault === true" status="ACTIVE" :label="t('acme.provider.default')" tone="success" />
            <GcStatusTag v-if="providerConfig(provider).isBuiltIn === true" status="BUILT_IN" :label="t('acme.provider.builtIn')" tone="info" />
            <GcButton variant="secondary" :disabled="actionPending" :loading="providerTestId === text(provider.id)" @click="testProvider(provider)">
              {{ providerTestId === text(provider.id) ? t('acme.provider.testing') : t('acme.provider.test') }}
            </GcButton>
            <GcButton variant="secondary" :disabled="actionPending" @click="openProviderEditor(provider)">{{ t('acme.provider.edit') }}</GcButton>
          </div>
        </article>
        <p v-if="!activeProviders.length" class="acme-page__provider-empty">{{ t('acme.provider.empty') }}</p>
        <p v-if="providerTestResult" class="acme-page__provider-result">{{ providerTestResult }}</p>
      </div>
      <template #actions>
        <GcButton variant="secondary" :disabled="actionPending" @click="providerDialogOpen = false">{{ t('acme.actions.close') }}</GcButton>
        <GcButton variant="primary" :disabled="actionPending" @click="openProviderEditor()">{{ t('acme.provider.add') }}</GcButton>
      </template>
    </GcModal>

    <GcModal v-model:open="providerEditorOpen" size="lg" :title="providerEditingId ? t('acme.provider.edit') : t('acme.provider.add')" :description="t('acme.provider.description')" :busy="actionPending" :error="providerError">
      <form class="acme-page__provider-form" @submit.prevent="saveProvider">
        <label class="gc-form-field">
          <span>{{ t('acme.provider.fields.preset') }}</span>
          <select v-model="providerDraft.preset">
            <option v-for="preset in providerPresets" :key="text(preset.key)" :value="text(preset.key)">
              {{ t(`acme.provider.presets.${text(preset.key, 'custom')}`, text(preset.key, 'custom')) }}
            </option>
            <option v-if="!providerPresets.length" value="letsencrypt">{{ t('acme.provider.presets.letsencrypt') }}</option>
          </select>
        </label>
        <label class="gc-form-field">
          <span>{{ t('acme.provider.fields.name') }}</span>
          <input v-model="providerDraft.name" required />
        </label>
        <label class="gc-form-field acme-page__field--wide">
          <span>{{ t('acme.provider.fields.directoryUrl') }}</span>
          <input v-model="providerDraft.directoryUrl" type="url" required />
        </label>
        <label class="gc-form-field acme-page__field--wide">
          <span>{{ t('acme.provider.fields.termsOfServiceUrl') }}</span>
          <input v-model="providerDraft.termsOfServiceUrl" type="url" />
        </label>
        <fieldset class="acme-page__challenge-field acme-page__field--wide">
          <legend>{{ t('acme.provider.fields.allowedChallenges') }}</legend>
          <label><input v-model="providerDraft.allowedChallenges" type="checkbox" value="http-01" /> HTTP-01</label>
          <label><input v-model="providerDraft.allowedChallenges" type="checkbox" value="dns-01" /> DNS-01</label>
          <label><input v-model="providerDraft.allowedChallenges" type="checkbox" value="tls-alpn-01" /> TLS-ALPN-01</label>
        </fieldset>
        <label class="acme-page__checkbox acme-page__field--wide">
          <input v-model="providerDraft.isDefault" type="checkbox" />
          <span>{{ t('acme.provider.fields.isDefault') }}</span>
        </label>
        <footer class="acme-page__form-actions acme-page__field--wide">
          <GcButton variant="secondary" :disabled="actionPending" @click="providerEditorOpen = false">{{ t('acme.actions.close') }}</GcButton>
          <GcButton variant="primary" type="submit" :loading="actionPending">{{ t('acme.provider.save') }}</GcButton>
        </footer>
      </form>
    </GcModal>
  </section>
</template>

<style scoped>
.acme-page { display: grid; gap: var(--gc-space-5); min-width: 0; }
.acme-page__intro, .acme-page__summary, .acme-page__row-actions, .acme-page__form-actions { display: flex; gap: var(--gc-space-3); align-items: center; }
.acme-page__intro { justify-content: space-between; }
.acme-page__intro h2 { margin: 0; color: var(--gc-color-text); }
.acme-page__intro p, .acme-page__error { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.acme-page__error { color: var(--gc-color-danger); }
.acme-page__summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.acme-page__summary .gc-card { display: grid; gap: var(--gc-space-2); }
.acme-page__summary strong { font-size: var(--gc-font-size-xl); color: var(--gc-color-text); }
.acme-page__summary span { color: var(--gc-color-text-muted); }
.acme-page__row-actions { flex-wrap: wrap; }
.acme-page__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.acme-page__form > :first-child, .acme-page__form > :nth-child(2), .acme-page__form > :nth-child(3), .acme-page__form > :nth-child(4), .acme-page__form-actions { grid-column: 1 / -1; }
.acme-page__checkbox { display: flex; align-items: center; gap: var(--gc-space-2); }
.acme-page__form-actions { justify-content: flex-end; padding-top: var(--gc-space-3); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.acme-page__provider-list { display: grid; gap: var(--gc-space-3); }
.acme-page__provider { display: flex; justify-content: space-between; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.acme-page__provider > div:first-child { display: grid; gap: var(--gc-space-1); min-width: 0; }
.acme-page__provider small { color: var(--gc-color-text-muted); overflow-wrap: anywhere; }
.acme-page__provider-empty, .acme-page__provider-result { margin: 0; color: var(--gc-color-text-muted); }
.acme-page__provider-result { color: var(--gc-color-success); }
.acme-page__provider-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.acme-page__field--wide { grid-column: 1 / -1; }
.acme-page__challenge-field { display: flex; flex-wrap: wrap; gap: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); padding: var(--gc-space-3); }
.acme-page__challenge-field legend { color: var(--gc-color-text-muted); }
@media (max-width: 48rem) { .acme-page__summary, .acme-page__form { grid-template-columns: 1fr; } .acme-page__intro { align-items: flex-start; flex-direction: column; } }
</style>
