<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { createWindowsAdcsInstallSession, listAgents } from '@/api/modules/assets.api'
import { GcDataTable, GcModal, GcPageHeader, GcStatusTag, type StatusTone } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const props = defineProps<{ embedded?: boolean }>()
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
const providerActionBindings = ref<InternalCaRecord[]>([])
const certificatePolicies = ref<InternalCaRecord[]>([])
const certificateRotations = ref<InternalCaRecord[]>([])
const crlPublications = ref<InternalCaRecord[]>([])
const riskOverview = ref<InternalCaRecord>({})
const authorityPreview = ref<InternalCaRecord | null>(null)
const remediationPreview = ref<InternalCaRecord | null>(null)
const authorityWizardOpen = ref(false)
const authorityWizardStep = ref(1)
const authorityCreationKind = ref<'root' | 'intermediate'>('root')
const authorityCreationMode = ref<'builtin' | 'external'>('builtin')
const selectedRootId = ref('')
const authorityWizardForm = ref<HTMLFormElement | null>(null)
const authoritySubjectAdvancedOpen = ref(false)
const commonNameCustomized = ref(false)
const trustDomainModalOpen = ref(false)
const requestModalOpen = ref(false)
const profileModalOpen = ref(false)
const authorityDeleteModalOpen = ref(false)
const authorityDeleteTarget = ref<InternalCaRecord | null>(null)
const adcsModalOpen = ref(false)
const adcsEditingProviderId = ref('')
const adcsInstallBusy = ref(false)
const adcsAssociationBusy = ref(false)
const adcsRefreshBusy = ref('')

const trustDomainDraft = reactive({ name: '', purpose: 'production_tls', isolationLevel: 'standard', isDefault: false })
const authorityDraft = reactive({ providerId: '', trustDomainId: '', parentCaId: '', name: '', commonName: '', securityDomain: 'production', topologyMode: 'root_with_intermediate', keyBackend: 'secret' })
const profileDraft = reactive({ name: '', trustDomainId: '', securityDomain: 'production', allowedDnsSuffix: '', maximumValidityDays: 90, renewalWindowDays: 30, requireApproval: true })
const requestDraft = reactive({
  applicationAssetId: '', trustDomainId: '', caId: '', profileVersionId: '', commonName: '', sans: '', custodyMode: 'managed_secret',
  agentId: '', targetId: '', keyPath: '', certificatePath: '', configPath: '', format: 'pem', alias: '', storageMode: 'file_pem',
})
const revocationDraft = reactive({ certificateVersionId: '', reason: 'keyCompromise' })
const trustDraft = reactive({ caId: '', targetIds: '', platform: 'linux' })
const adcsDraft = reactive({
  agentId: '', agentKey: '', agentVersion: '', installSessionId: '', installCommand: '', installExpiresAt: '',
})

const selectedBackend = computed(() => providers.value.find((item) => text(item.id) === authorityDraft.providerId))
const rootAuthorities = computed(() => authorities.value.filter((item) => (text(item.role) === 'root' || !text(item.parentCaId)) && text(item.status, 'active') === 'active'))
const selectedRoot = computed(() => rootAuthorities.value.find((item) => text(item.id) === selectedRootId.value) ?? rootAuthorities.value[0])
const selectedIntermediates = computed(() => authorities.value.filter((item) => text(item.parentCaId) === text(selectedRoot.value?.id) && text(item.status, 'active') === 'active'))
const activeAuthorities = computed(() => authorities.value.filter((item) => text(item.status, 'active') === 'active'))
const eligibleParentRoots = computed(() => rootAuthorities.value.filter(isEligibleParentRoot))
const requestAuthorities = computed(() => authorities.value.filter((item) => text(item.status, 'active') === 'active' && (!requestDraft.trustDomainId || text(item.trustDomainId) === requestDraft.trustDomainId)))
const requestProfileVersions = computed(() => profiles.value.flatMap((item) => {
  const profile = item.profile as InternalCaRecord | undefined
  if (requestDraft.trustDomainId && text(profile?.trustDomainId) !== requestDraft.trustDomainId) return []
  return asRecords(item.versions).map((version): InternalCaRecord => ({ ...version, profileName: text(profile?.name) }))
}))
const topologyInput = computed(() => authorityCreationMode.value === 'external'
  ? { topologyMode: 'external_managed', deploymentMode: 'external', runtimePlatform: 'windows', availabilityMode: 'single', keyBackend: 'device' }
  : {
      topologyMode: authorityDraft.topologyMode,
      deploymentMode: text(selectedBackend.value?.deploymentMode, 'builtin'),
      runtimePlatform: text(selectedBackend.value?.runtimePlatform, 'embedded'),
      availabilityMode: text(selectedBackend.value?.availabilityMode, 'single'),
      keyBackend: authorityDraft.keyBackend,
    })

const wizardStepCount = computed(() => authorityCreationKind.value === 'intermediate' ? 3 : authorityCreationMode.value === 'external' ? 2 : 4)
const wizardProgress = computed(() => `${(authorityWizardStep.value / wizardStepCount.value) * 100}%`)
const builtinBackend = computed(() => providers.value.find((item) => text(item.type) === 'gcac_builtin'))
const adcsProviders = computed(() => providers.value.filter((item) => isAdcsProvider(item) && text(item.status, 'active') === 'active'))
const visibleProviders = computed(() => providers.value.filter((item) => !(isAdcsProvider(item) && text(item.status) === 'disabled')))
const recentRequests = computed(() => requests.value.slice(0, 20))
const selectedCreationMode = computed(() => authorityCreationMode.value)
const trustDomainColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'name', title: t('internalCa.trustDomains.columns.name'), width: '22%' },
  { key: 'purpose', title: t('internalCa.trustDomains.columns.purpose'), width: '18%' },
  { key: 'isolationLevel', title: t('internalCa.trustDomains.columns.isolationLevel'), width: '18%' },
  { key: 'status', title: t('internalCa.trustDomains.columns.status'), width: '14%' },
  { key: 'isDefault', title: t('internalCa.trustDomains.columns.default'), width: '14%' },
  { key: 'createdAt', title: t('internalCa.trustDomains.columns.createdAt') },
])
const requestColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'subjectCommonName', title: t('internalCa.requests.columns.commonName'), width: '16%' },
  { key: 'applicationAssetId', title: t('internalCa.requests.columns.applicationAssetId'), width: '15%' },
  { key: 'keyReference', title: t('internalCa.requests.columns.keyReference'), width: '18%' },
  { key: 'certificate', title: t('internalCa.requests.columns.certificate'), width: '19%' },
  { key: 'status', title: t('internalCa.trustDomains.columns.status'), width: '11%' },
  { key: 'updatedAt', title: t('internalCa.requests.columns.updatedAt'), width: '9%' },
  { key: 'actions', title: t('internalCa.requests.columns.actions'), width: '12%' },
])
const profileColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'name', title: t('internalCa.trustDomains.columns.name'), width: '28%' },
  { key: 'securityDomain', title: t('internalCa.profiles.columns.securityDomain'), width: '24%' },
  { key: 'versionCount', title: t('internalCa.profiles.columns.versionCount'), width: '24%' },
  { key: 'status', title: t('internalCa.trustDomains.columns.status'), width: '24%' },
])

onMounted(loadAll)

watch(() => authorityDraft.name, (name) => {
  if (!commonNameCustomized.value) authorityDraft.commonName = name
})

watch(() => requestDraft.storageMode, (storageMode) => {
  // Windows CNG 只能通过 PEM 证书回复导入，避免在表单中生成必然失败的组合。
  if (storageMode === 'windows_cng' && requestDraft.format !== 'pem') requestDraft.format = 'pem'
})

async function loadAll() {
  loading.value = true
  error.value = ''
  try {
    const [providerResult, trustDomainResult, authorityResult, profileResult, requestResult, renewalResult, revocationResult, trustResult, riskResult, overviewResult, policyResult, rotationResult, crlResult] = await Promise.all([
      internalCaApi.listProviders(), internalCaApi.listTrustDomains(), internalCaApi.listAuthorities(), internalCaApi.listProfiles(), internalCaApi.listRequests(),
      internalCaApi.listRenewals(), internalCaApi.listRevocations(), internalCaApi.listTrustDistributions(), internalCaApi.listReuseRisks(), internalCaApi.reuseRiskOverview(),
      internalCaApi.listCertificatePolicies(), internalCaApi.listCertificateRotations(), internalCaApi.listCrlPublications(),
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
    certificatePolicies.value = policyResult.data ?? []
    certificateRotations.value = rotationResult.data ?? []
    crlPublications.value = crlResult.data ?? []
    const bindingResults = await Promise.allSettled(
      providers.value.map((provider) => internalCaApi.listProviderActionBindings(text(provider.id))),
    )
    providerActionBindings.value = bindingResults.flatMap((result, index) => {
      if (result.status !== 'fulfilled') return []
      const providerId = text(providers.value[index]?.id)
      return (result.value.data ?? []).map((binding) => ({ ...binding, providerId }))
    })
    authorityDraft.providerId ||= text(builtinBackend.value?.id)
    const defaultTrustDomainId = text(trustDomains.value.find((item) => item.isDefault === true)?.id ?? trustDomains.value[0]?.id)
    authorityDraft.trustDomainId ||= defaultTrustDomainId
    profileDraft.trustDomainId ||= defaultTrustDomainId
    requestDraft.trustDomainId ||= defaultTrustDomainId
    if (!requestAuthorities.value.some((item) => text(item.id) === requestDraft.caId)) {
      requestDraft.caId = text(requestAuthorities.value.find((item) => text(item.role) === 'intermediate')?.id ?? requestAuthorities.value[0]?.id)
    }
    requestDraft.profileVersionId ||= text(requestProfileVersions.value[0]?.id)
    if (!requestAuthorities.value.some((item) => text(item.id) === trustDraft.caId)) trustDraft.caId = requestDraft.caId
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
    if (!authorityDraft.providerId) return
  }
  if (!authorityPreview.value) await previewAuthority()
  const confirmationToken = text(authorityPreview.value?.confirmationToken)
  if (!confirmationToken) return
  const previousRootIds = new Set(rootAuthorities.value.map((item) => text(item.id)))
  await runAction(() => internalCaApi.createAuthority({
    ...authorityDraft,
    parentCaId: authorityCreationKind.value === 'intermediate' ? authorityDraft.parentCaId : undefined,
    ...topologyInput.value,
    ...(authorityCreationMode.value === 'external' ? { trustDomainId: undefined, configuration: { providerKind: 'microsoft_adcs', templateId: 'WebServer' } } : {}),
    confirmationToken,
  }), 'internalCa.messages.authorityCreated')
  if (authorityCreationKind.value === 'intermediate') selectedRootId.value = authorityDraft.parentCaId
  else selectedRootId.value = text(rootAuthorities.value.find((item) => !previousRootIds.has(text(item.id)))?.id, selectedRootId.value)
  authorityPreview.value = null
  authorityWizardOpen.value = false
}

function openAuthorityWizard(kind: 'root' | 'intermediate' = 'root', parent?: InternalCaRecord) {
  authorityCreationKind.value = kind
  authorityWizardStep.value = 1
  authorityPreview.value = null
  authorityCreationMode.value = 'builtin'
  authorityDraft.parentCaId = ''
  authorityDraft.name = ''
  authorityDraft.commonName = ''
  authoritySubjectAdvancedOpen.value = false
  commonNameCustomized.value = false
  authorityDraft.topologyMode = 'root_with_intermediate'
  if (kind === 'intermediate') {
    applyParentRoot(parent ?? selectedRoot.value)
    authorityWizardStep.value = 1
  }
  authorityWizardOpen.value = true
}

function chooseAuthorityMode() {
  authorityCreationMode.value = 'builtin'
  authorityDraft.providerId = text(builtinBackend.value?.id)
  authorityDraft.topologyMode = 'root_with_intermediate'
  authorityDraft.keyBackend = 'secret'
  authorityWizardStep.value = 2
}

function chooseExternalAuthorityMode(provider?: InternalCaRecord) {
  const selected = provider ?? adcsProviders.value[0]
  authorityCreationMode.value = 'external'
  authorityDraft.providerId = text(selected?.id)
  authorityDraft.trustDomainId = ''
  authorityDraft.name = text(selected?.name)
  authorityDraft.commonName = authorityDraft.name
  commonNameCustomized.value = false
  authorityDraft.topologyMode = 'external_managed'
  authorityDraft.keyBackend = 'device'
  authorityWizardStep.value = 2
}

function selectExternalProvider(providerId: string) {
  authorityDraft.providerId = providerId
  const provider = adcsProviders.value.find((item) => text(item.id) === providerId)
  if (provider) {
    authorityDraft.name = text(provider.name)
    authorityDraft.commonName = authorityDraft.name
    commonNameCustomized.value = false
  }
}

function applyParentRoot(parent?: InternalCaRecord) {
  if (!parent) return
  authorityDraft.parentCaId = text(parent.id)
  authorityDraft.providerId = text(parent.providerId)
  authorityDraft.trustDomainId = text(parent.trustDomainId)
  authorityDraft.securityDomain = text(parent.securityDomain, 'production')
  authorityDraft.topologyMode = 'root_with_intermediate'
  authorityCreationMode.value = 'builtin'
}

function selectParentRoot(parentId: string) {
  applyParentRoot(eligibleParentRoots.value.find((item) => text(item.id) === parentId))
}

async function advanceAuthorityWizard() {
  if (authorityCreationKind.value === 'root' && authorityWizardStep.value === 1) {
    return
  }
  if (authorityCreationKind.value === 'root' && authorityCreationMode.value === 'builtin' && authorityWizardStep.value === 2) {
    if (!authorityWizardForm.value?.reportValidity()) return
    await prepareBackend()
    if (authorityDraft.providerId) authorityWizardStep.value = 3
    return
  }
  if (authorityCreationKind.value === 'root' && authorityCreationMode.value === 'builtin' && authorityWizardStep.value === 3) {
    if (!authorityWizardForm.value?.reportValidity()) return
    await previewAuthority()
    if (authorityPreview.value) authorityWizardStep.value = 4
    return
  }
  if (authorityCreationKind.value === 'root' && authorityCreationMode.value === 'external' && authorityWizardStep.value === 2) {
    if (!authorityWizardForm.value?.reportValidity()) return
    await previewAuthority()
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
  if (authorityCreationMode.value === 'external') {
    return t(step === 1 ? 'internalCa.wizard.entryStep' : 'internalCa.wizard.authorityStep')
  }
  return t(step === 1 ? 'internalCa.wizard.entryStep' : step === 2 ? 'internalCa.wizard.backendStep' : step === 3 ? 'internalCa.wizard.authorityStep' : 'internalCa.wizard.reviewStep')
}

function backendModeLabel(backend: InternalCaRecord): string {
  const type = text(backend.type)
  if (type === 'gcac_builtin') return t('internalCa.backendTypes.builtin')
  if (type === 'acme') return t('internalCa.backendTypes.acme')
  return t('internalCa.backendTypes.external')
}

function backendDisplayName(backend: InternalCaRecord): string {
  return text(backend.type) === 'gcac_builtin'
    ? t('internalCa.wizard.builtinProviderName')
    : text(backend.name, t('common.notAvailable'))
}

function backendCapabilitySummary(backend: InternalCaRecord): string {
  const type = text(backend.type)
  if (type === 'gcac_builtin') return t('internalCa.backendSummary.createAndIssue')
  if (type === 'acme') return t('internalCa.backendSummary.requestPublicCertificates')
  return t('internalCa.backendSummary.external')
}

function backendVerificationSummary(backend: InternalCaRecord): string {
  const isVerified = asRecords(backend.capabilityRecords).some((record) => text(record.state) === 'verified')
  if (!isVerified) return t('internalCa.backendSummary.unverified')
  const type = text(backend.type)
  if (type === 'gcac_builtin') return t('internalCa.backendSummary.localVerified')
  return t('internalCa.backendSummary.remoteVerified')
}

function adcsRuntimeOf(backend: InternalCaRecord): InternalCaRecord {
  return asRecord(backend.runtime)
}

function adcsStatusLabel(status: unknown): string {
  const value = text(status)
  if (value === 'ONLINE') return t('internalCa.backendSummary.statusOnline')
  if (value === 'OFFLINE') return t('internalCa.backendSummary.statusOffline')
  return t('internalCa.backendSummary.statusUnknown')
}

function adcsStatusTone(status: unknown): StatusTone {
  const value = text(status)
  if (value === 'ONLINE') return 'success'
  if (value === 'OFFLINE') return 'danger'
  return 'muted'
}

function adcsAuthorityId(backend: InternalCaRecord): string {
  return text(activeAuthorities.value.find((authority) => text(authority.providerId) === text(backend.id))?.id)
}

async function refreshAdcsProvider(backend: InternalCaRecord): Promise<void> {
  const providerId = text(backend.id)
  const caId = adcsAuthorityId(backend)
  if (!providerId || !caId || adcsRefreshBusy.value) return
  adcsRefreshBusy.value = providerId
  error.value = ''
  try {
    const result = await internalCaApi.refreshAdcsObservations(caId)
    await loadAll()
    const lastRun = asRecord(asRecord(result.data).lastRun)
    window.dispatchEvent(new CustomEvent('gcac:toast', {
      detail: {
        message: t('internalCa.backendSummary.refreshSucceeded', { count: number(lastRun.insertedRecords ?? adcsRuntimeOf(backend).storedRecords) }),
        tone: 'success',
      },
    }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('internalCa.backendSummary.refreshFailed')
  } finally {
    adcsRefreshBusy.value = ''
  }
}

function backendLabel(providerId: unknown): string {
  const backend = providers.value.find((item) => text(item.id) === text(providerId))
  return backend ? backendModeLabel(backend) : t('common.notAvailable')
}

async function prepareBackend() {
  if (authorityDraft.providerId || authorityCreationKind.value === 'intermediate') return
  actionPending.value = true
  try {
    if (authorityCreationMode.value === 'builtin') {
      authorityDraft.providerId = text(builtinBackend.value?.id)
      if (!authorityDraft.providerId) {
        const result = await internalCaApi.createProvider({ name: t('internalCa.wizard.builtinProviderName'), type: 'gcac_builtin', deploymentMode: 'builtin', runtimePlatform: 'embedded', availabilityMode: 'single' })
        authorityDraft.providerId = text(result.data?.id)
        await loadAll()
      }
      return
    }
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
  const ok = await runAction(async () => {
    const result = await internalCaApi.createRequest({
      applicationAssetId: requestDraft.applicationAssetId,
      trustDomainId: requestDraft.trustDomainId,
      caId: requestDraft.caId,
      profileVersionId: requestDraft.profileVersionId,
      commonName: requestDraft.commonName,
      sans: splitList(requestDraft.sans),
      custodyMode: requestDraft.custodyMode,
      requestedValidityDays: 90,
    })
    if (requestDraft.custodyMode !== 'local_agent') return result
    const requestId = text(result.data?.id)
    if (!requestId) throw new Error(t('internalCa.requests.localAgentRequestIdMissing'))
    await internalCaApi.generateLocalCsr(requestId, {
      agentId: requestDraft.agentId,
      targetId: requestDraft.targetId,
      commonName: requestDraft.commonName,
      sans: splitList(requestDraft.sans),
      keyPath: requestDraft.keyPath,
      certificatePath: requestDraft.certificatePath,
      ...(requestDraft.configPath.trim() ? { configPath: requestDraft.configPath } : {}),
      format: requestDraft.format,
      ...(requestDraft.alias.trim() ? { alias: requestDraft.alias } : {}),
      storageMode: requestDraft.storageMode,
      idempotencyKey: `certificate-request:${requestId}:key-generate`,
    })
    return result
  }, 'internalCa.messages.requestCreated')
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

async function publishCrl(caId: string): Promise<void> {
  if (!caId) return
  await runAction(() => internalCaApi.publishCrl(caId), 'internalCa.operations.crlPublished')
}

function openAdcsModal(provider?: InternalCaRecord) {
  adcsEditingProviderId.value = text(provider?.id)
  const configuration = provider?.configuration as InternalCaRecord | undefined
  Object.assign(adcsDraft, {
    agentId: text(configuration?.agentId),
    agentKey: text(configuration?.agentKey),
    agentVersion: text(configuration?.agentVersion),
    installSessionId: text(configuration?.installSessionId),
    installCommand: text(configuration?.installCommand),
    installExpiresAt: text(configuration?.installExpiresAt),
  })
  error.value = ''
  adcsModalOpen.value = true
}

async function generateAdcsInstallCommand() {
  adcsInstallBusy.value = true
  error.value = ''
  try {
    const result = await createWindowsAdcsInstallSession({
      role: 'adcs_agent',
      zone: 'default',
      ...(adcsDraft.agentKey.trim() ? { agentKey: adcsDraft.agentKey.trim() } : {}),
    })
    const material = asRecord(result.data)
    Object.assign(adcsDraft, {
      agentKey: text(material.agentKey),
      agentVersion: text(material.agentVersion),
      installSessionId: text(material.sessionId),
      installCommand: text(material.installCommand),
      installExpiresAt: text(material.expiresAt),
    })
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('internalCa.adcs.messages.installCommandGenerated'), tone: 'success' } }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('internalCa.adcs.messages.installCommandFailed')
  } finally {
    adcsInstallBusy.value = false
  }
}

async function copyAdcsInstallCommand() {
  if (!adcsDraft.installCommand) return
  try {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(adcsDraft.installCommand)
      } catch {
        // 非安全上下文中回退到浏览器兼容剪贴板实现。
        copyTextWithLegacyApi(adcsDraft.installCommand)
      }
    } else {
      copyTextWithLegacyApi(adcsDraft.installCommand)
    }
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('internalCa.adcs.messages.installCommandCopied'), tone: 'success' } }))
  } catch {
    error.value = t('internalCa.adcs.messages.copyFailed')
  }
}

function copyTextWithLegacyApi(value: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!copied) throw new Error('clipboard copy failed')
}

async function associateAdcsAgent() {
  if (!adcsDraft.agentKey.trim()) {
    error.value = t('internalCa.adcs.messages.agentKeyMissing')
    return
  }
  adcsAssociationBusy.value = true
  error.value = ''
  try {
    const result = await listAgents({ page: 1, pageSize: 100, filters: { agentKey: adcsDraft.agentKey.trim() } })
    const agent = (result.data?.items ?? []).find((item) => text(item.agentKey) === adcsDraft.agentKey.trim() && text(item.role) === 'adcs_agent')
    if (!agent) throw new Error(t('internalCa.adcs.messages.agentNotFound'))
    const agentId = text(agent.id)
    if (!agentId) throw new Error(t('internalCa.adcs.messages.agentNotFound'))
    await loadAll()
    const provider = providers.value.find((item) => isAdcsProvider(item) && (
      text(item.id) === adcsEditingProviderId.value
      || text(asRecord(item.configuration).agentKey) === adcsDraft.agentKey.trim()
      || text(asRecord(item.configuration).agentId) === agentId
    ))
    if (!provider) throw new Error(t('internalCa.adcs.messages.agentNotFound'))
    adcsEditingProviderId.value = text(provider.id)
    await internalCaApi.updateProvider(text(provider.id), {
      configuration: {
        agentId,
        agentKey: adcsDraft.agentKey.trim(),
        ...(adcsDraft.agentVersion.trim() ? { agentVersion: adcsDraft.agentVersion.trim() } : {}),
        registrationStatus: 'linked',
        linkedAt: new Date().toISOString(),
      },
    })
    adcsDraft.agentId = agentId
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('internalCa.adcs.messages.agentAssociated'), tone: 'success' } }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError || caught instanceof Error ? caught.message : t('internalCa.adcs.messages.associationFailed')
  } finally {
    adcsAssociationBusy.value = false
  }
}

async function deleteAdcsProvider(provider: InternalCaRecord) {
  const ok = await runAction(() => internalCaApi.deleteProvider(text(provider.id)), 'internalCa.adcs.messages.deleted')
  if (ok) adcsModalOpen.value = false
}

function openAuthorityDeleteModal(authority: InternalCaRecord) {
  const authorityId = text(authority.id)
  if (!authorityId) return
  error.value = ''
  authorityDeleteTarget.value = authority
  authorityDeleteModalOpen.value = true
}

async function confirmAuthorityDelete() {
  const authorityId = text(authorityDeleteTarget.value?.id)
  if (!authorityId) return
  const ok = await runAction(() => internalCaApi.deleteAuthority(authorityId), 'internalCa.messages.authorityDeleted')
  if (ok) {
    authorityDeleteModalOpen.value = false
    authorityDeleteTarget.value = null
  }
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
function isAdcsProvider(value: InternalCaRecord): boolean {
  const configuration = asRecord(value.configuration)
  return text(value.type) === 'plugin' && text(configuration.providerKind) === 'microsoft_adcs'
}
function number(value: unknown): number { return Number(value ?? 0) }
function splitList(value: string): string[] { return value.split(',').map((item) => item.trim()).filter(Boolean) }
function asRecords(value: unknown): InternalCaRecord[] { return Array.isArray(value) ? value as InternalCaRecord[] : [] }
function asRecord(value: unknown): InternalCaRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as InternalCaRecord : {} }
function localTime(value: unknown): string { return formatBrowserLocalTime(value) || t('internalCa.common.unknown') }
function trustDomainName(value: unknown): string { return text(trustDomains.value.find((item) => text(item.id) === text(value))?.name, t('internalCa.common.unknown')) }
function evidenceOf(rotation: InternalCaRecord): InternalCaRecord { return asRecord(rotation.evidence) }
function providerName(providerId: unknown): string { return text(providers.value.find((item) => text(item.id) === text(providerId))?.name, t('internalCa.common.unknown')) }
function keySummaryOf(request: InternalCaRecord): InternalCaRecord { return asRecord(request.keyReferenceSummary) }
function custodyLabel(value: unknown): string {
  const key = text(value)
  if (key === 'local_agent') return t('internalCa.custodyModes.localAgent')
  if (key === 'managed_secret') return t('internalCa.custodyModes.managedSecret')
  if (key === 'device_local') return t('internalCa.custodyModes.deviceLocal')
  if (key === 'external_key') return t('internalCa.custodyModes.externalKey')
  return t('internalCa.common.unknown')
}
function protectionLabel(value: unknown): string {
  const key = text(value)
  if (key === 'hardware_backed') return t('internalCa.protectionLevels.hardwareBacked')
  if (key === 'os_protected') return t('internalCa.protectionLevels.osProtected')
  if (key === 'software_controlled') return t('internalCa.protectionLevels.softwareControlled')
  return t('internalCa.common.unknown')
}
function shortDigest(value: unknown): string {
  const digest = text(value)
  return digest.length > 16 ? `${digest.slice(0, 8)}...${digest.slice(-8)}` : digest || t('internalCa.common.unknown')
}
function requestDeploymentSummary(request: InternalCaRecord): string {
  const status = text(request.deploymentPlanStatus)
  if (status) return status
  if (text(request.status) === 'active') return t('internalCa.requests.deploymentActive')
  if (text(request.status) === 'deploy_failed') return t('internalCa.requests.deploymentBlocked')
  return t('internalCa.requests.deploymentPending')
}
</script>

<template>
  <section class="internal-ca-page" :class="{ 'gc-page': !props.embedded, 'internal-ca-page--embedded': props.embedded }">
    <GcPageHeader v-if="!props.embedded" :title="t('internalCa.title')" :description="t('internalCa.description')">
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
          <article v-for="root in rootAuthorities" :key="text(root.id)" class="root-ca-card gc-card" :class="{ 'is-selected': text(root.id) === text(selectedRoot?.id) }">
            <button type="button" class="root-ca-card__select" @click="selectRoot(root)">
              <span class="root-ca-card__accent"></span>
              <span class="root-ca-card__body">
                <span class="root-ca-card__title">
                  <strong>{{ text(root.name) }}</strong>
                  <GcStatusTag :status="text(root.status)" />
                </span>
                <span class="root-ca-card__cn">{{ text(root.subjectCommonName) }}</span>
                <span class="root-ca-card__meta">{{ trustDomainName(root.trustDomainId) }} · {{ text(root.securityDomain) }}</span>
                <span class="root-ca-card__expiry">{{ t('internalCa.labels.expiresAt', { time: localTime(root.notAfter) }) }}</span>
                <span class="root-ca-card__badge">{{ t('internalCa.labels.intermediateCount', { count: activeAuthorities.filter((item) => text(item.parentCaId) === text(root.id)).length }) }}</span>
              </span>
            </button>
            <button type="button" class="gc-button gc-button--sm gc-button--danger root-ca-card__delete" :aria-label="t('internalCa.actions.deleteAuthority')" @click="openAuthorityDeleteModal(root)">{{ t('internalCa.actions.deleteAuthority') }}</button>
          </article>
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
          <summary class="backend-settings__summary"><span>{{ t('internalCa.sections.issuingBackends') }}</span><button class="gc-button gc-button--primary gc-button--sm" type="button" @click.stop="openAdcsModal()">{{ t('internalCa.adcs.actions.add') }}</button></summary>
          <div class="backend-settings__list">
            <article v-for="backend in visibleProviders" :key="text(backend.id)" class="backend-summary">
              <div class="backend-summary__heading"><strong>{{ backendDisplayName(backend) }}</strong><span>{{ backendModeLabel(backend) }}</span></div>
              <GcStatusTag :status="text(backend.status)" />
              <small>{{ t('internalCa.labels.backendUsageCount', { count: activeAuthorities.filter((item) => text(item.providerId) === text(backend.id)).length }) }}</small>
              <small>{{ backendCapabilitySummary(backend) }}</small>
              <small>{{ backendVerificationSummary(backend) }}</small>
              <div v-if="isAdcsProvider(backend)" class="backend-summary__runtime">
                <template v-if="adcsRuntimeOf(backend).agentId">
                  <span><strong>{{ t('internalCa.backendSummary.agentVersion') }}:</strong> {{ text(adcsRuntimeOf(backend).version, t('internalCa.common.unknown')) }}</span>
                  <span><strong>{{ t('internalCa.backendSummary.agentVersionSource') }}:</strong> {{ text(adcsRuntimeOf(backend).versionSource) === 'heartbeat' ? t('internalCa.backendSummary.versionFromHeartbeat') : t('internalCa.backendSummary.versionFromRegistration') }}</span>
                  <span v-if="text(adcsRuntimeOf(backend).registeredVersion) && text(adcsRuntimeOf(backend).versionSource) === 'heartbeat' && text(adcsRuntimeOf(backend).registeredVersion) !== text(adcsRuntimeOf(backend).version)"><strong>{{ t('internalCa.backendSummary.registeredVersion') }}:</strong> {{ text(adcsRuntimeOf(backend).registeredVersion) }}</span>
                  <span><strong>{{ t('internalCa.backendSummary.agentKey') }}:</strong> <code>{{ text(adcsRuntimeOf(backend).agentKey, t('internalCa.common.unknown')) }}</code></span>
                  <span><strong>{{ t('internalCa.backendSummary.agentStatus') }}:</strong> <GcStatusTag :status="text(adcsRuntimeOf(backend).status)" :label="adcsStatusLabel(adcsRuntimeOf(backend).status)" :tone="adcsStatusTone(adcsRuntimeOf(backend).status)" /></span>
                  <span><strong>{{ t('internalCa.backendSummary.heartbeatAt') }}:</strong> {{ adcsRuntimeOf(backend).heartbeatAt ? localTime(adcsRuntimeOf(backend).heartbeatAt) : t('internalCa.backendSummary.observationNever') }}</span>
                  <span><strong>{{ t('internalCa.backendSummary.observationAt') }}:</strong> {{ adcsRuntimeOf(backend).lastObservationAt ? localTime(adcsRuntimeOf(backend).lastObservationAt) : t('internalCa.backendSummary.observationNever') }}</span>
                  <span><strong>{{ t('internalCa.backendSummary.storedRecords') }}:</strong> {{ number(adcsRuntimeOf(backend).storedRecords) }}</span>
                  <span v-if="adcsRuntimeOf(backend).scannedRecords !== undefined"><strong>{{ t('internalCa.backendSummary.observationStats', { scanned: number(adcsRuntimeOf(backend).scannedRecords), submitted: number(adcsRuntimeOf(backend).submittedRecords), inserted: number(adcsRuntimeOf(backend).insertedRecords) }) }}</strong></span>
                </template>
                <span v-else>{{ t('internalCa.backendSummary.noAgent') }}</span>
              </div>
              <div v-if="isAdcsProvider(backend)" class="backend-summary__actions">
                <button class="gc-button gc-button--sm gc-button--primary" type="button" :disabled="adcsRefreshBusy !== '' || !adcsAuthorityId(backend)" @click="refreshAdcsProvider(backend)">{{ adcsRefreshBusy === text(backend.id) ? t('internalCa.backendSummary.refreshing') : t('internalCa.backendSummary.refresh') }}</button>
                <button class="gc-button gc-button--sm" type="button" @click="openAdcsModal(backend)">{{ t('internalCa.adcs.actions.edit') }}</button>
                <button class="gc-button gc-button--sm gc-button--danger" type="button" @click="deleteAdcsProvider(backend)">{{ t('internalCa.adcs.actions.delete') }}</button>
              </div>
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
        <GcDataTable :columns="trustDomainColumns" :rows="trustDomains" :loading="loading" row-key="id" :empty-text="t('internalCa.trustDomains.empty')" dense pagination>
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
        <GcDataTable :columns="profileColumns" :rows="profiles" :loading="loading" row-key="id" :empty-text="t('internalCa.profiles.empty')" dense pagination>
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
        <GcDataTable :columns="requestColumns" :rows="recentRequests" :loading="loading" row-key="id" :empty-text="t('internalCa.requests.empty')" dense pagination>
          <template #toolbar>
            <div class="trust-domain-page__table-toolbar">
              <strong>{{ t('internalCa.requests.recordsTitle') }}</strong>
              <span>{{ t('businessPage.total', { count: requests.length }) }}</span>
            </div>
          </template>
          <template #cell-subjectCommonName="{ row }">
            <div class="trust-domain-page__cell-main">
              <strong>{{ text(row.subjectCommonName) }}</strong>
              <small>{{ t('internalCa.requests.policyVersion', { id: shortDigest(row.certificatePolicyVersionId) }) }}</small>
            </div>
          </template>
          <template #cell-keyReference="{ row }">
            <div class="trust-domain-page__cell-main">
              <strong>{{ custodyLabel(keySummaryOf(row).custodyMode) }}</strong>
              <small>{{ protectionLabel(keySummaryOf(row).protectionLevel) }} · {{ text(keySummaryOf(row).backendType, t('internalCa.common.unknown')) }}</small>
              <small>SPKI {{ shortDigest(keySummaryOf(row).publicKeyFingerprintSha256 || row.publicKeyFingerprintSha256) }}</small>
            </div>
          </template>
          <template #cell-certificate="{ row }">
            <div class="trust-domain-page__cell-main">
              <strong>{{ t('internalCa.requests.certificateVersion', { id: shortDigest(row.certificateVersionId) }) }}</strong>
              <small>{{ t('internalCa.requests.deployment', { status: requestDeploymentSummary(row) }) }}</small>
              <small v-if="row.deploymentPlanId">{{ t('internalCa.requests.deploymentPlan', { id: shortDigest(row.deploymentPlanId) }) }}</small>
              <small v-if="row.failureCode" class="lifecycle-warning">{{ text(row.failureCode) }}{{ row.failureMessage ? `: ${text(row.failureMessage)}` : '' }}</small>
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

    <!-- Section: 生命周期运维 -->
    <details class="ca-section gc-card" open>
      <summary class="ca-section__header">
        <span class="ca-section__title">{{ t('internalCa.operations.title') }}</span>
      </summary>
      <div class="ca-section__body lifecycle-operations">
        <section class="ca-subsection">
          <header class="ca-subsection__header"><span>{{ t('internalCa.operations.policiesTitle') }}</span><span>{{ t('businessPage.total', { count: certificatePolicies.length }) }}</span></header>
          <div v-if="certificatePolicies.length" class="lifecycle-list">
            <article v-for="policy in certificatePolicies" :key="text(policy.id)" class="lifecycle-row">
              <div><strong>{{ text(policy.name, t('internalCa.common.unknown')) }}</strong><small>{{ t('internalCa.operations.policyVersion', { version: text(asRecord(policy.version).id, t('internalCa.common.unknown')) }) }}</small></div>
              <GcStatusTag :status="text(policy.status, 'unknown')" />
              <small>{{ t('internalCa.operations.policyApproval', { required: asRecord(policy.rules).requireApproval === true ? t('common.yes') : t('common.no') }) }}</small>
            </article>
          </div>
          <p v-else class="lifecycle-empty">{{ t('internalCa.operations.emptyPolicies') }}</p>
        </section>

        <section class="ca-subsection">
          <header class="ca-subsection__header"><span>{{ t('internalCa.operations.bindingsTitle') }}</span><span>{{ t('businessPage.total', { count: providerActionBindings.length }) }}</span></header>
          <div v-if="providerActionBindings.length" class="lifecycle-list">
            <article v-for="binding in providerActionBindings" :key="text(binding.id)" class="lifecycle-row">
              <div><strong>{{ providerName(binding.providerId) }}</strong><small>{{ text(binding.pluginVersionId, t('internalCa.common.unknown')) }}</small></div>
              <GcStatusTag :status="text(binding.status, 'unknown')" />
              <small>{{ text(binding.executionLocation, t('internalCa.common.unknown')) }} · {{ text(asRecord(binding.issueAction).actionId, t('internalCa.common.unknown')) }}</small>
            </article>
          </div>
          <p v-else class="lifecycle-empty">{{ t('internalCa.operations.emptyBindings') }}</p>
        </section>

        <section class="ca-subsection">
          <header class="ca-subsection__header"><span>{{ t('internalCa.operations.rotationsTitle') }}</span><span>{{ t('businessPage.total', { count: certificateRotations.length }) }}</span></header>
          <div v-if="certificateRotations.length" class="lifecycle-list">
            <article v-for="rotation in certificateRotations" :key="text(rotation.id)" class="lifecycle-row lifecycle-row--rotation">
              <div><strong>{{ text(rotation.applicationAssetId, t('internalCa.common.unknown')) }}</strong><small>{{ text(rotation.id, t('internalCa.common.unknown')) }}</small></div>
              <GcStatusTag :status="text(rotation.status, 'unknown')" />
              <small>{{ t('internalCa.operations.plan', { id: text(evidenceOf(rotation).deploymentPlanId, t('internalCa.common.unknown')) }) }}</small>
              <small>{{ t('internalCa.operations.targetVersion', { id: text(rotation.targetCertificateVersionId, t('internalCa.common.unknown')) }) }}</small>
              <small>{{ t('internalCa.operations.tlsStatus', { status: text(evidenceOf(rotation).tlsVerification, t('internalCa.operations.tlsPending')) }) }}</small>
              <span v-if="evidenceOf(rotation).rollbackRequired === true" class="lifecycle-warning">{{ t('internalCa.operations.rollbackRequired') }}</span>
            </article>
          </div>
          <p v-else class="lifecycle-empty">{{ t('internalCa.operations.emptyRotations') }}</p>
        </section>

        <section class="ca-subsection">
          <header class="ca-subsection__header"><span>{{ t('internalCa.operations.crlTitle') }}</span><span>{{ t('businessPage.total', { count: crlPublications.length }) }}</span></header>
          <div v-if="crlPublications.length" class="lifecycle-list">
            <article v-for="publication in crlPublications" :key="text(publication.id)" class="lifecycle-row">
              <div><strong>{{ text(publication.caId, t('internalCa.common.unknown')) }}</strong><small>{{ t('internalCa.operations.crlNumber', { number: text(publication.crlNumber, t('internalCa.common.unknown')) }) }}</small></div>
              <GcStatusTag :status="text(publication.publicationStatus, 'unknown')" />
              <small>{{ localTime(publication.thisUpdate) }}</small>
              <button class="gc-button gc-button--sm" type="button" :disabled="actionPending" @click="publishCrl(text(publication.caId))">{{ t('internalCa.operations.publishCrl') }}</button>
            </article>
          </div>
          <p v-else class="lifecycle-empty">{{ t('internalCa.operations.emptyCrl') }}</p>
          <div v-if="!crlPublications.length && authorities.length" class="button-row">
            <button v-for="authority in authorities" :key="text(authority.id)" class="gc-button gc-button--sm" type="button" :disabled="actionPending" @click="publishCrl(text(authority.id))">{{ t('internalCa.operations.publishCrlFor', { name: text(authority.name, t('internalCa.common.unknown')) }) }}</button>
          </div>
        </section>
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
        <template v-if="requestDraft.custodyMode === 'local_agent'">
          <p class="trust-domain-form__hint">{{ t('internalCa.requests.localAgentHint') }}</p>
          <label>{{ t('internalCa.requests.agentId') }}<input v-model="requestDraft.agentId" required /></label>
          <label>{{ t('internalCa.requests.targetId') }}<input v-model="requestDraft.targetId" required /></label>
          <label>{{ t('internalCa.requests.keyPath') }}<input v-model="requestDraft.keyPath" required /></label>
          <label>{{ t('internalCa.requests.certificatePath') }}<input v-model="requestDraft.certificatePath" required /></label>
          <label>{{ t('internalCa.requests.format') }}<select v-model="requestDraft.format"><option value="pem">PEM</option><option value="pkcs12">PKCS#12</option><option value="jks">JKS</option></select></label>
          <label v-if="requestDraft.format !== 'pem'">{{ t('internalCa.requests.configPath') }}<input v-model="requestDraft.configPath" :required="requestDraft.format !== 'pem'" /></label>
          <label v-if="requestDraft.format !== 'pem'">{{ t('internalCa.requests.alias') }}<input v-model="requestDraft.alias" /></label>
          <label>{{ t('internalCa.requests.storageMode') }}<select v-model="requestDraft.storageMode"><option value="file_pem">{{ t('internalCa.requests.storageFile') }}</option><option value="windows_cng">{{ t('internalCa.requests.storageCng') }}</option></select></label>
        </template>
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
            <button type="button" class="ca-entry-card ca-entry-card--recommended" @click="chooseAuthorityMode"><span class="ca-entry-card__badge">{{ t('internalCa.wizard.recommended') }}</span><span class="ca-entry-card__icon">CA</span><strong>{{ t('internalCa.wizard.builtinTitle') }}</strong><p>{{ t('internalCa.wizard.builtinDescription') }}</p><ul><li>{{ t('internalCa.wizard.builtinFeature1') }}</li><li>{{ t('internalCa.wizard.builtinFeature2') }}</li></ul></button>
            <button type="button" class="ca-entry-card" :disabled="!adcsProviders.length" @click="chooseExternalAuthorityMode()"><span class="ca-entry-card__icon">AD</span><strong>{{ t('internalCa.wizard.externalTitle') }}</strong><p>{{ adcsProviders.length ? t('internalCa.wizard.externalDescription') : t('internalCa.wizard.externalUnavailable') }}</p><ul><li>{{ t('internalCa.wizard.externalFeature1') }}</li><li>{{ t('internalCa.wizard.externalFeature2') }}</li></ul></button>
          </div>
        </section>

        <form v-else-if="authorityCreationKind === 'root' && authorityWizardStep === 2 && authorityCreationMode === 'builtin'" ref="authorityWizardForm" class="ca-wizard__panel ca-wizard__form" @submit.prevent="advanceAuthorityWizard">
          <header class="ca-wizard__panel-heading ca-wizard__full"><span>{{ t('internalCa.wizard.backendEyebrow') }}</span><h3>{{ t(`internalCa.wizard.${authorityCreationMode}BackendTitle`) }}</h3><p>{{ t(`internalCa.wizard.${authorityCreationMode}BackendDescription`) }}</p></header>
          <article class="ca-wizard__notice ca-wizard__full"><strong>{{ t('internalCa.wizard.builtinAutomaticTitle') }}</strong><p>{{ t('internalCa.wizard.builtinAutomaticDescription') }}</p></article>
          <button class="ca-wizard__hidden-submit" tabindex="-1"></button>
        </form>

        <form v-else-if="(authorityCreationKind === 'root' && ((authorityCreationMode === 'builtin' && authorityWizardStep === 3) || (authorityCreationMode === 'external' && authorityWizardStep === 2))) || (authorityCreationKind === 'intermediate' && authorityWizardStep < 3)" ref="authorityWizardForm" class="ca-wizard__panel ca-wizard__form" @submit.prevent="advanceAuthorityWizard">
          <header class="ca-wizard__panel-heading ca-wizard__full"><span>{{ t('internalCa.wizard.authorityEyebrow') }}</span><h3>{{ authorityCreationMode === 'external' ? t('internalCa.wizard.externalTitle') : authorityCreationKind === 'root' ? t('internalCa.wizard.rootConfigurationTitle') : t('internalCa.wizard.intermediateConfigurationTitle') }}</h3><p>{{ authorityCreationMode === 'external' ? t('internalCa.wizard.externalDescription') : authorityCreationKind === 'root' ? t('internalCa.wizard.rootConfigurationDescription') : t('internalCa.wizard.intermediateConfigurationDescription') }}</p></header>
          <label v-if="authorityCreationKind === 'intermediate' && authorityWizardStep === 1" class="ca-wizard__full">{{ t('internalCa.fields.parentAuthority') }}<select :value="authorityDraft.parentCaId" required @change="selectParentRoot(($event.target as HTMLSelectElement).value)"><option v-for="item in eligibleParentRoots" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
          <template v-else>
             <label v-if="authorityCreationMode === 'external'" class="ca-wizard__full">{{ t('internalCa.fields.issuingBackend') }}<select :value="authorityDraft.providerId" required @change="selectExternalProvider(($event.target as HTMLSelectElement).value)"><option v-for="item in adcsProviders" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
             <label v-if="authorityCreationKind === 'root' && authorityCreationMode === 'builtin'">{{ t('internalCa.fields.trustDomain') }}<select v-model="authorityDraft.trustDomainId" required><option v-for="item in trustDomains" :key="text(item.id)" :value="text(item.id)">{{ text(item.name) }}</option></select></label>
             <label>{{ t('internalCa.fields.name') }}<input v-model="authorityDraft.name" required /></label>
             <label>{{ t('internalCa.fields.securityDomain') }}<input v-model="authorityDraft.securityDomain" required /></label>
             <label v-if="authorityCreationKind === 'root' && authorityCreationMode === 'builtin'">{{ t('internalCa.fields.topology') }}<select v-model="authorityDraft.topologyMode"><option value="root_only">{{ t('internalCa.topology.rootOnly') }}</option><option value="root_with_intermediate">{{ t('internalCa.topology.intermediate') }}</option></select></label>
             <p v-if="authorityCreationMode === 'external'" class="ca-wizard__hint ca-wizard__full">{{ t('internalCa.wizard.externalTrustDomainHint') }}</p>
             <details v-if="authorityCreationMode === 'builtin'" class="ca-wizard__advanced ca-wizard__full" :open="authoritySubjectAdvancedOpen" @toggle="authoritySubjectAdvancedOpen = ($event.target as HTMLDetailsElement).open">
               <summary>{{ t('internalCa.wizard.advancedSubjectTitle') }}</summary>
               <div v-if="authoritySubjectAdvancedOpen" class="ca-wizard__advanced-body">
                 <label>{{ t('internalCa.fields.certificateSubjectCommonName') }}<input v-model="authorityDraft.commonName" :placeholder="authorityDraft.name" required @input="commonNameCustomized = true" /></label>
                 <small>{{ t('internalCa.wizard.commonNameHelp') }}</small>
               </div>
             </details>
             <article class="ca-wizard__backend-summary ca-wizard__full"><span>{{ t('internalCa.fields.issuingBackend') }}</span><strong>{{ authorityCreationKind === 'intermediate' || authorityCreationMode === 'external' ? backendLabel(authorityDraft.providerId) : t(`internalCa.wizard.${authorityCreationMode}Title`) }}</strong><small>{{ t(`internalCa.wizard.${selectedCreationMode}SecurityNote`) }}</small></article>
          </template>
          <button class="ca-wizard__hidden-submit" tabindex="-1"></button>
        </form>

        <section v-else class="ca-wizard__panel ca-wizard__review">
          <header class="ca-wizard__panel-heading"><span>{{ t('internalCa.wizard.reviewEyebrow') }}</span><h3>{{ t('internalCa.wizard.reviewTitle') }}</h3><p>{{ t('internalCa.wizard.reviewDescription') }}</p></header>
          <div class="ca-wizard__review-grid"><span>{{ t('internalCa.fields.entryMode') }}</span><strong>{{ t(`internalCa.wizard.${selectedCreationMode}Title`) }}</strong><span>{{ t('internalCa.fields.authorityType') }}</span><strong>{{ authorityCreationKind === 'root' ? t('internalCa.wizard.rootTitle') : t('internalCa.wizard.intermediateTitle') }}</strong><span>{{ t('internalCa.fields.name') }}</span><strong>{{ authorityDraft.name }}</strong><span>{{ t('internalCa.fields.certificateSubjectCommonName') }}</span><strong>{{ authorityDraft.commonName }}</strong><span>{{ t('internalCa.fields.trustDomain') }}</span><strong>{{ authorityCreationMode === 'external' ? t('internalCa.wizard.externalTrustDomainAuto') : trustDomainName(authorityDraft.trustDomainId) }}</strong><template v-if="authorityCreationMode === 'external'"><span>{{ t('internalCa.fields.issuingBackend') }}</span><strong>{{ backendLabel(authorityDraft.providerId) }}</strong></template></div>
          <article class="ca-wizard__risk"><strong>{{ t('internalCa.sections.riskSummary') }}</strong><p>{{ text(authorityPreview?.overallRecommendation) }}</p><ul><li v-for="warning in asRecords(authorityPreview?.warnings)" :key="String(warning)">{{ warning }}</li></ul><p v-if="!asRecords(authorityPreview?.warnings).length">{{ t('internalCa.wizard.noWarnings') }}</p></article>
        </section>
      </div>
      <template #actions><button v-if="authorityWizardStep > 1" class="gc-button" type="button" :disabled="actionPending" @click="previousAuthorityWizardStep">{{ t('internalCa.actions.previous') }}</button><button v-if="authorityWizardStep < wizardStepCount" class="gc-button gc-button--primary" type="button" :disabled="actionPending || (authorityCreationKind === 'intermediate' && authorityWizardStep === 1 && !authorityDraft.parentCaId)" @click="advanceAuthorityWizard">{{ t('internalCa.actions.next') }}</button><button v-else class="gc-button gc-button--primary" type="button" :disabled="actionPending || (authorityCreationMode === 'external' && !authorityDraft.providerId)" @click="createAuthority">{{ t('internalCa.actions.createAuthority') }}</button></template>
    </GcModal>

    <GcModal v-model:open="authorityDeleteModalOpen" size="sm" :title="t('internalCa.actions.deleteAuthority')" :description="t('internalCa.messages.confirmAuthorityDelete', { name: text(authorityDeleteTarget?.name) })" :busy="actionPending" :error="error">
      <template #actions>
        <button class="gc-button" type="button" :disabled="actionPending" @click="authorityDeleteModalOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="actionPending" @click="confirmAuthorityDelete">{{ t('designSystem.confirm.confirm') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="adcsModalOpen" size="xl" :title="adcsEditingProviderId ? t('internalCa.adcs.modal.editTitle') : t('internalCa.adcs.modal.addTitle')" :description="t('internalCa.adcs.modal.description')">
      <div id="adcs-provider-form" class="adcs-provider-form">
        <section class="adcs-install-panel adcs-provider-form__full">
          <header class="adcs-install-panel__header">
            <strong>{{ t('internalCa.adcs.install.title') }}</strong>
            <button class="gc-button gc-button--primary gc-button--sm" type="button" :disabled="adcsInstallBusy || actionPending" @click="generateAdcsInstallCommand">
              {{ adcsInstallBusy ? t('common.loading') : adcsDraft.installCommand ? t('internalCa.adcs.install.regenerate') : t('internalCa.adcs.install.generate') }}
            </button>
          </header>
          <div v-if="adcsDraft.installCommand" class="adcs-install-panel__command">
            <code>{{ adcsDraft.installCommand }}</code>
            <button class="gc-button gc-button--sm" type="button" :disabled="adcsInstallBusy" @click="copyAdcsInstallCommand">{{ t('internalCa.adcs.install.copy') }}</button>
          </div>
          <p v-else class="adcs-install-panel__empty">{{ t('internalCa.adcs.install.notGenerated') }}</p>
          <div class="adcs-install-panel__meta">
            <span>{{ t('internalCa.adcs.install.version') }}: <code>{{ adcsDraft.agentVersion || t('internalCa.common.unknown') }}</code></span>
            <span>{{ t('internalCa.adcs.fields.agentKey') }}: <code>{{ adcsDraft.agentKey || t('internalCa.common.unknown') }}</code></span>
            <span v-if="adcsDraft.installExpiresAt">{{ t('internalCa.adcs.install.expiresAt', { time: localTime(adcsDraft.installExpiresAt) }) }}</span>
          </div>
          <div class="adcs-install-panel__association">
            <span v-if="adcsDraft.agentId">{{ t('internalCa.adcs.install.associated', { agentId: adcsDraft.agentId }) }}</span>
            <span v-else>{{ t('internalCa.adcs.install.waitingAssociation') }}</span>
            <button v-if="adcsEditingProviderId && adcsDraft.agentKey && !adcsDraft.agentId" class="gc-button gc-button--sm" type="button" :disabled="adcsAssociationBusy || actionPending" @click="associateAdcsAgent">
              {{ adcsAssociationBusy ? t('common.loading') : t('internalCa.adcs.install.associate') }}
            </button>
          </div>
        </section>
      </div>
      <template #actions>
        <button class="gc-button gc-button--primary" type="button" @click="adcsModalOpen = false">{{ t('common.close') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.internal-ca-page { display: grid; gap: var(--gc-space-5); }
.internal-ca-page--embedded { gap: var(--gc-space-4); }
.trust-domain-page__table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.trust-domain-page__table-toolbar span { color: var(--gc-color-text-muted); }
.trust-domain-page__cell-main { display: grid; gap: var(--gc-space-1); }
.trust-domain-form { display: grid; gap: var(--gc-space-4); }
.trust-domain-form__hint { margin: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); color: var(--gc-color-text-muted); background: var(--gc-color-info-bg); }
.adcs-install-panel { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-md); background: var(--gc-color-info-bg); }
.adcs-install-panel__header, .adcs-install-panel__association, .adcs-install-panel__meta { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); flex-wrap: wrap; }
.adcs-install-panel__header strong { color: var(--gc-color-text-strong); }
.adcs-install-panel__header p, .adcs-install-panel__empty { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.adcs-install-panel__command { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--gc-space-2); align-items: center; }
.adcs-install-panel__command code { display: block; overflow: auto; min-width: 0; padding: var(--gc-space-3); color: var(--gc-color-text); background: var(--gc-color-surface-field); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); white-space: pre-wrap; overflow-wrap: anywhere; }
.adcs-install-panel__meta, .adcs-install-panel__association { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.adcs-install-panel__meta code { color: var(--gc-color-text); }
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
.root-ca-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--gc-space-3); min-width: 0; padding: var(--gc-space-3) var(--gc-space-4); color: var(--gc-color-text); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); transition: border-color 140ms ease, box-shadow 140ms ease; align-items: start; }
.root-ca-card:hover { border-color: var(--gc-color-primary-border); box-shadow: var(--gc-shadow-hover); }
.root-ca-card.is-selected { border-color: var(--gc-color-primary); background: var(--gc-color-surface-selected); }
.root-ca-card__select { display: grid; grid-template-columns: var(--gc-space-1) minmax(0, 1fr); gap: 0 var(--gc-space-3); min-width: 0; padding: 0; text-align: left; color: inherit; cursor: pointer; border: 0; background: transparent; align-items: stretch; }
.root-ca-card__select:focus-visible { outline: var(--gc-border-width-default) solid var(--gc-color-focus-ring); outline-offset: var(--gc-space-1); border-radius: var(--gc-radius-sm); }
.root-ca-card__delete { align-self: start; white-space: nowrap; }
.root-ca-card__accent { width: var(--gc-space-1); height: 100%; min-height: var(--gc-control-height-sm); border-radius: var(--gc-radius-xl); background: var(--gc-color-primary); }
.root-ca-card.is-selected .root-ca-card__accent { background: var(--gc-color-primary); box-shadow: var(--gc-shadow-focus); }
.root-ca-card__body { display: grid; gap: var(--gc-space-hairline); min-width: 0; }
.root-ca-card__title { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: var(--gc-space-2); min-width: 0; font-size: var(--gc-font-size-sm); }
.root-ca-card__title strong { min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-ca-card__cn { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-ca-card__meta { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root-ca-card__expiry { font-size: var(--gc-font-size-xs); color: var(--gc-color-text-soft); }
.root-ca-card__badge { justify-self: start; margin-top: var(--gc-space-1); padding: var(--gc-space-hairline) var(--gc-space-2); border-radius: var(--gc-radius-xl); background: var(--gc-color-primary-soft); color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: var(--gc-font-weight-semibold); white-space: normal; overflow-wrap: anywhere; }
.ca-architecture { margin-top: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); overflow: hidden; }
.ca-architecture__header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-3); margin-bottom: var(--gc-space-3); }
.ca-architecture__eyebrow { font-size: var(--gc-font-size-sm); font-weight: 600; color: var(--gc-color-text-strong); }
.ca-architecture__desc { margin: var(--gc-space-1) 0 0; font-size: var(--gc-font-size-xs); color: var(--gc-color-text-muted); }
.ca-tree { display: grid; justify-items: center; gap: 0; }
.ca-node { display: grid; gap: var(--gc-space-1); width: min(100%, var(--gc-size-sidebar)); padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); text-align: left; }
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
.backend-settings__summary { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); cursor: pointer; color: var(--gc-color-text-strong); font-weight: 700; }
.backend-settings__list { display: grid; gap: var(--gc-space-3); margin-top: var(--gc-space-4); }
.backend-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-muted); }
.backend-summary div { display: grid; gap: var(--gc-space-1); }
.backend-summary span, .backend-summary small { color: var(--gc-color-text-muted); }
.backend-summary__actions { display: flex !important; gap: var(--gc-space-2); align-items: center; justify-content: flex-end; }
.backend-summary__runtime { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--gc-space-2) var(--gc-space-4); padding: var(--gc-space-2) 0 0; border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.backend-summary__runtime span { display: inline-flex; align-items: center; gap: var(--gc-space-1); }
.backend-summary__runtime strong { color: var(--gc-color-text); font-weight: 600; }
.backend-summary__runtime code { font-family: var(--gc-font-family-mono); overflow-wrap: anywhere; }
.adcs-provider-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.adcs-provider-form__full { grid-column: 1 / -1; }
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
.ca-wizard__panel { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-5); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); }
.ca-wizard__panel-heading { display: grid; gap: var(--gc-space-2); }
.ca-wizard__panel-heading span { color: var(--gc-color-primary); font-size: var(--gc-font-size-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0; }
.ca-wizard__panel-heading h3, .ca-wizard__panel-heading p { margin: 0; }
.ca-wizard__panel-heading p { color: var(--gc-color-text-muted); }
.ca-wizard__entry-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-4); }
.ca-entry-card { position: relative; display: grid; align-content: start; justify-items: start; gap: var(--gc-space-3); min-height: var(--gc-size-card-min); padding: var(--gc-space-5); border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-lg); color: var(--gc-color-text); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); text-align: left; cursor: pointer; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
.ca-entry-card:hover { border-color: var(--gc-color-primary); background: var(--gc-color-surface-selected); transform: translateY(calc(var(--gc-space-1) * -1)); }
.ca-entry-card--recommended { border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.ca-entry-card__badge { position: absolute; inset-block-start: var(--gc-space-3); inset-inline-end: var(--gc-space-3); padding: var(--gc-space-1) var(--gc-space-2); border-radius: var(--gc-radius-xl); color: var(--gc-color-success); background: var(--gc-color-success-soft); font-size: var(--gc-font-size-xs); font-weight: 700; }
.ca-entry-card__icon { display: grid; place-items: center; width: var(--gc-space-10); aspect-ratio: 1; border-radius: var(--gc-radius-lg); color: var(--gc-color-primary); background: var(--gc-color-primary-soft); font-weight: 800; }
.ca-entry-card p { margin: 0; color: var(--gc-color-text-muted); }
.ca-entry-card ul { display: grid; gap: var(--gc-space-2); margin: 0; padding-inline-start: var(--gc-space-5); color: var(--gc-color-text-muted); }
.ca-wizard__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.ca-wizard__full { grid-column: 1 / -1; }
.ca-wizard__advanced { display: grid; gap: var(--gc-space-3); padding-top: var(--gc-space-3); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.ca-wizard__advanced summary { width: fit-content; color: var(--gc-color-primary); font-size: var(--gc-font-size-sm); font-weight: 700; cursor: pointer; }
.ca-wizard__advanced-body { display: grid; gap: var(--gc-space-2); }
.ca-wizard__advanced-body small { color: var(--gc-color-text-muted); }
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
.ca-section { padding: 0; border: var(--gc-border-width-default) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); overflow: hidden; }
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
.lifecycle-operations { gap: var(--gc-space-4); }
.lifecycle-list { display: grid; gap: var(--gc-space-2); }
.lifecycle-row { display: grid; grid-template-columns: minmax(0, 1.4fr) auto minmax(0, 1fr); align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-field); }
.lifecycle-row > div { display: grid; gap: var(--gc-space-1); min-width: 0; }
.lifecycle-row strong, .lifecycle-row small { overflow-wrap: anywhere; }
.lifecycle-row small { color: var(--gc-color-text-muted); }
.lifecycle-row--rotation { grid-template-columns: minmax(0, 1.2fr) auto repeat(3, minmax(0, 1fr)) auto; }
.lifecycle-warning { color: var(--gc-color-danger); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); }
.lifecycle-empty { margin: 0; color: var(--gc-color-text-muted); }
@media (max-width: 48rem) {
  .authority-toolbar, .ca-architecture__header, .ca-section__header { align-items: stretch; flex-direction: column; }
  .ca-section__actions { justify-content: flex-start; }
  .ca-wizard__entry-grid, .ca-wizard__form, .ca-tree__children { grid-template-columns: 1fr; }
  .ca-wizard__progress ol { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .backend-summary { grid-template-columns: minmax(0, 1fr) auto; }
  .backend-summary small { grid-column: 1 / -1; }
  .backend-summary__actions { grid-column: 1 / -1; justify-content: flex-start; }
  .root-ca-card { grid-template-columns: 1fr; }
  .root-ca-card__delete { justify-self: end; }
  .adcs-provider-form { grid-template-columns: 1fr; }
  .adcs-provider-form__full { grid-column: auto; }
  .lifecycle-row, .lifecycle-row--rotation { grid-template-columns: minmax(0, 1fr) auto; }
  .lifecycle-row > small, .lifecycle-row > .lifecycle-warning { grid-column: 1 / -1; }
}
</style>
