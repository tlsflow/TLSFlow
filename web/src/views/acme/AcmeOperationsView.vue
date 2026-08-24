<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { GcDataTable, GcPageHeader, GcTabs } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()

const activeTab = ref('overview')
const loading = ref(false)
const actionPending = ref(false)
const error = ref('')
const providers = ref<InternalCaRecord[]>([])
const accounts = ref<InternalCaRecord[]>([])
const orders = ref<InternalCaRecord[]>([])
const policies = ref<InternalCaRecord[]>([])
const jobs = ref<InternalCaRecord[]>([])

const providerDraft = reactive({
  name: '',
  directoryUrl: '',
  allowedChallenges: 'http-01,dns-01,tls-alpn-01',
  termsOfServiceAgreed: false,
})
const accountDraft = reactive({
  providerId: '',
  accountKeySecretRef: '',
  contact: '',
  termsOfServiceAgreed: false,
})
const policyDraft = reactive({
  certificateAssetId: '',
  bindingId: '',
  providerId: '',
  accountId: '',
  renewalWindowDays: 30,
  challengeType: 'http-01',
  rotateKeyOnRenewal: true,
  deploymentMode: 'automatic',
  maxAttempts: 5,
  backoffSeconds: 300,
})

const tabs = computed(() => [
  { value: 'overview', label: t('acme.tabs.overview') },
  { value: 'orders', label: t('acme.tabs.orders') },
  { value: 'policies', label: t('acme.tabs.policies') },
])
const acmeProviders = computed(() => providers.value.filter((item) => text(item.type) === 'acme'))
const selectedProvider = computed(() => acmeProviders.value.find((item) => text(item.id) === accountDraft.providerId))
const acmeAccounts = computed(() => accounts.value.filter((item) => acmeProviders.value.some((provider) => text(provider.id) === text(item.providerId))))
const completedJobs = computed(() => jobs.value.filter((item) => text(item.status) === 'completed').length)
const failedJobs = computed(() => jobs.value.filter((item) => ['failed', 'rollback_required', 'blocked'].includes(text(item.status))).length)
const activeOrders = computed(() => orders.value.filter((item) => !['valid', 'invalid', 'expired', 'cancelled'].includes(text(item.status))).length)

const providerColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'name', title: t('acme.fields.name') },
  { key: 'directoryUrl', title: t('acme.fields.directoryUrl') },
  { key: 'allowedChallenges', title: t('acme.fields.allowedChallenges') },
  { key: 'status', title: t('acme.fields.status') },
])
const accountColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'providerId', title: t('acme.fields.provider') },
  { key: 'contact', title: t('acme.fields.contact') },
  { key: 'status', title: t('acme.fields.status') },
  { key: 'updatedAt', title: t('acme.fields.updatedAt') },
])
const orderColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'id', title: 'ID' },
  { key: 'identifiers', title: t('acme.fields.identifiers') },
  { key: 'status', title: t('acme.fields.status') },
  { key: 'challengeCount', title: t('acme.fields.challenge') },
  { key: 'updatedAt', title: t('acme.fields.updatedAt') },
])
const policyColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'certificateAssetId', title: t('acme.fields.certificateAssetId') },
  { key: 'providerId', title: t('acme.fields.provider') },
  { key: 'challengeType', title: t('acme.fields.challengeType') },
  { key: 'deploymentMode', title: t('acme.fields.deploymentMode') },
  { key: 'status', title: t('acme.fields.status') },
])
const jobColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'sourceCertificateVersionId', title: t('acme.fields.certificateAssetId') },
  { key: 'status', title: t('acme.fields.status') },
  { key: 'promotionStatus', title: t('acme.fields.promotion') },
  { key: 'nextAttemptAt', title: t('acme.fields.nextAttemptAt') },
  { key: 'failureMessage', title: t('acme.fields.failure') },
])

onMounted(loadAll)

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [providerResult, accountResult, orderResult, policyResult, jobResult] = await Promise.all([
      internalCaApi.listProviders(),
      internalCaApi.listAcmeAccounts(),
      internalCaApi.listAcmeOrders(),
      internalCaApi.listAcmeRenewalPolicies(),
      internalCaApi.listAcmeRenewalJobs(),
    ])
    providers.value = providerResult.data ?? []
    accounts.value = accountResult.data ?? []
    orders.value = orderResult.data ?? []
    policies.value = policyResult.data ?? []
    jobs.value = jobResult.data ?? []
    accountDraft.providerId ||= text(acmeProviders.value[0]?.id)
    policyDraft.providerId ||= text(acmeProviders.value[0]?.id)
    policyDraft.accountId ||= text(acmeAccounts.value[0]?.id)
  } catch {
    error.value = t('acme.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

async function runAction(action: () => Promise<unknown>, successKey: string): Promise<boolean> {
  actionPending.value = true
  error.value = ''
  try {
    await action()
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t(successKey), tone: 'success' } }))
    return true
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.actionFailed')
    return false
  } finally {
    actionPending.value = false
  }
}

async function createProvider(): Promise<void> {
  const allowedChallenges = providerDraft.allowedChallenges.split(',').map((item) => item.trim()).filter(Boolean)
  await runAction(() => internalCaApi.createProvider({
    name: providerDraft.name.trim(),
    type: 'acme',
    deploymentMode: 'external',
    runtimePlatform: 'external',
    availabilityMode: 'active_active',
    endpoint: providerDraft.directoryUrl.trim(),
    configuration: {
      directoryUrl: providerDraft.directoryUrl.trim(),
      allowedChallenges,
      requestTimeoutMs: 15000,
      verifyTls: true,
      termsOfServiceAgreed: providerDraft.termsOfServiceAgreed,
    },
  }), 'acme.messages.providerCreated')
}

async function createAccount(): Promise<void> {
  await runAction(() => internalCaApi.createAcmeAccount({
    providerId: accountDraft.providerId,
    accountKeySecretRef: accountDraft.accountKeySecretRef.trim(),
    contact: accountDraft.contact.split(',').map((item) => item.trim()).filter(Boolean),
    termsOfServiceAgreed: accountDraft.termsOfServiceAgreed,
  }), 'acme.messages.accountCreated')
}

async function createPolicy(): Promise<void> {
  if (!policyDraft.certificateAssetId.trim() && !policyDraft.bindingId.trim()) {
    error.value = t('acme.messages.actionFailed')
    return
  }
  await runAction(() => internalCaApi.createAcmeRenewalPolicy({
    certificateAssetId: policyDraft.certificateAssetId.trim() || undefined,
    bindingId: policyDraft.bindingId.trim() || undefined,
    providerId: policyDraft.providerId,
    accountId: policyDraft.accountId,
    renewalWindowDays: policyDraft.renewalWindowDays,
    challengeType: policyDraft.challengeType,
    rotateKeyOnRenewal: policyDraft.rotateKeyOnRenewal,
    deploymentMode: policyDraft.deploymentMode,
    maxAttempts: policyDraft.maxAttempts,
    backoffSeconds: policyDraft.backoffSeconds,
  }), 'acme.messages.policyCreated')
}

async function scan(): Promise<void> {
  await runAction(() => internalCaApi.scanAcmeRenewalJobs(), 'acme.messages.scanCompleted')
}

async function runJobs(): Promise<void> {
  await runAction(() => internalCaApi.runAcmeRenewalJobs(), 'acme.messages.runCompleted')
}

async function retryJob(job: InternalCaRecord): Promise<void> {
  await runAction(() => internalCaApi.retryAcmeRenewalJob(text(job.id)), 'acme.messages.retryCompleted')
}

async function reconcileOrder(order: InternalCaRecord): Promise<void> {
  await runAction(() => internalCaApi.reconcileAcmeOrder(text(order.id)), 'acme.messages.runCompleted')
}

async function finalizeOrder(order: InternalCaRecord): Promise<void> {
  await runAction(() => internalCaApi.finalizeAcmeOrder(text(order.id)), 'acme.messages.runCompleted')
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function localTime(value: unknown): string {
  return formatBrowserLocalTime(value, { includeSeconds: false }) || t('acme.common.notAvailable')
}

function statusLabel(value: unknown): string {
  const status = text(value, 'unknown')
  return t(`acme.statuses.${status}`)
}

function challengeLabel(value: unknown): string {
  const challenge = text(value)
  return t(`acme.challengeTypes.${challenge}`)
}

function deploymentModeLabel(value: unknown): string {
  const mode = text(value)
  return t(`acme.deploymentModes.${mode}`)
}

function providerName(providerId: unknown): string {
  return text(acmeProviders.value.find((item) => text(item.id) === text(providerId))?.name, t('acme.common.unknown'))
}

function accountName(accountId: unknown): string {
  const account = acmeAccounts.value.find((item) => text(item.id) === text(accountId))
  return text(account?.contact, text(account?.id, t('acme.common.unknown')))
}

function identifiers(value: unknown): string {
  if (!Array.isArray(value)) return t('acme.common.notAvailable')
  return value.map((item) => {
    if (!item || typeof item !== 'object') return ''
    const record = item as InternalCaRecord
    return text(record.value)
  }).filter(Boolean).join(', ') || t('acme.common.notAvailable')
}

function allowedChallenges(provider: InternalCaRecord): string {
  const configuration = provider.configuration
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) return t('acme.common.notAvailable')
  const values = (configuration as InternalCaRecord).allowedChallenges
  return Array.isArray(values) ? values.map(challengeLabel).join(', ') : t('acme.common.notAvailable')
}

function canRetry(job: InternalCaRecord): boolean {
  return ['failed', 'retry_waiting', 'rollback_required'].includes(text(job.status))
}
</script>

<template>
  <section class="acme-page">
    <GcPageHeader :title="t('acme.title')" :description="t('acme.description')">
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading || actionPending" :aria-label="t('acme.aria.refresh')" @click="loadAll">{{ t('acme.actions.refresh') }}</button>
        <button class="gc-button" type="button" :disabled="actionPending" :aria-label="t('acme.aria.scan')" @click="scan">{{ t('acme.actions.scan') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="actionPending" :aria-label="t('acme.aria.run')" @click="runJobs">{{ t('acme.actions.run') }}</button>
      </template>
    </GcPageHeader>

    <p v-if="error" class="acme-error" role="alert">{{ error }}</p>
    <GcTabs v-model="activeTab" :tabs="tabs" :aria-label="t('acme.title')" />

    <template v-if="activeTab === 'overview'">
      <div class="acme-metrics">
        <article class="gc-card acme-metric"><span>{{ t('acme.sections.provider') }}</span><strong>{{ acmeProviders.length }}</strong></article>
        <article class="gc-card acme-metric"><span>{{ t('acme.sections.account') }}</span><strong>{{ acmeAccounts.length }}</strong></article>
        <article class="gc-card acme-metric"><span>{{ t('acme.sections.order') }}</span><strong>{{ activeOrders }}</strong></article>
        <article class="gc-card acme-metric"><span>{{ t('acme.sections.job') }}</span><strong>{{ completedJobs }}/{{ jobs.length }}</strong><small v-if="failedJobs">{{ failedJobs }} {{ statusLabel('failed') }}</small></article>
      </div>

      <div class="acme-form-grid">
        <form class="gc-card acme-form" @submit.prevent="createProvider">
          <h2>{{ t('acme.sections.provider') }}</h2>
          <label>{{ t('acme.fields.name') }}<input v-model="providerDraft.name" required /></label>
          <label>{{ t('acme.fields.directoryUrl') }}<input v-model="providerDraft.directoryUrl" type="url" required /></label>
          <label>{{ t('acme.fields.allowedChallenges') }}<input v-model="providerDraft.allowedChallenges" required /></label>
          <label class="acme-check"><input v-model="providerDraft.termsOfServiceAgreed" type="checkbox" />{{ t('acme.fields.termsOfServiceAgreed') }}</label>
          <button class="gc-button gc-button--primary" type="submit" :disabled="actionPending">{{ t('acme.actions.createProvider') }}</button>
        </form>

        <form class="gc-card acme-form" @submit.prevent="createAccount">
          <h2>{{ t('acme.sections.account') }}</h2>
          <label>{{ t('acme.fields.provider') }}<select v-model="accountDraft.providerId" required><option v-for="provider in acmeProviders" :key="text(provider.id)" :value="text(provider.id)">{{ text(provider.name) }}</option></select></label>
          <label>{{ t('acme.fields.accountKeySecretRef') }}<input v-model="accountDraft.accountKeySecretRef" required /></label>
          <label>{{ t('acme.fields.contact') }}<input v-model="accountDraft.contact" required /></label>
          <label class="acme-check"><input v-model="accountDraft.termsOfServiceAgreed" type="checkbox" />{{ t('acme.fields.termsOfServiceAgreed') }}</label>
          <button class="gc-button gc-button--primary" type="submit" :disabled="actionPending || !selectedProvider">{{ t('acme.actions.createAccount') }}</button>
        </form>
      </div>

      <GcDataTable :columns="providerColumns" :rows="acmeProviders" :loading="loading" :empty-text="t('acme.messages.noProviders')">
        <template #cell-directoryUrl="{ row }">{{ text((row.configuration as InternalCaRecord)?.directoryUrl, text(row.endpoint, t('acme.common.notAvailable'))) }}</template>
        <template #cell-allowedChallenges="{ row }">{{ allowedChallenges(row) }}</template>
        <template #cell-status="{ row }"><span class="acme-status" :data-status="text(row.status)">{{ statusLabel(row.status) }}</span></template>
      </GcDataTable>

      <GcDataTable :columns="accountColumns" :rows="acmeAccounts" :loading="loading" :empty-text="t('acme.messages.noAccounts')">
        <template #cell-providerId="{ row }">{{ providerName(row.providerId) }}</template>
        <template #cell-contact="{ row }">{{ Array.isArray(row.contact) ? row.contact.join(', ') : t('acme.common.notAvailable') }}</template>
        <template #cell-status="{ row }"><span class="acme-status" :data-status="text(row.status)">{{ statusLabel(row.status) }}</span></template>
        <template #cell-updatedAt="{ row }">{{ localTime(row.updatedAt) }}</template>
      </GcDataTable>
    </template>

    <template v-else-if="activeTab === 'orders'">
      <GcDataTable :columns="orderColumns" :rows="orders" :loading="loading" :empty-text="t('acme.messages.noOrders')">
        <template #cell-identifiers="{ row }">{{ identifiers(row.identifiers) }}</template>
        <template #cell-status="{ row }"><span class="acme-status" :data-status="text(row.status)">{{ statusLabel(row.status) }}</span></template>
        <template #cell-updatedAt="{ row }">{{ localTime(row.updatedAt) }}</template>
        <template #cell-id="{ row }"><span class="acme-id">{{ text(row.id) }}</span></template>
        <template #cell-challengeCount="{ row }">{{ number(row.challengeCount) }}</template>
      </GcDataTable>

      <section class="acme-section">
        <div class="acme-section__heading"><h2>{{ t('acme.sections.timeline') }}</h2></div>
        <div class="acme-timeline-grid">
          <article v-for="order in orders" :key="text(order.id)" class="gc-card acme-timeline">
            <header><div><strong>{{ text(order.id) }}</strong><small>{{ identifiers(order.identifiers) }}</small></div><span class="acme-status" :data-status="text(order.status)">{{ statusLabel(order.status) }}</span></header>
            <ol>
              <li v-for="challenge in (Array.isArray(order.challenges) ? order.challenges : [])" :key="text(challenge.id)">
                <span><strong>{{ challengeLabel(challenge.type) }}</strong><small>{{ text(challenge.identifier) }}</small></span>
                <span class="acme-status" :data-status="text(challenge.status)">{{ statusLabel(challenge.status) }}</span>
              </li>
            </ol>
            <footer>
              <small>{{ localTime(order.updatedAt) }}</small>
              <button v-if="['pending', 'processing', 'ready'].includes(text(order.status))" class="gc-button" type="button" :disabled="actionPending" @click="reconcileOrder(order)">{{ t('acme.actions.reconcile') }}</button>
              <button v-if="text(order.status) === 'ready'" class="gc-button gc-button--primary" type="button" :disabled="actionPending" @click="finalizeOrder(order)">{{ t('acme.actions.finalize') }}</button>
            </footer>
          </article>
        </div>
      </section>
    </template>

    <template v-else>
      <div class="acme-form-grid">
        <form class="gc-card acme-form" @submit.prevent="createPolicy">
          <h2>{{ t('acme.sections.policy') }}</h2>
          <label>{{ t('acme.fields.certificateAssetId') }}<input v-model="policyDraft.certificateAssetId" /></label>
          <label>{{ t('acme.fields.bindingId') }}<input v-model="policyDraft.bindingId" /></label>
          <label>{{ t('acme.fields.provider') }}<select v-model="policyDraft.providerId" required><option v-for="provider in acmeProviders" :key="text(provider.id)" :value="text(provider.id)">{{ text(provider.name) }}</option></select></label>
          <label>{{ t('acme.fields.account') }}<select v-model="policyDraft.accountId" required><option v-for="account in acmeAccounts" :key="text(account.id)" :value="text(account.id)">{{ accountName(account.id) }}</option></select></label>
          <label>{{ t('acme.fields.renewalWindowDays') }}<input v-model.number="policyDraft.renewalWindowDays" type="number" min="1" max="90" required /></label>
          <label>{{ t('acme.fields.challengeType') }}<select v-model="policyDraft.challengeType"><option value="http-01">{{ challengeLabel('http-01') }}</option><option value="dns-01">{{ challengeLabel('dns-01') }}</option><option value="tls-alpn-01">{{ challengeLabel('tls-alpn-01') }}</option></select></label>
          <label>{{ t('acme.fields.deploymentMode') }}<select v-model="policyDraft.deploymentMode"><option value="automatic">{{ deploymentModeLabel('automatic') }}</option><option value="approval">{{ deploymentModeLabel('approval') }}</option><option value="manual">{{ deploymentModeLabel('manual') }}</option></select></label>
          <label>{{ t('acme.fields.maxAttempts') }}<input v-model.number="policyDraft.maxAttempts" type="number" min="1" max="20" required /></label>
          <label>{{ t('acme.fields.backoffSeconds') }}<input v-model.number="policyDraft.backoffSeconds" type="number" min="10" required /></label>
          <label class="acme-check"><input v-model="policyDraft.rotateKeyOnRenewal" type="checkbox" />{{ t('acme.fields.rotateKeyOnRenewal') }}</label>
          <button class="gc-button gc-button--primary" type="submit" :disabled="actionPending || !acmeAccounts.length">{{ t('acme.actions.createPolicy') }}</button>
        </form>

        <GcDataTable :columns="policyColumns" :rows="policies" :loading="loading" :empty-text="t('acme.messages.noPolicies')">
          <template #cell-providerId="{ row }">{{ providerName(row.providerId) }}</template>
          <template #cell-challengeType="{ row }">{{ challengeLabel(row.challengeType) }}</template>
          <template #cell-deploymentMode="{ row }">{{ deploymentModeLabel(row.deploymentMode) }}</template>
          <template #cell-status="{ row }"><span class="acme-status" :data-status="text(row.status)">{{ statusLabel(row.status) }}</span></template>
        </GcDataTable>
      </div>

      <GcDataTable :columns="jobColumns" :rows="jobs" :loading="loading" :empty-text="t('acme.messages.noJobs')">
        <template #cell-status="{ row }"><span class="acme-status" :data-status="text(row.status)">{{ statusLabel(row.status) }}</span></template>
        <template #cell-promotionStatus="{ row }"><span class="acme-status" :data-status="text(row.promotionStatus)">{{ statusLabel(row.promotionStatus) }}</span></template>
        <template #cell-nextAttemptAt="{ row }">{{ localTime(row.nextAttemptAt) }}</template>
        <template #cell-failureMessage="{ row }">{{ text(row.failureMessage, t('acme.messages.noFailure')) }}</template>
        <template #cell-sourceCertificateVersionId="{ row }"><span class="acme-id">{{ text(row.sourceCertificateVersionId) }}</span></template>
      </GcDataTable>
      <div class="acme-job-actions">
        <button v-for="job in jobs.filter(canRetry)" :key="text(job.id)" class="gc-button" type="button" :disabled="actionPending" @click="retryJob(job)">{{ t('acme.actions.retry') }} · {{ text(job.id) }}</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.acme-page { display: grid; gap: var(--gc-space-5); }
.acme-error { margin: 0; padding: var(--gc-space-3); color: var(--gc-color-danger); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); background: var(--gc-color-danger-bg); }
.acme-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); }
.acme-metric { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-5); }
.acme-metric span, .acme-metric small { color: var(--gc-color-text-muted); }
.acme-metric strong { color: var(--gc-color-primary); font-size: var(--gc-font-size-2xl); }
.acme-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); align-items: start; }
.acme-form { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-5); }
.acme-form h2, .acme-section h2 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-lg); }
.acme-form label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-form input, .acme-form select { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); color: var(--gc-color-text); background: var(--gc-color-surface-field); }
.acme-check { display: flex !important; align-items: center; gap: var(--gc-space-2) !important; }
.acme-check input { min-height: auto !important; }
.acme-section { display: grid; gap: var(--gc-space-3); }
.acme-section__heading { display: flex; align-items: center; justify-content: space-between; }
.acme-timeline-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); }
.acme-timeline { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-4); }
.acme-timeline header, .acme-timeline footer, .acme-timeline li { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.acme-timeline header div, .acme-timeline li span:first-child { display: grid; gap: var(--gc-space-1); min-width: 0; }
.acme-timeline small { color: var(--gc-color-text-muted); }
.acme-timeline ol { display: grid; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.acme-timeline li { padding: var(--gc-space-3); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-info-border); background: var(--gc-color-surface-muted); }
.acme-id { overflow-wrap: anywhere; font-family: var(--gc-font-family-mono); color: var(--gc-color-text-strong); }
.acme-status { display: inline-flex; align-items: center; width: fit-content; padding: var(--gc-space-1) var(--gc-space-2); border-radius: var(--gc-radius-pill); font-size: var(--gc-font-size-xs); font-weight: 700; color: var(--gc-color-muted); background: var(--gc-color-muted-bg); }
.acme-status[data-status='active'], .acme-status[data-status='valid'], .acme-status[data-status='completed'], .acme-status[data-status='promoted'] { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.acme-status[data-status='processing'], .acme-status[data-status='presented'], .acme-status[data-status='ready'], .acme-status[data-status='issuing'], .acme-status[data-status='deploying'], .acme-status[data-status='verifying'], .acme-status[data-status='scheduled'], .acme-status[data-status='retry_waiting'] { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.acme-status[data-status='invalid'], .acme-status[data-status='failed'], .acme-status[data-status='blocked'], .acme-status[data-status='error'] { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.acme-job-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
@media (max-width: 48rem) {
  .acme-form-grid { grid-template-columns: 1fr; }
  .acme-timeline header, .acme-timeline footer, .acme-timeline li { align-items: flex-start; flex-direction: column; }
}
</style>
