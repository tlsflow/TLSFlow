<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { GcDataTable, GcModal, GcPageHeader, GcStatusTag } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const loading = ref(false)
const actionPending = ref(false)
const error = ref('')
const providers = ref<InternalCaRecord[]>([])
const trustDomains = ref<InternalCaRecord[]>([])
const authorities = ref<InternalCaRecord[]>([])
const profiles = ref<InternalCaRecord[]>([])
const requests = ref<InternalCaRecord[]>([])
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
const authorityCreationMode = ref<'builtin' | 'managed_node'>('builtin')
const selectedRootId = ref('')
const authorityWizardForm = ref<HTMLFormElement | null>(null)
const backendEnrollment = ref<InternalCaRecord | null>(null)
const backendPrepared = ref(false)
const trustDomainModalOpen = ref(false)
const requestModalOpen = ref(false)
const profileModalOpen = ref(false)

const backendDraft = reactive({ id: '', name: '', type: 'gcac_managed_node', deploymentMode: 'managed_node', runtimePlatform: 'linux', availabilityMode: 'single', endpoint: '', authMode: 'enrollment_token', profile: '', template: '', crlUrl: '', ocspUrl: '' })
const trustDomainDraft = reactive({ name: '', purpose: 'production_tls', isolationLevel: 'standard', isDefault: false })
const authorityDraft = reactive({ providerId: '', trustDomainId: '', parentCaId: '', name: '', commonName: '', securityDomain: 'production', topologyMode: 'root_with_intermediate', keyBackend: 'secret' })
const profileDraft = reactive({ name: '', trustDomainId: '', securityDomain: 'production', allowedDnsSuffix: '', maximumValidityDays: 90, renewalWindowDays: 30, requireApproval: true })
const requestDraft = reactive({ applicationAssetId: '', trustDomainId: '', caId: '', profileVersionId: '', commonName: '', sans: '', custodyMode: 'managed_secret' })
const revocationDraft = reactive({ certificateVersionId: '', reason: 'keyCompromise' })
const trustDraft = reactive({ caId: '', targetIds: '', platform: 'linux' })

const selectedBackend = computed(() => providers.value.find((item) => text(item.id) === authorityDraft.providerId))
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
  deploymentMode: text(selectedBackend.value?.deploymentMode, backendDraft.deploymentMode),
  runtimePlatform: text(selectedBackend.value?.runtimePlatform, backendDraft.runtimePlatform),
  availabilityMode: text(selectedBackend.value?.availabilityMode, backendDraft.availabilityMode),
  keyBackend: authorityDraft.keyBackend,
}))

const wizardStepCount = computed(() => authorityCreationKind.value === 'intermediate' ? 3 : 4)
const wizardProgress = computed(() => `${(authorityWizardStep.value / wizardStepCount.value) * 100}%`)
const builtinBackend = computed(() => providers.value.find((item) => text(item.type) === 'gcac_builtin'))
const recentRequests = computed(() => requests.value.slice(0, 20))
const selectedCreationMode = computed(() => {
  if (authorityCreationKind.value === 'intermediate') {
    const provider = providers.value.find((item) => text(item.id) === authorityDraft.providerId)
    if (text(provider?.type) === 'gcac_managed_node') return 'managed_node'
  }
  return authorityCreationMode.value === 'managed_node' ? 'managed_node' : 'builtin'
})
const trustDomainColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'name', title: t('internalCa.trustDomains.columns.name'), width: '22%' },
  { key: 'purpose', title: t('internalCa.trustDomains.columns.purpose'), width: '18%' },
  { key: 'isolationLevel', title: t('internalCa.trustDomains.columns.isolationLevel'), width: '18%' },
  { key: 'status', title: t('internalCa.trustDomains.columns.status'), width: '14%' },
  { key: 'isDefault', title: t('internalCa.trustDomains.columns.default'), width: '14%' },
  { key: 'createdAt', title: t('internalCa.trustDomains.columns.createdAt') },
])
const requestColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'subjectCommonName', title: t('internalCa.requests.columns.commonName'), width: '24%' },
  { key: 'applicationAssetId', title: t('internalCa.requests.columns.applicationAssetId'), width: '24%' },
  { key: 'status', title: t('internalCa.trustDomains.columns.status'), width: '16%' },
  { key: 'updatedAt', title: t('internalCa.requests.columns.updatedAt'), width: '20%' },
  { key: 'actions', title: t('internalCa.requests.columns.actions'), width: '16%' },
])
const profileColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'name', title: t('internalCa.trustDomains.columns.name'), width: '28%' },
  { key: 'securityDomain', title: t('internalCa.profiles.columns.securityDomain'), width: '24%' },
  { key: 'versionCount', title: t('internalCa.profiles.columns.versionCount'), width: '24%' },
  { key: 'status', title: t('internalCa.trustDomains.columns.status'), width: '24%' },
])

onMounted(loadAll)

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [providerResult, trustDomainResult, authorityResult, profileResult, requestResult, renewalResult, revocationResult, trustResult, riskResult, overviewResult] = await Promise.all([
      internalCaApi.listProviders(), internalCaApi.listTrustDomains(), internalCaApi.listAuthorities(), internalCaApi.listProfiles(), internalCaApi.listRequests(),
      internalCaApi.listRenewals(), internalCaApi.listRevocations(), internalCaApi.listTrustDistributions(), internalCaApi.listReuseRisks(), internalCaApi.reuseRiskOverview(),
    ])
    providers.value = providerResult.data ?? []
    trustDomains.value = trustDomainResult.data ?? []
    authorities.value = authorityResult.data ?? []
    profiles.value = profileResult.data ?? []
    requests.value = requestResult.data ?? []
    renewals.value = renewalResult.data ?? []
    revocations.value = revocationResult.data ?? []
    trustDistributions.value = trustResult.data ?? []
    reuseRisks.value = riskResult.data ?? []
    riskOverview.value = overviewResult.data ?? {}
    authorityDraft.providerId ||= text(builtinBackend.value?.id)
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

async function runAction(action: () => Promise<unknown>, successKey: string): Promise<boolean> {
  actionPending.value = true
  error.value = ''
  try {
    await action()
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t(successKey), tone: 'success' } }))
    return true
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('internalCa.messages.actionFailed')
    return false
  } finally {
    actionPending.value = false
  }
}

function openTrustDomainModal() {
  Object.assign(trustDomainDraft, { name: '', purpose: 'production_tls', isolationLevel: 'standard', isDefault: false })
  error.value = ''
  trustDomainModalOpen.value = true
}

async function createTrustDomain() {
  const created = await runAction(() => internalCaApi.createTrustDomain({
    name: trustDomainDraft.name.trim(),
    purpose: trustDomainDraft.purpose.trim(),
    isolationLevel: trustDomainDraft.isolationLevel,
    isDefault: trustDomainDraft.isDefault,
  }), 'internalCa.messages.trustDomainCreated')
  if (created) trustDomainModalOpen.value = false
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
    await prepareBackend()
    if (!backendPrepared.value) return
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
  backendEnrollment.value = null
  backendPrepared.value = false
  authorityWizardOpen.value = false
}

function openAuthorityWizard(kind: 'root' | 'intermediate' = 'root', parent?: InternalCaRecord) {
  authorityCreationKind.value = kind
  authorityWizardStep.value = 1
  authorityPreview.value = null
  backendEnrollment.value = null
  backendPrepared.value = false
  authorityCreationMode.value = kind === 'intermediate' ? selectedCreationMode.value : 'builtin'
  backendDraft.id = ''
  backendDraft.name = ''
  backendDraft.endpoint = ''
  backendDraft.profile = ''
  backendDraft.template = ''
  backendDraft.crlUrl = ''
  backendDraft.ocspUrl = ''
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

function chooseAuthorityMode(mode: 'builtin' | 'managed_node') {
  const modeChanged = authorityCreationMode.value !== mode
  authorityCreationMode.value = mode
  backendPrepared.value = false
  backendEnrollment.value = null
  if (modeChanged) {
    backendDraft.id = ''
    authorityDraft.providerId = mode === 'builtin' ? text(builtinBackend.value?.id) : ''
  }
  authorityWizardStep.value = 2
  if (mode === 'builtin') {
    authorityDraft.providerId = text(builtinBackend.value?.id)
    backendDraft.type = 'gcac_builtin'
    backendDraft.deploymentMode = 'builtin'
    backendDraft.runtimePlatform = 'embedded'
    return
  }
  backendDraft.type = 'gcac_managed_node'
  backendDraft.deploymentMode = 'managed_node'
  backendDraft.runtimePlatform = 'linux'
}

function applyParentRoot(parent?: InternalCaRecord) {
  if (!parent) return
  authorityDraft.parentCaId = text(parent.id)
  authorityDraft.providerId = text(parent.providerId)
  authorityDraft.trustDomainId = text(parent.trustDomainId)
  authorityDraft.securityDomain = text(parent.securityDomain, 'production')
  authorityDraft.topologyMode = 'root_with_intermediate'
  authorityCreationMode.value = text(providers.value.find((item) => text(item.id) === text(parent.providerId))?.type) === 'gcac_managed_node'
    ? 'managed_node'
    : 'builtin'
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
    await prepareBackend()
    if (backendPrepared.value) authorityWizardStep.value = 3
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

function backendModeLabel(backend: InternalCaRecord): string {
  const mode = text(backend.deploymentMode)
  if (mode === 'managed_node') return t('internalCa.wizard.managedTitle')
  if (mode === 'builtin') return t('internalCa.wizard.builtinTitle')
  return text(backend.protocol, t('common.notAvailable'))
}

function backendProtocolLabel(backend: InternalCaRecord): string {
  return text(backend.protocol, text(backend.profile, t('common.notAvailable')))
}

function capabilityCount(backend: InternalCaRecord, state: string): number {
  return asRecords(backend.capabilityRecords).filter((record) => text(record.state) === state).length
}

function capabilityLabel(capability: InternalCaRecord): string {
  return text(capability.key, text(capability.name, t('internalCa.common.unknown')))
}

function backendLabel(providerId: unknown): string {
  const backend = providers.value.find((item) => text(item.id) === text(providerId))
  return backend ? backendModeLabel(backend) : t('common.notAvailable')
}

async function prepareBackend() {
  if (backendPrepared.value || authorityCreationKind.value === 'intermediate') return
  actionPending.value = true
  try {
    if (authorityCreationMode.value === 'builtin') {
      authorityDraft.providerId = text(builtinBackend.value?.id)
      if (!authorityDraft.providerId) {
        const result = await internalCaApi.createProvider({ name: t('internalCa.wizard.builtinProviderName'), type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single' })
        authorityDraft.providerId = text(result.data?.id)
        await loadAll()
      }
      backendPrepared.value = Boolean(authorityDraft.providerId)
      return
    }
    if (!backendDraft.id) {
      if (!backendDraft.name.trim()) backendDraft.name = t('internalCa.wizard.managedProviderName')
      const provider = await internalCaApi.createProvider({
        name: backendDraft.name,
        type: 'gcac_managed_node',
        deploymentMode: 'managed_node',
        runtimePlatform: backendDraft.runtimePlatform,
        availabilityMode: backendDraft.availabilityMode,
        endpoint: backendDraft.endpoint,
        configuration: {
          authMode: backendDraft.authMode,
          profile: backendDraft.profile,
          template: backendDraft.template,
          crlUrl: backendDraft.crlUrl,
          ocspUrl: backendDraft.ocspUrl,
        },
      })
      backendDraft.id = text(provider.data?.id)
    }
    authorityDraft.providerId = backendDraft.id
    if (authorityDraft.providerId && !backendEnrollment.value) {
      backendEnrollment.value = (await internalCaApi.createNodeEnrollmentToken(authorityDraft.providerId, 30)).data ?? null
    }
    backendPrepared.value = Boolean(authorityDraft.providerId) && Boolean(backendEnrollment.value)
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
  const backend = providers.value.find((item) => text(item.id) === text(root.providerId))
  return text(root.role) === 'root' && number(root.pathLengthConstraint) > 0 && text(root.status) === 'active' && text(backend?.type) === 'gcac_builtin'
}

async function createProfile() {
  const ok = await runAction(() => internalCaApi.createProfile({
    name: profileDraft.name,
    trustDomainId: profileDraft.trustDomainId,
    securityDomain: profileDraft.securityDomain,
    rules: {
      allowedDnsSuffixes: splitList(profileDraft.allowedDnsSuffix), maximumValidityDays: profileDraft.maximumValidityDays,
      renewalWindowDays: profileDraft.renewalWindowDays, rotateKeyOnRenewal: true, requireApproval: profileDraft.requireApproval,
    },
  }), 'internalCa.messages.profileCreated')
  if (ok) profileModalOpen.value = false
}

async function createRequest() {
  const ok = await runAction(() => internalCaApi.createRequest({
    ...requestDraft, sans: splitList(requestDraft.sans), requestedValidityDays: 90,
  }), 'internalCa.messages.requestCreated')
  if (ok) requestModalOpen.value = false
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
  <section class="gc-page internal-ca-page">
    <GcPageHeader :title="t('internalCa.title')" :description="t('internalCa.description')">
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="loadAll">
          {{ loading ? t('common.loading') : t('internalCa.actions.refresh') }}
        </button>
      </template>
    </GcPageHeader>

    <div v-if="error" class="notice notice--danger" role="alert">
      <span>{{ error }}</span>
      <button class="gc-button gc-button--danger" type="button" :disabled="loading" @click="loadAll">{{ t('internalCa.actions.retry') }}</button>
    </div>

    <!-- Section: 证书机构 -->
    <details class="ca-section gc-card" open>
      <summary class="ca-section__header">
        <span class="ca-section__title">{{ t('internalCa.tabs.authorities') }}</span>
        <span class="ca-section__actions" @click.stop>
          <button class="gc-button gc-button--primary" type="button" @click="openAuthorityWizard('root')">{{ t('internalCa.actions.addAuthority') }}</button>
        </span>
      </summary>
      <div class="ca-section__body">
        <div v-if="rootAuthorities.length" class="root-ca-grid">
          <button v-for="root in rootAuthorities" :key="text(root.id)" type="button" class="root-ca-card gc-card" :class="{ 'is-selected': text(root.id) === text(selectedRoot?.id) }" @click="selectRoot(root)">
            <span class="root-ca-card__accent"></span>
            <span class="root-ca-card__body">
              <span class="root-ca-card__title">
                <strong>{{ text(root.name) }}</strong>
                <GcStatusTag :status="text(root.status)" />
              </span>
              <span class="root-ca-card__cn">{{ text(root.subjectCommonName) }}</span>
              <span class="root-ca-card__meta">{{ trustDomainName(root.trustDomainId) }} · {{ text(root.securityDomain) }}</span>
              <span class="root-ca-card__expiry">{{ t('internalCa.labels.expiresAt', { time: localTime(root.notAfter) }) }}</span>
            </span>
            <span class="root-ca-card__badge">{{ t('internalCa.labels.intermediateCount', { count: authorities.filter((item) => text(item.parentCaId) === text(root.id)).length }) }}</span>
          </button>
        </div>
        <article v-if="selectedRoot" class="ca-architecture">
          <header class="ca-architecture__header">
            <div>
              <span class="ca-architecture__eyebrow">{{ text(selectedRoot.name) }}</span>
              <p class="ca-architecture__desc">{{ t('internalCa.sections.caArchitecture') }}</p>
            </div>
            <button v-if="isEligibleParentRoot(selectedRoot)" class="gc-button gc-button--sm" type="button" @click="openAuthorityWizard('intermediate', selectedRoot)">{{ t('internalCa.actions.addIntermediate') }}</button>
          </header>
          <div class="ca-tree">
            <article class="ca-node ca-node--root">
              <span class="ca-node__badge">{{ t('internalCa.labels.rootAuthority') }}</span>
              <strong>{{ text(selectedRoot.name) }}</strong>
              <span class="ca-node__cn">{{ text(selectedRoot.subjectCommonName) }}</span>
              <span class="ca-node__meta">{{ backendLabel(selectedRoot.providerId) }} · {{ localTime(selectedRoot.notAfter) }}</span>
            </article>
            <div v-if="selectedIntermediates.length" class="ca-tree__connector"></div>
            <div v-if="selectedIntermediates.length" class="ca-tree__children">
              <article v-for="item in selectedIntermediates" :key="text(item.id)" class="ca-node ca-node--intermediate">
                <span class="ca-node__badge">{{ t('internalCa.labels.intermediateAuthority') }}</span>
                <strong>{{ text(item.name) }}</strong>
                <span class="ca-node__cn">{{ text(item.subjectCommonName) }}</span>
                <span class="ca-node__meta">{{ text(item.securityDomain) }} · {{ localTime(item.notAfter) }}</span>
                <GcStatusTag :status="text(item.status)" />
              </article>
            </div>
            <div v-else class="ca-tree__empty">
              <p>{{ t('internalCa.messages.noIntermediate') }}</p>
              <button v-if="isEligibleParentRoot(selectedRoot)" class="gc-button gc-button--primary gc-button--sm" type="button" @click="openAuthorityWizard('intermediate', selectedRoot)">{{ t('internalCa.actions.addIntermediate') }}</button>
            </div>
          </div>
        </article>
        <article v-else class="ca-empty">
          <h2>{{ t('internalCa.messages.noRootAuthority') }}</h2>
          <p>{{ t('internalCa.messages.noRootAuthorityDescription') }}</p>
          <button class="gc-button gc-button--primary" type="button" @click="openAuthorityWizard('root')">{{ t('internalCa.actions.addAuthority') }}</button>
        </article>

        <details class="gc-card backend-settings">
          <summary>{{ t('internalCa.sections.issuingBackends') }}</summary>
          <section class="capability-overview">
            <strong>{{ t('designSystem.capability.title') }}</strong>
            <p>{{ t('designSystem.capability.description') }}</p>
          </section>
          <div class="backend-settings__list">
            <article v-for="backend in providers" :key="text(backend.id)" class="backend-summary">
              <div class="backend-summary__heading"><strong>{{ text(backend.name) }}</strong><span>{{ backendModeLabel(backend) }} · {{ backendProtocolLabel(backend) }}</span></div>
              <GcStatusTag :status="text(backend.status)" />
              <small>{{ t('internalCa.labels.backendUsageCount', { count: authorities.filter((item) => text(item.providerId) === text(backend.id)).length }) }}</small>
              <small>{{ t('internalCa.labels.unverifiedCapabilityCount', { count: capabilityCount(backend, 'declared') }) }}</small>
              <div v-if="asRecords(backend.capabilityRecords).length" class="backend-summary__capabilities">
                <span v-for="capability in asRecords(backend.capabilityRecords)" :key="`${capabilityLabel(capability)}:${text(capability.state)}`">{{ capabilityLabel(capability) }} · {{ text(capability.state, t('internalCa.common.unknown')) }}</span>
              </div>
              <p v-else class="backend-summary__empty">{{ t('designSystem.capability.empty') }}</p>
            </article>
          </div>
        </details>
      </div>
    </details>

    <!-- Section: CA信任域 -->
    <details class="ca-section gc-card" open>
      <summary class="ca-section__header">
        <span class="ca-section__title">{{ t('internalCa.tabs.trustDomains') }}</span>
        <span class="ca-section__actions" @click.stop>
          <button class="gc-button gc-button--primary" type="button" @click="openTrustDomainModal">{{ t('internalCa.actions.addTrustDomain') }}</button>
        </span>
      </summary>
      <div class="ca-section__body">
        <GcDataTable :columns="trustDomainColumns" :rows="trustDomains" :loading="loading" row-key="id" :empty-text="t('internalCa.trustDomains.empty')" dense>
          <template #toolbar>
            <div class="trust-domain-page__table-toolbar">
              <strong>{{ t('internalCa.trustDomains.recordsTitle') }}</strong>
              <span>{{ t('businessPage.total', { count: trustDomains.length }) }}</span>
            </div>
          </template>
          <template #cell-name="{ row }">
            <div class="trust-domain-page__cell-main">
              <strong>{{ text(row.name) }}</strong>
            </div>
          </template>
          <template #cell-status="{ row }"><GcStatusTag :status="text(row.status)" /></template>
          <template #cell-isDefault="{ row }">{{ row.isDefault ? t('internalCa.labels.defaultTrustDomain') : t('internalCa.trustDomains.notDefault') }}</template>
          <template #cell-createdAt="{ row }">{{ localTime(row.createdAt) }}</template>
        </GcDataTable>
      </div>
    </details>

    <!-- Section: 证书Profile -->
    <details class="ca-section gc-card" open>
      <summary class="ca-section__header">
        <span class="ca-section__title">{{ t('internalCa.tabs.profiles') }}</span>
        <span class="ca-section__actions" @click.stop>
          <button class="gc-button gc-button--primary" type="button" @click="profileModalOpen = true">{{ t('internalCa.actions.createProfile') }}</button>
        </span>
      </summary>
      <div class="ca-section__body">
        <GcDataTable :columns="profileColumns" :rows="profiles" :loading="loading" row-key="id" :empty-text="t('internalCa.profiles.empty')" dense>
          <template #toolbar>
            <div class="trust-domain-page__table-toolbar">
              <strong>{{ t('internalCa.profiles.recordsTitle') }}</strong>
              <span>{{ t('businessPage.total', { count: profiles.length }) }}</span>
            </div>
          </template>
          <template #cell-name="{ row }">
            <div class="trust-domain-page__cell-main">
              <strong>{{ text(row.profile && (row.profile as InternalCaRecord).name) }}</strong>
            </div>
          </template>
          <template #cell-securityDomain="{ row }">{{ text(row.profile && (row.profile as InternalCaRecord).securityDomain) }}</template>
          <template #cell-versionCount="{ row }">{{ t('internalCa.labels.versionCount', { count: asRecords(row.versions).length }) }}</template>
          <template #cell-status="{ row }"><GcStatusTag :status="text(row.status)" /></template>
        </GcDataTable>
      </div>
    </details>

    <!-- Section: 证书申请 -->
    <details class="ca-section gc-card" open>
      <summary class="ca-section__header">
        <span class="ca-section__title">{{ t('internalCa.tabs.requests') }}</span>
        <span class="ca-section__actions" @click.stop>
          <button class="gc-button gc-button--primary" type="button" @click="requestModalOpen = true">{{ t('internalCa.actions.createRequest') }}</button>
        </span>
      </summary>
      <div class="ca-section__body">
        <GcDataTable :columns="requestColumns" :rows="recentRequests" :loading="loading" row-key="id" :empty-text="t('internalCa.requests.empty')" dense>
          <template #toolbar>
            <div class="trust-domain-page__table-toolbar">
              <strong>{{ t('internalCa.requests.recordsTitle') }}</strong>
              <span>{{ t('businessPage.total', { count: requests.length }) }}</span>
            </div>
          </template>
          <template #cell-subjectCommonName="{ row }">
            <div class="trust-domain-page__cell-main">
              <strong>{{ text(row.subjectCommonName) }}</strong>
            </div>
          </template>
          <template #cell-status="{ row }"><GcStatusTag :status="text(row.status)" /></template>
          <template #cell-updatedAt="{ row }">{{ localTime(row.updatedAt) }}</template>
          <template #cell-actions="{ row }">
            <div class="button-row">
              <button v-if="text(row.status) === 'pending_approval' && text(row.approvalId)" class="gc-button gc-button--sm" @click="approveRequest(row)">{{ t('internalCa.actions.approve') }}</button>
              <button v-if="text(row.status) === 'issue_failed'" class="gc-button gc-button--sm" @click="retryRequest(row)">{{ t('internalCa.actions.retry') }}</button>
              <button v-if="text(row.status) === 'issuing' && text(row.providerRequestId)" class="gc-button gc-button--sm" @click="queryRequest(row)">{{ t('internalCa.actions.queryResult') }}</button>
            </div>
          </template>
        </GcDataTable>
      </div>
    </details>

    <GcModal v-model:open="trustDomainModalOpen" size="lg" :title="t('internalCa.trustDomains.modalTitle')" :description="t('internalCa.trustDomains.modalDescription')">
      <form id="trust-domain-form" class="trust-domain-form" @submit.prevent="createTrustDomain">
        <label>{{ t('internalCa.fields.name') }}<input v-model="trustDomainDraft.name" required /></label>
        <label>{{ t('internalCa.fields.purpose') }}<input v-model="trustDomainDraft.purpose" required /></label>
        <label>{{ t('internalCa.fields.isolationLevel') }}<select v-model="trustDomainDraft.isolationLevel"><option value="standard">{{ t('internalCa.isolationLevels.standard') }}</option><option value="strict">{{ t('internalCa.isolationLevels.strict') }}</option><option value="regulated">{{ t('internalCa.isolationLevels.regulated') }}</option></select></label>
        <label class="check"><input v-model="trustDomainDraft.isDefault" type="checkbox" />{{ t('internalCa.fields.defaultTrustDomain') }}</label>
        <p class="trust-domain-form__hint">{{ t('internalCa.trustDomains.generatedCodeHint') }}</p>
        <p v-if="error" class="notice notice--danger">{{ error }}</p>
      </form>
      <template #actions>
        <button class="gc-button" type="button" :disabled="actionPending" @click="trustDomainModalOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--primary" form="trust-domain-form" type="submit" :disabled="actionPending">{{ actionPending ? t('businessPage.processing') : t('internalCa.actions.createTrustDomain') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="requestModalOpen" size="lg" :title="t('internalCa.requests.modalTitle')" :description="t('internalCa.requests.modalDescription')">
      <form id="request-form" class="trust-domain-form" @submit.prevent="createRequest">
        <label>{{ t('internalCa.fields.applicationAssetId') }}<input v-model="requestDraft.applicationAssetId" required /></label>
        <label>{{ t('internalCa.fields.trustDomain') }}<select v-model="requestDraft.trustDomainId" required><option v-for="item in trustDomains" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
        <label>{{ t('internalCa.fields.authority') }}<select v-model="requestDraft.caId"><option v-for="item in requestAuthorities" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
        <label>{{ t('internalCa.fields.profileVersionId') }}<select v-model="requestDraft.profileVersionId" required><option v-for="item in requestProfileVersions" :key="text(item.id)" :value="text(item.id)">{{ text(item.profileName) }} · v{{ number(item.versionNo) }}</option></select></label>
        <label>{{ t('internalCa.fields.commonName') }}<input v-model="requestDraft.commonName" required /></label>
        <label>{{ t('internalCa.fields.sans') }}<input v-model="requestDraft.sans" :placeholder="t('internalCa.placeholders.sans')" /></label>
        <label>{{ t('internalCa.fields.custodyMode') }}<select v-model="requestDraft.custodyMode"><option value="managed_secret">{{ t('internalCa.custodyModes.managedSecret') }}</option><option value="local_agent">{{ t('internalCa.custodyModes.localAgent') }}</option><option value="device_local">{{ t('internalCa.custodyModes.deviceLocal') }}</option><option value="external_key">{{ t('internalCa.custodyModes.externalKey') }}</option></select></label>
        <p v-if="error" class="notice notice--danger">{{ error }}</p>
      </form>
      <template #actions>
        <button class="gc-button" type="button" :disabled="actionPending" @click="requestModalOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--primary" form="request-form" type="submit" :disabled="actionPending">{{ actionPending ? t('businessPage.processing') : t('internalCa.actions.createRequest') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="profileModalOpen" size="lg" :title="t('internalCa.profiles.modalTitle')" :description="t('internalCa.profiles.modalDescription')">
      <form id="profile-form" class="trust-domain-form" @submit.prevent="createProfile">
        <label>{{ t('internalCa.fields.name') }}<input v-model="profileDraft.name" required /></label>
        <label>{{ t('internalCa.fields.trustDomain') }}<select v-model="profileDraft.trustDomainId" required><option v-for="item in trustDomains" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
        <label>{{ t('internalCa.fields.securityDomain') }}<input v-model="profileDraft.securityDomain" /></label>
        <label>{{ t('internalCa.fields.dnsSuffixes') }}<input v-model="profileDraft.allowedDnsSuffix" :placeholder="t('internalCa.placeholders.dnsSuffixes')" /></label>
        <label>{{ t('internalCa.fields.validityDays') }}<input v-model.number="profileDraft.maximumValidityDays" type="number" min="1" /></label>
        <label>{{ t('internalCa.fields.renewalDays') }}<input v-model.number="profileDraft.renewalWindowDays" type="number" min="1" /></label>
        <label class="check"><input v-model="profileDraft.requireApproval" type="checkbox" />{{ t('internalCa.fields.requireApproval') }}</label>
        <p v-if="error" class="notice notice--danger">{{ error }}</p>
      </form>
      <template #actions>
        <button class="gc-button" type="button" :disabled="actionPending" @click="profileModalOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--primary" form="profile-form" type="submit" :disabled="actionPending">{{ actionPending ? t('businessPage.processing') : t('internalCa.actions.createProfile') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="authorityWizardOpen" size="xl" :title="t('internalCa.wizard.title')" :description="t('internalCa.wizard.description')">
      <div class="ca-wizard">
        <div class="ca-wizard__progress"><div class="ca-wizard__progress-bar"><span :style="{ width: wizardProgress }"></span></div><ol :aria-label="t('internalCa.wizard.stepsAria')"><li v-for="step in wizardStepCount" :key="step" :class="{ 'is-active': authorityWizardStep === step, 'is-complete': authorityWizardStep > step }"><span>{{ step }}</span><div><strong>{{ authorityWizardStepLabel(step) }}</strong><small>{{ t(authorityWizardStep > step ? 'internalCa.wizard.completed' : authorityWizardStep === step ? 'internalCa.wizard.inProgress' : 'internalCa.wizard.pending') }}</small></div></li></ol></div>

        <section v-if="authorityCreationKind === 'root' && authorityWizardStep === 1" class="ca-wizard__panel">
          <header class="ca-wizard__panel-heading"><span>{{ t('internalCa.wizard.entryEyebrow') }}</span><h3>{{ t('internalCa.wizard.entryTitle') }}</h3><p>{{ t('internalCa.wizard.entryDescription') }}</p></header>
          <div class="ca-wizard__entry-grid">
            <button type="button" class="ca-entry-card ca-entry-card--recommended" @click="chooseAuthorityMode('builtin')"><span class="ca-entry-card__badge">{{ t('internalCa.wizard.recommended') }}</span><span class="ca-entry-card__icon">CA</span><strong>{{ t('internalCa.wizard.builtinTitle') }}</strong><p>{{ t('internalCa.wizard.builtinDescription') }}</p><ul><li>{{ t('internalCa.wizard.builtinFeature1') }}</li><li>{{ t('internalCa.wizard.builtinFeature2') }}</li></ul></button>
            <button type="button" class="ca-entry-card" @click="chooseAuthorityMode('managed_node')"><span class="ca-entry-card__icon">N</span><strong>{{ t('internalCa.wizard.managedTitle') }}</strong><p>{{ t('internalCa.wizard.managedDescription') }}</p><ul><li>{{ t('internalCa.wizard.managedFeature1') }}</li><li>{{ t('internalCa.wizard.managedFeature2') }}</li></ul></button>
          </div>
        </section>

        <form v-else-if="authorityCreationKind === 'root' && authorityWizardStep === 2" ref="authorityWizardForm" class="ca-wizard__panel ca-wizard__form" @submit.prevent="advanceAuthorityWizard">
          <header class="ca-wizard__panel-heading ca-wizard__full"><span>{{ t('internalCa.wizard.backendEyebrow') }}</span><h3>{{ t(`internalCa.wizard.${authorityCreationMode}BackendTitle`) }}</h3><p>{{ t(`internalCa.wizard.${authorityCreationMode}BackendDescription`) }}</p></header>
          <article v-if="authorityCreationMode === 'builtin'" class="ca-wizard__notice ca-wizard__full"><strong>{{ t('internalCa.wizard.builtinAutomaticTitle') }}</strong><p>{{ t('internalCa.wizard.builtinAutomaticDescription') }}</p></article>
          <template v-else>
            <label>{{ t('internalCa.fields.backendName') }}<input v-model="backendDraft.name" required /></label>
            <label>{{ t('internalCa.fields.platform') }}<select v-model="backendDraft.runtimePlatform" required><option value="windows">{{ t('assets.platforms.windows') }}</option><option value="linux">{{ t('assets.platforms.linux') }}</option></select></label>
            <label>{{ t('internalCa.fields.availabilityMode') }}<select v-model="backendDraft.availabilityMode"><option value="single">{{ t('internalCa.availability.single') }}</option><option value="active_standby">{{ t('internalCa.availability.activeStandby') }}</option><option value="active_active">{{ t('internalCa.availability.activeActive') }}</option></select></label>
            <article class="ca-wizard__notice ca-wizard__full"><strong>{{ t('designSystem.capability.title') }}</strong><p>{{ t('designSystem.capability.description') }}</p></article>
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
            <article class="ca-wizard__backend-summary ca-wizard__full"><span>{{ t('internalCa.fields.issuingBackend') }}</span><strong>{{ authorityCreationKind === 'intermediate' ? backendLabel(authorityDraft.providerId) : t(`internalCa.wizard.${authorityCreationMode}Title`) }}</strong><small>{{ t(`internalCa.wizard.${selectedCreationMode}SecurityNote`) }}</small></article>
          </template>
          <button class="ca-wizard__hidden-submit" tabindex="-1"></button>
        </form>

        <section v-else class="ca-wizard__panel ca-wizard__review">
          <header class="ca-wizard__panel-heading"><span>{{ t('internalCa.wizard.reviewEyebrow') }}</span><h3>{{ t('internalCa.wizard.reviewTitle') }}</h3><p>{{ t('internalCa.wizard.reviewDescription') }}</p></header>
          <div class="ca-wizard__review-grid"><span>{{ t('internalCa.fields.entryMode') }}</span><strong>{{ t(`internalCa.wizard.${selectedCreationMode}Title`) }}</strong><span>{{ t('internalCa.fields.authorityType') }}</span><strong>{{ authorityCreationKind === 'root' ? t('internalCa.wizard.rootTitle') : t('internalCa.wizard.intermediateTitle') }}</strong><span>{{ t('internalCa.fields.name') }}</span><strong>{{ authorityDraft.name }}</strong><span>{{ t('internalCa.fields.commonName') }}</span><strong>{{ authorityDraft.commonName }}</strong><span>{{ t('internalCa.fields.trustDomain') }}</span><strong>{{ trustDomainName(authorityDraft.trustDomainId) }}</strong></div>
          <article v-if="selectedCreationMode === 'managed_node' && backendEnrollment" class="ca-wizard__enrollment"><strong>{{ t('internalCa.wizard.enrollmentTitle') }}</strong><p>{{ t('internalCa.wizard.enrollmentDescription') }}</p><code>{{ text(backendEnrollment.token) }}</code><small>{{ t('internalCa.wizard.enrollmentExpiresAt', { time: localTime(backendEnrollment.expiresAt) }) }}</small></article>
          <article class="ca-wizard__risk"><strong>{{ t('internalCa.sections.riskSummary') }}</strong><p>{{ text(authorityPreview?.overallRecommendation) }}</p><ul><li v-for="warning in asRecords(authorityPreview?.warnings)" :key="String(warning)">{{ warning }}</li></ul><p v-if="!asRecords(authorityPreview?.warnings).length">{{ t('internalCa.wizard.noWarnings') }}</p></article>
        </section>
      </div>
      <template #actions><button v-if="authorityWizardStep > 1" class="gc-button" type="button" :disabled="actionPending" @click="previousAuthorityWizardStep">{{ t('internalCa.actions.previous') }}</button><button v-if="authorityWizardStep < wizardStepCount" class="gc-button gc-button--primary" type="button" :disabled="actionPending || (authorityCreationKind === 'intermediate' && authorityWizardStep === 1 && !authorityDraft.parentCaId)" @click="advanceAuthorityWizard">{{ t('internalCa.actions.next') }}</button><button v-else class="gc-button gc-button--primary" type="button" :disabled="actionPending" @click="createAuthority">{{ t('internalCa.actions.createAuthority') }}</button></template>
    </GcModal>
  </section>
</template>

<style scoped>
.internal-ca-page { display: grid; gap: var(--gc-space-5); }
.trust-domain-page__table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.trust-domain-page__table-toolbar span { color: var(--gc-color-text-muted); }
.trust-domain-page__cell-main { display: grid; gap: var(--gc-space-1); }
.trust-domain-form { display: grid; gap: var(--gc-space-4); }
.trust-domain-form__hint { margin: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); color: var(--gc-color-text-muted); background: var(--gc-color-info-bg); }
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
.notice { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); flex-wrap: wrap; padding: var(--gc-space-3); border-radius: var(--gc-radius-md); }
.notice--danger { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); }
pre { overflow: auto; padding: var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-muted-bg); border-radius: var(--gc-radius-md); }
.authority-toolbar, .ca-architecture__header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); }
.authority-toolbar h2, .authority-toolbar p, .ca-architecture__header h2 { margin: 0; }
.authority-toolbar p { margin-top: var(--gc-space-1); color: var(--gc-color-text-muted); }
.root-ca-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-3); }
.root-ca-card { display: grid; grid-template-columns: var(--gc-space-1) minmax(0, 1fr) auto; gap: 0 var(--gc-space-3); padding: var(--gc-space-3) var(--gc-space-4); text-align: left; color: var(--gc-color-text); cursor: pointer; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); transition: border-color 140ms ease, box-shadow 140ms ease; align-items: start; }
.root-ca-card:hover { border-color: var(--gc-color-primary-border); box-shadow: var(--gc-shadow-hover); }
.root-ca-card.is-selected { border-color: var(--gc-color-primary); background: var(--gc-color-surface-selected); }
.root-ca-card__accent { width: var(--gc-space-1); height: 100%; border-radius: var(--gc-radius-xl); background: var(--gc-color-primary); grid-row: 1 / 3; }
.root-ca-card.is-selected .root-ca-card__accent { background: var(--gc-color-primary); box-shadow: var(--gc-shadow-focus); }
.root-ca-card__body { display: grid; gap: var(--gc-space-hairline); min-width: 0; }
.root-ca-card__title { display: flex; align-items: center; gap: var(--gc-space-2); font-size: var(--gc-font-size-sm); }
.root-ca-card__title strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-ca-card__cn { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-ca-card__meta { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-ca-card__expiry { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-soft); }
.root-ca-card__badge { grid-row: 1; padding: var(--gc-space-hairline) var(--gc-space-2); border-radius: var(--gc-radius-xl); background: var(--gc-color-primary-soft); color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-semibold); white-space: nowrap; }
.ca-architecture { margin-top: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); overflow: hidden; }
.ca-architecture__header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-3); margin-bottom: var(--gc-space-3); }
.ca-architecture__eyebrow { font-size: var(--gc-font-size-sm); font-weight: 600; color: var(--gc-color-text-strong); }
.ca-architecture__desc { margin: var(--gc-space-1) 0 0; font-size: var(--gc-font-size-xs); color: var(--gc-color-text-muted); }
.ca-tree { display: grid; justify-items: center; gap: 0; }
.ca-node { display: grid; gap: var(--gc-space-1); width: min(100%, var(--gc-size-sidebar)); padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); text-align: left; }
.ca-node strong { font-size: var(--gc-font-size-sm); font-weight: 600; }
.ca-node__badge { font-size: var(--gc-font-size-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0; color: var(--gc-color-primary); }
.ca-node__cn { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-node__meta { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-node--root { border-color: var(--gc-color-primary-border-strong); background: var(--gc-color-primary-soft); }
.ca-node--intermediate { position: relative; border-color: var(--gc-color-border); }
.ca-tree__connector { width: var(--gc-border-width-default); height: var(--gc-space-4); margin: 0 auto; background: var(--gc-color-border-strong); }
.ca-tree__children { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-3); width: 100%; padding-top: var(--gc-space-4); border-top: var(--gc-border-width-default) solid var(--gc-color-border-strong); position: relative; }
.ca-tree__empty, .ca-empty { display: grid; justify-items: center; gap: var(--gc-space-2); padding: var(--gc-space-5); text-align: center; color: var(--gc-color-text-muted); border: var(--gc-border-width-default) dashed var(--gc-color-border); border-radius: var(--gc-radius-md); }
.ca-empty h2, .ca-empty p, .ca-tree__empty p { margin: 0; font-size: var(--gc-font-size-sm); }
.ca-empty { margin-top: var(--gc-space-3); }
.backend-settings { padding: var(--gc-space-4); }
.backend-settings summary { cursor: pointer; color: var(--gc-color-text-strong); font-weight: 700; }
.backend-settings__list { display: grid; gap: var(--gc-space-3); margin-top: var(--gc-space-4); }
.backend-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); }
.backend-summary div { display: grid; gap: var(--gc-space-1); }
.backend-summary span, .backend-summary small { color: var(--gc-color-text-muted); }
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
.ca-wizard__panel-heading span { color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
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
/* Collapsible sections */
.ca-section { padding: 0; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-raised); overflow: hidden; }
.ca-section[open] { border-color: var(--gc-color-primary-border); }
.ca-section__header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); padding: var(--gc-space-4) var(--gc-space-5); cursor: pointer; list-style: none; user-select: none; transition: background 120ms ease; }
.ca-section__header::-webkit-details-marker { display: none; }
.ca-section__header::marker { display: none; content: ''; }
.ca-section__header:hover { background: var(--gc-color-surface-muted); }
.ca-section__header::before { content: ''; flex: 0 0 auto; width: var(--gc-space-5); height: var(--gc-space-5); background: var(--gc-color-text-muted); mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M9 18l6-6-6-6'/%3E%3C/svg%3E") center / contain no-repeat; transition: transform 200ms ease; }
.ca-section[open] > .ca-section__header::before { transform: rotate(90deg); }
.ca-section__title { font-size: var(--gc-font-size-lg); font-weight: 700; color: var(--gc-color-text-strong); flex: 1 1 auto; }
.ca-section__actions { display: flex; align-items: center; gap: var(--gc-space-2); flex: 0 0 auto; }
.ca-section__body { display: grid; gap: var(--gc-space-5); padding: 0 var(--gc-space-5) var(--gc-space-5); }
.ca-subsection { margin-top: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border-subtle); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); }
.ca-subsection__header { cursor: pointer; color: var(--gc-color-text-strong); font-weight: 700; font-size: var(--gc-font-size-sm); list-style: none; padding: var(--gc-space-2); border-radius: var(--gc-radius-sm); transition: background 120ms ease; display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.ca-subsection__header::-webkit-details-marker { display: none; }
.ca-subsection__header:hover { background: var(--gc-color-surface-hover); }
.ca-subsection__actions { display: flex; align-items: center; gap: var(--gc-space-2); flex: 0 0 auto; }
.ca-subsection__body { display: grid; gap: var(--gc-space-4); padding-top: var(--gc-space-3); }
@media (max-width: 48rem) {
  .authority-toolbar, .ca-architecture__header, .ca-section__header { align-items: stretch; flex-direction: column; }
  .ca-section__actions { justify-content: flex-start; }
  .ca-wizard__entry-grid, .ca-wizard__form, .ca-tree__children { grid-template-columns: 1fr; }
  .ca-wizard__progress ol { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .backend-summary { grid-template-columns: minmax(0, 1fr) auto; }
  .backend-summary small { grid-column: 1 / -1; }
}
</style>
