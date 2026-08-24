<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { GcPageHeader, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const activeTab = ref('authorities')
const loading = ref(false)
const actionPending = ref(false)
const error = ref('')
const providers = ref<InternalCaRecord[]>([])
const authorities = ref<InternalCaRecord[]>([])
const profiles = ref<InternalCaRecord[]>([])
const requests = ref<InternalCaRecord[]>([])
const nodes = ref<InternalCaRecord[]>([])
const renewals = ref<InternalCaRecord[]>([])
const revocations = ref<InternalCaRecord[]>([])
const trustDistributions = ref<InternalCaRecord[]>([])
const reuseRisks = ref<InternalCaRecord[]>([])
const riskOverview = ref<InternalCaRecord>({})
const authorityPreview = ref<InternalCaRecord | null>(null)
const remediationPreview = ref<InternalCaRecord | null>(null)

const providerDraft = reactive({ name: '', type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single' })
const authorityDraft = reactive({ providerId: '', name: '', commonName: '', securityDomain: 'production', topologyMode: 'root_with_intermediate', keyBackend: 'secret' })
const profileDraft = reactive({ name: '', securityDomain: 'production', allowedDnsSuffix: '', maximumValidityDays: 90, renewalWindowDays: 30, requireApproval: true })
const requestDraft = reactive({ applicationAssetId: '', caId: '', profileVersionId: '', commonName: '', sans: '', custodyMode: 'managed_secret' })
const revocationDraft = reactive({ certificateVersionId: '', reason: 'keyCompromise' })
const trustDraft = reactive({ caId: '', targetIds: '', platform: 'linux' })

const tabs = computed(() => [
  { value: 'authorities', label: t('internalCa.tabs.authorities') },
  { value: 'profiles', label: t('internalCa.tabs.profiles') },
  { value: 'requests', label: t('internalCa.tabs.requests') },
  { value: 'operations', label: t('internalCa.tabs.operations') },
  { value: 'risks', label: t('internalCa.tabs.risks') },
])

const selectedProvider = computed(() => providers.value.find((item) => text(item.id) === authorityDraft.providerId))
const topologyInput = computed(() => ({
  topologyMode: authorityDraft.topologyMode,
  deploymentMode: text(selectedProvider.value?.deploymentMode, providerDraft.deploymentMode),
  runtimePlatform: text(selectedProvider.value?.runtimePlatform, providerDraft.runtimePlatform),
  availabilityMode: text(selectedProvider.value?.availabilityMode, providerDraft.availabilityMode),
  keyBackend: authorityDraft.keyBackend,
}))

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [providerResult, authorityResult, profileResult, requestResult, nodeResult, renewalResult, revocationResult, trustResult, riskResult, overviewResult] = await Promise.all([
      internalCaApi.listProviders(), internalCaApi.listAuthorities(), internalCaApi.listProfiles(), internalCaApi.listRequests(), internalCaApi.listNodes(),
      internalCaApi.listRenewals(), internalCaApi.listRevocations(), internalCaApi.listTrustDistributions(), internalCaApi.listReuseRisks(), internalCaApi.reuseRiskOverview(),
    ])
    providers.value = providerResult.data ?? []
    authorities.value = authorityResult.data ?? []
    profiles.value = profileResult.data ?? []
    requests.value = requestResult.data ?? []
    nodes.value = nodeResult.data ?? []
    renewals.value = renewalResult.data ?? []
    revocations.value = revocationResult.data ?? []
    trustDistributions.value = trustResult.data ?? []
    reuseRisks.value = riskResult.data ?? []
    riskOverview.value = overviewResult.data ?? {}
    authorityDraft.providerId ||= text(providers.value[0]?.id)
    requestDraft.caId ||= text(authorities.value.find((item) => text(item.role) === 'intermediate')?.id ?? authorities.value[0]?.id)
    requestDraft.profileVersionId ||= text(asRecords(profiles.value[0]?.versions)[0]?.id)
    trustDraft.caId ||= requestDraft.caId
  } catch {
    error.value = t('internalCa.messages.loadFailed')
  } finally {
    loading.value = false
  }
}

async function runAction(action: () => Promise<unknown>, successKey: string) {
  actionPending.value = true
  error.value = ''
  try {
    await action()
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t(successKey), tone: 'success' } }))
  } catch {
    error.value = t('internalCa.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

async function createProvider() {
  await runAction(() => internalCaApi.createProvider({ ...providerDraft }), 'internalCa.messages.providerCreated')
}

async function previewAuthority() {
  actionPending.value = true
  try {
    authorityPreview.value = (await internalCaApi.previewAuthority(topologyInput.value)).data ?? null
  } catch {
    error.value = t('internalCa.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

async function createAuthority() {
  if (!authorityPreview.value) await previewAuthority()
  const confirmationToken = text(authorityPreview.value?.confirmationToken)
  if (!confirmationToken) return
  await runAction(() => internalCaApi.createAuthority({ ...authorityDraft, ...topologyInput.value, confirmationToken }), 'internalCa.messages.authorityCreated')
  authorityPreview.value = null
}

async function createProfile() {
  await runAction(() => internalCaApi.createProfile({
    name: profileDraft.name,
    securityDomain: profileDraft.securityDomain,
    rules: {
      allowedDnsSuffixes: splitList(profileDraft.allowedDnsSuffix), maximumValidityDays: profileDraft.maximumValidityDays,
      renewalWindowDays: profileDraft.renewalWindowDays, rotateKeyOnRenewal: true, requireApproval: profileDraft.requireApproval,
    },
  }), 'internalCa.messages.profileCreated')
}

async function createRequest() {
  await runAction(() => internalCaApi.createRequest({
    ...requestDraft, sans: splitList(requestDraft.sans), requestedValidityDays: 90,
  }), 'internalCa.messages.requestCreated')
}

async function createRevocation() {
  await runAction(() => internalCaApi.createRevocation({ ...revocationDraft }), 'internalCa.messages.revocationCreated')
}

async function createTrustDistribution() {
  await runAction(() => internalCaApi.createTrustDistribution({
    caId: trustDraft.caId, targetScope: { targetIds: splitList(trustDraft.targetIds), platform: trustDraft.platform },
  }), 'internalCa.messages.trustCreated')
}

async function approveRequest(item: InternalCaRecord) {
  await runAction(() => internalCaApi.approveRequest(text(item.id), text(item.approvalId)), 'internalCa.messages.requestApproved')
}

async function retryRequest(item: InternalCaRecord) {
  await runAction(() => internalCaApi.retryRequest(text(item.id)), 'internalCa.messages.requestRetried')
}

async function queryRequest(item: InternalCaRecord) {
  await runAction(() => internalCaApi.queryRequest(text(item.id)), 'internalCa.messages.requestQueried')
}

async function approveRevocation(item: InternalCaRecord) {
  await runAction(() => internalCaApi.approveRevocation(text(item.id), text(item.approvalId)), 'internalCa.messages.revocationApproved')
}

async function approveTrustDistribution(item: InternalCaRecord) {
  await runAction(() => internalCaApi.approveTrustDistribution(text(item.id), text(item.approvalId)), 'internalCa.messages.trustApproved')
}

async function previewRemediation(riskId: string) {
  remediationPreview.value = (await internalCaApi.previewRemediation(riskId)).data ?? null
}

function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback }
function number(value: unknown): number { return Number(value ?? 0) }
function splitList(value: string): string[] { return value.split(',').map((item) => item.trim()).filter(Boolean) }
function asRecords(value: unknown): InternalCaRecord[] { return Array.isArray(value) ? value as InternalCaRecord[] : [] }
function localTime(value: unknown): string { return formatBrowserLocalTime(value) || t('internalCa.common.unknown') }
</script>

<template>
  <section class="internal-ca-page">
    <GcPageHeader :title="t('internalCa.title')" :description="t('internalCa.description')">
      <template #actions><button class="gc-button" type="button" :disabled="loading" @click="loadAll">{{ t('internalCa.actions.refresh') }}</button></template>
    </GcPageHeader>
    <div v-if="error" class="notice notice--danger">{{ error }}</div>
    <GcTabs v-model="activeTab" :tabs="tabs" :aria-label="t('internalCa.aria.tabs')" />

    <template v-if="activeTab === 'authorities'">
      <div class="decision-grid">
        <article class="gc-card decision-card"><h2>{{ t('internalCa.topology.rootOnly') }}</h2><p>{{ t('internalCa.topology.rootOnlyDescription') }}</p><strong>{{ t('internalCa.topology.rootOnlyRisk') }}</strong></article>
        <article class="gc-card decision-card decision-card--recommended"><h2>{{ t('internalCa.topology.intermediate') }}</h2><p>{{ t('internalCa.topology.intermediateDescription') }}</p><strong>{{ t('internalCa.topology.recommended') }}</strong></article>
      </div>
      <div class="content-grid">
        <form class="gc-card form-card" @submit.prevent="createProvider">
          <h2>{{ t('internalCa.sections.provider') }}</h2>
          <label>{{ t('internalCa.fields.name') }}<input v-model="providerDraft.name" required /></label>
          <label>{{ t('internalCa.fields.providerType') }}<select v-model="providerDraft.type"><option value="gcac_builtin">GCAC Builtin</option><option value="gcac_managed_node">GCAC CA Node</option><option value="microsoft_adcs">Microsoft AD CS</option><option value="acme">ACME</option><option value="est">EST</option><option value="scep">SCEP</option></select></label>
          <label>{{ t('internalCa.fields.deploymentMode') }}<select v-model="providerDraft.deploymentMode"><option value="builtin">builtin</option><option value="managed_node">managed_node</option><option value="external">external</option></select></label>
          <label>{{ t('internalCa.fields.platform') }}<select v-model="providerDraft.runtimePlatform"><option value="embedded">embedded</option><option value="windows">windows</option><option value="linux">linux</option><option value="external">external</option></select></label>
          <button class="gc-button gc-button--primary" :disabled="actionPending">{{ t('internalCa.actions.createProvider') }}</button>
        </form>
        <form class="gc-card form-card" @submit.prevent="createAuthority">
          <h2>{{ t('internalCa.sections.authorityWizard') }}</h2>
          <label>{{ t('internalCa.fields.provider') }}<select v-model="authorityDraft.providerId" required><option v-for="item in providers" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
          <label>{{ t('internalCa.fields.name') }}<input v-model="authorityDraft.name" required /></label>
          <label>{{ t('internalCa.fields.commonName') }}<input v-model="authorityDraft.commonName" required /></label>
          <label>{{ t('internalCa.fields.securityDomain') }}<input v-model="authorityDraft.securityDomain" required /></label>
          <label>{{ t('internalCa.fields.topology') }}<select v-model="authorityDraft.topologyMode"><option value="root_only">{{ t('internalCa.topology.rootOnly') }}</option><option value="root_with_intermediate">{{ t('internalCa.topology.intermediate') }}</option></select></label>
          <div class="button-row"><button class="gc-button" type="button" @click="previewAuthority">{{ t('internalCa.actions.previewRisk') }}</button><button class="gc-button gc-button--primary" :disabled="actionPending">{{ t('internalCa.actions.createAuthority') }}</button></div>
        </form>
      </div>
      <article v-if="authorityPreview" class="gc-card"><h2>{{ t('internalCa.sections.riskSummary') }}</h2><p>{{ text(authorityPreview.overallRecommendation) }}</p><ul><li v-for="warning in asRecords(authorityPreview.warnings)" :key="String(warning)">{{ warning }}</li></ul></article>
      <div class="record-grid"><article v-for="item in authorities" :key="text(item.id)" class="gc-card record-card"><div><strong>{{ text(item.name) }}</strong><GcStatusTag :status="text(item.status)" /></div><p>{{ text(item.subjectCommonName) }}</p><small>{{ text(item.role) }} · {{ text(item.securityDomain) }} · {{ localTime(item.notAfter) }}</small></article></div>
    </template>

    <template v-else-if="activeTab === 'profiles'">
      <form class="gc-card form-card wide-form" @submit.prevent="createProfile"><h2>{{ t('internalCa.sections.profile') }}</h2><label>{{ t('internalCa.fields.name') }}<input v-model="profileDraft.name" required /></label><label>{{ t('internalCa.fields.securityDomain') }}<input v-model="profileDraft.securityDomain" /></label><label>{{ t('internalCa.fields.dnsSuffixes') }}<input v-model="profileDraft.allowedDnsSuffix" :placeholder="t('internalCa.placeholders.dnsSuffixes')" /></label><label>{{ t('internalCa.fields.validityDays') }}<input v-model.number="profileDraft.maximumValidityDays" type="number" min="1" /></label><label>{{ t('internalCa.fields.renewalDays') }}<input v-model.number="profileDraft.renewalWindowDays" type="number" min="1" /></label><label class="check"><input v-model="profileDraft.requireApproval" type="checkbox" />{{ t('internalCa.fields.requireApproval') }}</label><button class="gc-button gc-button--primary">{{ t('internalCa.actions.createProfile') }}</button></form>
      <div class="record-grid"><article v-for="item in profiles" :key="text(item.profile && (item.profile as InternalCaRecord).id)" class="gc-card record-card"><strong>{{ text(item.profile && (item.profile as InternalCaRecord).name) }}</strong><p>{{ text(item.profile && (item.profile as InternalCaRecord).securityDomain) }}</p><small>{{ t('internalCa.labels.versionCount', { count: asRecords(item.versions).length }) }}</small></article></div>
    </template>

    <template v-else-if="activeTab === 'requests'">
      <form class="gc-card form-card wide-form" @submit.prevent="createRequest"><h2>{{ t('internalCa.sections.request') }}</h2><label>{{ t('internalCa.fields.applicationAssetId') }}<input v-model="requestDraft.applicationAssetId" required /></label><label>{{ t('internalCa.fields.authority') }}<select v-model="requestDraft.caId"><option v-for="item in authorities" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label><label>{{ t('internalCa.fields.profileVersionId') }}<input v-model="requestDraft.profileVersionId" required /></label><label>{{ t('internalCa.fields.commonName') }}<input v-model="requestDraft.commonName" required /></label><label>{{ t('internalCa.fields.sans') }}<input v-model="requestDraft.sans" :placeholder="t('internalCa.placeholders.sans')" /></label><label>{{ t('internalCa.fields.custodyMode') }}<select v-model="requestDraft.custodyMode"><option value="managed_secret">managed_secret</option><option value="local_agent">local_agent</option><option value="device_local">device_local</option><option value="external_key">external_key</option></select></label><button class="gc-button gc-button--primary">{{ t('internalCa.actions.createRequest') }}</button></form>
      <div class="record-grid"><article v-for="item in requests" :key="text(item.id)" class="gc-card record-card"><div><strong>{{ text(item.subjectCommonName) }}</strong><GcStatusTag :status="text(item.status)" /></div><p>{{ text(item.applicationAssetId) }}</p><small>{{ localTime(item.updatedAt) }}</small><div class="button-row"><button v-if="text(item.status) === 'pending_approval' && text(item.approvalId)" class="gc-button" @click="approveRequest(item)">{{ t('internalCa.actions.approve') }}</button><button v-if="text(item.status) === 'issue_failed'" class="gc-button" @click="retryRequest(item)">{{ t('internalCa.actions.retry') }}</button><button v-if="text(item.status) === 'issuing' && text(item.providerRequestId)" class="gc-button" @click="queryRequest(item)">{{ t('internalCa.actions.queryResult') }}</button></div></article></div>
    </template>

    <template v-else-if="activeTab === 'operations'">
      <div class="metrics"><article class="gc-card metric"><span>{{ t('internalCa.metrics.nodes') }}</span><strong>{{ nodes.length }}</strong></article><article class="gc-card metric"><span>{{ t('internalCa.metrics.renewals') }}</span><strong>{{ renewals.length }}</strong></article><article class="gc-card metric"><span>{{ t('internalCa.metrics.revocations') }}</span><strong>{{ revocations.length }}</strong></article><article class="gc-card metric"><span>{{ t('internalCa.metrics.trust') }}</span><strong>{{ trustDistributions.length }}</strong></article></div>
      <button class="gc-button gc-button--primary" @click="runAction(() => internalCaApi.scanRenewals(), 'internalCa.messages.renewalScanned')">{{ t('internalCa.actions.scanRenewals') }}</button>
      <div class="content-grid"><form class="gc-card form-card" @submit.prevent="createRevocation"><h2>{{ t('internalCa.sections.revocation') }}</h2><label>{{ t('internalCa.fields.certificateVersionId') }}<input v-model="revocationDraft.certificateVersionId" required /></label><label>{{ t('internalCa.fields.reason') }}<input v-model="revocationDraft.reason" required /></label><button class="gc-button gc-button--primary">{{ t('internalCa.actions.createRevocation') }}</button></form><form class="gc-card form-card" @submit.prevent="createTrustDistribution"><h2>{{ t('internalCa.sections.trust') }}</h2><label>{{ t('internalCa.fields.authority') }}<select v-model="trustDraft.caId"><option v-for="item in authorities" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label><label>{{ t('internalCa.fields.targetIds') }}<input v-model="trustDraft.targetIds" /></label><label>{{ t('internalCa.fields.platform') }}<select v-model="trustDraft.platform"><option value="windows">windows</option><option value="linux">linux</option></select></label><button class="gc-button gc-button--primary">{{ t('internalCa.actions.createTrust') }}</button></form></div>
      <div class="record-grid"><article v-for="item in revocations" :key="text(item.id)" class="gc-card record-card"><div><strong>{{ text(item.certificateVersionId) }}</strong><GcStatusTag :status="text(item.status)" /></div><small>{{ localTime(item.updatedAt) }}</small><button v-if="text(item.status) === 'pending_approval' && text(item.approvalId)" class="gc-button" @click="approveRevocation(item)">{{ t('internalCa.actions.approve') }}</button></article><article v-for="item in trustDistributions" :key="text(item.id)" class="gc-card record-card"><div><strong>{{ text(item.caId) }}</strong><GcStatusTag :status="text(item.status)" /></div><small>{{ localTime(item.updatedAt) }}</small><button v-if="text(item.status) === 'pending_approval' && text(item.approvalId)" class="gc-button" @click="approveTrustDistribution(item)">{{ t('internalCa.actions.approve') }}</button></article></div>
    </template>

    <template v-else>
      <div class="metrics"><article class="gc-card metric"><span>{{ t('internalCa.metrics.totalRisks') }}</span><strong>{{ number(riskOverview.total) }}</strong></article><article class="gc-card metric metric--danger"><span>{{ t('internalCa.metrics.critical') }}</span><strong>{{ number(riskOverview.critical) }}</strong></article><article class="gc-card metric"><span>{{ t('internalCa.metrics.affectedAssets') }}</span><strong>{{ number(riskOverview.affectedApplicationAssets) }}</strong></article></div>
      <div class="record-grid"><article v-for="item in reuseRisks" :key="text(item.id)" class="gc-card record-card"><div><strong>{{ t(`internalCa.riskTypes.${text(item.riskType)}`) }}</strong><GcStatusTag :status="text(item.severity)" /></div><p>{{ text(item.explanation) }}</p><small>{{ t('internalCa.labels.assetCount', { count: asRecords(item.applicationAssets).length }) }} · {{ text(item.fingerprintSha256).slice(0, 16) }}</small><button class="gc-button" @click="previewRemediation(text(item.id))">{{ t('internalCa.actions.previewRemediation') }}</button></article></div>
      <article v-if="remediationPreview" class="gc-card"><h2>{{ t('internalCa.sections.remediation') }}</h2><p>{{ t('internalCa.labels.requestCount', { count: asRecords(remediationPreview.requests).length }) }}</p><pre>{{ JSON.stringify(remediationPreview, null, 2) }}</pre></article>
    </template>
  </section>
</template>

<style scoped>
.internal-ca-page { display: grid; gap: var(--gc-space-5); }
.decision-grid, .content-grid, .record-grid, .metrics { display: grid; gap: var(--gc-space-4); grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); }
.decision-card, .form-card, .record-card, .metric { padding: var(--gc-space-5); }
.decision-card--recommended { border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.decision-card h2, .form-card h2 { margin: 0 0 var(--gc-space-3); color: var(--gc-color-text-strong); }
.decision-card p, .record-card p { color: var(--gc-color-text-muted); }
.form-card { display: grid; gap: var(--gc-space-3); align-content: start; }
.wide-form { grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); align-items: end; }
label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
input, select { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); color: var(--gc-color-text); background: var(--gc-color-surface-field); }
.check { display: flex; align-items: center; }
.check input { min-height: auto; }
.button-row, .record-card > div { display: flex; gap: var(--gc-space-2); align-items: center; justify-content: space-between; flex-wrap: wrap; }
.record-card { display: grid; gap: var(--gc-space-2); }
.record-card small { color: var(--gc-color-text-soft); }
.metric { display: flex; justify-content: space-between; align-items: center; }
.metric strong { font-size: var(--gc-font-size-2xl); color: var(--gc-color-primary); }
.metric--danger strong { color: var(--gc-color-danger); }
.notice { padding: var(--gc-space-3); border-radius: var(--gc-radius-md); }
.notice--danger { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); }
pre { overflow: auto; padding: var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-muted-bg); border-radius: var(--gc-radius-md); }
</style>
