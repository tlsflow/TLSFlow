<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { GcConfirmAction, GcModal, GcPageHeader, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const activeTab = ref('authorities')
const loading = ref(false)
const actionPending = ref(false)
const error = ref('')
const providers = ref<InternalCaRecord[]>([])
const trustDomains = ref<InternalCaRecord[]>([])
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
const authorityWizardOpen = ref(false)
const authorityWizardStep = ref(1)
const authorityCreationKind = ref<'root' | 'intermediate'>('root')
const authorityCreationMode = ref<'builtin' | 'managed_node' | 'external'>('builtin')
const selectedRootId = ref('')
const authorityWizardForm = ref<HTMLFormElement | null>(null)
const providerEnrollment = ref<InternalCaRecord | null>(null)
const providerPrepared = ref(false)
const adcsInstallSession = ref<InternalCaRecord | null>(null)
const adcsWizardOpen = ref(false)
const deletingProviderId = ref('')

const providerDraft = reactive({ id: '', name: '', type: 'gcac_managed_node', deploymentMode: 'managed_node', runtimePlatform: 'linux', availabilityMode: 'single', endpoint: '', authMode: 'enrollment_token', profile: '', template: '', crlUrl: '', ocspUrl: '' })
const adcsDraft = reactive({ name: '' })
const trustDomainDraft = reactive({ name: '', code: '', purpose: 'production_tls', isolationLevel: 'standard', isDefault: false })
const authorityDraft = reactive({ providerId: '', trustDomainId: '', parentCaId: '', name: '', commonName: '', securityDomain: 'production', topologyMode: 'root_with_intermediate', keyBackend: 'secret' })
const profileDraft = reactive({ name: '', trustDomainId: '', securityDomain: 'production', allowedDnsSuffix: '', maximumValidityDays: 90, renewalWindowDays: 30, requireApproval: true })
const requestDraft = reactive({ applicationAssetId: '', trustDomainId: '', caId: '', profileVersionId: '', commonName: '', sans: '', custodyMode: 'managed_secret' })
const revocationDraft = reactive({ certificateVersionId: '', reason: 'keyCompromise' })
const trustDraft = reactive({ caId: '', targetIds: '', platform: 'linux' })

const tabs = computed(() => [
  { value: 'trustDomains', label: t('internalCa.tabs.trustDomains') },
  { value: 'authorities', label: t('internalCa.tabs.authorities') },
  { value: 'profiles', label: t('internalCa.tabs.profiles') },
  { value: 'requests', label: t('internalCa.tabs.requests') },
  { value: 'operations', label: t('internalCa.tabs.operations') },
  { value: 'risks', label: t('internalCa.tabs.risks') },
])

const selectedProvider = computed(() => providers.value.find((item) => text(item.id) === authorityDraft.providerId))
const adcsProviders = computed(() => providers.value.filter((item) => text(item.type) === 'microsoft_adcs' && nodes.value.some((node) => text(node.providerId) === text(item.id))))
const selectedAdcsNode = computed(() => nodes.value.find((node) => text(node.providerId) === text(selectedProvider.value?.id)))
const selectedAdcsDiscovery = computed(() => asRecord(asRecord(selectedProvider.value?.configuration).discovered))
const rootAuthorities = computed(() => authorities.value.filter((item) => text(item.role) === 'root' || !text(item.parentCaId)))
const selectedRoot = computed(() => rootAuthorities.value.find((item) => text(item.id) === selectedRootId.value) ?? rootAuthorities.value[0])
const selectedIntermediates = computed(() => authorities.value.filter((item) => text(item.parentCaId) === text(selectedRoot.value?.id)))
const eligibleParentRoots = computed(() => rootAuthorities.value.filter(isEligibleParentRoot))
const requestAuthorities = computed(() => authorities.value.filter((item) => !requestDraft.trustDomainId || text(item.trustDomainId) === requestDraft.trustDomainId))
const requestProfileVersions = computed(() => profiles.value.flatMap((item) => {
  const profile = item.profile as InternalCaRecord | undefined
  if (requestDraft.trustDomainId && text(profile?.trustDomainId) !== requestDraft.trustDomainId) return []
  return asRecords(item.versions).map((version): InternalCaRecord => ({ ...version, profileName: text(profile?.name) }))
}))
const topologyInput = computed(() => ({
  topologyMode: authorityDraft.topologyMode,
  deploymentMode: text(selectedProvider.value?.deploymentMode, providerDraft.deploymentMode),
  runtimePlatform: text(selectedProvider.value?.runtimePlatform, providerDraft.runtimePlatform),
  availabilityMode: text(selectedProvider.value?.availabilityMode, providerDraft.availabilityMode),
  keyBackend: authorityDraft.keyBackend,
}))

const wizardStepCount = computed(() => authorityCreationKind.value === 'intermediate' ? 3 : 4)
const wizardProgress = computed(() => `${(authorityWizardStep.value / wizardStepCount.value) * 100}%`)
const builtinProvider = computed(() => providers.value.find((item) => text(item.type) === 'gcac_builtin'))
const selectedCreationMode = computed(() => {
  if (authorityCreationKind.value === 'intermediate') {
    const provider = providers.value.find((item) => text(item.id) === authorityDraft.providerId)
    if (text(provider?.type) === 'gcac_managed_node') return 'managed_node'
    if (text(provider?.type) && text(provider?.type) !== 'gcac_builtin') return 'external'
  }
  return authorityCreationMode.value
})

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [providerResult, trustDomainResult, authorityResult, profileResult, requestResult, nodeResult, renewalResult, revocationResult, trustResult, riskResult, overviewResult] = await Promise.all([
      internalCaApi.listProviders(), internalCaApi.listTrustDomains(), internalCaApi.listAuthorities(), internalCaApi.listProfiles(), internalCaApi.listRequests(), internalCaApi.listNodes(),
      internalCaApi.listRenewals(), internalCaApi.listRevocations(), internalCaApi.listTrustDistributions(), internalCaApi.listReuseRisks(), internalCaApi.reuseRiskOverview(),
    ])
    providers.value = providerResult.data ?? []
    trustDomains.value = trustDomainResult.data ?? []
    authorities.value = authorityResult.data ?? []
    profiles.value = profileResult.data ?? []
    requests.value = requestResult.data ?? []
    nodes.value = nodeResult.data ?? []
    renewals.value = renewalResult.data ?? []
    revocations.value = revocationResult.data ?? []
    trustDistributions.value = trustResult.data ?? []
    reuseRisks.value = riskResult.data ?? []
    riskOverview.value = overviewResult.data ?? {}
    authorityDraft.providerId ||= text(builtinProvider.value?.id)
    const defaultTrustDomainId = text(trustDomains.value.find((item) => item.isDefault === true)?.id ?? trustDomains.value[0]?.id)
    authorityDraft.trustDomainId ||= defaultTrustDomainId
    profileDraft.trustDomainId ||= defaultTrustDomainId
    requestDraft.trustDomainId ||= defaultTrustDomainId
    requestDraft.caId ||= text(requestAuthorities.value.find((item) => text(item.role) === 'intermediate')?.id ?? requestAuthorities.value[0]?.id)
    requestDraft.profileVersionId ||= text(requestProfileVersions.value[0]?.id)
    trustDraft.caId ||= requestDraft.caId
    if (!rootAuthorities.value.some((item) => text(item.id) === selectedRootId.value)) selectedRootId.value = text(rootAuthorities.value[0]?.id)
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

async function createTrustDomain() {
  await runAction(() => internalCaApi.createTrustDomain({ ...trustDomainDraft }), 'internalCa.messages.trustDomainCreated')
}

async function previewAuthority() {
  actionPending.value = true
  authorityPreview.value = null
  try {
    authorityPreview.value = (await internalCaApi.previewAuthority(topologyInput.value)).data ?? null
  } catch {
    error.value = t('internalCa.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

async function createAuthority() {
  if (authorityCreationKind.value === 'root') {
    await prepareProvider()
    if (!providerPrepared.value) return
  }
  if (!authorityPreview.value) await previewAuthority()
  const confirmationToken = text(authorityPreview.value?.confirmationToken)
  if (!confirmationToken) return
  const previousRootIds = new Set(rootAuthorities.value.map((item) => text(item.id)))
  await runAction(() => internalCaApi.createAuthority({
    ...authorityDraft,
    parentCaId: authorityCreationKind.value === 'intermediate' ? authorityDraft.parentCaId : undefined,
    ...topologyInput.value,
    confirmationToken,
  }), 'internalCa.messages.authorityCreated')
  if (authorityCreationKind.value === 'intermediate') selectedRootId.value = authorityDraft.parentCaId
  else selectedRootId.value = text(rootAuthorities.value.find((item) => !previousRootIds.has(text(item.id)))?.id, selectedRootId.value)
  authorityPreview.value = null
  providerEnrollment.value = null
  providerPrepared.value = false
  authorityWizardOpen.value = false
}

function openAuthorityWizard(kind: 'root' | 'intermediate' = 'root', parent?: InternalCaRecord) {
  authorityCreationKind.value = kind
  authorityWizardStep.value = 1
  authorityPreview.value = null
  providerEnrollment.value = null
  providerPrepared.value = false
  authorityCreationMode.value = kind === 'intermediate' ? selectedCreationMode.value : 'builtin'
  providerDraft.id = ''
  providerDraft.name = ''
  providerDraft.endpoint = ''
  providerDraft.profile = ''
  providerDraft.template = ''
  providerDraft.crlUrl = ''
  providerDraft.ocspUrl = ''
  authorityDraft.parentCaId = ''
  authorityDraft.name = ''
  authorityDraft.commonName = ''
  authorityDraft.topologyMode = 'root_with_intermediate'
  if (kind === 'intermediate') {
    applyParentRoot(parent ?? selectedRoot.value)
    authorityWizardStep.value = 1
  }
  authorityWizardOpen.value = true
}

function chooseAuthorityMode(mode: 'builtin' | 'managed_node' | 'external') {
  const modeChanged = authorityCreationMode.value !== mode
  authorityCreationMode.value = mode
  providerPrepared.value = false
  providerEnrollment.value = null
  if (modeChanged) {
    providerDraft.id = ''
    authorityDraft.providerId = mode === 'builtin' ? text(builtinProvider.value?.id) : ''
  }
  authorityWizardStep.value = 2
  if (mode === 'builtin') {
    authorityDraft.providerId = text(builtinProvider.value?.id)
    providerDraft.type = 'gcac_builtin'
    providerDraft.deploymentMode = 'builtin'
    providerDraft.runtimePlatform = 'embedded'
  }
  if (mode === 'managed_node') {
    providerDraft.type = 'gcac_managed_node'
    providerDraft.deploymentMode = 'managed_node'
    providerDraft.runtimePlatform = 'linux'
  }
  if (mode === 'external') {
    providerDraft.type = 'microsoft_adcs'
    providerDraft.deploymentMode = 'external'
    providerDraft.runtimePlatform = 'external'
  }
}

function applyParentRoot(parent?: InternalCaRecord) {
  if (!parent) return
  const provider = providers.value.find((item) => text(item.id) === text(parent.providerId))
  authorityDraft.parentCaId = text(parent.id)
  authorityDraft.providerId = text(parent.providerId)
  authorityDraft.trustDomainId = text(parent.trustDomainId)
  authorityDraft.securityDomain = text(parent.securityDomain, 'production')
  authorityDraft.topologyMode = 'root_with_intermediate'
  authorityCreationMode.value = text(provider?.type) === 'gcac_managed_node'
    ? 'managed_node'
    : text(provider?.type) === 'gcac_builtin' ? 'builtin' : 'external'
}

function selectParentRoot(parentId: string) {
  applyParentRoot(eligibleParentRoots.value.find((item) => text(item.id) === parentId))
}

async function advanceAuthorityWizard() {
  if (authorityCreationKind.value === 'root' && authorityWizardStep.value === 1) {
    return
  }
  if (authorityCreationKind.value === 'root' && authorityWizardStep.value === 2) {
    if (!authorityWizardForm.value?.reportValidity()) return
    await prepareProvider()
    if (providerPrepared.value) authorityWizardStep.value = 3
    return
  }
  if (authorityCreationKind.value === 'root' && authorityWizardStep.value === 3) {
    if (!authorityWizardForm.value?.reportValidity()) return
    await previewAuthority()
    if (authorityPreview.value) authorityWizardStep.value = 4
    return
  }
  if (authorityCreationKind.value === 'intermediate' && authorityWizardStep.value === 1) {
    if (!authorityWizardForm.value?.reportValidity()) return
    authorityWizardStep.value = 2
    return
  }
  if (authorityCreationKind.value === 'intermediate' && authorityWizardStep.value === 2) {
    if (!authorityWizardForm.value?.reportValidity()) return
    await previewAuthority()
    if (authorityPreview.value) authorityWizardStep.value = 3
  }
}

function previousAuthorityWizardStep() {
  authorityWizardStep.value = Math.max(1, authorityWizardStep.value - 1)
}

function authorityWizardStepLabel(step: number): string {
  if (authorityCreationKind.value === 'intermediate') {
    return t(step === 1 ? 'internalCa.wizard.parentStep' : step === 2 ? 'internalCa.wizard.authorityStep' : 'internalCa.wizard.reviewStep')
  }
  return t(step === 1 ? 'internalCa.wizard.entryStep' : step === 2 ? 'internalCa.wizard.backendStep' : step === 3 ? 'internalCa.wizard.authorityStep' : 'internalCa.wizard.reviewStep')
}

function providerTypeLabel(type: unknown): string {
  const key = text(type, 'gcac_builtin')
  return t(`internalCa.providerTypes.${key}`)
}

function capabilityCount(provider: InternalCaRecord, state: string): number {
  return asRecords(provider.capabilityRecords).filter((record) => text(record.state) === state).length
}

function openAdcsWizard() {
  adcsInstallSession.value = null
  adcsDraft.name = t('internalCa.adcsAgent.defaultProviderNameIndexed', { index: adcsProviders.value.length + 1 })
  adcsWizardOpen.value = true
}

async function createAdcsAgentInstallSession() {
  await runAction(async () => {
    adcsInstallSession.value = (await internalCaApi.createAdcsAgentInstallSession({ name: adcsDraft.name })).data ?? null
  }, 'internalCa.messages.adcsAgentInstallCreated')
}

async function deleteProvider(provider: InternalCaRecord) {
  deletingProviderId.value = text(provider.id)
  try {
    await runAction(() => internalCaApi.deleteProvider(text(provider.id)), 'internalCa.messages.providerDeleted')
  } finally {
    deletingProviderId.value = ''
  }
}

async function prepareProvider() {
  if (providerPrepared.value || authorityCreationKind.value === 'intermediate') return
  actionPending.value = true
  try {
    if (authorityCreationMode.value === 'builtin') {
      authorityDraft.providerId = text(builtinProvider.value?.id)
      if (!authorityDraft.providerId) {
        const result = await internalCaApi.createProvider({ name: t('internalCa.wizard.builtinProviderName'), type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single' })
        authorityDraft.providerId = text(result.data?.id)
        await loadAll()
      }
      providerPrepared.value = Boolean(authorityDraft.providerId)
      return
    }
    if (authorityCreationMode.value === 'external' && providerDraft.type === 'microsoft_adcs') {
      const node = selectedAdcsNode.value
      if (!authorityDraft.providerId || !selectedProvider.value || text(selectedProvider.value.type) !== 'microsoft_adcs' || text(node?.healthStatus) !== 'online') {
        error.value = t('internalCa.messages.actionFailed')
        return
      }
      providerDraft.id = authorityDraft.providerId
      providerPrepared.value = true
      return
    }
    if (!providerDraft.id) {
      if (!providerDraft.name.trim()) providerDraft.name = authorityCreationMode.value === 'managed_node' ? t('internalCa.wizard.managedProviderName') : t('internalCa.wizard.externalProviderName')
      const provider = await internalCaApi.createProvider({
        name: providerDraft.name,
        type: providerDraft.type,
        deploymentMode: providerDraft.deploymentMode,
        runtimePlatform: providerDraft.runtimePlatform,
        availabilityMode: providerDraft.availabilityMode,
        endpoint: providerDraft.endpoint,
        configuration: {
          authMode: providerDraft.authMode,
          profile: providerDraft.profile,
          template: providerDraft.template,
          crlUrl: providerDraft.crlUrl,
          ocspUrl: providerDraft.ocspUrl,
        },
      })
      providerDraft.id = text(provider.data?.id)
    }
    authorityDraft.providerId = providerDraft.id
    if (authorityCreationMode.value === 'managed_node' && authorityDraft.providerId && !providerEnrollment.value) {
      providerEnrollment.value = (await internalCaApi.createNodeEnrollmentToken(authorityDraft.providerId, 30)).data ?? null
    }
    providerPrepared.value = Boolean(authorityDraft.providerId) && (authorityCreationMode.value !== 'managed_node' || Boolean(providerEnrollment.value))
    await loadAll()
  } catch {
    error.value = t('internalCa.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

function selectRoot(root: InternalCaRecord) {
  selectedRootId.value = text(root.id)
}

function isEligibleParentRoot(root: InternalCaRecord): boolean {
  const provider = providers.value.find((item) => text(item.id) === text(root.providerId))
  return text(root.role) === 'root' && number(root.pathLengthConstraint) > 0 && text(root.status) === 'active' && text(provider?.type) === 'gcac_builtin'
}

async function createProfile() {
  await runAction(() => internalCaApi.createProfile({
    name: profileDraft.name,
    trustDomainId: profileDraft.trustDomainId,
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
function asRecord(value: unknown): InternalCaRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as InternalCaRecord : {} }
function localTime(value: unknown): string { return formatBrowserLocalTime(value) || t('internalCa.common.unknown') }
function trustDomainName(value: unknown): string { return text(trustDomains.value.find((item) => text(item.id) === text(value))?.name, t('internalCa.common.unknown')) }
</script>

<template>
  <section class="internal-ca-page">
    <GcPageHeader :title="t('internalCa.title')" :description="t('internalCa.description')">
      <template #actions><button class="gc-button" type="button" :disabled="loading" @click="loadAll">{{ t('internalCa.actions.refresh') }}</button></template>
    </GcPageHeader>
    <div v-if="error" class="notice notice--danger">{{ error }}</div>
    <GcTabs v-model="activeTab" :tabs="tabs" :aria-label="t('internalCa.aria.tabs')" />

    <template v-if="activeTab === 'trustDomains'">
      <form class="gc-card form-card wide-form" @submit.prevent="createTrustDomain">
        <h2>{{ t('internalCa.sections.trustDomain') }}</h2>
        <label>{{ t('internalCa.fields.name') }}<input v-model="trustDomainDraft.name" required /></label>
        <label>{{ t('internalCa.fields.code') }}<input v-model="trustDomainDraft.code" required /></label>
        <label>{{ t('internalCa.fields.purpose') }}<input v-model="trustDomainDraft.purpose" required /></label>
        <label>{{ t('internalCa.fields.isolationLevel') }}<select v-model="trustDomainDraft.isolationLevel"><option value="standard">standard</option><option value="strict">strict</option><option value="regulated">regulated</option></select></label>
        <label class="check"><input v-model="trustDomainDraft.isDefault" type="checkbox" />{{ t('internalCa.fields.defaultTrustDomain') }}</label>
        <button class="gc-button gc-button--primary" :disabled="actionPending">{{ t('internalCa.actions.createTrustDomain') }}</button>
      </form>
      <div class="record-grid"><article v-for="item in trustDomains" :key="text(item.id)" class="gc-card record-card"><div><strong>{{ text(item.name) }}</strong><GcStatusTag :status="text(item.status)" /></div><p>{{ text(item.purpose) }}</p><small>{{ text(item.code) }} · {{ text(item.isolationLevel) }} · {{ item.isDefault ? t('internalCa.labels.defaultTrustDomain') : t('internalCa.labels.independentTrustDomain') }}</small></article></div>
    </template>

    <template v-else-if="activeTab === 'authorities'">
      <div class="authority-toolbar">
        <div><h2>{{ t('internalCa.sections.authorityOverview') }}</h2><p>{{ t('internalCa.sections.authorityOverviewDescription') }}</p></div>
        <button class="gc-button gc-button--primary" type="button" @click="openAuthorityWizard('root')">{{ t('internalCa.actions.addAuthority') }}</button>
      </div>
      <div v-if="rootAuthorities.length" class="root-ca-grid">
        <button v-for="root in rootAuthorities" :key="text(root.id)" type="button" class="root-ca-card gc-card" :class="{ 'is-selected': text(root.id) === text(selectedRoot?.id) }" @click="selectRoot(root)">
          <span class="root-ca-card__icon">CA</span>
          <span class="root-ca-card__body"><span class="root-ca-card__title"><strong>{{ text(root.name) }}</strong><GcStatusTag :status="text(root.status)" /></span><span>{{ text(root.subjectCommonName) }}</span><small>{{ trustDomainName(root.trustDomainId) }} · {{ text(root.securityDomain) }}</small></span>
          <span class="root-ca-card__metrics"><span>{{ t('internalCa.labels.intermediateCount', { count: authorities.filter((item) => text(item.parentCaId) === text(root.id)).length }) }}</span><small>{{ t('internalCa.labels.expiresAt', { time: localTime(root.notAfter) }) }}</small></span>
        </button>
      </div>
      <article v-if="selectedRoot" class="gc-card ca-architecture">
        <header class="ca-architecture__header"><div><span class="ca-architecture__eyebrow">{{ t('internalCa.sections.caArchitecture') }}</span><h2>{{ text(selectedRoot.name) }}</h2></div><button v-if="isEligibleParentRoot(selectedRoot)" class="gc-button" type="button" @click="openAuthorityWizard('intermediate', selectedRoot)">{{ t('internalCa.actions.addIntermediate') }}</button></header>
        <div class="ca-tree">
          <article class="ca-node ca-node--root"><span class="ca-node__role">{{ t('internalCa.labels.rootAuthority') }}</span><strong>{{ text(selectedRoot.name) }}</strong><span>{{ text(selectedRoot.subjectCommonName) }}</span><small>{{ text(selectedRoot.providerId) }} · {{ localTime(selectedRoot.notAfter) }}</small></article>
          <div v-if="selectedIntermediates.length" class="ca-tree__connector"><span></span></div>
          <div v-if="selectedIntermediates.length" class="ca-tree__children">
            <article v-for="item in selectedIntermediates" :key="text(item.id)" class="ca-node ca-node--intermediate"><span class="ca-node__role">{{ t('internalCa.labels.intermediateAuthority') }}</span><strong>{{ text(item.name) }}</strong><span>{{ text(item.subjectCommonName) }}</span><small>{{ text(item.securityDomain) }} · {{ localTime(item.notAfter) }}</small><GcStatusTag :status="text(item.status)" /></article>
          </div>
          <div v-else class="ca-tree__empty"><p>{{ t('internalCa.messages.noIntermediate') }}</p><button v-if="isEligibleParentRoot(selectedRoot)" class="gc-button gc-button--primary" type="button" @click="openAuthorityWizard('intermediate', selectedRoot)">{{ t('internalCa.actions.addIntermediate') }}</button></div>
        </div>
      </article>
      <article v-else class="gc-card ca-empty"><h2>{{ t('internalCa.messages.noRootAuthority') }}</h2><p>{{ t('internalCa.messages.noRootAuthorityDescription') }}</p><button class="gc-button gc-button--primary" type="button" @click="openAuthorityWizard('root')">{{ t('internalCa.actions.addAuthority') }}</button></article>
      <details class="gc-card provider-settings">
        <summary>{{ t('internalCa.sections.issuingBackends') }}</summary>
        <section class="adcs-agent-install">
          <div><strong>{{ t('internalCa.adcsAgent.title') }}</strong><p>{{ t('internalCa.adcsAgent.description') }}</p><small>{{ t('internalCa.adcsAgent.providerCount', { count: adcsProviders.length }) }}</small></div>
          <button class="gc-button gc-button--primary" type="button" :disabled="actionPending" @click="openAdcsWizard">{{ t('internalCa.adcsAgent.addProvider') }}</button>
        </section>
        <div class="provider-settings__list"><article v-for="provider in providers" :key="text(provider.id)" class="provider-summary"><div><strong>{{ text(provider.name) }}</strong><span>{{ providerTypeLabel(provider.type) }}</span></div><GcStatusTag :status="text(provider.status)" /><small>{{ t('internalCa.labels.backendUsageCount', { count: authorities.filter((item) => text(item.providerId) === text(provider.id)).length }) }}</small><small>{{ t('internalCa.labels.unverifiedCapabilityCount', { count: capabilityCount(provider, 'declared') }) }}</small><GcConfirmAction v-if="text(provider.type) === 'microsoft_adcs'" :action-name="deletingProviderId === text(provider.id) ? t('internalCa.adcsAgent.deletingProvider') : t('internalCa.adcsAgent.deleteProvider')" :impact-count="nodes.filter((item) => text(item.providerId) === text(provider.id)).length" :risk-text="t('internalCa.adcsAgent.deleteProviderRisk')" :confirm-text="t('internalCa.adcsAgent.deleteConfirmText')" :disabled="authorities.some((item) => text(item.providerId) === text(provider.id)) || Boolean(deletingProviderId)" :disabled-reason="authorities.some((item) => text(item.providerId) === text(provider.id)) ? t('internalCa.adcsAgent.deleteProviderBlocked') : ''" @confirm="deleteProvider(provider)" /></article></div>
      </details>
    </template>

    <template v-else-if="activeTab === 'profiles'">
      <form class="gc-card form-card wide-form" @submit.prevent="createProfile"><h2>{{ t('internalCa.sections.profile') }}</h2><label>{{ t('internalCa.fields.name') }}<input v-model="profileDraft.name" required /></label><label>{{ t('internalCa.fields.trustDomain') }}<select v-model="profileDraft.trustDomainId" required><option v-for="item in trustDomains" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label><label>{{ t('internalCa.fields.securityDomain') }}<input v-model="profileDraft.securityDomain" /></label><label>{{ t('internalCa.fields.dnsSuffixes') }}<input v-model="profileDraft.allowedDnsSuffix" :placeholder="t('internalCa.placeholders.dnsSuffixes')" /></label><label>{{ t('internalCa.fields.validityDays') }}<input v-model.number="profileDraft.maximumValidityDays" type="number" min="1" /></label><label>{{ t('internalCa.fields.renewalDays') }}<input v-model.number="profileDraft.renewalWindowDays" type="number" min="1" /></label><label class="check"><input v-model="profileDraft.requireApproval" type="checkbox" />{{ t('internalCa.fields.requireApproval') }}</label><button class="gc-button gc-button--primary">{{ t('internalCa.actions.createProfile') }}</button></form>
      <div class="record-grid"><article v-for="item in profiles" :key="text(item.profile && (item.profile as InternalCaRecord).id)" class="gc-card record-card"><strong>{{ text(item.profile && (item.profile as InternalCaRecord).name) }}</strong><p>{{ text(item.profile && (item.profile as InternalCaRecord).securityDomain) }}</p><small>{{ t('internalCa.labels.versionCount', { count: asRecords(item.versions).length }) }}</small></article></div>
    </template>

    <template v-else-if="activeTab === 'requests'">
      <form class="gc-card form-card wide-form" @submit.prevent="createRequest"><h2>{{ t('internalCa.sections.request') }}</h2><label>{{ t('internalCa.fields.applicationAssetId') }}<input v-model="requestDraft.applicationAssetId" required /></label><label>{{ t('internalCa.fields.trustDomain') }}<select v-model="requestDraft.trustDomainId" required><option v-for="item in trustDomains" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label><label>{{ t('internalCa.fields.authority') }}<select v-model="requestDraft.caId"><option v-for="item in requestAuthorities" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label><label>{{ t('internalCa.fields.profileVersionId') }}<select v-model="requestDraft.profileVersionId" required><option v-for="item in requestProfileVersions" :key="text(item.id)" :value="text(item.id)">{{ text(item.profileName) }} · v{{ number(item.versionNo) }}</option></select></label><label>{{ t('internalCa.fields.commonName') }}<input v-model="requestDraft.commonName" required /></label><label>{{ t('internalCa.fields.sans') }}<input v-model="requestDraft.sans" :placeholder="t('internalCa.placeholders.sans')" /></label><label>{{ t('internalCa.fields.custodyMode') }}<select v-model="requestDraft.custodyMode"><option value="managed_secret">managed_secret</option><option value="local_agent">local_agent</option><option value="device_local">device_local</option><option value="external_key">external_key</option></select></label><button class="gc-button gc-button--primary">{{ t('internalCa.actions.createRequest') }}</button></form>
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
      <div class="record-grid"><article v-for="item in reuseRisks" :key="text(item.id)" class="gc-card record-card"><div><strong>{{ t(`internalCa.riskTypes.${text(item.riskType)}`) }}</strong><GcStatusTag :status="text(item.severity)" /></div><p>{{ text(item.explanation) }}</p><small>{{ t('internalCa.labels.assetCount', { count: asRecords(item.applicationAssets).length }) }} · {{ t('internalCa.labels.trustDomainCount', { count: asRecords(item.trustDomainIds).length }) }} · {{ text(item.fingerprintSha256).slice(0, 16) }}</small><small v-if="asRecords(item.trustDomainNames).length">{{ asRecords(item.trustDomainNames).join(' · ') }}</small><button class="gc-button" @click="previewRemediation(text(item.id))">{{ t('internalCa.actions.previewRemediation') }}</button></article></div>
      <article v-if="remediationPreview" class="gc-card"><h2>{{ t('internalCa.sections.remediation') }}</h2><p>{{ t('internalCa.labels.requestCount', { count: asRecords(remediationPreview.requests).length }) }}</p><pre>{{ JSON.stringify(remediationPreview, null, 2) }}</pre></article>
    </template>

    <GcModal v-model:open="adcsWizardOpen" size="lg" :title="t('internalCa.adcsAgent.wizardTitle')" :description="t('internalCa.adcsAgent.wizardDescription')">
      <form v-if="!adcsInstallSession" class="adcs-wizard" @submit.prevent="createAdcsAgentInstallSession">
        <article class="adcs-wizard__requirements"><strong>{{ t('internalCa.adcsAgent.requirementsTitle') }}</strong><ul><li>{{ t('internalCa.adcsAgent.requirementInstalled') }}</li><li>{{ t('internalCa.adcsAgent.requirementConfigured') }}</li><li>{{ t('internalCa.adcsAgent.requirementService') }}</li><li>{{ t('internalCa.adcsAgent.requirementPermission') }}</li></ul></article>
        <label>{{ t('internalCa.adcsAgent.connectionName') }}<input v-model="adcsDraft.name" required /></label>
        <article class="adcs-wizard__compatibility"><strong>{{ t('internalCa.adcsAgent.coexistenceTitle') }}</strong><p>{{ t('internalCa.adcsAgent.coexistenceDescription') }}</p></article>
        <button class="ca-wizard__hidden-submit" tabindex="-1"></button>
      </form>
      <section v-else class="adcs-wizard adcs-wizard--result">
        <article class="ca-wizard__notice"><strong>{{ t('internalCa.adcsAgent.commandReadyTitle') }}</strong><p>{{ t('internalCa.adcsAgent.commandReadyDescription', { name: text((adcsInstallSession.provider as InternalCaRecord)?.name) }) }}</p></article>
        <code>{{ text(adcsInstallSession.installCommand) }}</code>
        <small>{{ t('internalCa.adcsAgent.expiresAt', { time: localTime(adcsInstallSession.expiresAt) }) }}</small>
      </section>
      <template #actions><button v-if="!adcsInstallSession" class="gc-button gc-button--primary" type="button" :disabled="actionPending || !adcsDraft.name.trim()" @click="createAdcsAgentInstallSession">{{ t('internalCa.adcsAgent.createCommand') }}</button><button v-else class="gc-button gc-button--primary" type="button" @click="adcsWizardOpen = false">{{ t('common.actions.done') }}</button></template>
    </GcModal>

    <GcModal v-model:open="authorityWizardOpen" size="xl" :title="t('internalCa.wizard.title')" :description="t('internalCa.wizard.description')">
      <div class="ca-wizard">
        <div class="ca-wizard__progress"><div class="ca-wizard__progress-bar"><span :style="{ width: wizardProgress }"></span></div><ol :aria-label="t('internalCa.wizard.stepsAria')"><li v-for="step in wizardStepCount" :key="step" :class="{ 'is-active': authorityWizardStep === step, 'is-complete': authorityWizardStep > step }"><span>{{ step }}</span><div><strong>{{ authorityWizardStepLabel(step) }}</strong><small>{{ t(authorityWizardStep > step ? 'internalCa.wizard.completed' : authorityWizardStep === step ? 'internalCa.wizard.inProgress' : 'internalCa.wizard.pending') }}</small></div></li></ol></div>

        <section v-if="authorityCreationKind === 'root' && authorityWizardStep === 1" class="ca-wizard__panel">
          <header class="ca-wizard__panel-heading"><span>{{ t('internalCa.wizard.entryEyebrow') }}</span><h3>{{ t('internalCa.wizard.entryTitle') }}</h3><p>{{ t('internalCa.wizard.entryDescription') }}</p></header>
          <div class="ca-wizard__entry-grid">
            <button type="button" class="ca-entry-card ca-entry-card--recommended" @click="chooseAuthorityMode('builtin')"><span class="ca-entry-card__badge">{{ t('internalCa.wizard.recommended') }}</span><span class="ca-entry-card__icon">CA</span><strong>{{ t('internalCa.wizard.builtinTitle') }}</strong><p>{{ t('internalCa.wizard.builtinDescription') }}</p><ul><li>{{ t('internalCa.wizard.builtinFeature1') }}</li><li>{{ t('internalCa.wizard.builtinFeature2') }}</li></ul></button>
            <button type="button" class="ca-entry-card" @click="chooseAuthorityMode('managed_node')"><span class="ca-entry-card__icon">N</span><strong>{{ t('internalCa.wizard.managedTitle') }}</strong><p>{{ t('internalCa.wizard.managedDescription') }}</p><ul><li>{{ t('internalCa.wizard.managedFeature1') }}</li><li>{{ t('internalCa.wizard.managedFeature2') }}</li></ul></button>
            <button type="button" class="ca-entry-card" @click="chooseAuthorityMode('external')"><span class="ca-entry-card__icon">E</span><strong>{{ t('internalCa.wizard.externalTitle') }}</strong><p>{{ t('internalCa.wizard.externalDescription') }}</p><ul><li>{{ t('internalCa.wizard.externalFeature1') }}</li><li>{{ t('internalCa.wizard.externalFeature2') }}</li></ul></button>
          </div>
        </section>

        <form v-else-if="authorityCreationKind === 'root' && authorityWizardStep === 2" ref="authorityWizardForm" class="ca-wizard__panel ca-wizard__form" @submit.prevent="advanceAuthorityWizard">
          <header class="ca-wizard__panel-heading ca-wizard__full"><span>{{ t('internalCa.wizard.backendEyebrow') }}</span><h3>{{ t(`internalCa.wizard.${authorityCreationMode}BackendTitle`) }}</h3><p>{{ t(`internalCa.wizard.${authorityCreationMode}BackendDescription`) }}</p></header>
          <article v-if="authorityCreationMode === 'builtin'" class="ca-wizard__notice ca-wizard__full"><strong>{{ t('internalCa.wizard.builtinAutomaticTitle') }}</strong><p>{{ t('internalCa.wizard.builtinAutomaticDescription') }}</p></article>
          <template v-else>
            <template v-if="authorityCreationMode === 'managed_node'">
              <label>{{ t('internalCa.fields.backendName') }}<input v-model="providerDraft.name" required /></label>
              <label>{{ t('internalCa.fields.platform') }}<select v-model="providerDraft.runtimePlatform" required><option value="windows">Windows</option><option value="linux">Linux</option></select></label>
              <label>{{ t('internalCa.fields.availabilityMode') }}<select v-model="providerDraft.availabilityMode"><option value="single">{{ t('internalCa.availability.single') }}</option><option value="active_standby">{{ t('internalCa.availability.activeStandby') }}</option><option value="active_active">{{ t('internalCa.availability.activeActive') }}</option></select></label>
            </template>
            <template v-else>
              <label class="ca-wizard__full">{{ t('internalCa.fields.providerType') }}<select v-model="providerDraft.type" required><option value="microsoft_adcs">{{ t('internalCa.providerTypes.microsoft_adcs') }}</option><option value="acme">{{ t('internalCa.providerTypes.acme') }}</option><option value="est">{{ t('internalCa.providerTypes.est') }}</option><option value="scep">{{ t('internalCa.providerTypes.scep') }}</option><option value="product_adapter">{{ t('internalCa.providerTypes.product_adapter') }}</option></select></label>
              <template v-if="providerDraft.type === 'microsoft_adcs'">
                <label class="ca-wizard__full">{{ t('internalCa.fields.provider') }}<select v-model="authorityDraft.providerId" required @change="providerDraft.id = authorityDraft.providerId"><option value="" disabled>{{ t('internalCa.adcsAgent.description') }}</option><option v-for="provider in adcsProviders" :key="text(provider.id)" :value="text(provider.id)">{{ text(provider.name) }}</option></select></label>
                <article class="ca-wizard__notice ca-wizard__full" v-if="selectedProvider">
                  <strong>{{ text(selectedProvider.name) }}</strong>
                  <p>{{ text(selectedAdcsDiscovery.caConfig, t('internalCa.common.unknown')) }} · {{ text(selectedAdcsDiscovery.caName, t('internalCa.common.unknown')) }}</p>
                  <small>{{ text(selectedAdcsNode?.name, t('internalCa.common.unknown')) }} · {{ text(selectedAdcsNode?.version, t('internalCa.common.unknown')) }}</small>
                  <small>{{ asRecords(selectedAdcsDiscovery.templates).join(', ') || t('internalCa.common.unknown') }}</small>
                </article>
                <p v-else class="ca-wizard__notice ca-wizard__full">{{ t('internalCa.adcsAgent.description') }}</p>
              </template>
              <template v-else>
                <label>{{ t('internalCa.fields.backendName') }}<input v-model="providerDraft.name" required /></label>
                <label class="ca-wizard__full">{{ t('internalCa.fields.endpoint') }}<input v-model="providerDraft.endpoint" type="url" required /></label>
                <label>{{ t('internalCa.fields.authMode') }}<select v-model="providerDraft.authMode"><option value="managed_secret">{{ t('internalCa.authModes.managedSecret') }}</option><option value="client_certificate">{{ t('internalCa.authModes.clientCertificate') }}</option><option value="none">{{ t('internalCa.authModes.none') }}</option></select></label>
                <label>{{ t('internalCa.fields.profile') }}<input v-model="providerDraft.profile" /></label>
                <label>{{ t('internalCa.fields.template') }}<input v-model="providerDraft.template" /></label>
                <label>{{ t('internalCa.fields.crlUrl') }}<input v-model="providerDraft.crlUrl" type="url" /></label>
                <label>{{ t('internalCa.fields.ocspUrl') }}<input v-model="providerDraft.ocspUrl" type="url" /></label>
              </template>
            </template>
          </template>
          <button class="ca-wizard__hidden-submit" tabindex="-1"></button>
        </form>

        <form v-else-if="(authorityCreationKind === 'root' && authorityWizardStep === 3) || (authorityCreationKind === 'intermediate' && authorityWizardStep < 3)" ref="authorityWizardForm" class="ca-wizard__panel ca-wizard__form" @submit.prevent="advanceAuthorityWizard">
          <header class="ca-wizard__panel-heading ca-wizard__full"><span>{{ t('internalCa.wizard.authorityEyebrow') }}</span><h3>{{ authorityCreationKind === 'root' ? t('internalCa.wizard.rootConfigurationTitle') : t('internalCa.wizard.intermediateConfigurationTitle') }}</h3><p>{{ authorityCreationKind === 'root' ? t('internalCa.wizard.rootConfigurationDescription') : t('internalCa.wizard.intermediateConfigurationDescription') }}</p></header>
          <label v-if="authorityCreationKind === 'intermediate' && authorityWizardStep === 1" class="ca-wizard__full">{{ t('internalCa.fields.parentAuthority') }}<select :value="authorityDraft.parentCaId" required @change="selectParentRoot(($event.target as HTMLSelectElement).value)"><option v-for="item in eligibleParentRoots" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
          <template v-else>
            <label v-if="authorityCreationKind === 'root'">{{ t('internalCa.fields.trustDomain') }}<select v-model="authorityDraft.trustDomainId" required><option v-for="item in trustDomains" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
            <label>{{ t('internalCa.fields.name') }}<input v-model="authorityDraft.name" required /></label>
            <label>{{ t('internalCa.fields.commonName') }}<input v-model="authorityDraft.commonName" required /></label>
            <label>{{ t('internalCa.fields.securityDomain') }}<input v-model="authorityDraft.securityDomain" required /></label>
            <label v-if="authorityCreationKind === 'root'">{{ t('internalCa.fields.topology') }}<select v-model="authorityDraft.topologyMode"><option value="root_only">{{ t('internalCa.topology.rootOnly') }}</option><option value="root_with_intermediate">{{ t('internalCa.topology.intermediate') }}</option></select></label>
            <article class="ca-wizard__backend-summary ca-wizard__full"><span>{{ t('internalCa.fields.issuingBackend') }}</span><strong>{{ authorityCreationKind === 'intermediate' ? providerTypeLabel(selectedProvider?.type) : t(`internalCa.wizard.${authorityCreationMode}Title`) }}</strong><small>{{ t(`internalCa.wizard.${selectedCreationMode}SecurityNote`) }}</small></article>
          </template>
          <button class="ca-wizard__hidden-submit" tabindex="-1"></button>
        </form>

        <section v-else class="ca-wizard__panel ca-wizard__review">
          <header class="ca-wizard__panel-heading"><span>{{ t('internalCa.wizard.reviewEyebrow') }}</span><h3>{{ t('internalCa.wizard.reviewTitle') }}</h3><p>{{ t('internalCa.wizard.reviewDescription') }}</p></header>
          <div class="ca-wizard__review-grid"><span>{{ t('internalCa.fields.entryMode') }}</span><strong>{{ t(`internalCa.wizard.${selectedCreationMode}Title`) }}</strong><span>{{ t('internalCa.fields.authorityType') }}</span><strong>{{ authorityCreationKind === 'root' ? t('internalCa.wizard.rootTitle') : t('internalCa.wizard.intermediateTitle') }}</strong><span>{{ t('internalCa.fields.name') }}</span><strong>{{ authorityDraft.name }}</strong><span>{{ t('internalCa.fields.commonName') }}</span><strong>{{ authorityDraft.commonName }}</strong><span>{{ t('internalCa.fields.trustDomain') }}</span><strong>{{ trustDomainName(authorityDraft.trustDomainId) }}</strong></div>
          <article v-if="selectedCreationMode === 'managed_node' && providerEnrollment" class="ca-wizard__enrollment"><strong>{{ t('internalCa.wizard.enrollmentTitle') }}</strong><p>{{ t('internalCa.wizard.enrollmentDescription') }}</p><code>{{ text(providerEnrollment.token) }}</code><small>{{ t('internalCa.wizard.enrollmentExpiresAt', { time: localTime(providerEnrollment.expiresAt) }) }}</small></article>
          <article class="ca-wizard__risk"><strong>{{ t('internalCa.sections.riskSummary') }}</strong><p>{{ text(authorityPreview?.overallRecommendation) }}</p><ul><li v-for="warning in asRecords(authorityPreview?.warnings)" :key="String(warning)">{{ warning }}</li></ul><p v-if="!asRecords(authorityPreview?.warnings).length">{{ t('internalCa.wizard.noWarnings') }}</p></article>
        </section>
      </div>
      <template #actions><button v-if="authorityWizardStep > 1" class="gc-button" type="button" :disabled="actionPending" @click="previousAuthorityWizardStep">{{ t('internalCa.actions.previous') }}</button><button v-if="authorityWizardStep < wizardStepCount" class="gc-button gc-button--primary" type="button" :disabled="actionPending || (authorityCreationKind === 'intermediate' && authorityWizardStep === 1 && !authorityDraft.parentCaId)" @click="advanceAuthorityWizard">{{ t('internalCa.actions.next') }}</button><button v-else class="gc-button gc-button--primary" type="button" :disabled="actionPending" @click="createAuthority">{{ t('internalCa.actions.createAuthority') }}</button></template>
    </GcModal>
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
.authority-toolbar, .ca-architecture__header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.authority-toolbar h2, .authority-toolbar p, .ca-architecture__header h2 { margin: 0; }
.authority-toolbar p { margin-top: var(--gc-space-1); color: var(--gc-color-text-muted); }
.root-ca-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); }
.root-ca-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gc-space-3); padding: var(--gc-space-4); text-align: left; color: var(--gc-color-text); cursor: pointer; transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease; }
.root-ca-card:hover { transform: translateY(calc(var(--gc-space-hairline) * -1)); border-color: var(--gc-color-primary-border); box-shadow: var(--gc-shadow-hover); }
.root-ca-card.is-selected { border-color: var(--gc-color-primary); background: var(--gc-color-surface-selected); box-shadow: var(--gc-shadow-focus); }
.root-ca-card__icon { display: grid; place-items: center; width: var(--gc-control-height-md); aspect-ratio: 1; border-radius: var(--gc-radius-lg); color: var(--gc-color-text-inverse); background: var(--gc-gradient-primary); font-weight: 700; }
.root-ca-card__body, .root-ca-card__metrics { display: grid; gap: var(--gc-space-1); min-width: 0; }
.root-ca-card__title { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-2); }
.root-ca-card__body > span, .root-ca-card__body small, .root-ca-card__metrics { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-ca-card__body small, .root-ca-card__metrics small, .ca-node small { color: var(--gc-color-text-soft); }
.root-ca-card__metrics { grid-column: 2; padding-top: var(--gc-space-2); border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.ca-architecture { padding: var(--gc-space-5); overflow: hidden; }
.ca-architecture__eyebrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: 700; text-transform: uppercase; }
.ca-tree { display: grid; justify-items: center; margin-top: var(--gc-space-6); }
.ca-node { display: grid; gap: var(--gc-space-1); width: min(100%, calc(var(--gc-size-card-min) * 1.35)); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-raised); box-shadow: var(--gc-shadow-sm); text-align: center; }
.ca-node--root { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); }
.ca-node--intermediate { position: relative; border-color: var(--gc-color-info-border); }
.ca-node__role { color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: 700; }
.ca-tree__connector { display: grid; justify-items: center; width: 100%; min-height: var(--gc-space-8); }
.ca-tree__connector::before { content: ''; width: var(--gc-border-width-default); height: var(--gc-space-4); background: var(--gc-color-border-strong); }
.ca-tree__connector span { align-self: end; width: min(72%, calc(var(--gc-size-card-min) * 2)); height: var(--gc-border-width-default); background: var(--gc-color-border-strong); }
.ca-tree__children { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); width: 100%; }
.ca-tree__children .ca-node::before { content: ''; position: absolute; inset-inline-start: 50%; bottom: 100%; width: var(--gc-border-width-default); height: var(--gc-space-4); background: var(--gc-color-border-strong); }
.ca-tree__empty, .ca-empty { display: grid; justify-items: center; gap: var(--gc-space-3); padding: var(--gc-space-6); text-align: center; color: var(--gc-color-text-muted); }
.ca-empty h2, .ca-empty p, .ca-tree__empty p { margin: 0; }
.provider-settings { padding: var(--gc-space-4); }
.provider-settings summary { cursor: pointer; color: var(--gc-color-text-strong); font-weight: 700; }
.provider-settings__list { display: grid; gap: var(--gc-space-3); margin-top: var(--gc-space-4); }
.adcs-agent-install { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--gc-space-4); align-items: center; margin-top: var(--gc-space-4); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); }
.adcs-agent-install p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.adcs-agent-install small { display: block; margin-top: var(--gc-space-2); color: var(--gc-color-text-soft); }
.adcs-agent-install__command { grid-column: 1 / -1; display: grid; gap: var(--gc-space-2); }
.adcs-agent-install__command code { overflow-wrap: anywhere; padding: var(--gc-space-3); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text-strong); }
.adcs-wizard { display: grid; gap: var(--gc-space-4); }
.adcs-wizard__requirements, .adcs-wizard__compatibility { padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); }
.adcs-wizard__requirements ul { margin: var(--gc-space-3) 0 0; padding-left: var(--gc-space-5); color: var(--gc-color-text-muted); }
.adcs-wizard__requirements li + li { margin-top: var(--gc-space-2); }
.adcs-wizard__compatibility p { margin: var(--gc-space-2) 0 0; color: var(--gc-color-text-muted); }
.adcs-wizard--result code { overflow-wrap: anywhere; padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); color: var(--gc-color-text-strong); }
.adcs-wizard--result small { color: var(--gc-color-text-muted); }
.provider-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); }
.provider-summary div { display: grid; gap: var(--gc-space-1); }
.provider-summary span, .provider-summary small { color: var(--gc-color-text-muted); }
.ca-wizard { display: grid; gap: var(--gc-space-5); }
.ca-wizard__progress { display: grid; gap: var(--gc-space-3); }
.ca-wizard__progress-bar { height: var(--gc-space-1); overflow: hidden; border-radius: var(--gc-radius-xl); background: var(--gc-color-surface-muted); }
.ca-wizard__progress-bar span { display: block; height: 100%; border-radius: inherit; background: var(--gc-color-primary); transition: width .16s ease; }
.ca-wizard__progress ol { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.ca-wizard__progress li { display: flex; align-items: center; gap: var(--gc-space-2); min-width: 0; color: var(--gc-color-text-muted); }
.ca-wizard__progress li > span { display: grid; flex: 0 0 auto; place-items: center; width: var(--gc-space-7); aspect-ratio: 1; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-xl); background: var(--gc-color-surface-field); font-weight: 700; }
.ca-wizard__progress li div { display: grid; min-width: 0; }
.ca-wizard__progress li strong, .ca-wizard__progress li small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-wizard__progress li.is-active { color: var(--gc-color-primary); }
.ca-wizard__progress li.is-active > span { border-color: var(--gc-color-primary); background: var(--gc-color-primary-soft); box-shadow: var(--gc-shadow-focus); }
.ca-wizard__progress li.is-complete { color: var(--gc-color-success); }
.ca-wizard__progress li.is-complete > span { border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.ca-wizard__panel { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-5); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-raised); }
.ca-wizard__panel-heading { display: grid; gap: var(--gc-space-2); }
.ca-wizard__panel-heading span { color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.ca-wizard__panel-heading h3, .ca-wizard__panel-heading p { margin: 0; }
.ca-wizard__panel-heading p { color: var(--gc-color-text-muted); }
.ca-wizard__entry-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-4); }
.ca-entry-card { position: relative; display: grid; align-content: start; justify-items: start; gap: var(--gc-space-3); min-height: var(--gc-size-card-min); padding: var(--gc-space-5); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-lg); color: var(--gc-color-text); background: var(--gc-color-surface-raised); text-align: left; cursor: pointer; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
.ca-entry-card:hover { border-color: var(--gc-color-primary); background: var(--gc-color-surface-selected); transform: translateY(calc(var(--gc-space-1) * -1)); }
.ca-entry-card--recommended { border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.ca-entry-card__badge { position: absolute; inset-block-start: var(--gc-space-3); inset-inline-end: var(--gc-space-3); padding: var(--gc-space-1) var(--gc-space-2); border-radius: var(--gc-radius-xl); color: var(--gc-color-success); background: var(--gc-color-success-soft); font-size: var(--gc-font-size-xs); font-weight: 700; }
.ca-entry-card__icon { display: grid; place-items: center; width: var(--gc-space-10); aspect-ratio: 1; border-radius: var(--gc-radius-lg); color: var(--gc-color-primary); background: var(--gc-color-primary-soft); font-weight: 800; }
.ca-entry-card p { margin: 0; color: var(--gc-color-text-muted); }
.ca-entry-card ul { display: grid; gap: var(--gc-space-2); margin: 0; padding-inline-start: var(--gc-space-5); color: var(--gc-color-text-muted); }
.ca-wizard__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.ca-wizard__full { grid-column: 1 / -1; }
.ca-wizard__hidden-submit { position: absolute; width: 0; height: 0; padding: 0; border: 0; overflow: hidden; }
.ca-wizard__review { display: grid; gap: var(--gc-space-4); }
.ca-wizard__review-grid { display: grid; grid-template-columns: minmax(0, .65fr) minmax(0, 1.35fr); gap: var(--gc-space-2) var(--gc-space-4); padding: var(--gc-space-4); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-muted); }
.ca-wizard__review-grid span { color: var(--gc-color-text-muted); }
.ca-wizard__notice, .ca-wizard__backend-summary, .ca-wizard__enrollment { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-lg); background: var(--gc-color-info-bg); }
.ca-wizard__notice p, .ca-wizard__backend-summary small, .ca-wizard__enrollment p, .ca-wizard__enrollment small { margin: 0; color: var(--gc-color-text-muted); }
.ca-wizard__backend-summary span { color: var(--gc-color-text-muted); }
.ca-wizard__enrollment { border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.ca-wizard__enrollment code { overflow-wrap: anywhere; padding: var(--gc-space-3); border-radius: var(--gc-radius-md); color: var(--gc-color-text-strong); background: var(--gc-color-surface-field); }
.ca-wizard__risk { padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-lg); background: var(--gc-color-warning-bg); }
.ca-wizard__risk p { color: var(--gc-color-text-muted); }
@media (max-width: 48rem) {
  .authority-toolbar, .ca-architecture__header { align-items: stretch; flex-direction: column; }
  .ca-wizard__entry-grid, .ca-wizard__form, .ca-tree__children { grid-template-columns: 1fr; }
  .ca-wizard__progress ol { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .provider-summary { grid-template-columns: minmax(0, 1fr) auto; }
  .provider-summary small { grid-column: 1 / -1; }
  .ca-tree__connector span { width: var(--gc-border-width-default); height: var(--gc-space-4); }
}
</style>
