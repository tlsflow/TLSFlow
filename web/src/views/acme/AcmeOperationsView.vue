<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { listCertificateVersions, listCertificates } from '@/api/modules/certificates.api'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { createSecret } from '@/api/modules/security.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  GcAcmeDnsCredentialSelect,
  GcButton,
  GcCard,
  GcConfirmAction,
  GcDataTable,
  GcModal,
  GcPageToolbar,
  GcSecretRefSelect,
  GcStatusTag,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import AcmeCertificateRequestModal from './AcmeCertificateRequestModal.vue'

type AcmeStatus = 'READY' | 'BLOCKED' | 'UNKNOWN'
type AcmeProvider = InternalCaRecord & {
  id?: string
  name?: string
  endpoint?: string
  status?: string
  configuration?: InternalCaRecord
}
type AcmeProviderProfile = InternalCaRecord & {
  key?: string
  displayName?: string
  category?: string
  version?: string
  directory?: InternalCaRecord
  account?: InternalCaRecord
  form?: InternalCaRecord
  preconfiguration?: InternalCaRecord
}

const VERSION_PAGE_SIZE = 200
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const { t } = useI18n()

const loading = ref(false)
const actionPending = ref(false)
const error = ref('')
const status = ref<AcmeStatus>('UNKNOWN')
const providerName = ref('')
const assets = ref<ApiRecord[]>([])
const versions = ref<ApiRecord[]>([])
const policies = ref<InternalCaRecord[]>([])
const jobs = ref<InternalCaRecord[]>([])
const orders = ref<InternalCaRecord[]>([])
const accounts = ref<InternalCaRecord[]>([])
const providers = ref<AcmeProvider[]>([])
const providerProfiles = ref<AcmeProviderProfile[]>([])
const dnsProviders = ref<InternalCaRecord[]>([])
const formOpen = ref(false)
const editOpen = ref(false)
const detailOpen = ref(false)
const providerDialogOpen = ref(false)
const providerEditorOpen = ref(false)
const eabEditorOpen = ref(false)
const formError = ref('')
const providerError = ref('')
const providerEditingId = ref('')
const providerNameAuto = ref(true)
const providerTestId = ref('')
const providerTestResult = ref('')
const providerDirectoryProbeState = ref<'idle' | 'probing' | 'succeeded' | 'failed'>('idle')
const providerDirectoryProbeError = ref('')
const providerDirectoryExternalAccountRequired = ref<boolean | null>(null)
const eabError = ref('')
const eabPending = ref(false)
const eabSecretOptions = ref<Array<{ value: string; label: string }>>([])
const selectedAsset = ref<ApiRecord | null>(null)
const editingAsset = ref<ApiRecord | null>(null)
const manualRenewalAssetId = ref('')
const retryingJobId = ref('')

const editDraft = reactive({
  name: '',
  providerId: '',
  domains: '',
  contactEmail: '',
  challengeType: 'http-01',
  dnsProvider: '',
  dnsCredentialId: '',
  dnsPropagationSeconds: 60,
  keyType: 'rsa',
  autoRenew: true,
  renewalWindowDays: 7,
})
const providerDraft = reactive({
  name: '',
  profileKey: 'letsencrypt',
  directoryUrl: '',
  trustBundleSecretRef: '',
  contactEmail: '',
  eabSecretRef: '',
  isDefault: false,
})
const eabDraft = reactive({
  name: '',
  keyId: '',
  hmacKey: '',
})

const selectedProviderProfile = computed(() => providerProfile(providerDraft.profileKey))
const providerDraftRequiresDirectory = computed(() => profileHasProviderField(selectedProviderProfile.value, 'directoryUrl'))
const providerDraftUsesTrustBundle = computed(() => profileHasAccountField(selectedProviderProfile.value, 'trustBundleSecretRef'))
const providerDraftEabPolicy = computed(() => text(recordValue(selectedProviderProfile.value?.account).eab))
const providerDraftRequiresEab = computed(() => providerDraftEabPolicy.value === 'required'
  || (providerDraftEabPolicy.value === 'discover' && providerDirectoryExternalAccountRequired.value === true))
const providerDraftUsesEab = computed(() => providerDraftEabPolicy.value === 'required'
  || (providerDraftEabPolicy.value === 'discover' && providerDirectoryProbeState.value === 'succeeded' && providerDirectoryExternalAccountRequired.value === true))
const selectedProviderNeedsPreconfiguration = computed(() => recordValue(selectedProviderProfile.value?.preconfiguration).required === true)
const selectedProviderPreconfigurationSource = computed(() => text(recordValue(selectedProviderProfile.value?.preconfiguration).source, 'none'))

const activeProviders = computed(() => providers.value.filter((item) => (
  text(item.type, 'acme') === 'acme' && text(item.status, 'active') === 'active'
)))
const defaultProvider = computed(() => activeProviders.value.find((item) => providerConfig(item).isDefault === true) ?? activeProviders.value[0])
const selectedEditDnsProvider = computed(() => dnsProviders.value.find((item) => text(item.id) === editDraft.dnsProvider))
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
const statusTone = computed(() => status.value === 'READY' ? 'success' : status.value === 'BLOCKED' ? 'warning' : 'muted')
const assetColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'name', title: t('acme.list.columns.name') },
  { key: 'domains', title: t('acme.list.columns.domains') },
  { key: 'status', title: t('acme.list.columns.status') },
  { key: 'expiresAt', title: t('acme.list.columns.expiresAt') },
  { key: 'nextRenewalIn', title: t('acme.list.columns.nextRenewalIn') },
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
  { key: 'identifiers', title: t('acme.order.identifiers') },
  { key: 'status', title: t('acme.order.status') },
  { key: 'updatedAt', title: t('acme.order.updatedAt') },
])

onMounted(() => {
  void loadAll()
})

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [statusResult, assetResult, versionResult, policyResult, jobResult, orderResult, accountResult, providerResult, profileResult, dnsProviderResult] = await Promise.allSettled([
      internalCaApi.getAcmeStatus(),
      listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listAllAcmeCertificateVersions(),
      internalCaApi.listAcmeRenewalPolicies(),
      internalCaApi.listAcmeRenewalJobs(),
      internalCaApi.listAcmeOrders(),
      internalCaApi.listAcmeAccounts(),
      internalCaApi.listAcmeProviders(),
      internalCaApi.listAcmeProviderProfiles(),
      internalCaApi.listAcmeDnsProviders(),
    ])
    if (statusResult.status === 'fulfilled') {
      const statusData = statusResult.value.data ?? {}
      status.value = normalizeStatus(statusData.status)
      providerName.value = text((statusData.provider as InternalCaRecord | undefined)?.name, t('acme.issuer.letsencrypt'))
    }
    if (assetResult.status === 'fulfilled') assets.value = [...(assetResult.value.data?.items ?? [])]
    if (versionResult.status === 'fulfilled') versions.value = versionResult.value
    if (policyResult.status === 'fulfilled') policies.value = readRecords(policyResult.value.data)
    if (jobResult.status === 'fulfilled') jobs.value = readRecords(jobResult.value.data)
    if (orderResult.status === 'fulfilled') orders.value = readRecords(orderResult.value.data)
    if (accountResult.status === 'fulfilled') accounts.value = readRecords(accountResult.value.data)
    if (dnsProviderResult.status === 'fulfilled') dnsProviders.value = readRecords(dnsProviderResult.value.data)
    if (providerResult.status === 'fulfilled') {
      const data = providerResult.value.data ?? {}
      providers.value = Array.isArray(data) ? [...data] : Array.isArray(data.items) ? [...data.items] : []
      providerProfiles.value = readRecords(data.profiles) as AcmeProviderProfile[]
      if (!providerName.value && defaultProvider.value) providerName.value = text(defaultProvider.value.name, t('acme.issuer.letsencrypt'))
    }
    if (profileResult.status === 'fulfilled') {
      providerProfiles.value = readRecords(profileResult.value.data) as AcmeProviderProfile[]
    }
    const failures = [statusResult, assetResult, versionResult, policyResult, jobResult, orderResult, accountResult, providerResult, profileResult, dnsProviderResult]
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

async function listAllAcmeCertificateVersions(): Promise<ApiRecord[]> {
  const items: ApiRecord[] = []
  let page = 1
  while (true) {
    const result = await listCertificateVersions({
      page,
      pageSize: VERSION_PAGE_SIZE,
      sort: 'createdAt:desc',
      filters: { sourceType: 'acme' },
    })
    const pageItems = [...(result.data?.items ?? [])]
    items.push(...pageItems)
    if (pageItems.length < VERSION_PAGE_SIZE || items.length >= Number(result.data?.total ?? 0)) return items
    page += 1
  }
}

function openCreate(): void {
  formError.value = ''
  formOpen.value = true
}

function openEdit(asset: ApiRecord): void {
  const policy = assetPolicy(asset)
  if (!policy || hasRunningJob(asset)) return
  const maintenanceWindow = recordValue(policy.maintenanceWindow)
  editingAsset.value = asset
  Object.assign(editDraft, {
    name: text(asset.name),
    providerId: text(policy.providerId),
    domains: domainsOf(asset),
    contactEmail: text(maintenanceWindow.contactEmail),
    challengeType: text(policy.challengeType, 'http-01'),
    dnsProvider: text(maintenanceWindow.dnsProvider),
    dnsCredentialId: text(maintenanceWindow.dnsCredentialId),
    dnsPropagationSeconds: numberValue(maintenanceWindow.dnsPropagationSeconds) ?? 60,
    keyType: text(maintenanceWindow.keyType, 'rsa'),
    autoRenew: policyEnabled(asset),
    renewalWindowDays: numberValue(policy.renewalWindowDays) ?? 7,
  })
  formError.value = ''
  editOpen.value = true
}

function openDetails(asset: ApiRecord): void {
  selectedAsset.value = asset
  detailOpen.value = true
}

async function saveEdit(): Promise<void> {
  const assetId = text(editingAsset.value?.id)
  const domains = normalizeDomains(editDraft.domains)
  if (!assetId || !domains.length || !editDraft.contactEmail.trim() || !editDraft.providerId) {
    formError.value = t('acme.messages.requiredFields')
    return
  }
  if (editDraft.challengeType === 'dns-01' && (!editDraft.dnsProvider || !editDraft.dnsCredentialId)) {
    formError.value = t('acme.messages.dnsFieldsRequired')
    return
  }
  actionPending.value = true
  formError.value = ''
  try {
    await internalCaApi.updateAcmeCertificate(assetId, {
      name: editDraft.name.trim() || undefined,
      providerId: editDraft.providerId,
      domains,
      contactEmail: editDraft.contactEmail.trim(),
      challengeType: editDraft.challengeType,
      dnsProvider: editDraft.challengeType === 'dns-01' ? editDraft.dnsProvider : undefined,
      dnsCredentialId: editDraft.challengeType === 'dns-01' ? editDraft.dnsCredentialId : undefined,
      dnsPropagationSeconds: editDraft.challengeType === 'dns-01' ? editDraft.dnsPropagationSeconds : undefined,
      keyType: editDraft.keyType,
      autoRenew: editDraft.autoRenew,
      renewalWindowDays: editDraft.renewalWindowDays,
    })
    editOpen.value = false
    editingAsset.value = null
    notify(t('acme.messages.updated'), 'success')
    await loadAll()
  } catch (caught) {
    formError.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

async function renew(asset: ApiRecord): Promise<void> {
  const id = text(asset.id)
  if (!id || !policyEnabled(asset) || hasRunningJob(asset)) return
  manualRenewalAssetId.value = id
  await runAction(() => internalCaApi.manualRenewAcmeCertificate(id), t('acme.messages.renewed'))
  manualRenewalAssetId.value = ''
}

async function toggleRenewal(asset: ApiRecord): Promise<void> {
  const policy = assetPolicy(asset)
  if (!policy || hasRunningJob(asset)) return
  const enabled = policyEnabled(asset)
  await runAction(
    () => internalCaApi.updateAcmeRenewalPolicy(text(policy.id), { enabled: !enabled }),
    t('acme.messages.policyUpdated'),
  )
}

async function remove(asset: ApiRecord): Promise<void> {
  const id = text(asset.id)
  if (!id || hasRunningJob(asset)) return
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

function openProviderSettings(): void {
  providerError.value = ''
  providerTestResult.value = ''
  providerDialogOpen.value = true
}

function openProviderEditor(provider?: AcmeProvider): void {
  providerError.value = ''
  providerEditingId.value = text(provider?.id)
  providerNameAuto.value = !provider
  providerDirectoryProbeState.value = 'idle'
  providerDirectoryProbeError.value = ''
  providerDirectoryExternalAccountRequired.value = null
  const configuration = providerConfig(provider)
  const profileKey = normalizeProfileKey(configuration.profileKey ?? configuration.preset)
    || text(providerProfiles.value[0]?.key, 'letsencrypt')
  const profile = providerProfile(profileKey)
  const savedDirectory = recordValue(recordValue(configuration.verification).directory)
  if (savedDirectory.reachable === true && typeof savedDirectory.externalAccountRequired === 'boolean') {
    providerDirectoryProbeState.value = 'succeeded'
    providerDirectoryExternalAccountRequired.value = savedDirectory.externalAccountRequired
  }
  Object.assign(providerDraft, {
    name: text(provider?.name, profileLabel(profile)),
    profileKey,
    directoryUrl: text(configuration.directoryUrl, text(provider?.endpoint, text(recordValue(profile?.directory).defaultUrl))),
    trustBundleSecretRef: text(configuration.trustBundleSecretRef),
    contactEmail: '',
    eabSecretRef: '',
    isDefault: configuration.isDefault === true,
  })
  providerDialogOpen.value = false
  providerEditorOpen.value = true
}

async function probeProviderDirectory(): Promise<void> {
  if (!providerDraft.profileKey || (providerDraftRequiresDirectory.value && !providerDraft.directoryUrl.trim())) {
    providerDirectoryProbeState.value = 'failed'
    providerDirectoryProbeError.value = t('acme.provider.messages.directoryRequired')
    return
  }
  providerDirectoryProbeState.value = 'probing'
  providerDirectoryProbeError.value = ''
  providerDirectoryExternalAccountRequired.value = null
  try {
    const result = await internalCaApi.probeAcmeDirectory({
      profileKey: providerDraft.profileKey,
      directoryUrl: providerDraftRequiresDirectory.value ? providerDraft.directoryUrl.trim() : undefined,
      trustBundleSecretRef: providerDraftUsesTrustBundle.value ? providerDraft.trustBundleSecretRef.trim() || undefined : undefined,
    })
    if (result.data?.reachable !== true) {
      throw new Error(text(result.data?.detail, t('acme.provider.messages.directoryProbeFailed')))
    }
    providerDirectoryExternalAccountRequired.value = recordValue(result.data.directory).externalAccountRequired === true
    providerDirectoryProbeState.value = 'succeeded'
  } catch (caught) {
    providerDirectoryProbeState.value = 'failed'
    providerDirectoryProbeError.value = caught instanceof ApiClientError
      ? caught.message
      : caught instanceof Error ? caught.message : t('acme.provider.messages.directoryProbeFailed')
  }
}

async function saveProvider(): Promise<void> {
  if (!providerDraft.name.trim() || !providerDraft.profileKey || (providerDraftRequiresDirectory.value && !providerDraft.directoryUrl.trim())) {
    providerError.value = t('acme.provider.messages.required')
    return
  }
  if (providerDraftEabPolicy.value === 'discover' && providerDraft.contactEmail.trim() && providerDirectoryProbeState.value !== 'succeeded') {
    providerError.value = t('acme.provider.messages.directoryProbeRequired')
    return
  }
  if (providerDraft.contactEmail.trim() && providerDraftRequiresEab.value && !providerDraft.eabSecretRef.trim()) {
    providerError.value = t('acme.provider.messages.eabRequired')
    return
  }
  actionPending.value = true
  providerError.value = ''
  try {
    const payload = {
      displayName: providerDraft.name.trim(),
      profileKey: providerDraft.profileKey,
      directoryUrl: providerDraftRequiresDirectory.value ? providerDraft.directoryUrl.trim() : undefined,
      trustBundleSecretRef: providerDraftUsesTrustBundle.value ? providerDraft.trustBundleSecretRef.trim() || undefined : undefined,
      isDefault: providerDraft.isDefault,
    }
    const saved = providerEditingId.value
      ? await internalCaApi.updateAcmeProvider(providerEditingId.value, payload)
      : await internalCaApi.createAcmeProvider(payload)
    const savedProviderId = text(saved.data?.id, providerEditingId.value)
    if (savedProviderId && providerDraft.contactEmail.trim()) {
      await internalCaApi.createAcmeAccount({
        providerId: savedProviderId,
        contact: [`mailto:${providerDraft.contactEmail.trim()}`],
        termsOfServiceAgreed: true,
        eabSecretRef: providerDraftUsesEab.value ? providerDraft.eabSecretRef.trim() || undefined : undefined,
      })
    }
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

function assetPolicy(asset: ApiRecord | null): InternalCaRecord | undefined {
  return policyByAssetId.value.get(text(asset?.id))
}

function jobsForAsset(asset: ApiRecord | null): InternalCaRecord[] {
  const policy = assetPolicy(asset)
  const assetId = text(asset?.id)
  return jobs.value.filter((job) => text(job.policyId) === text(policy?.id) || text(job.certificateAssetId) === assetId)
}

function ordersForAsset(asset: ApiRecord | null): InternalCaRecord[] {
  const assetId = text(asset?.id)
  const jobOrderIds = new Set(jobsForAsset(asset).map((job) => text(job.acmeOrderId)).filter(Boolean))
  return orders.value.filter((order) => text(order.certificateAssetId) === assetId || jobOrderIds.has(text(order.id)))
}

function latestVersion(asset: ApiRecord | null): InternalCaRecord | undefined {
  if (!asset) return undefined
  const current = recordValue(asset.currentVersion)
  if (text(current.notAfter)) return current
  const currentId = text(asset.currentVersionId, text(current.id))
  if (currentId) {
    const found = versions.value.find((item) => text(item.id) === currentId)
    if (found) return found
  }
  return versions.value.find((item) => text(item.certificateAssetId) === text(asset.id))
}

function providerConfig(provider: AcmeProvider | undefined): InternalCaRecord {
  return recordValue(provider?.configuration)
}

function providerLabel(asset: ApiRecord | null): string {
  const providerId = text(assetPolicy(asset)?.providerId)
  const provider = activeProviders.value.find((item) => text(item.id) === providerId)
  return text(provider?.name, providerId || t('acme.list.notAvailable'))
}

function providerProfile(key: unknown): AcmeProviderProfile | undefined {
  const normalized = normalizeProfileKey(key)
  return providerProfiles.value.find((item) => text(item.key) === normalized)
}

function normalizeProfileKey(value: unknown): string {
  const key = text(value)
  if (key === 'google') return 'google-trust-services'
  if (key === 'sslcom') return 'ssl-com'
  return key
}

function profileLabel(profile: AcmeProviderProfile | undefined): string {
  const key = text(profile?.key, 'custom')
  return t(`acme.provider.profiles.${key}`, text(profile?.displayName, key))
}

function providerProfileLabel(provider: AcmeProvider): string {
  const configuration = providerConfig(provider)
  const profile = providerProfile(configuration.profileKey ?? configuration.preset)
  return profileLabel(profile)
}

function providerPreconfigurationLabel(provider: AcmeProvider): string {
  const configuration = providerConfig(provider)
  const profile = providerProfile(configuration.profileKey ?? configuration.preset)
  return recordValue(profile?.preconfiguration).required === true
    ? t('acme.provider.preconfiguration.required')
    : t('acme.provider.preconfiguration.none')
}

function providerPreconfigurationSource(provider: AcmeProvider): string {
  const configuration = providerConfig(provider)
  const profile = providerProfile(configuration.profileKey ?? configuration.preset)
  const source = text(recordValue(profile?.preconfiguration).source, 'none')
  return t(`acme.provider.preconfiguration.sources.${source}`, source)
}

function providerVerificationLevel(provider: AcmeProvider): string {
  return text(providerConfig(provider).verificationLevel, 'unconfigured')
}

function providerVerificationLabel(provider: AcmeProvider): string {
  const level = providerVerificationLevel(provider)
  return t(`acme.provider.verification.${level}`, level)
}

function providerAccountStatus(provider: AcmeProvider): string {
  const account = accounts.value.find((item) => text(item.providerId) === text(provider.id))
  if (!account) return t('acme.provider.account.notConfigured')
  return t(`acme.states.${text(account.status, 'unknown')}`, statusLabel(account.status))
}

function profileHasProviderField(profile: AcmeProviderProfile | undefined, field: string): boolean {
  const fields = recordValue(profile?.form).providerFields
  return Array.isArray(fields) && fields.map(String).includes(field)
}

function profileHasAccountField(profile: AcmeProviderProfile | undefined, field: string): boolean {
  const fields = recordValue(profile?.form).accountFields
  return Array.isArray(fields) && fields.map(String).includes(field)
}

function resetProviderProfileFields(): void {
  const profile = selectedProviderProfile.value
  providerDraft.directoryUrl = text(recordValue(profile?.directory).defaultUrl)
  if (providerNameAuto.value) providerDraft.name = profileLabel(profile)
  providerDirectoryProbeState.value = 'idle'
  providerDirectoryProbeError.value = ''
  providerDirectoryExternalAccountRequired.value = null
  if (!providerDraftUsesTrustBundle.value) providerDraft.trustBundleSecretRef = ''
  if (!providerDraftUsesEab.value) providerDraft.eabSecretRef = ''
}

function invalidateDirectoryProbe(): void {
  if (providerDirectoryProbeState.value === 'idle' && providerDirectoryExternalAccountRequired.value === null) return
  providerDirectoryProbeState.value = 'idle'
  providerDirectoryProbeError.value = ''
  providerDirectoryExternalAccountRequired.value = null
  providerDraft.eabSecretRef = ''
}

function openEabEditor(): void {
  Object.assign(eabDraft, { name: '', keyId: '', hmacKey: '' })
  eabError.value = ''
  eabEditorOpen.value = true
}

async function saveEab(): Promise<void> {
  if (!eabDraft.name.trim() || !eabDraft.keyId.trim() || !eabDraft.hmacKey.trim()) {
    eabError.value = t('acme.provider.account.eabRequiredFields')
    return
  }
  eabPending.value = true
  eabError.value = ''
  try {
    const result = await createSecret({
      name: eabDraft.name.trim(),
      type: 'acme_eab',
      scopeType: 'global',
      plainText: JSON.stringify({ keyId: eabDraft.keyId.trim(), hmacKey: eabDraft.hmacKey.trim() }),
      metadata: { purpose: 'acme_eab' },
    })
    const secretRef = text(result.data?.secretRef)
    if (!secretRef) throw new Error(t('acme.provider.account.eabCreateFailed'))
    eabSecretOptions.value = [
      ...eabSecretOptions.value.filter((item) => item.value !== secretRef),
      { value: secretRef, label: eabDraft.name.trim() },
    ]
    providerDraft.eabSecretRef = secretRef
    eabEditorOpen.value = false
    notify(t('acme.provider.account.eabCreated'), 'success')
  } catch (caught) {
    eabError.value = caught instanceof ApiClientError ? caught.message : t('acme.provider.account.eabCreateFailed')
  } finally {
    eabPending.value = false
  }
}

function policyEnabled(asset: ApiRecord): boolean {
  const policy = assetPolicy(asset)
  return policy?.enabled === true || text(policy?.enabled) === 'true'
}

function hasRunningJob(asset: ApiRecord): boolean {
  return jobsForAsset(asset).some((job) => ['scheduled', 'retry_waiting', 'issuing'].includes(text(job.status)))
}

function assetStatus(asset: ApiRecord): string {
  const latest = [...jobsForAsset(asset)]
    .sort((left, right) => dateValue(right.updatedAt ?? right.createdAt) - dateValue(left.updatedAt ?? left.createdAt))[0]
  return text(latest?.status, text(asset.status, 'unknown'))
}

function domainsOf(asset: ApiRecord): string {
  return [text(asset.primaryDomain), ...(Array.isArray(asset.sans) ? asset.sans.map(String) : [])]
    .filter(Boolean)
    .join(', ') || t('acme.list.notAvailable')
}

function expiresAt(asset: ApiRecord): string {
  return localTime(latestVersion(asset)?.notAfter)
}

function renewalWindowDays(asset: ApiRecord | null): number | null {
  return numberValue(assetPolicy(asset)?.renewalWindowDays)
}

function renewalCountdown(asset: ApiRecord): string {
  const expiration = timeValue(latestVersion(asset)?.notAfter)
  const windowDays = renewalWindowDays(asset)
  if (expiration === null || windowDays === null) return t('acme.list.notAvailable')
  const difference = expiration - windowDays * MILLISECONDS_PER_DAY - Date.now()
  if (difference < 0) return t('acme.countdown.windowStarted')
  if (difference < MILLISECONDS_PER_DAY) return t('acme.countdown.today')
  return t('acme.countdown.remainingDays', { days: Math.ceil(difference / MILLISECONDS_PER_DAY) })
}

function renewalLabel(asset: ApiRecord): string {
  if (!assetPolicy(asset)) return t('acme.list.notAvailable')
  return policyEnabled(asset) ? t('acme.list.enabled') : t('acme.list.disabled')
}

function statusLabel(value: unknown): string {
  const key = text(value, 'unknown')
  return t(`acme.states.${key}`, t('acme.states.unknown'))
}

function challengeLabel(value: unknown): string {
  const key = text(value, 'http-01')
  return t(`acme.challengeTypes.${key}`, key)
}

function orderIdentifiers(order: InternalCaRecord): string {
  if (!Array.isArray(order.identifiers)) return t('acme.list.notAvailable')
  return order.identifiers
    .map((item) => text(recordValue(item).value))
    .filter(Boolean)
    .join(', ') || t('acme.list.notAvailable')
}

function localTime(value: unknown): string {
  return formatBrowserLocalTime(value, { includeSeconds: false }) || t('acme.list.notAvailable')
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

function recordValue(value: unknown): InternalCaRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InternalCaRecord : {}
}

function readRecords(value: unknown): InternalCaRecord[] {
  if (Array.isArray(value)) return value.map(recordValue).filter((item) => Object.keys(item).length > 0)
  if (recordValue(value).items && Array.isArray(recordValue(value).items)) return readRecords(recordValue(value).items)
  return []
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timeValue(value: unknown): number | null {
  const parsed = Date.parse(text(value))
  return Number.isFinite(parsed) ? parsed : null
}

function dateValue(value: unknown): number {
  return timeValue(value) ?? 0
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
      <template #cell-name="{ row }">
        <div class="acme-page__certificate-name">
          <strong>{{ text(row.name, text(row.primaryDomain, t('acme.list.notAvailable'))) }}</strong>
          <small>{{ text(row.primaryDomain) }}</small>
        </div>
      </template>
      <template #cell-domains="{ row }"><span class="acme-page__domains">{{ domainsOf(row) }}</span></template>
      <template #cell-status="{ row }"><GcStatusTag :status="assetStatus(row)" :label="statusLabel(assetStatus(row))" /></template>
      <template #cell-expiresAt="{ row }">{{ expiresAt(row) }}</template>
      <template #cell-nextRenewalIn="{ row }">{{ renewalCountdown(row) }}</template>
      <template #cell-renewal="{ row }">{{ renewalLabel(row) }}</template>
      <template #cell-actions="{ row }">
        <div class="acme-page__row-actions">
          <GcButton variant="secondary" :disabled="actionPending || hasRunningJob(row)" @click="toggleRenewal(row)">
            {{ policyEnabled(row) ? t('acme.actions.disable') : t('acme.actions.enable') }}
          </GcButton>
          <GcButton variant="secondary" :disabled="actionPending || !policyEnabled(row) || hasRunningJob(row)" :loading="manualRenewalAssetId === text(row.id)" @click="renew(row)">
            {{ t('acme.actions.renew') }}
          </GcButton>
          <GcButton variant="secondary" :disabled="actionPending" @click="openDetails(row)">{{ t('acme.actions.details') }}</GcButton>
          <GcButton variant="secondary" :disabled="actionPending || hasRunningJob(row)" @click="openEdit(row)">{{ t('acme.actions.edit') }}</GcButton>
          <GcConfirmAction :action-name="t('acme.actions.delete')" :disabled="actionPending || hasRunningJob(row)" @confirm="remove(row)" />
        </div>
      </template>
    </GcDataTable>

    <GcDataTable :columns="jobColumns" :rows="jobs" :loading="loading" :empty-text="t('acme.jobs.empty')" :aria-label="t('acme.jobs.title')" dense>
      <template #cell-status="{ row }"><GcStatusTag :status="text(row.status, 'unknown')" :label="statusLabel(row.status)" /></template>
      <template #cell-nextAttemptAt="{ row }">{{ localTime(row.nextAttemptAt) }}</template>
      <template #cell-failureMessage="{ row }">{{ text(row.failureMessage, t('acme.list.notAvailable')) }}</template>
      <template #cell-actions="{ row }">
        <GcButton v-if="failedJobs.includes(row)" variant="secondary" :loading="retryingJobId === text(row.id)" :disabled="actionPending" @click="retry(row)">{{ t('acme.actions.retry') }}</GcButton>
      </template>
    </GcDataTable>

    <GcDataTable :columns="orderColumns" :rows="orders.slice(0, 10)" :loading="loading" :empty-text="t('acme.order.empty')" :aria-label="t('acme.order.title')" dense>
      <template #cell-identifiers="{ row }">{{ orderIdentifiers(row) }}</template>
      <template #cell-status="{ row }"><GcStatusTag :status="text(row.status, 'unknown')" :label="statusLabel(row.status)" /></template>
      <template #cell-updatedAt="{ row }">{{ localTime(row.updatedAt) }}</template>
    </GcDataTable>

    <AcmeCertificateRequestModal v-model:open="formOpen" @created="loadAll" />

    <GcModal v-model:open="editOpen" size="lg" :title="t('acme.edit.title')" :description="t('acme.edit.description')" :busy="actionPending" :error="formError">
      <form class="acme-page__form" @submit.prevent="saveEdit">
        <label class="gc-form-field acme-page__field--wide"><span>{{ t('acme.fields.domains') }}</span><textarea v-model="editDraft.domains" :placeholder="t('acme.placeholders.domains')" required /></label>
        <label class="gc-form-field"><span>{{ t('acme.fields.issuer') }}</span><select v-model="editDraft.providerId" required><option v-for="provider in activeProviders" :key="text(provider.id)" :value="text(provider.id)">{{ text(provider.name, text(provider.id)) }}</option></select></label>
        <label class="gc-form-field"><span>{{ t('acme.fields.name') }}</span><input v-model="editDraft.name" :placeholder="t('acme.placeholders.name')" /></label>
        <label class="gc-form-field"><span>{{ t('acme.fields.email') }}</span><input v-model="editDraft.contactEmail" type="email" :placeholder="t('acme.placeholders.email')" required /></label>
        <fieldset class="acme-page__challenge-field">
          <legend>{{ t('acme.fields.challengeType') }}</legend>
          <div class="acme-page__challenge-options">
            <label><input v-model="editDraft.challengeType" type="radio" value="http-01" />{{ challengeLabel('http-01') }}</label>
            <label><input v-model="editDraft.challengeType" type="radio" value="dns-01" />{{ challengeLabel('dns-01') }}</label>
          </div>
        </fieldset>
        <section v-if="editDraft.challengeType === 'dns-01'" class="acme-page__dns-fields acme-page__field--wide">
          <label class="gc-form-field"><span>{{ t('acme.fields.dnsProvider') }}</span><select v-model="editDraft.dnsProvider" required><option value="" disabled>{{ t('acme.placeholders.dnsProvider') }}</option><option v-for="provider in dnsProviders" :key="text(provider.id)" :value="text(provider.id)">{{ text(provider.name, text(provider.id)) }}</option></select></label>
          <label class="gc-form-field"><span>{{ t('acme.fields.dnsPropagation') }}</span><input v-model.number="editDraft.dnsPropagationSeconds" type="number" min="0" max="7200" required /></label>
          <GcAcmeDnsCredentialSelect
            v-if="selectedEditDnsProvider"
            v-model="editDraft.dnsCredentialId"
            class="acme-page__field--wide"
            :provider-id="text(selectedEditDnsProvider.id)"
            :provider-name="text(selectedEditDnsProvider.name, text(selectedEditDnsProvider.id))"
            :credential-template="text(selectedEditDnsProvider.credentialTemplate)"
            required
          />
        </section>
        <label class="gc-form-field"><span>{{ t('acme.fields.keyType') }}</span><select v-model="editDraft.keyType"><option value="rsa">{{ t('acme.keyTypes.rsa') }}</option><option value="ecdsa">{{ t('acme.keyTypes.ecdsa') }}</option></select></label>
        <label class="gc-form-field"><span>{{ t('acme.fields.renewalWindowDays') }}</span><input v-model.number="editDraft.renewalWindowDays" type="number" min="1" max="90" required /></label>
        <label class="acme-page__checkbox"><input v-model="editDraft.autoRenew" type="checkbox" /><span>{{ t('acme.fields.autoRenew') }}</span></label>
        <footer class="acme-page__form-actions acme-page__field--wide"><GcButton variant="secondary" :disabled="actionPending" @click="editOpen = false">{{ t('acme.actions.close') }}</GcButton><GcButton variant="primary" type="submit" :loading="actionPending">{{ t('acme.actions.save') }}</GcButton></footer>
      </form>
    </GcModal>

    <GcModal v-model:open="detailOpen" size="xl" :title="text(selectedAsset?.name, text(selectedAsset?.primaryDomain, t('acme.list.notAvailable')))" :description="t('acme.detail.description')">
      <div class="acme-page__detail">
        <dl class="acme-page__detail-facts">
          <div><dt>{{ t('acme.detail.domains') }}</dt><dd>{{ selectedAsset ? domainsOf(selectedAsset) : t('acme.list.notAvailable') }}</dd></div>
          <div><dt>{{ t('acme.detail.expiresAt') }}</dt><dd>{{ selectedAsset ? expiresAt(selectedAsset) : t('acme.list.notAvailable') }}</dd></div>
          <div><dt>{{ t('acme.detail.provider') }}</dt><dd>{{ providerLabel(selectedAsset) }}</dd></div>
          <div><dt>{{ t('acme.detail.challenge') }}</dt><dd>{{ challengeLabel(assetPolicy(selectedAsset)?.challengeType) }}</dd></div>
          <div><dt>{{ t('acme.detail.renewalWindowDays') }}</dt><dd>{{ renewalWindowDays(selectedAsset) ?? t('acme.list.notAvailable') }}</dd></div>
          <div><dt>{{ t('acme.detail.nextRenewalIn') }}</dt><dd>{{ selectedAsset ? renewalCountdown(selectedAsset) : t('acme.list.notAvailable') }}</dd></div>
        </dl>
        <GcDataTable :columns="jobColumns" :rows="jobsForAsset(selectedAsset)" :loading="loading" :empty-text="t('acme.detail.emptyJobs')" dense>
          <template #cell-status="{ row }"><GcStatusTag :status="text(row.status, 'unknown')" :label="statusLabel(row.status)" /></template>
          <template #cell-nextAttemptAt="{ row }">{{ localTime(row.nextAttemptAt) }}</template>
          <template #cell-failureMessage="{ row }">{{ text(row.failureMessage, t('acme.list.notAvailable')) }}</template>
        </GcDataTable>
        <GcDataTable :columns="orderColumns" :rows="ordersForAsset(selectedAsset)" :loading="loading" :empty-text="t('acme.detail.emptyOrders')" dense>
          <template #cell-identifiers="{ row }">{{ orderIdentifiers(row) }}</template>
          <template #cell-status="{ row }"><GcStatusTag :status="text(row.status, 'unknown')" :label="statusLabel(row.status)" /></template>
          <template #cell-updatedAt="{ row }">{{ localTime(row.updatedAt) }}</template>
        </GcDataTable>
      </div>
      <template #actions><GcButton variant="secondary" @click="detailOpen = false">{{ t('acme.actions.close') }}</GcButton></template>
    </GcModal>

    <GcModal v-model:open="providerDialogOpen" size="lg" :title="t('acme.provider.title')" :description="t('acme.provider.description')" :busy="actionPending" :error="providerError">
      <div class="acme-page__provider-list">
        <article v-for="provider in activeProviders" :key="text(provider.id)" class="acme-page__provider">
          <div>
            <strong>{{ text(provider.name, text(provider.id)) }}</strong>
            <small>{{ providerProfileLabel(provider) }} · {{ providerVerificationLabel(provider) }} · {{ providerAccountStatus(provider) }}</small>
            <small>{{ providerPreconfigurationLabel(provider) }} · {{ providerPreconfigurationSource(provider) }}</small>
            <small>{{ text(providerConfig(provider).directoryUrl, text(provider.endpoint)) }}</small>
          </div>
          <div class="acme-page__row-actions">
            <GcStatusTag v-if="providerConfig(provider).isDefault === true" status="ACTIVE" :label="t('acme.provider.default')" tone="success" />
            <GcStatusTag v-if="providerConfig(provider).isBuiltIn === true" status="BUILT_IN" :label="t('acme.provider.builtIn')" tone="info" />
            <GcStatusTag :status="providerVerificationLevel(provider)" :label="providerVerificationLabel(provider)" tone="muted" />
            <GcButton variant="secondary" :disabled="actionPending" :loading="providerTestId === text(provider.id)" @click="testProvider(provider)">{{ providerTestId === text(provider.id) ? t('acme.provider.testing') : t('acme.provider.test') }}</GcButton>
            <GcButton variant="secondary" :disabled="actionPending" @click="openProviderEditor(provider)">{{ t('acme.provider.edit') }}</GcButton>
          </div>
        </article>
        <p v-if="!activeProviders.length" class="acme-page__provider-empty">{{ t('acme.provider.empty') }}</p>
        <p v-if="providerTestResult" class="acme-page__provider-result">{{ providerTestResult }}</p>
      </div>
      <template #actions><GcButton variant="secondary" :disabled="actionPending" @click="providerDialogOpen = false">{{ t('acme.actions.close') }}</GcButton><GcButton variant="primary" :disabled="actionPending" @click="openProviderEditor()">{{ t('acme.provider.add') }}</GcButton></template>
    </GcModal>

    <GcModal v-model:open="providerEditorOpen" size="lg" :title="providerEditingId ? t('acme.provider.edit') : t('acme.provider.add')" :description="t('acme.provider.description')" :busy="actionPending" :error="providerError">
      <form class="acme-page__form" @submit.prevent="saveProvider">
        <label class="gc-form-field">
          <span>{{ t('acme.provider.fields.profile') }}</span>
          <select v-model="providerDraft.profileKey" :disabled="Boolean(providerEditingId)" @change="resetProviderProfileFields">
            <option v-for="profile in providerProfiles" :key="text(profile.key)" :value="text(profile.key)">{{ profileLabel(profile) }}</option>
            <option v-if="!providerProfiles.length" value="letsencrypt">{{ t('acme.provider.profiles.letsencrypt') }}</option>
          </select>
        </label>
        <label class="gc-form-field"><span>{{ t('acme.provider.fields.name') }}</span><input v-model="providerDraft.name" required @input="providerNameAuto = false" /></label>
        <label v-if="providerDraftRequiresDirectory" class="gc-form-field acme-page__field--wide"><span>{{ t('acme.provider.fields.directoryUrl') }}</span><input v-model="providerDraft.directoryUrl" type="url" required @input="invalidateDirectoryProbe" /></label>
        <div v-if="selectedProviderNeedsPreconfiguration" class="acme-page__provider-preconfiguration acme-page__field--wide">
          <GcStatusTag status="PRECONFIGURATION_REQUIRED" :label="t('acme.provider.preconfiguration.required')" tone="warning" />
          <p>{{ t(`acme.provider.preconfiguration.sources.${selectedProviderPreconfigurationSource}`) }}</p>
        </div>
        <div v-if="providerDraftRequiresDirectory" class="acme-page__directory-probe acme-page__field--wide">
          <GcButton variant="secondary" type="button" :disabled="actionPending || providerDirectoryProbeState === 'probing'" :loading="providerDirectoryProbeState === 'probing'" @click="probeProviderDirectory">{{ t('acme.provider.actions.probeDirectory') }}</GcButton>
          <GcStatusTag v-if="providerDirectoryProbeState === 'succeeded'" status="DIRECTORY_REACHABLE" :label="t('acme.provider.verification.directory_reachable')" tone="success" />
          <span v-if="providerDirectoryProbeState === 'succeeded'" class="acme-page__directory-probe-result">{{ providerDirectoryExternalAccountRequired ? t('acme.provider.messages.eabDiscoveredRequired') : t('acme.provider.messages.eabDiscoveredNotRequired') }}</span>
          <p v-if="providerDirectoryProbeError" class="acme-page__provider-probe-error">{{ providerDirectoryProbeError }}</p>
        </div>
        <label class="acme-page__checkbox acme-page__field--wide"><input v-model="providerDraft.isDefault" type="checkbox" /><span>{{ t('acme.provider.fields.isDefault') }}</span></label>
        <fieldset class="acme-page__account-field acme-page__field--wide">
          <legend>{{ t('acme.provider.account.title') }}</legend>
          <label class="gc-form-field"><span>{{ t('acme.provider.fields.contactEmail') }}</span><input v-model="providerDraft.contactEmail" type="email" :placeholder="t('acme.placeholders.email')" /></label>
          <GcSecretRefSelect
            v-if="providerDraftUsesEab"
            v-model="providerDraft.eabSecretRef"
            :label="t('acme.provider.fields.eabSecretRef')"
            :required="providerDraftRequiresEab && Boolean(providerDraft.contactEmail.trim())"
            :accepted-types="['acme_eab']"
            :extra-options="eabSecretOptions"
          />
          <GcSecretRefSelect
            v-if="providerDraftUsesTrustBundle"
            v-model="providerDraft.trustBundleSecretRef"
            :label="t('acme.provider.fields.trustBundleSecretRef')"
            :accepted-types="['certificate_trust_bundle']"
            @update:model-value="invalidateDirectoryProbe"
          />
          <p v-if="providerDraftEabPolicy === 'discover' && providerDirectoryProbeState !== 'succeeded'" class="acme-page__provider-hint">{{ t('acme.provider.messages.eabAfterProbe') }}</p>
          <GcButton v-if="providerDraftUsesEab" variant="secondary" type="button" :disabled="actionPending" @click="openEabEditor">{{ t('acme.provider.account.createEab') }}</GcButton>
        </fieldset>
        <footer class="acme-page__form-actions acme-page__field--wide"><GcButton variant="secondary" :disabled="actionPending" @click="providerEditorOpen = false">{{ t('acme.actions.close') }}</GcButton><GcButton variant="primary" type="submit" :loading="actionPending">{{ t('acme.provider.save') }}</GcButton></footer>
      </form>
    </GcModal>

    <GcModal v-model:open="eabEditorOpen" size="md" :title="t('acme.provider.account.eabTitle')" :description="t('acme.provider.account.eabDescription')" :busy="eabPending" :error="eabError">
      <form class="acme-page__form" @submit.prevent="saveEab">
        <label class="gc-form-field acme-page__field--wide"><span>{{ t('acme.provider.account.eabName') }}</span><input v-model="eabDraft.name" required /></label>
        <label class="gc-form-field acme-page__field--wide"><span>{{ t('acme.provider.account.eabKeyId') }}</span><input v-model="eabDraft.keyId" required autocomplete="off" /></label>
        <label class="gc-form-field acme-page__field--wide"><span>{{ t('acme.provider.account.eabHmacKey') }}</span><input v-model="eabDraft.hmacKey" type="password" required autocomplete="new-password" /></label>
        <footer class="acme-page__form-actions acme-page__field--wide">
          <GcButton variant="secondary" type="button" :disabled="eabPending" @click="eabEditorOpen = false">{{ t('acme.actions.close') }}</GcButton>
          <GcButton variant="primary" type="submit" :loading="eabPending">{{ t('acme.provider.account.saveEab') }}</GcButton>
        </footer>
      </form>
    </GcModal>
  </section>
</template>

<style scoped>
.acme-page { display: grid; gap: var(--gc-space-5); min-width: 0; }
.acme-page__intro, .acme-page__row-actions, .acme-page__form-actions, .acme-page__checkbox { display: flex; gap: var(--gc-space-3); align-items: center; }
.acme-page__intro { justify-content: space-between; }
.acme-page__intro h2 { margin: 0; color: var(--gc-color-text); }
.acme-page__intro p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.acme-page__error { margin: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.acme-page__summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--gc-space-3); }
.acme-page__summary .gc-card { display: grid; gap: var(--gc-space-2); }
.acme-page__summary strong { color: var(--gc-color-text); font-size: var(--gc-font-size-xl); }
.acme-page__summary span, .acme-page__certificate-name small, .acme-page__provider small { color: var(--gc-color-text-muted); }
.acme-page__certificate-name { display: grid; gap: var(--gc-space-1); }
.acme-page__domains { overflow-wrap: anywhere; }
.acme-page__row-actions { flex-wrap: wrap; }
.acme-page__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.acme-page__field--wide { grid-column: 1 / -1; }
.acme-page__form textarea { min-height: var(--gc-control-height-xl); resize: vertical; }
.acme-page__checkbox { min-height: var(--gc-control-height-md); flex-wrap: wrap; }
.acme-page__form-actions { justify-content: flex-end; padding-top: var(--gc-space-3); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.acme-page__challenge-field, .acme-page__account-field { display: grid; gap: var(--gc-space-1); margin: 0; padding: 0; border: 0; }
.acme-page__challenge-field legend, .acme-page__account-field legend { margin: 0 0 var(--gc-space-1); padding: 0; color: var(--gc-color-text-muted); font-weight: var(--gc-font-weight-semibold); }
.acme-page__challenge-options { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gc-space-4); min-height: var(--gc-control-height-md); }
.acme-page__challenge-field label { display: inline-flex; gap: var(--gc-space-2); align-items: center; min-height: var(--gc-control-height-md); color: var(--gc-color-text); }
.acme-page__dns-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); padding: var(--gc-space-4); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-info-border); background: var(--gc-color-info-bg); }
.acme-page__provider-list, .acme-page__detail, .acme-page__terms { display: grid; gap: var(--gc-space-3); }
.acme-page__provider-preconfiguration, .acme-page__directory-probe { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-3); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-warning-border); background: var(--gc-color-warning-bg); }
.acme-page__provider-preconfiguration p, .acme-page__directory-probe p, .acme-page__provider-hint { margin: 0; color: var(--gc-color-text-muted); }
.acme-page__directory-probe { display: flex; flex-wrap: wrap; align-items: center; }
.acme-page__provider-probe-error { color: var(--gc-color-danger) !important; flex-basis: 100%; }
.acme-page__provider { display: flex; justify-content: space-between; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); }
.acme-page__provider > div:first-child { display: grid; gap: var(--gc-space-1); min-width: 0; }
.acme-page__provider small { overflow-wrap: anywhere; }
.acme-page__provider-empty, .acme-page__provider-result, .acme-page__terms p { margin: 0; color: var(--gc-color-text-muted); }
.acme-page__provider-result { color: var(--gc-color-success); }
.acme-page__detail-facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.acme-page__detail-facts div { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); background: var(--gc-color-surface-muted); }
.acme-page__detail-facts dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-page__detail-facts dd { margin: 0; color: var(--gc-color-text); overflow-wrap: anywhere; }
@media (max-width: 48rem) {
  .acme-page__summary, .acme-page__form, .acme-page__dns-fields, .acme-page__detail-facts { grid-template-columns: 1fr; }
  .acme-page__intro, .acme-page__provider { align-items: flex-start; flex-direction: column; }
}
</style>
