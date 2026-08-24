<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { internalCaApi, type AcmeProviderPreset, type AcmeProviderPresetKey, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { listCertificateVersions, listCertificates } from '@/api/modules/certificates.api'
import { GcAcmeDnsCredentialSelect, GcDataTable, GcModal, GcPageHeader } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import type { ApiRecord } from '@/api/modules/common'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const VERSION_PAGE_SIZE = 200
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

const loading = ref(false)
const actionPending = ref(false)
const error = ref('')
const assets = ref<ApiRecord[]>([])
const providers = ref<InternalCaRecord[]>([])
const accounts = ref<InternalCaRecord[]>([])
const dnsProviders = ref<InternalCaRecord[]>([])
const policies = ref<InternalCaRecord[]>([])
const orders = ref<InternalCaRecord[]>([])
const jobs = ref<InternalCaRecord[]>([])
const certificateVersions = ref<ApiRecord[]>([])
const acmeProviderPresets = ref<AcmeProviderPreset[]>([])
const createDialogOpen = ref(false)
const editDialogOpen = ref(false)
const deleteDialogOpen = ref(false)
const detailDialogOpen = ref(false)
const termsDialogOpen = ref(false)
const providerDialogOpen = ref(false)
const providerEditorOpen = ref(false)
const termsRead = ref(false)
const manualRenewalAssetId = ref('')
const selectedAsset = ref<ApiRecord | null>(null)
const editingAsset = ref<ApiRecord | null>(null)
const deletingAsset = ref<ApiRecord | null>(null)
const editingProviderId = ref('')
const providerActionPending = ref(false)
const providerTestId = ref('')
const providerTestResults = reactive<Record<string, { status: 'valid' | 'failed'; message: string }>>({})

const createDraft = reactive({
  name: '',
  domains: '',
  contactEmail: '',
  providerId: '',
  challengeType: 'http-01',
  dnsProvider: '',
  dnsCredentialId: '',
  dnsPropagationSeconds: 60,
  keyType: 'rsa',
  autoRenew: true,
  renewalWindowDays: 7,
  termsOfServiceAgreed: false,
})

const editDraft = reactive({
  name: '',
  domains: '',
  contactEmail: '',
  providerId: '',
  challengeType: 'http-01',
  dnsProvider: '',
  dnsCredentialId: '',
  dnsPropagationSeconds: 60,
  keyType: 'rsa',
  autoRenew: true,
  renewalWindowDays: 7,
})

const providerDraft = reactive<{
  name: string
  preset: AcmeProviderPresetKey
  directoryUrl: string
  allowedChallenges: string[]
  termsOfServiceUrl: string
  isDefault: boolean
}>({
  name: '',
  preset: 'letsencrypt',
  directoryUrl: '',
  allowedChallenges: ['http-01', 'dns-01'],
  termsOfServiceUrl: '',
  isDefault: true,
})

const acmeProviders = computed(() => providers.value.filter((item) => text(item.type) === 'acme' && text(item.status, 'active') === 'active'))
const acmeAccounts = computed(() => accounts.value.filter((item) => acmeProviders.value.some((provider) => text(provider.id) === text(item.providerId)) && text(item.status) === 'active'))
const defaultAcmeProvider = computed(() => acmeProviders.value.find((item) => providerConfiguration(item).isDefault === true) ?? acmeProviders.value[0])
const selectedAcmeProvider = computed(() => acmeProviders.value.find((item) => text(item.id) === createDraft.providerId) ?? defaultAcmeProvider.value)
const selectedDnsProvider = computed(() => dnsProviders.value.find((provider) => text(provider.id) === createDraft.dnsProvider))
const selectedEditDnsProvider = computed(() => dnsProviders.value.find((provider) => text(provider.id) === editDraft.dnsProvider))
const selectedProviderPreset = computed(() => acmeProviderPresets.value.find((item) => item.key === providerDraft.preset))
const configuredAssets = computed(() => assets.value.filter((asset) => policyForAsset(asset) || text(asset.sourceType) === 'acme'))
const failedJobs = computed(() => jobs.value.filter((job) => ['failed', 'rollback_required'].includes(text(job.status))))
const dueJobs = computed(() => jobs.value.filter((job) => ['scheduled', 'retry_waiting', 'issuing'].includes(text(job.status))))

const assetColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'name', title: t('acme.list.columns.name') },
  { key: 'domains', title: t('acme.list.columns.domains') },
  { key: 'status', title: t('acme.list.columns.status') },
  { key: 'expiresAt', title: t('acme.list.columns.expiresAt') },
  { key: 'nextRenewalIn', title: t('acme.list.columns.nextRenewalIn') },
  { key: 'renewal', title: t('acme.list.columns.renewal') },
  { key: 'actions', title: t('acme.list.columns.actions') },
])

const detailJobColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'status', title: t('acme.detail.columns.status') },
  { key: 'nextAttemptAt', title: t('acme.detail.columns.nextAttemptAt') },
  { key: 'failureMessage', title: t('acme.detail.columns.failure') },
])

const detailOrderColumns = computed<DataTableColumn<InternalCaRecord>[]>(() => [
  { key: 'identifiers', title: t('acme.detail.columns.domains') },
  { key: 'status', title: t('acme.detail.columns.status') },
  { key: 'updatedAt', title: t('acme.detail.columns.updatedAt') },
])

onMounted(loadAll)

watch(() => providerDraft.preset, (preset) => {
  const definition = acmeProviderPresets.value.find((item) => item.key === preset)
  if (!definition || editingProviderId.value) return
  providerDraft.directoryUrl = definition.defaultDirectoryUrl ?? ''
  providerDraft.allowedChallenges = [...definition.defaultAllowedChallenges]
})

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [assetResult, versionItems, providerResult, accountResult, providerSettingsResult, dnsProviderResult, policyResult, orderResult, jobResult] = await Promise.all([
      listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listAllAcmeCertificateVersions(),
      internalCaApi.listProviders(),
      internalCaApi.listAcmeAccounts(),
      internalCaApi.listAcmeProviderSettings(),
      internalCaApi.listAcmeDnsProviders(),
      internalCaApi.listAcmeRenewalPolicies(),
      internalCaApi.listAcmeOrders(),
      internalCaApi.listAcmeRenewalJobs(),
    ])
    assets.value = [...(assetResult.data?.items ?? [])]
    certificateVersions.value = [...versionItems]
    providers.value = providerResult.data ?? []
    accounts.value = accountResult.data ?? []
    acmeProviderPresets.value = providerSettingsResult.data?.presets ?? []
    providers.value = providerSettingsResult.data?.items ?? []
    dnsProviders.value = dnsProviderResult.data ?? []
    policies.value = policyResult.data ?? []
    orders.value = orderResult.data ?? []
    jobs.value = jobResult.data ?? []
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

    const total = Number(result.data?.total ?? 0)
    if (pageItems.length < VERSION_PAGE_SIZE || items.length >= total) break
    page += 1
  }

  return items
}

function openCreateDialog(): void {
  resetDraft()
  error.value = ''
  termsRead.value = false
  createDialogOpen.value = true
}

function closeCreateDialog(): void {
  if (!actionPending.value) createDialogOpen.value = false
}

function resetDraft(): void {
  Object.assign(createDraft, {
    name: '',
    domains: '',
    contactEmail: '',
    providerId: text(defaultAcmeProvider.value?.id),
    challengeType: 'http-01',
    dnsProvider: '',
    dnsCredentialId: '',
    dnsPropagationSeconds: 60,
    keyType: 'rsa',
    autoRenew: true,
    renewalWindowDays: 7,
    termsOfServiceAgreed: false,
  })
}

function openProviderSettingsDialog(): void {
  editingProviderId.value = ''
  providerDialogOpen.value = true
}

function openProviderCreateDialog(): void {
  editingProviderId.value = ''
  const definition = acmeProviderPresets.value.find((item) => item.key === 'letsencrypt')
  Object.assign(providerDraft, {
    name: '',
    preset: 'letsencrypt',
    directoryUrl: definition?.defaultDirectoryUrl ?? '',
    allowedChallenges: [...(definition?.defaultAllowedChallenges ?? ['http-01', 'dns-01'])],
    termsOfServiceUrl: '',
    isDefault: acmeProviders.value.length === 0,
  })
  providerDialogOpen.value = false
  providerEditorOpen.value = true
}

function openProviderEditDialog(provider: InternalCaRecord): void {
  editingProviderId.value = text(provider.id)
  const configuration = providerConfiguration(provider)
  Object.assign(providerDraft, {
    name: text(provider.name),
    preset: (text(configuration.preset, 'custom') as AcmeProviderPresetKey),
    directoryUrl: text(configuration.directoryUrl, text(provider.endpoint)),
    allowedChallenges: Array.isArray(configuration.allowedChallenges) ? configuration.allowedChallenges.map(String) : ['http-01', 'dns-01'],
    termsOfServiceUrl: text(configuration.termsOfServiceUrl),
    isDefault: configuration.isDefault === true,
  })
  providerDialogOpen.value = false
  providerEditorOpen.value = true
}

async function saveProvider(): Promise<void> {
  if (!providerDraft.name.trim() || !providerDraft.directoryUrl.trim() || providerDraft.allowedChallenges.length === 0) {
    error.value = t('acme.provider.messages.requiredFields')
    return
  }
  providerActionPending.value = true
  error.value = ''
  try {
    const payload = {
      name: providerDraft.name.trim(),
      preset: providerDraft.preset,
      directoryUrl: providerDraft.directoryUrl.trim(),
      allowedChallenges: providerDraft.allowedChallenges,
      termsOfServiceUrl: providerDraft.termsOfServiceUrl.trim() || undefined,
      isDefault: providerDraft.isDefault,
    }
    if (editingProviderId.value) await internalCaApi.updateAcmeProvider(editingProviderId.value, payload)
    else await internalCaApi.createAcmeProvider(payload)
    providerEditorOpen.value = false
    await loadAll()
    providerDialogOpen.value = true
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('acme.provider.messages.saved'), tone: 'success' } }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('acme.messages.actionFailed')
  } finally {
    providerActionPending.value = false
  }
}

async function testProvider(provider: InternalCaRecord): Promise<void> {
  const providerId = text(provider.id)
  providerActionPending.value = true
  providerTestId.value = providerId
  error.value = ''
  try {
    const result = await internalCaApi.testAcmeProvider(providerId)
    const reachable = result.data?.reachable === true
    providerTestResults[providerId] = {
      status: reachable ? 'valid' : 'failed',
      message: reachable ? t('acme.provider.messages.testSucceeded') : t('acme.provider.messages.testFailed'),
    }
    window.dispatchEvent(new CustomEvent('gcac:toast', {
      detail: { message: reachable ? t('acme.provider.messages.testSucceeded') : t('acme.provider.messages.testFailed'), tone: reachable ? 'success' : 'warning' },
    }))
  } catch (caught) {
    providerTestResults[providerId] = {
      status: 'failed',
      message: caught instanceof ApiClientError
        ? caught.message
        : caught instanceof Error ? caught.message : t('acme.provider.messages.testFailed'),
    }
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('acme.messages.actionFailed')
  } finally {
    providerActionPending.value = false
    providerTestId.value = ''
  }
}

function openTermsDialog(): void {
  termsRead.value = false
  termsDialogOpen.value = true
}

function confirmTerms(): void {
  if (!termsRead.value) return
  createDraft.termsOfServiceAgreed = true
  termsDialogOpen.value = false
  error.value = ''
}

async function createAcmeCertificate(): Promise<void> {
  const domains = normalizeDomains(createDraft.domains)
  if (!domains.length || !createDraft.contactEmail.trim()) {
    error.value = t('acme.messages.requiredFields')
    return
  }
  if (createDraft.challengeType === 'dns-01' && (!createDraft.dnsProvider.trim() || !createDraft.dnsCredentialId.trim())) {
    error.value = t('acme.messages.dnsFieldsRequired')
    return
  }
  if (!createDraft.termsOfServiceAgreed) {
    error.value = t('acme.messages.termsRequired')
    openTermsDialog()
    return
  }

  actionPending.value = true
  error.value = ''
  let taskStarted = false
  try {
    await internalCaApi.createAcmeCertificate({
      name: createDraft.name.trim() || undefined,
      domains,
      contactEmail: createDraft.contactEmail.trim(),
      providerId: text(selectedAcmeProvider.value?.id) || undefined,
      challengeType: createDraft.challengeType,
      dnsProvider: createDraft.dnsProvider.trim() || undefined,
      dnsCredentialId: createDraft.dnsCredentialId.trim() || undefined,
      dnsPropagationSeconds: createDraft.dnsPropagationSeconds,
      keyType: createDraft.keyType,
      autoRenew: createDraft.autoRenew,
      renewalWindowDays: createDraft.renewalWindowDays,
      termsOfServiceAgreed: createDraft.termsOfServiceAgreed,
    })
    taskStarted = true
    window.dispatchEvent(new CustomEvent('gcac:toast', {
      detail: { message: t('acme.messages.issueTaskStarted'), tone: 'info' },
    }))
    createDialogOpen.value = false
    await loadAll()
  } catch (caught) {
    if (!taskStarted) {
      window.dispatchEvent(new CustomEvent('gcac:toast', {
        detail: { message: t('acme.messages.issueTaskFailed'), tone: 'danger' },
      }))
    }
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

function openEditDialog(asset: ApiRecord): void {
  const policy = policyForAsset(asset)
  if (!policy || hasRunningJob(asset)) return
  const maintenanceWindow = policy.maintenanceWindow && typeof policy.maintenanceWindow === 'object' && !Array.isArray(policy.maintenanceWindow)
    ? policy.maintenanceWindow as InternalCaRecord
    : {}
  editingAsset.value = asset
  Object.assign(editDraft, {
    name: text(asset.name),
    domains: domainsOf(asset) === t('acme.common.notAvailable') ? '' : domainsOf(asset),
    contactEmail: text(maintenanceWindow.contactEmail),
    providerId: text(policy.providerId),
    challengeType: text(policy.challengeType, 'http-01'),
    dnsProvider: text(maintenanceWindow.dnsProvider),
    dnsCredentialId: text(maintenanceWindow.dnsCredentialId),
    dnsPropagationSeconds: Number(maintenanceWindow.dnsPropagationSeconds ?? 60),
    keyType: text(maintenanceWindow.keyType, 'rsa'),
    autoRenew: policy.enabled === true || text(policy.enabled) === 'true',
    renewalWindowDays: Number(policy.renewalWindowDays ?? 7),
  })
  error.value = ''
  editDialogOpen.value = true
}

async function saveEditedCertificate(): Promise<void> {
  const assetId = text(editingAsset.value?.id)
  const domains = normalizeDomains(editDraft.domains)
  if (!assetId || !domains.length || !editDraft.contactEmail.trim() || !editDraft.providerId) {
    error.value = t('acme.messages.requiredFields')
    return
  }
  if (editDraft.challengeType === 'dns-01' && (!editDraft.dnsProvider || !editDraft.dnsCredentialId)) {
    error.value = t('acme.messages.dnsFieldsRequired')
    return
  }
  actionPending.value = true
  error.value = ''
  try {
    await internalCaApi.updateAcmeCertificate(assetId, {
      name: editDraft.name.trim() || undefined,
      domains,
      contactEmail: editDraft.contactEmail.trim(),
      providerId: editDraft.providerId,
      challengeType: editDraft.challengeType,
      dnsProvider: editDraft.challengeType === 'dns-01' ? editDraft.dnsProvider : undefined,
      dnsCredentialId: editDraft.challengeType === 'dns-01' ? editDraft.dnsCredentialId : undefined,
      dnsPropagationSeconds: editDraft.challengeType === 'dns-01' ? editDraft.dnsPropagationSeconds : undefined,
      keyType: editDraft.keyType,
      autoRenew: editDraft.autoRenew,
      renewalWindowDays: editDraft.renewalWindowDays,
    })
    editDialogOpen.value = false
    editingAsset.value = null
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('acme.messages.updated'), tone: 'success' } }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

function openDeleteDialog(asset: ApiRecord): void {
  if (hasRunningJob(asset)) return
  deletingAsset.value = asset
  error.value = ''
  deleteDialogOpen.value = true
}

async function deleteCertificate(): Promise<void> {
  const assetId = text(deletingAsset.value?.id)
  if (!assetId) return
  actionPending.value = true
  error.value = ''
  try {
    await internalCaApi.deleteAcmeCertificate(assetId)
    deleteDialogOpen.value = false
    deletingAsset.value = null
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('acme.messages.deleted'), tone: 'success' } }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

async function runDueJobs(): Promise<void> {
  await runAction(async () => {
    await internalCaApi.scanAcmeRenewalJobs()
    await internalCaApi.runAcmeRenewalJobs()
  }, 'acme.messages.runCompleted')
}

async function retryJob(job: InternalCaRecord): Promise<void> {
  await runAction(() => internalCaApi.retryAcmeRenewalJob(text(job.id)), 'acme.messages.retryCompleted')
}

async function toggleRenewal(asset: ApiRecord): Promise<void> {
  const policy = policyForAsset(asset)
  if (!policy) return
  const enabled = policy.enabled === true || text(policy.enabled) === 'true'
  await runAction(
    () => internalCaApi.updateAcmeRenewalPolicy(text(policy.id), { enabled: !enabled, status: enabled ? 'disabled' : 'active' }),
    'acme.messages.policyUpdated',
  )
}

function policyEnabled(asset: ApiRecord): boolean {
  const policy = policyForAsset(asset)
  return policy?.enabled === true || text(policy?.enabled) === 'true'
}

function hasBlockingJob(asset: ApiRecord): boolean {
  return jobsForAsset(asset).some((job) => [
    'scheduled',
    'retry_waiting',
    'issuing',
  ].includes(text(job.status)))
}

function hasRunningJob(asset: ApiRecord): boolean {
  return jobsForAsset(asset).some((job) => [
    'scheduled',
    'retry_waiting',
    'issuing',
  ].includes(text(job.status)))
}

async function manualRenew(asset: ApiRecord): Promise<void> {
  const assetId = text(asset.id)
  if (!assetId || !policyEnabled(asset) || hasBlockingJob(asset)) return
  manualRenewalAssetId.value = assetId
  actionPending.value = true
  error.value = ''
  try {
    await internalCaApi.manualRenewAcmeCertificate(assetId)
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t('acme.messages.manualRenewCompleted'), tone: 'success' } }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : caught instanceof Error ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
    manualRenewalAssetId.value = ''
  }
}

async function runAction(action: () => Promise<unknown>, successKey: string): Promise<void> {
  actionPending.value = true
  error.value = ''
  try {
    await action()
    await loadAll()
    window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message: t(successKey), tone: 'success' } }))
  } catch (caught) {
    error.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

function openDetails(asset: ApiRecord): void {
  selectedAsset.value = asset
  detailDialogOpen.value = true
}

function policyForAsset(asset: ApiRecord | null): InternalCaRecord | undefined {
  const id = text(asset?.id)
  return policies.value.find((policy) => text(policy.certificateAssetId) === id)
}

function jobsForAsset(asset: ApiRecord | null): InternalCaRecord[] {
  const id = text(asset?.id)
  const policy = policyForAsset(asset)
  return jobs.value.filter((job) => text(job.policyId) === text(policy?.id) || text(job.certificateAssetId) === id)
}

function ordersForAsset(asset: ApiRecord | null): InternalCaRecord[] {
  const assetId = text(asset?.id)
  const assetJobs = jobsForAsset(asset)
  const orderIds = new Set(assetJobs.map((job) => text(job.acmeOrderId)).filter(Boolean))
  return orders.value.filter((order) => {
    const orderAssetId = text(order.certificateAssetId)
    return orderAssetId === assetId || orderIds.has(text(order.id))
  })
}

function normalizeDomains(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))]
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timeValue(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function providerConfiguration(provider: InternalCaRecord | null | undefined): InternalCaRecord {
  return provider?.configuration && typeof provider.configuration === 'object' && !Array.isArray(provider.configuration)
    ? provider.configuration as InternalCaRecord
    : {}
}

function acmeProviderForAsset(asset: ApiRecord | null): InternalCaRecord | undefined {
  const providerId = text(policyForAsset(asset)?.providerId)
  if (!providerId) return undefined
  return acmeProviders.value.find((provider) => text(provider.id) === providerId)
}

function providerLabelForAsset(asset: ApiRecord | null): string {
  const provider = acmeProviderForAsset(asset)
  return text(provider?.name, text(provider?.id, t('acme.common.notAvailable')))
}

function localTime(value: unknown): string {
  return formatBrowserLocalTime(value, { includeSeconds: false }) || t('acme.common.notAvailable')
}

function dateFromAsset(asset: ApiRecord): string {
  const version = latestVersionForAsset(asset)
  return localTime(version?.notAfter)
}

function renewalWindowDaysOf(asset: ApiRecord | null): number | null {
  return numberValue(policyForAsset(asset)?.renewalWindowDays)
}

function renewalWindowLabel(asset: ApiRecord | null): string {
  const days = renewalWindowDaysOf(asset)
  return days === null ? t('acme.common.notAvailable') : String(days)
}

function renewalAtTimeOf(asset: ApiRecord | null): number | null {
  const notAfterTime = timeValue(latestVersionForAsset(asset)?.notAfter)
  const renewalWindowDays = renewalWindowDaysOf(asset)
  if (notAfterTime === null || renewalWindowDays === null) return null
  return notAfterTime - (renewalWindowDays * MILLISECONDS_PER_DAY)
}

// 这里展示的是“距离进入续签窗口还有多久”，不是策略配置本身。
function renewalCountdownFromAsset(asset: ApiRecord | null): string {
  const renewalAtTime = renewalAtTimeOf(asset)
  if (renewalAtTime === null) return t('acme.common.notAvailable')

  const difference = renewalAtTime - Date.now()
  if (difference < 0) return t('acme.countdown.windowStarted')
  if (difference < MILLISECONDS_PER_DAY) return t('acme.countdown.today')

  return t('acme.countdown.remainingDays', {
    days: Math.ceil(difference / MILLISECONDS_PER_DAY),
  })
}

function domainsOf(asset: ApiRecord): string {
  const domains = [text(asset.primaryDomain), ...(Array.isArray(asset.sans) ? asset.sans.map(String) : [])].filter(Boolean)
  return domains.join(', ') || t('acme.common.notAvailable')
}

function statusLabel(value: unknown): string {
  return t(`acme.statuses.${normalizedJobStatus(value)}`)
}

function assetStatus(asset: ApiRecord): string {
  const assetJobs = jobsForAsset(asset)
  const latestJob = [...assetJobs].sort((left, right) => {
    const leftTime = Date.parse(text(left.updatedAt, text(left.createdAt)))
    const rightTime = Date.parse(text(right.updatedAt, text(right.createdAt)))
    return rightTime - leftTime
  })[0]
  const jobStatus = text(latestJob?.status)
  return ['scheduled', 'retry_waiting', 'issuing'].includes(jobStatus)
    ? jobStatus
    : text(asset.status)
}

function challengeLabel(value: unknown): string {
  return t(`acme.challengeTypes.${text(value)}`)
}

function renewalLabel(asset: ApiRecord): string {
  const policy = policyForAsset(asset)
  if (!policy) return t('acme.list.values.notConfigured')
  return text(policy.enabled) === 'true' || policy.enabled === true ? t('acme.list.values.enabled') : t('acme.list.values.disabled')
}

function normalizedJobStatus(value: unknown): string {
  const status = text(value, 'unknown')
  return ['deploying', 'verifying', 'issued_waiting_for_installation'].includes(status) ? 'completed' : status
}

function orderIdentifiers(order: InternalCaRecord): string {
  if (!Array.isArray(order.identifiers)) return t('acme.common.notAvailable')
  return order.identifiers
    .map((item) => item && typeof item === 'object' ? text((item as InternalCaRecord).value) : '')
    .filter(Boolean)
    .join(', ') || t('acme.common.notAvailable')
}

function detailOrderEmptyText(asset: ApiRecord | null): string {
  const policy = policyForAsset(asset)
  if (text(policy?.challengeType) === 'dns-01') return t('acme.detail.emptyOrdersDns01')
  return t('acme.detail.emptyOrders')
}

function latestVersionForAsset(asset: ApiRecord | null): InternalCaRecord | undefined {
  if (!asset) return undefined
  const currentVersion = asset.currentVersion && typeof asset.currentVersion === 'object'
    ? asset.currentVersion as InternalCaRecord
    : undefined
  if (text(currentVersion?.notAfter)) return currentVersion

  const currentVersionId = text(asset.currentVersionId, text(currentVersion?.id))
  if (currentVersionId) {
    const matched = certificateVersions.value.find((version) => text(version.id) === currentVersionId)
    if (matched) return matched as InternalCaRecord
  }

  const assetId = text(asset.id)
  if (!assetId) return undefined
  return certificateVersions.value.find((version) => text(version.certificateAssetId) === assetId) as InternalCaRecord | undefined
}
</script>

<template>
  <section class="acme-page">
    <GcPageHeader :title="t('acme.title')" :description="t('acme.description')">
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading || actionPending" :aria-label="t('acme.aria.refresh')" @click="loadAll">{{ t('acme.actions.refresh') }}</button>
        <button class="gc-button" type="button" :disabled="actionPending" @click="openProviderSettingsDialog">{{ t('acme.provider.actions.settings') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="actionPending" :aria-label="t('acme.aria.add')" @click="openCreateDialog">{{ t('acme.actions.add') }}</button>
      </template>
    </GcPageHeader>

    <p v-if="error" class="acme-error" role="alert">{{ error }}</p>

    <div class="acme-summary" aria-live="polite">
      <div><strong>{{ configuredAssets.length }}</strong><span>{{ t('acme.summary.certificates') }}</span></div>
      <div><strong>{{ dueJobs.length }}</strong><span>{{ t('acme.summary.inProgress') }}</span></div>
      <div data-tone="danger"><strong>{{ failedJobs.length }}</strong><span>{{ t('acme.summary.failures') }}</span></div>
      <button class="gc-button" type="button" :disabled="actionPending" @click="runDueJobs">{{ t('acme.actions.run') }}</button>
    </div>

    <GcDataTable :columns="assetColumns" :rows="configuredAssets" :loading="loading" :empty-text="t('acme.list.empty')">
      <template #cell-name="{ row }">
        <div class="acme-asset-name"><strong>{{ text(row.name, text(row.primaryDomain, t('acme.common.unknown'))) }}</strong><small>{{ text(row.primaryDomain) }}</small></div>
      </template>
      <template #cell-domains="{ row }"><span class="acme-domains">{{ domainsOf(row) }}</span></template>
      <template #cell-status="{ row }"><span class="acme-status" :data-status="assetStatus(row)">{{ statusLabel(assetStatus(row)) }}</span></template>
      <template #cell-expiresAt="{ row }">{{ dateFromAsset(row) }}</template>
      <template #cell-nextRenewalIn="{ row }">{{ renewalCountdownFromAsset(row) }}</template>
      <template #cell-renewal="{ row }"><span class="acme-status" :data-status="renewalLabel(row)">{{ renewalLabel(row) }}</span></template>
      <template #cell-actions="{ row }">
        <div class="acme-row-actions">
          <button class="gc-button gc-button--compact" type="button" :disabled="actionPending || !policyForAsset(row) || hasRunningJob(row)" @click="toggleRenewal(row)">{{ renewalLabel(row) === t('acme.list.values.enabled') ? t('acme.actions.disable') : t('acme.actions.enable') }}</button>
          <button class="gc-button gc-button--compact" type="button" :disabled="actionPending || manualRenewalAssetId === text(row.id) || !policyEnabled(row) || hasBlockingJob(row)" @click="manualRenew(row)">{{ manualRenewalAssetId === text(row.id) ? t('acme.actions.manualRenewing') : t('acme.actions.manualRenew') }}</button>
          <button class="gc-button gc-button--compact" type="button" :disabled="actionPending" @click="openDetails(row)">{{ t('acme.actions.details') }}</button>
          <button class="gc-button gc-button--compact" type="button" :disabled="actionPending || hasRunningJob(row)" @click="openEditDialog(row)">{{ t('acme.actions.edit') }}</button>
          <button class="gc-button gc-button--compact gc-button--danger" type="button" :disabled="actionPending || hasRunningJob(row)" @click="openDeleteDialog(row)">{{ t('acme.actions.delete') }}</button>
        </div>
      </template>
    </GcDataTable>

    <details class="acme-advanced">
      <summary>{{ t('acme.advanced.title') }}</summary>
      <div class="acme-advanced__body">
        <p>{{ t('acme.advanced.description') }}</p>
        <div class="acme-advanced__facts">
          <span>{{ t('acme.advanced.providers', { count: acmeProviders.length }) }}</span>
          <span>{{ t('acme.advanced.accounts', { count: acmeAccounts.length }) }}</span>
          <span>{{ t('acme.advanced.orders', { count: orders.length }) }}</span>
          <span>{{ t('acme.advanced.jobs', { count: jobs.length }) }}</span>
        </div>
        <div v-if="failedJobs.length" class="acme-failure-list">
          <article v-for="job in failedJobs" :key="text(job.id)" class="acme-failure">
            <strong>{{ statusLabel(job.status) }}</strong>
            <span>{{ text(job.failureMessage, t('acme.messages.noFailure')) }}</span>
            <button class="gc-button gc-button--compact" type="button" :disabled="actionPending" @click="retryJob(job)">{{ t('acme.actions.retry') }}</button>
          </article>
        </div>
      </div>
    </details>

    <GcModal v-model:open="createDialogOpen" :title="t('acme.create.title')" :description="t('acme.create.description')" size="lg">
      <form class="acme-form" @submit.prevent="createAcmeCertificate">
        <section class="acme-form-section">
          <label class="acme-form-field acme-form-field--wide">{{ t('acme.create.fields.domains') }}<textarea v-model="createDraft.domains" required :placeholder="t('acme.create.placeholders.domains')" /></label>
          <label class="acme-form-field">{{ t('acme.create.fields.email') }}<input v-model="createDraft.contactEmail" type="email" required /></label>
          <label class="acme-form-field">{{ t('acme.create.fields.name') }}<input v-model="createDraft.name" :placeholder="t('acme.create.placeholders.name')" /></label>
          <label class="acme-form-field">
            {{ t('acme.create.fields.acmeProvider') }}
            <select v-model="createDraft.providerId" required>
              <option value="" disabled>{{ t('acme.create.placeholders.acmeProvider') }}</option>
              <option v-for="provider in acmeProviders" :key="text(provider.id)" :value="text(provider.id)">
                {{ text(provider.name, text(provider.id)) }}
              </option>
            </select>
          </label>
        </section>
        <p class="acme-form-hint">{{ t('acme.create.hints.domains') }}</p>
        <section class="acme-form-section acme-form-section--challenge">
          <span class="acme-form-section__title">{{ t('acme.fields.challengeType') }}</span>
          <label class="acme-switch"><input v-model="createDraft.challengeType" type="radio" value="http-01" />{{ challengeLabel('http-01') }}</label>
          <label class="acme-switch"><input v-model="createDraft.challengeType" type="radio" value="dns-01" />{{ challengeLabel('dns-01') }}</label>
        </section>
        <section v-if="createDraft.challengeType === 'dns-01'" class="acme-dns-fields">
          <label>
            {{ t('acme.create.fields.dnsProvider') }}
            <select v-model="createDraft.dnsProvider" required>
              <option value="" disabled>{{ t('acme.create.placeholders.dnsProvider') }}</option>
              <option v-for="provider in dnsProviders" :key="text(provider.id)" :value="text(provider.id)">
                {{ text(provider.name, text(provider.id)) }}
              </option>
            </select>
          </label>
          <div v-if="selectedDnsProvider" class="acme-provider-meta">
            <strong>{{ text(selectedDnsProvider.name, text(selectedDnsProvider.id)) }}</strong>
            <span>{{ text(selectedDnsProvider.id) }}</span>
          </div>
          <GcAcmeDnsCredentialSelect
            v-if="selectedDnsProvider"
            v-model="createDraft.dnsCredentialId"
            :provider-id="text(selectedDnsProvider.id)"
            :provider-name="text(selectedDnsProvider.name, text(selectedDnsProvider.id))"
            :credential-template="text(selectedDnsProvider.credentialTemplate, t('acme.common.notAvailable'))"
            required
          />
          <label>{{ t('acme.create.fields.dnsPropagation') }}<input v-model.number="createDraft.dnsPropagationSeconds" type="number" min="0" max="7200" required /></label>
        </section>
        <section class="acme-form-section">
          <label class="acme-form-field">{{ t('acme.create.fields.keyType') }}<select v-model="createDraft.keyType"><option value="rsa">{{ t('acme.create.values.rsa') }}</option><option value="ecdsa">{{ t('acme.create.values.ecdsa') }}</option></select></label>
          <label class="acme-form-field">{{ t('acme.create.fields.renewalWindow') }}<input v-model.number="createDraft.renewalWindowDays" type="number" min="1" max="90" required /></label>
          <label class="acme-switch"><input v-model="createDraft.autoRenew" type="checkbox" />{{ t('acme.create.fields.autoRenew') }}</label>
        </section>
        <label class="acme-switch acme-terms-trigger">
          <input :checked="createDraft.termsOfServiceAgreed" type="checkbox" @click.prevent="openTermsDialog" />
          <span>{{ t('acme.create.fields.terms') }}</span>
          <button class="gc-button gc-button--compact" type="button" @click.prevent="openTermsDialog">{{ t('acme.actions.readTerms') }}</button>
        </label>
        <p class="acme-form-note">{{ t('acme.create.note') }}</p>
      </form>
      <template #actions>
        <button class="gc-button" type="button" :disabled="actionPending" @click="closeCreateDialog">{{ t('common.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="actionPending" @click="createAcmeCertificate">{{ t('acme.actions.save') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="editDialogOpen" :title="t('acme.edit.title')" :description="t('acme.edit.description')" size="lg">
      <form class="acme-form" @submit.prevent="saveEditedCertificate">
        <section class="acme-form-section">
          <label class="acme-form-field acme-form-field--wide">{{ t('acme.create.fields.domains') }}<textarea v-model="editDraft.domains" required :placeholder="t('acme.create.placeholders.domains')" /></label>
          <label class="acme-form-field">{{ t('acme.create.fields.email') }}<input v-model="editDraft.contactEmail" type="email" required /></label>
          <label class="acme-form-field">{{ t('acme.create.fields.name') }}<input v-model="editDraft.name" :placeholder="t('acme.create.placeholders.name')" /></label>
          <label class="acme-form-field">
            {{ t('acme.create.fields.acmeProvider') }}
            <select v-model="editDraft.providerId" required>
              <option value="" disabled>{{ t('acme.create.placeholders.acmeProvider') }}</option>
              <option v-for="provider in acmeProviders" :key="text(provider.id)" :value="text(provider.id)">
                {{ text(provider.name, text(provider.id)) }}
              </option>
            </select>
          </label>
        </section>
        <section class="acme-form-section acme-form-section--challenge">
          <span class="acme-form-section__title">{{ t('acme.fields.challengeType') }}</span>
          <label class="acme-switch"><input v-model="editDraft.challengeType" type="radio" value="http-01" />{{ challengeLabel('http-01') }}</label>
          <label class="acme-switch"><input v-model="editDraft.challengeType" type="radio" value="dns-01" />{{ challengeLabel('dns-01') }}</label>
        </section>
        <section v-if="editDraft.challengeType === 'dns-01'" class="acme-dns-fields">
          <label>
            {{ t('acme.create.fields.dnsProvider') }}
            <select v-model="editDraft.dnsProvider" required>
              <option value="" disabled>{{ t('acme.create.placeholders.dnsProvider') }}</option>
              <option v-for="provider in dnsProviders" :key="text(provider.id)" :value="text(provider.id)">
                {{ text(provider.name, text(provider.id)) }}
              </option>
            </select>
          </label>
          <GcAcmeDnsCredentialSelect
            v-if="selectedEditDnsProvider"
            v-model="editDraft.dnsCredentialId"
            :provider-id="text(selectedEditDnsProvider.id)"
            :provider-name="text(selectedEditDnsProvider.name, text(selectedEditDnsProvider.id))"
            :credential-template="text(selectedEditDnsProvider.credentialTemplate, t('acme.common.notAvailable'))"
            required
          />
          <label>{{ t('acme.create.fields.dnsPropagation') }}<input v-model.number="editDraft.dnsPropagationSeconds" type="number" min="0" max="7200" required /></label>
        </section>
        <section class="acme-form-section">
          <label class="acme-form-field">{{ t('acme.create.fields.keyType') }}<select v-model="editDraft.keyType"><option value="rsa">{{ t('acme.create.values.rsa') }}</option><option value="ecdsa">{{ t('acme.create.values.ecdsa') }}</option></select></label>
          <label class="acme-form-field">{{ t('acme.create.fields.renewalWindow') }}<input v-model.number="editDraft.renewalWindowDays" type="number" min="1" max="90" required /></label>
          <label class="acme-switch"><input v-model="editDraft.autoRenew" type="checkbox" />{{ t('acme.create.fields.autoRenew') }}</label>
        </section>
      </form>
      <template #actions>
        <button class="gc-button" type="button" :disabled="actionPending" @click="editDialogOpen = false">{{ t('common.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="actionPending" @click="saveEditedCertificate">{{ t('acme.actions.save') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="deleteDialogOpen" :title="t('acme.delete.title')" :description="t('acme.delete.description')" size="sm">
      <p class="acme-delete-confirm">
        {{ t('acme.delete.confirmation', { name: text(deletingAsset?.name, text(deletingAsset?.primaryDomain, t('acme.common.unknown'))) }) }}
      </p>
      <template #actions>
        <button class="gc-button" type="button" :disabled="actionPending" @click="deleteDialogOpen = false">{{ t('common.cancel') }}</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="actionPending" @click="deleteCertificate">{{ t('acme.actions.delete') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="providerDialogOpen" :title="t('acme.provider.title')" :description="t('acme.provider.description')" size="lg">
      <div class="acme-provider-settings">
        <div v-if="acmeProviders.length" class="acme-provider-list">
          <article v-for="provider in acmeProviders" :key="text(provider.id)" class="acme-provider-item">
            <div class="acme-provider-item__main">
              <strong>{{ text(provider.name, text(provider.id)) }}</strong>
              <span>{{ text(providerConfiguration(provider).directoryUrl, text(provider.endpoint)) }}</span>
              <small>{{ t(`acme.provider.presets.${text(providerConfiguration(provider).preset, 'custom')}`) }}</small>
            </div>
            <div class="acme-row-actions">
              <span v-if="providerConfiguration(provider).isDefault === true" class="acme-status" data-status="active">{{ t('acme.provider.values.default') }}</span>
              <span v-if="providerConfiguration(provider).isBuiltIn === true" class="acme-status" data-status="active">{{ t('acme.provider.values.builtIn') }}</span>
              <button class="gc-button gc-button--compact" type="button" :disabled="providerActionPending" @click="testProvider(provider)">
                {{ providerTestId === text(provider.id) ? t('acme.provider.actions.testing') : t('acme.provider.actions.test') }}
              </button>
              <button class="gc-button gc-button--compact" type="button" :disabled="providerActionPending" @click="openProviderEditDialog(provider)">{{ t('acme.provider.actions.edit') }}</button>
            </div>
            <p v-if="providerTestResults[text(provider.id)]" class="acme-provider-test-result" :data-status="providerTestResults[text(provider.id)]?.status">
              {{ providerTestResults[text(provider.id)]?.message }}
            </p>
          </article>
        </div>
        <p v-else class="acme-provider-empty">{{ t('acme.provider.empty') }}</p>
      </div>
      <template #actions>
        <button class="gc-button" type="button" @click="providerDialogOpen = false">{{ t('common.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" @click="openProviderCreateDialog">{{ t('acme.provider.actions.add') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="providerEditorOpen" :title="editingProviderId ? t('acme.provider.editTitle') : t('acme.provider.createTitle')" :description="t('acme.provider.editorDescription')" size="lg">
      <form class="acme-provider-form" @submit.prevent="saveProvider">
        <div class="acme-provider-form__grid">
          <label>{{ t('acme.provider.fields.preset') }}
            <select v-model="providerDraft.preset">
              <option v-for="preset in acmeProviderPresets" :key="preset.key" :value="preset.key">
                {{ t(`acme.provider.presets.${preset.key}`) }}
              </option>
            </select>
          </label>
          <label>{{ t('acme.provider.fields.name') }}<input v-model="providerDraft.name" required /></label>
          <label class="acme-provider-form__wide">{{ t('acme.provider.fields.directoryUrl') }}<input v-model="providerDraft.directoryUrl" type="url" required /></label>
          <label class="acme-provider-form__wide">{{ t('acme.provider.fields.termsOfServiceUrl') }}<input v-model="providerDraft.termsOfServiceUrl" type="url" :placeholder="t('acme.provider.placeholders.termsOfServiceUrl')" /></label>
        </div>
        <fieldset class="acme-provider-challenges">
          <legend>{{ t('acme.provider.fields.allowedChallenges') }}</legend>
          <label class="acme-switch"><input v-model="providerDraft.allowedChallenges" type="checkbox" value="http-01" />{{ challengeLabel('http-01') }}</label>
          <label class="acme-switch"><input v-model="providerDraft.allowedChallenges" type="checkbox" value="dns-01" />{{ challengeLabel('dns-01') }}</label>
          <label class="acme-switch"><input v-model="providerDraft.allowedChallenges" type="checkbox" value="tls-alpn-01" />{{ challengeLabel('tls-alpn-01') }}</label>
        </fieldset>
        <p v-if="selectedProviderPreset?.requiresEab" class="acme-form-note">{{ t('acme.provider.hints.eabRequired') }}</p>
        <p v-else class="acme-form-note">{{ t('acme.provider.hints.accountSetup') }}</p>
        <label class="acme-switch"><input v-model="providerDraft.isDefault" type="checkbox" />{{ t('acme.provider.fields.isDefault') }}</label>
      </form>
      <template #actions>
        <button class="gc-button" type="button" :disabled="providerActionPending" @click="providerEditorOpen = false">{{ t('common.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="providerActionPending" @click="saveProvider">{{ t('acme.provider.actions.save') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="detailDialogOpen" :title="text(selectedAsset?.name, text(selectedAsset?.primaryDomain, t('acme.common.unknown')))" :description="t('acme.detail.description')" size="xl">
      <div class="acme-detail">
        <dl class="acme-detail__facts">
          <div><dt>{{ t('acme.detail.fields.domains') }}</dt><dd>{{ selectedAsset ? domainsOf(selectedAsset) : t('acme.common.notAvailable') }}</dd></div>
          <div><dt>{{ t('acme.detail.fields.expiresAt') }}</dt><dd>{{ selectedAsset ? dateFromAsset(selectedAsset) : t('acme.common.notAvailable') }}</dd></div>
          <div><dt>{{ t('acme.detail.fields.provider') }}</dt><dd>{{ providerLabelForAsset(selectedAsset) }}</dd></div>
          <div><dt>{{ t('acme.detail.fields.challenge') }}</dt><dd>{{ challengeLabel(policyForAsset(selectedAsset)?.challengeType) }}</dd></div>
          <div><dt>{{ t('acme.detail.fields.renewalWindow') }}</dt><dd>{{ renewalWindowLabel(selectedAsset) }}</dd></div>
          <div><dt>{{ t('acme.detail.fields.nextRenewalIn') }}</dt><dd>{{ renewalCountdownFromAsset(selectedAsset) }}</dd></div>
        </dl>
        <GcDataTable :columns="detailJobColumns" :rows="jobsForAsset(selectedAsset)" :loading="loading" :empty-text="t('acme.detail.emptyJobs')">
          <template #cell-status="{ row }"><span class="acme-status" :data-status="normalizedJobStatus(row.status)">{{ statusLabel(row.status) }}</span></template>
          <template #cell-nextAttemptAt="{ row }">{{ localTime(row.nextAttemptAt) }}</template>
          <template #cell-failureMessage="{ row }">{{ text(row.failureMessage, t('acme.messages.noFailure')) }}</template>
        </GcDataTable>
        <GcDataTable :columns="detailOrderColumns" :rows="ordersForAsset(selectedAsset)" :loading="loading" :empty-text="detailOrderEmptyText(selectedAsset)">
          <template #cell-identifiers="{ row }">{{ orderIdentifiers(row) }}</template>
          <template #cell-status="{ row }"><span class="acme-status" :data-status="text(row.status)">{{ statusLabel(row.status) }}</span></template>
          <template #cell-updatedAt="{ row }">{{ localTime(row.updatedAt) }}</template>
        </GcDataTable>
      </div>
    </GcModal>

    <GcModal v-model:open="termsDialogOpen" :title="t('acme.terms.title')" :description="t('acme.terms.description')" size="lg">
      <article class="acme-terms">
        <p>{{ t('acme.terms.intro') }}</p>
        <p>{{ t('acme.terms.responsibility') }}</p>
        <p>{{ t('acme.terms.credentials') }}</p>
        <p>{{ t('acme.terms.renewal') }}</p>
        <label class="acme-switch">
          <input v-model="termsRead" type="checkbox" />
          <span>{{ t('acme.terms.readConfirm') }}</span>
        </label>
      </article>
      <template #actions>
        <button class="gc-button" type="button" @click="termsDialogOpen = false">{{ t('common.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="!termsRead" @click="confirmTerms">{{ t('acme.terms.confirm') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.acme-page { display: grid; gap: var(--gc-space-5); }
.acme-error { margin: 0; padding: var(--gc-space-3); color: var(--gc-color-danger); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); background: var(--gc-color-danger-bg); }
.acme-summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gc-space-4); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface); }
.acme-summary > div { display: grid; gap: var(--gc-space-1); min-width: var(--gc-size-card-min); }
.acme-summary strong { color: var(--gc-color-primary); font-size: var(--gc-font-size-2xl); }
.acme-summary > div[data-tone='danger'] strong { color: var(--gc-color-danger); }
.acme-summary span, .acme-advanced p, .acme-form-hint, .acme-form-note { color: var(--gc-color-text-muted); }
.acme-asset-name { display: grid; gap: var(--gc-space-1); }
.acme-asset-name small, .acme-form-hint, .acme-form-note { font-size: var(--gc-font-size-sm); }
.acme-domains { overflow-wrap: anywhere; }
.acme-row-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.acme-status { display: inline-flex; width: fit-content; padding: var(--gc-space-1) var(--gc-space-2); border-radius: var(--gc-radius-pill); color: var(--gc-color-muted); background: var(--gc-color-muted-bg); font-size: var(--gc-font-size-xs); font-weight: 700; }
.acme-status[data-status='active'], .acme-status[data-status='enabled'], .acme-status[data-status='completed'], .acme-status[data-status='valid'] { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.acme-status[data-status='failed'], .acme-status[data-status='blocked'], .acme-status[data-status='disabled'] { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.acme-status[data-status='issuing'], .acme-status[data-status='retry_waiting'] { color: var(--gc-color-warning); background: var(--gc-color-warning-bg); }
.acme-advanced { border-block: var(--gc-border-width-default) solid var(--gc-color-border); }
.acme-advanced summary { cursor: pointer; padding: var(--gc-space-4) 0; color: var(--gc-color-text-strong); font-weight: 700; }
.acme-advanced__body { display: grid; gap: var(--gc-space-3); padding: 0 0 var(--gc-space-4); }
.acme-advanced__facts { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); color: var(--gc-color-text-muted); }
.acme-failure-list, .acme-detail { display: grid; gap: var(--gc-space-3); }
.acme-failure { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-danger-border); background: var(--gc-color-danger-bg); }
.acme-failure span { overflow-wrap: anywhere; color: var(--gc-color-text-muted); }
.acme-form { display: grid; gap: var(--gc-space-3); }
.acme-form-section { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: end; gap: var(--gc-space-3); }
.acme-form-section--challenge { grid-template-columns: auto auto 1fr; align-items: center; padding-block: var(--gc-space-1); }
.acme-form-section__title { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-form-field { min-width: 0; }
.acme-form-field--wide { grid-column: span 2; }
.acme-form label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-form input, .acme-form textarea, .acme-form select { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); color: var(--gc-color-text); background: var(--gc-color-surface-field); }
.acme-form textarea { min-height: var(--gc-control-height-xl); padding-block: var(--gc-space-2); resize: vertical; }
.acme-switch { display: flex !important; grid-template-columns: auto 1fr; align-items: center; gap: var(--gc-space-2) !important; }
.acme-switch input { min-height: auto !important; }
.acme-dns-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); padding: var(--gc-space-3); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-info-border); background: var(--gc-color-info-bg); }
.acme-dns-fields > :first-child { min-width: 0; }
.acme-dns-fields > :nth-child(2) { grid-column: span 2; }
.acme-provider-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-provider-meta strong { color: var(--gc-color-text-strong); }
.acme-template { max-height: 40vh; overflow: auto; margin: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); color: var(--gc-color-text-strong); background: var(--gc-color-surface-muted); font-family: var(--gc-font-family); font-size: var(--gc-font-size-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
.acme-terms-trigger { flex-wrap: wrap; }
.acme-terms-trigger .gc-button { margin-inline-start: auto; }
.acme-terms { display: grid; gap: var(--gc-space-3); color: var(--gc-color-text); line-height: 1.7; }
.acme-terms p { margin: 0; }
.acme-delete-confirm { margin: 0; color: var(--gc-color-text); overflow-wrap: anywhere; }
.acme-provider-settings { display: grid; gap: var(--gc-space-4); }
.acme-provider-list { display: grid; min-width: 0; gap: var(--gc-space-2); }
.acme-provider-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: var(--gc-space-3); min-width: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); background: var(--gc-color-surface-muted); }
.acme-provider-item__main { display: grid; min-width: 0; gap: var(--gc-space-1); }
.acme-provider-item__main span { overflow-wrap: anywhere; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-provider-item__main small, .acme-provider-empty { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-provider-empty { margin: 0; padding: var(--gc-space-4); border: var(--gc-border-width-default) dashed var(--gc-color-border); text-align: center; }
.acme-provider-item > .acme-row-actions { grid-column: 2; justify-self: end; align-items: center; }
.acme-provider-test-result { grid-column: 1 / -1; min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-provider-test-result[data-status='valid'] { color: var(--gc-color-success); }
.acme-provider-test-result[data-status='failed'] { color: var(--gc-color-danger); }
.acme-provider-form { display: grid; gap: var(--gc-space-3); padding-top: var(--gc-space-3); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.acme-provider-form h3 { margin: 0; color: var(--gc-color-text-strong); font-size: var(--gc-font-size-lg); }
.acme-provider-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.acme-provider-form label, .acme-provider-challenges { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-provider-form__wide { grid-column: span 2; }
.acme-provider-form input, .acme-provider-form select { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); color: var(--gc-color-text); background: var(--gc-color-surface-field); }
.acme-provider-challenges { grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); }
.acme-provider-challenges legend { padding-inline: var(--gc-space-1); }
.acme-provider-challenges .acme-switch { color: var(--gc-color-text); }
.acme-detail__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.acme-detail__facts div { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); background: var(--gc-color-surface-muted); }
.acme-detail__facts dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.acme-detail__facts dd { margin: 0; color: var(--gc-color-text-strong); overflow-wrap: anywhere; }
@media (max-width: 48rem) {
  .acme-form-section, .acme-dns-fields { grid-template-columns: 1fr; }
  .acme-form-field--wide, .acme-dns-fields > :nth-child(2) { grid-column: auto; }
  .acme-form-section--challenge { grid-template-columns: 1fr 1fr; }
  .acme-provider-form__grid, .acme-provider-challenges { grid-template-columns: 1fr; }
  .acme-provider-form__wide { grid-column: auto; }
  .acme-provider-item { grid-template-columns: 1fr; }
  .acme-provider-item > .acme-row-actions, .acme-provider-test-result { grid-column: auto; justify-self: start; width: 100%; }
  .acme-summary > div { min-width: 0; flex: 1 1 40%; }
  .acme-failure { grid-template-columns: 1fr; }
  .acme-detail__facts { grid-template-columns: 1fr; }
}
</style>
