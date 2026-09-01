<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch, type Directive } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { createServiceAsset, deleteServiceAsset, getAssetDetail, getApplicationAssetLinkageStatus, getApplicationCertificateSupplyPolicy, getManagedTargetEffectiveCapability, listAssets, listManagedTargets, listManagedTargetCompatiblePlugins, listManagedTargetSnapshots, listFrameworkInstances, listSiteAssets, previewApplicationCertificateSupplyPolicy, repairApplicationAssetLinkage, saveApplicationAssetManagedTarget, saveApplicationAssetStandaloneWorkflow, saveApplicationCertificateSupplyPolicy, updateServiceAsset } from '@/api/modules/assets.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import { listGateways } from '@/api/modules/gateways.api'
import { getWorkflowExecutionBinding, listWorkflowTemplates, listWorkflowTemplateVersions } from '@/api/modules/workflow-templates.api'
import { listCertificateFormats, listCertificates, listCertificateVersions } from '@/api/modules/certificates.api'
import { createDeploymentPlanFromApplicationAsset, dryRunDeploymentPlan, executeDeploymentPlan, listDeploymentPlansByApplicationAsset, submitDeploymentPlan } from '@/api/modules/deployments.api'
import { projectApplicationAssetPluginInputs, projectDeploymentInputs, type WorkflowDeploymentInputProjectionOverride } from '@/api/modules/deployment-inputs.api'
import { getPluginBinding } from '@/api/modules/plugins.api'
import { listManagedDevices } from '@/api/modules/devices.api'
import { getDeploymentTaskSettings } from '@/api/modules/security.api'
import type { ApiPageResult, ApiRecord, BusinessListQuery } from '@/api/modules/common'
import type { ViewRow } from '@/composables/useBusinessPage'
import { DeploymentInputForm, GcButton, GcCard, GcCertificateDeploymentForm, GcCompatiblePluginSelector, GcConfirmAction, GcDataTable, GcEffectiveCapabilityCard, GcEmptyState, GcExecutionModeSelector, GcHelpTip, GcManagedTargetSelector, GcModal, GcPagination, GcPermissionButton, GcPluginLogo, GcProgressBar, GcStatusTag, GcTabs, GcUserFlowWizard, GcWorkflowExecutionForm, type DeploymentArtifactOption, type DeploymentInputBindingsV1, type DeploymentInputProjectionV1, type StatusTone } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import type { UserFlowStep } from '@/design-system/components/GcUserFlowWizard.vue'
import { useAppStore } from '@/stores/app.store'
import { useAuthStore } from '@/stores/auth.store'
import { usePermissionStore } from '@/stores/permission.store'
import { useTenantStore } from '@/stores/tenant.store'
import { formatMaybeLocalTime, getExpiryCountdown } from '@/utils/browser-local-time'
import { localizeCertificateFormatName } from '@/utils/certificate-format-localization'
import {
  buildManagedTargetDeploymentStrategy,
  collectFrameworkTypeOptions,
  frameworkTypesMatch,
  normalizeFrameworkType,
  resolveDeploymentStrategyMode,
} from './asset-deployment-strategy.model'
import {
  loadCredentialProfiles,
  credentialProfileLabel,
  credentialProfileSummary,
  type CredentialProfileOption,
} from '@/views/workflows/credential-profiles'
import { filterCertificateDeploymentWorkflows } from '@/views/workflows/workflow-template-selection'
import {
  createInputBindingsV1,
  readInputBindingsV1,
} from './asset-input-bindings.model'
import ApplicationOnboardingModal from '@/views/application-onboarding/ApplicationOnboardingModal.vue'
import DeviceOnboardingWizard from '@/views/devices/DeviceOnboardingWizard.vue'
import type { DeviceOnboardingInitialSelection } from '@/views/devices/device-onboarding.model'

type AssetPlatform = 'LINUX' | 'WINDOWS' | 'APPLIANCE'
type AssetProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' | 'CUSTOM'
type AssetManagementMode = 'MANAGED_TARGET' | 'WORKFLOW'
type ManagedExecutionMode = 'PLUGIN' | 'WORKFLOW_OVERRIDE'
type WorkflowRunnerType = 'CONTROL_PLANE' | 'GATEWAY'
type WorkflowVersionSelection = 'PINNED' | 'LATEST_PUBLISHED'
type AssetWizardStep = 1 | 2 | 3
type AssetCertificateLifecycle = 'unknown' | 'expired' | 'expiringSoon' | 'valid' | 'updateAvailable'
type CertificateDeploymentSelection = { certificateAssetId: string; selectionMode: 'EXPLICIT' | 'LATEST_AUTO'; certificateVersionId: string }
type AssetPresentation = 'cards' | 'list'
type AssetSortField = 'domain' | 'port' | 'protocol' | 'device' | 'framework' | 'site' | 'status' | 'updatedAt'
type AssetSortOrder = 'asc' | 'desc'
type AssetCertificateCategory = 'all' | 'valid' | 'updateAvailable'
type ApplicationCertificateSupplyMode = 'manual' | 'dedicated'
type ApplicationCertificateProviderType = 'internal_ca' | 'acme'

interface CertificateSupplyDraft {
  supplyMode: ApplicationCertificateSupplyMode
  certificateAssetId: string
  certificateVersionId: string
  providerType: ApplicationCertificateProviderType
  providerId: string
  certificateAuthorityId: string
  acmeProviderProfileId: string
  dnsProviderId: string
  credentialRef: string
  certificateProfileVersionId: string
  autoRenew: boolean
  renewalWindowDays: number
  rotateKeyOnRenewal: boolean
}

interface CertificateSupplyData {
  readonly primaryDomain?: string
  readonly policy?: ApiRecord
  readonly currentVersion?: ApiRecord
  readonly certificateCandidates?: ApiRecord[]
  readonly providers?: {
    ca?: ApiRecord[]
    acme?: ApiRecord[]
    dns?: ApiRecord[]
    acmeProviderProfiles?: ApiRecord[]
    authorities?: ApiRecord[]
    profiles?: ApiRecord[]
  }
  readonly capability?: {
    custodyMode?: string
    deploymentArtifactMode?: string
    evidence?: Record<string, unknown>
  }
  readonly readiness?: {
    canSave?: boolean
    canIssue?: boolean
    canDeploy?: boolean
    reasons?: string[]
  }
}

interface DeploymentInputIssueDetail {
  readonly category?: string
  readonly code?: string
  readonly severity?: string
  readonly slot?: string
  readonly path?: string
  readonly bindingLayer?: string
}

const ASSET_WORKSPACE_PAGE_SIZE = 20
const cardFactTextObservers = new WeakMap<HTMLElement, ResizeObserver>()
const cardFactTextBaseFontSizes = new WeakMap<HTMLElement, number>()

function fitCardFactText(element: HTMLElement): void {
  const baseFontSize = cardFactTextBaseFontSizes.get(element)
  if (!baseFontSize || element.clientWidth <= 0) return

  const computedStyle = getComputedStyle(element)
  const minimumFontSize = Number.parseFloat(computedStyle.getPropertyValue('--gc-font-size-overline')) || baseFontSize * 0.8
  let fontSize = baseFontSize
  element.style.fontSize = `${baseFontSize}px`
  while (element.scrollWidth > element.clientWidth && fontSize > minimumFontSize) {
    fontSize = Math.max(minimumFontSize, fontSize - 0.5)
    element.style.fontSize = `${fontSize}px`
  }
}

const vAutoFitCardFactText: Directive<HTMLElement> = {
  mounted(element) {
    const baseFontSize = Number.parseFloat(getComputedStyle(element).fontSize)
    if (!Number.isFinite(baseFontSize) || baseFontSize <= 0) return
    cardFactTextBaseFontSizes.set(element, baseFontSize)
    element.style.whiteSpace = 'nowrap'
    element.style.overflow = 'visible'
    element.style.textOverflow = 'clip'
    fitCardFactText(element)
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(() => fitCardFactText(element))
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    cardFactTextObservers.set(element, observer)
  },
  updated(element) {
    fitCardFactText(element)
  },
  beforeUnmount(element) {
    cardFactTextObservers.get(element)?.disconnect()
    cardFactTextObservers.delete(element)
    cardFactTextBaseFontSizes.delete(element)
  },
}

interface AssetCardCertificate {
  readonly name: string
  readonly lifecycle: AssetCertificateLifecycle
  readonly lifecycleLabel: string
  readonly remainingLabel: string
  readonly tone: StatusTone
}

interface AssetOverviewCard {
  readonly id: string
  readonly asset: ApiRecord
  readonly name: string
  readonly status: string
  readonly pluginVersionId: string
  readonly certificate: AssetCardCertificate
}

interface AssetListRow extends Record<string, unknown> {
  readonly id: string
  readonly card: AssetOverviewCard
  readonly domain: string
  readonly port: string
  readonly protocol: string
  readonly device: string
  readonly framework: string
  readonly site: string
  readonly status: string
}

interface AssetDraft {
  managementMode: AssetManagementMode
  managedExecutionMode: ManagedExecutionMode
  approvalRequired: boolean
  deviceId: string
  frameworkInstanceId: string
  address: string
  port: string
  protocol: AssetProtocol
  platform: AssetPlatform
  verifyUrl: string
  frameworkType: string
  siteAssetId: string
  managedTargetId: string
  agentCertificateFormatId: string
  displayName: string
  environment: string
  tagsText: string
  workflowId: string
  workflowPluginVersionId: string
  workflowCapabilityKey: string
  workflowKey: string
  pluginOverrideVersionId: string
  workflowExecutionBindingId: string
  workflowExecutionBindingVersion: number
  workflowVersionSelection: WorkflowVersionSelection
  workflowVersionId: string
  workflowRunner: WorkflowRunnerType
  workflowGatewayId: string
  workflowTargetSiteName: string
  workflowTargetBindingInformation: string
  workflowTargetHostHeader: string
  workflowTargetSniName: string
}

interface WorkflowTargetInfo {
  frameworkType: string
  siteName: string
  bindingInformation?: string
  hostHeader?: string
  port: number
  protocol: AssetProtocol
  verifyUrl?: string
  sniName?: string
}

const { t, te, locale } = useI18n()
const route = useRoute?.() ?? { query: {} as Record<string, string | string[] | undefined> }
const router = useRouter()
const appStore = useAppStore()
const authStore = useAuthStore()
const permissionStore = usePermissionStore()
const tenantStore = useTenantStore()
const assetPresentation = ref<AssetPresentation>('cards')
const assetCertificateCategory = ref<AssetCertificateCategory>('all')
const assetSortField = ref<AssetSortField>('domain')
const assetSortOrder = ref<AssetSortOrder>('asc')
const assetOverviewCards = computed<AssetOverviewCard[]>(() =>
  [...assetOverviewItems.value]
    .map((asset) => toAssetOverviewCard(asset))
    .sort(compareAssetOverviewCards),
)
const visibleAssetOverviewCards = computed<AssetOverviewCard[]>(() => {
  if (assetCertificateCategory.value === 'all') return assetOverviewCards.value
  return assetOverviewCards.value.filter((card) => assetCertificateStatusKey(card) === assetCertificateCategory.value)
})
const assetListRows = computed<AssetListRow[]>(() =>
  visibleAssetOverviewCards.value.map((card) => ({
    id: card.id,
    card,
    domain: card.name,
    port: firstAssetText(card.asset, ['port']) || t('assets.empty.notSet'),
    protocol: firstAssetText(card.asset, ['protocol']) || t('assets.empty.notSet'),
    device: assetDeviceLabel(card.asset),
    framework: assetFrameworkLabel(card.asset),
    site: assetSiteLabel(card.asset),
    status: assetCertificateStatusKey(card),
  })),
)
const assetListColumns = computed<DataTableColumn<AssetListRow>[]>(() => [
  { key: 'domain', title: t('assets.columns.domain'), width: '24%' },
  { key: 'port', title: t('assets.columns.port'), width: '8%' },
  { key: 'protocol', title: t('assets.columns.protocol'), width: '10%' },
  { key: 'device', title: t('assets.columns.device'), width: '11%' },
  { key: 'framework', title: t('assets.columns.framework'), width: '14%' },
  { key: 'site', title: t('assets.columns.site'), width: '14%' },
  { key: 'status', title: t('assets.columns.status'), width: '9%' },
  { key: 'actions', title: t('assets.columns.actions'), width: '10%' },
])
const selectedAssetIds = ref<Set<string>>(new Set())
const selectedAssetRecords = ref<Map<string, ApiRecord>>(new Map())
const selectedAssetCount = computed(() => selectedAssetIds.value.size)
const selectedAssetItems = computed<ApiRecord[]>(() => [...selectedAssetIds.value]
  .map((assetId) => selectedAssetRecords.value.get(assetId))
  .filter((asset): asset is ApiRecord => Boolean(asset)))
const selectedCertificateDomain = computed(() => {
  if (selectedAssetItems.value.length !== selectedAssetCount.value || selectedAssetItems.value.length === 0) return ''
  const domains = selectedAssetItems.value.map((asset) => assetCertificateDomain(asset))
  if (domains.some((domain) => !domain)) return ''
  const firstDomain = domains[0]
  return domains.every((domain) => domain === firstDomain) ? firstDomain : ''
})
const canBatchUpdateCertificates = computed(() => Boolean(selectedCertificateDomain.value))
const canExecuteDeployments = computed(() => permissionStore.hasPermission('deployment.plan.execute'))
const canManageAssets = computed(() => permissionStore.hasPermission('service_asset.manage'))
const assetOverviewStatusOptions = computed(() => [
  { value: 'ACTIVE', label: t('dashboard.statusBlock.status.active') },
  { value: 'INACTIVE', label: t('dashboard.statusBlock.status.inactive') },
  { value: 'DISABLED', label: t('dashboard.statusBlock.status.disabled') },
])
const selectedServiceAsset = ref<ViewRow | null>(null)
const userAssetItems = ref<ApiRecord[]>([])
const userAssetsLoading = ref(false)
const userAssetsError = ref('')
const assetOverviewTotal = ref(0)
const assetOverviewItems = ref<ApiRecord[]>([])
const assetOverviewLoading = ref(false)
const assetOverviewError = ref('')
const assetOverviewPage = ref(1)
const assetOverviewPageSize = ref(ASSET_WORKSPACE_PAGE_SIZE)
const assetOverviewFiltersVisible = ref(false)
const assetOverviewFilters = reactive({
  address: '',
  status: '',
})
const detailModalOpen = ref(false)
let openedDetailRouteKey = ''
let openingRouteAssetKey = ''
const activeDetailTab = ref<'overview' | 'snapshots'>('overview')
const detailTabs = computed(() => [
  { value: 'overview', label: t('assets.detail.tabs.overview') },
  { value: 'snapshots', label: t('assets.detail.tabs.snapshots') },
])
const createDialogOpen = ref(false)
const onboardingDialogOpen = ref(false)
const deviceOnboardingOpen = ref(false)
const resumeApplicationOnboarding = ref(false)
const deviceOnboardingInitialSelection = ref<DeviceOnboardingInitialSelection>()
const createLoading = ref(false)
const createError = ref('')
const createRequestId = ref('')
const editingServiceAssetId = ref('')
const editAssetDetail = ref<ApiRecord | null>(null)
const deviceListLoading = ref(false)
const deviceItems = ref<ApiRecord[]>([])
const serviceInstanceListLoading = ref(false)
const serviceInstanceItems = ref<ApiRecord[]>([])
const siteListLoading = ref(false)
const siteItems = ref<ApiRecord[]>([])
const siteListError = ref('')
const managedTargetListLoading = ref(false)
const managedTargetItems = ref<ApiRecord[]>([])
const targetSelectionInitializing = ref(false)
const selectedAssetDetail = ref<ApiRecord | null>(null)
const snapshotItems = ref<ApiRecord[]>([])
const detailLoading = ref(false)
const detailError = ref('')
const linkageStatus = ref<ApiRecord | null>(null)
const linkageRepairing = ref(false)
const snapshotLoading = ref(false)
const snapshotError = ref('')
const rollbackSubmitting = ref(false)
const rollbackError = ref('')
const rollbackRequestId = ref('')
const deploymentDialogOpen = ref(false)
const deploymentLoading = ref(false)
const deploymentError = ref('')
const deploymentErrorIssues = ref<DeploymentInputIssueDetail[]>([])
const deploymentPlanId = ref('')
const deploymentDryRunChecks = ref<ApiRecord[]>([])
const deploymentCertificateItems = ref<ApiRecord[]>([])
const deploymentCertificateVersionItems = ref<ApiRecord[]>([])
const bulkCertificateUpdateMode = ref(false)
const bulkCertificateUpdateAssetIds = ref<string[]>([])
const bulkCertificateUpdateDomain = ref('')
const deploymentRecords = ref<ApiRecord[]>([])
const deploymentRecordsLoading = ref(false)
const deploymentRecordsError = ref('')
const assetWizardStep = ref<AssetWizardStep>(1)
const workflowListLoading = ref(false)
const workflowVersionListLoading = ref(false)
const gatewayListLoading = ref(false)
const workflowItems = ref<ApiRecord[]>([])
const workflowVersionItems = ref<ApiRecord[]>([])
const gatewayItems = ref<ApiRecord[]>([])
const workflowBindingProjection = ref<DeploymentInputProjectionV1 | null>(null)
const deploymentInputBindings = ref<DeploymentInputBindingsV1>(createInputBindingsV1())
const workflowProjectionLoading = ref(false)
const workflowProjectionRefreshing = ref(false)
const workflowProjectionError = ref('')
const workflowTargetAdvancedExpanded = ref(false)
const credentialProfileItems = ref<CredentialProfileOption[]>([])
const credentialProfileLoading = ref(false)
const certificateFormatItems = ref<ApiRecord[]>([])
const certificateFormatLoading = ref(false)
const workflowListError = ref('')
const workflowVersionListError = ref('')
const gatewayListError = ref('')
const credentialProfileError = ref('')
const certificateFormatError = ref('')
const bulkDeleteLoading = ref(false)
const pluginBindingId = ref('')
const pluginBindingVersion = ref(0)
const effectiveCapability = ref<ApiRecord | null>(null)
const inheritedEffectiveCapability = ref<ApiRecord | null>(null)
const effectiveCapabilityLoading = ref(false)
const compatibleManagedPlugins = ref<ApiRecord[]>([])
const compatibleManagedPluginsLoading = ref(false)
let managedCapabilityRequestSequence = 0
let workflowProjectionRequestSequence = 0

const assetPlatformOptions: ReadonlyArray<{ value: AssetPlatform; labelKey: string }> = [
  { value: 'LINUX', labelKey: 'assets.platforms.linux' },
  { value: 'WINDOWS', labelKey: 'assets.platforms.windows' },
  { value: 'APPLIANCE', labelKey: 'assets.platforms.appliance' },
]

const assetDraft = reactive<AssetDraft>({
  managementMode: 'MANAGED_TARGET',
  managedExecutionMode: 'PLUGIN',
  approvalRequired: false,
  deviceId: '',
  frameworkInstanceId: '',
  address: '',
  port: '443',
  protocol: 'HTTPS',
  platform: 'LINUX',
  verifyUrl: '',
  frameworkType: '',
  siteAssetId: '',
  managedTargetId: '',
  agentCertificateFormatId: '',
  displayName: '',
  environment: '',
  tagsText: '',
  workflowId: '',
  workflowPluginVersionId: '',
  workflowCapabilityKey: '',
  workflowKey: '',
  pluginOverrideVersionId: '',
  workflowExecutionBindingId: '',
  workflowExecutionBindingVersion: 0,
  workflowVersionSelection: 'PINNED',
  workflowVersionId: '',
  workflowRunner: 'CONTROL_PLANE',
  workflowGatewayId: '',
  workflowTargetSiteName: '',
  workflowTargetBindingInformation: '',
  workflowTargetHostHeader: '',
  workflowTargetSniName: '',
})

const certificateSupplyDraft = reactive<CertificateSupplyDraft>({
  supplyMode: 'manual',
  certificateAssetId: '',
  certificateVersionId: '',
  providerType: 'internal_ca',
  providerId: '',
  certificateAuthorityId: '',
  acmeProviderProfileId: '',
  dnsProviderId: '',
  credentialRef: '',
  certificateProfileVersionId: '',
  autoRenew: false,
  renewalWindowDays: 30,
  rotateKeyOnRenewal: false,
})
const certificateSupplyData = ref<CertificateSupplyData | null>(null)
const certificateSupplyPreview = ref<CertificateSupplyData | null>(null)
const certificateSupplyLoading = ref(false)
const certificateSupplySaving = ref(false)
const certificateSupplyError = ref('')
let certificateSupplyPreviewSequence = 0

const activeCertificateSupplyData = computed(() => certificateSupplyPreview.value ?? certificateSupplyData.value)
const certificateSupplyCandidates = computed(() => activeCertificateSupplyData.value?.certificateCandidates ?? [])
const certificateSupplyProviders = computed(() => activeCertificateSupplyData.value?.providers ?? {})
const certificateSupplyCapability = computed(() => activeCertificateSupplyData.value?.capability ?? {})
const certificateSupplyReadiness = computed(() => activeCertificateSupplyData.value?.readiness ?? {})
const certificateSupplyProfileVersions = computed<Array<{ id: string; label: string }>>(() => {
  const profiles = certificateSupplyProviders.value.profiles ?? []
  return profiles.flatMap((profile) => {
    const profileId = String(profile.id ?? '')
    const profileName = String(profile.name ?? profileId)
    const versions = Array.isArray(profile.versions) ? profile.versions as Array<Record<string, unknown>> : []
    return versions.map((version) => ({
      id: String(version.id ?? ''),
      label: `${profileName} · v${String(version.versionNo ?? '')}`,
    })).filter((version) => version.id)
  })
})
const certificateSupplyCanSave = computed(() => {
  if (!isEditMode.value || certificateSupplyLoading.value || !certificateSupplyData.value) return true
  return certificateSupplyReadiness.value.canSave !== false
})

const assetDetailFields = computed(() => [
    { label: t('assets.fields.assetId'), candidates: ['id'] },
    { label: t('assets.fields.domain'), candidates: ['address', 'displayName'] },
    { label: t('assets.fields.addressType'), candidates: ['addressType'] },
    { label: t('assets.fields.port'), candidates: ['port'] },
    { label: t('assets.fields.protocol'), candidates: ['protocol'] },
    { label: t('assets.fields.verifyUrl'), candidates: ['verifyUrl', 'metadata.verifyUrl'] },
    { label: t('assets.fields.platform'), candidates: ['platform'] },
    { label: t('assets.fields.frameworkType'), candidates: ['targetBinding.frameworkType', 'metadata.workflowTarget.frameworkType', 'deploymentStrategy.workflow.target.frameworkType'] },
    { label: t('assets.fields.deploymentStrategyCompatibility'), candidates: ['deploymentStrategyCompatibilityLabel'] },
    { label: t('assets.fields.hostId'), candidates: ['agentId'] },
    { label: t('assets.fields.sniName'), candidates: ['sniName', 'metadata.workflowTarget.sniName', 'deploymentStrategy.workflow.target.sniName'] },
    { label: t('assets.fields.serviceInstanceId'), candidates: ['serviceInstanceId'] },
    { label: t('assets.fields.siteId'), candidates: ['targetBinding.siteAssetId', 'metadata.workflowTarget.siteName'] },
    { label: t('assets.fields.managedTargetId'), candidates: ['targetBinding.managedTargetId'] },
    { label: t('assets.fields.bindingKey'), candidates: ['targetBinding.bindingKey'] },
    { label: t('assets.fields.hostId'), candidates: ['hostId'] },
    { label: t('assets.fields.environment'), candidates: ['environment'] },
    { label: t('assets.fields.discoverySource'), candidates: ['discoverySource'] },
    { label: t('assets.fields.lastDiscoveredAt'), candidates: ['lastDiscoveredAt', 'updatedAt'] },
    { label: t('assets.fields.tags'), candidates: ['tags'] },
])

const assetContextLinks = computed(() => [
    { label: t('assets.links.certificateBindings'), to: '/bindings', queryKey: 'serviceAssetId', candidates: ['id'] },
    { label: t('assets.links.executions'), to: '/executions', queryKey: 'serviceAssetId', candidates: ['id'] },
])

const latestSnapshot = computed<ApiRecord | null>(() => snapshotItems.value[0] ?? null)

const latestSnapshotExecutionRunId = computed(() =>
  String(readNested(latestSnapshot.value, ['executionRunId']) ?? ''),
)

const bindingRelations = computed<ApiRecord[]>(() => {
  const items = readNested(selectedAssetDetail.value, ['targetBindingDetail', 'certificateBindings'])
  return Array.isArray(items) ? items as ApiRecord[] : []
})

const selectedApplicationAssetId = computed(() =>
  String(selectedServiceAsset.value?.raw?.id ?? selectedServiceAsset.value?.id ?? ''),
)

const deploymentApplicationAsset = computed<ApiRecord | null>(() =>
  selectedAssetDetail.value ?? selectedServiceAsset.value?.raw ?? null,
)

const deploymentBinding = computed<ApiRecord | null>(() => {
  const applicationAssetId = selectedApplicationAssetId.value
  return bindingRelations.value.find((item) => String(item.serviceAssetId ?? '') === applicationAssetId)
    ?? bindingRelations.value[0]
    ?? null
})

const deploymentCurrentCertificateVersionId = computed(() => firstAssetText(
  deploymentBinding.value ?? deploymentApplicationAsset.value ?? {},
  ['certificateVersionId', 'targetCertificateVersionId', 'currentCertificate.versionId', 'currentCertificate.certificateVersionId'],
))

const deploymentCertificateAssetId = computed(() => {
  const directId = firstAssetText(deploymentBinding.value ?? {}, [
    'certificateAssetId',
    'certificateId',
    'certificate.certificateAssetId',
    'metadata.certificateAssetId',
  ]) || firstAssetText(deploymentApplicationAsset.value ?? {}, [
    'currentCertificate.certificateAssetId',
    'metadata.currentCertificate.certificateAssetId',
    'certificateAssetId',
  ])
  if (directId) return directId
  const currentVersion = deploymentCertificateVersionItems.value.find((item) =>
    firstAssetText(item, ['id', 'certificateVersionId']) === deploymentCurrentCertificateVersionId.value,
  )
  return firstAssetText(currentVersion ?? {}, ['certificateAssetId', 'certificateId'])
})

const deploymentCertificate = computed<ApiRecord | null>(() => {
  const assetId = deploymentCertificateAssetId.value
  const listed = deploymentCertificateItems.value.find((item) => firstAssetText(item, ['id', 'certificateId']) === assetId)
  if (listed) return listed
  const current = readRecord(readNested(deploymentApplicationAsset.value, ['currentCertificate']))
  if (!assetId && !current) return null
  return {
    id: assetId,
    primaryDomain: firstAssetText(current ?? {}, ['commonName', 'subject.commonName', 'name']),
    commonName: firstAssetText(current ?? {}, ['commonName', 'subject.commonName']),
  } as ApiRecord
})

const deploymentCertificateVersions = computed<ApiRecord[]>(() => {
  return deploymentCertificateVersionItems.value
})

const deploymentDialogTitle = computed(() => bulkCertificateUpdateMode.value
  ? t('assets.selection.actions.bulkUpdateCertificate')
  : t('assets.deployment.dialogTitle'))

const deploymentDialogDescription = computed(() => bulkCertificateUpdateMode.value
  ? t('assets.selection.bulkUpdateDescription', {
      count: bulkCertificateUpdateAssetIds.value.length,
      domain: bulkCertificateUpdateDomain.value,
    })
  : t('assets.deployment.dialogDescription'))

const deploymentSubmitLabel = computed(() => bulkCertificateUpdateMode.value
  ? t('assets.selection.actions.bulkUpdateCertificate')
  : t('assets.deployment.deployThisVersion'))

const deploymentSiteName = computed(() => firstAssetText(
  deploymentApplicationAsset.value ?? {},
  [
    'targetBindingDetail.siteAsset.siteName',
    'targetBindingDetail.siteAsset.name',
    'targetBinding.siteName',
    'deploymentStrategy.workflow.target.siteName',
    'metadata.deploymentStrategy.workflow.target.siteName',
    'metadata.workflowTarget.siteName',
    'siteName',
  ],
))

const deploymentRecordsForDisplay = computed(() =>
  [...deploymentRecords.value].sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? ''))),
)

const canRollbackFromSnapshot = computed(() =>
  Boolean(latestSnapshotExecutionRunId.value) && !rollbackSubmitting.value,
)

const selectedDevice = computed(() =>
  deviceItems.value.find((item) => String(item.id ?? '') === assetDraft.deviceId) ?? null,
)

const selectedServiceInstance = computed(() =>
  serviceInstanceItems.value.find((item) => String(item.id ?? '') === assetDraft.frameworkInstanceId) ?? null,
)

const availableFrameworkOptions = computed(() =>
  collectFrameworkTypeOptions(serviceInstanceItems.value, assetDraft.frameworkType),
)

const filteredSiteItems = computed(() => {
  return siteItems.value.filter((item) =>
    !assetDraft.frameworkInstanceId || String(item.frameworkInstanceId ?? item.serviceInstanceId ?? '') === assetDraft.frameworkInstanceId,
  )
})

const selectedSiteAsset = computed(() =>
  filteredSiteItems.value.find((item) => String(item.id ?? '') === assetDraft.siteAssetId) ?? null,
)

const selectedManagedTarget = computed(() =>
  managedTargetItems.value.find((item) => String(item.id ?? '') === assetDraft.managedTargetId) ?? null,
)

const editAgentLabel = computed(() => {
  if (!isEditMode.value) return ''
  const agentId = String(readNested(editAssetDetail.value, ['agentId']) ?? '')
  return agentId || '—'
})

const editSiteLabel = computed(() => {
  if (!isEditMode.value) return ''
  const siteName = String(readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'siteName']) ?? '')
  const hostHeader = String(readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'hostHeader']) ?? '')
  const bindingInformation = String(readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'bindingInformation']) ?? '')
  if (siteName && hostHeader) return `${siteName} (${hostHeader})`
  if (siteName && bindingInformation) return `${siteName} (${bindingInformation})`
  return siteName || bindingInformation || '—'
})

const editManagedTargetLabel = computed(() => {
  if (!isEditMode.value) return ''
  const targetType = String(readNested(editAssetDetail.value, ['targetBindingDetail', 'managedTarget', 'targetType']) ?? '')
  const bindingKey = String(readNested(editAssetDetail.value, ['targetBindingDetail', 'managedTarget', 'bindingKey']) ?? '')
  const targetKey = String(readNested(editAssetDetail.value, ['targetBindingDetail', 'managedTarget', 'targetKey']) ?? '')
  if (targetType && bindingKey) return `${targetType} (${bindingKey})`
  return targetType || bindingKey || targetKey || '—'
})

const currentBindingSummary = computed(() => {
  if (isEditMode.value) {
    return {
      bindingInformation: readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'bindingInformation']),
      hostHeader: readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'hostHeader']),
      port: readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'port']),
    }
  }
  return {
    bindingInformation: selectedSiteAsset.value?.bindingInformation,
    hostHeader: selectedSiteAsset.value?.hostHeader,
    port: selectedSiteAsset.value?.port,
  }
})

const selectedWorkflowTemplate = computed(() =>
  workflowItems.value.find((item) => String(item.id ?? '') === assetDraft.workflowId) ?? null,
)

const publishedWorkflowVersionItems = computed<ApiRecord[]>(() => {
  const published = workflowVersionItems.value.filter((item) => workflowVersionStatus(item) === 'published')
  if (String(selectedWorkflowTemplate.value?.origin ?? '') !== 'plugin_internal') return published

  const currentVersionId = String(selectedWorkflowTemplate.value?.currentVersionId ?? '')
  const selectedVersionId = assetDraft.workflowVersionId
  const unique = new Map<string, ApiRecord>()
  for (const item of published) {
    const dslVersion = workflowDslVersion(item)
    const key = dslVersion ? `dsl:${dslVersion}` : `id:${String(item.id ?? '')}`
    const existing = unique.get(key)
    if (!existing || preferWorkflowVersion(item, existing, selectedVersionId, currentVersionId)) unique.set(key, item)
  }
  return [...unique.values()]
    .sort(compareWorkflowVersionsByDsl)
    .map((item): ApiRecord => ({ ...item, displayVersion: workflowDslVersion(item) || String(item.id ?? '') }))
})

const isUserViewMode = computed(() => appStore.viewMode === 'user')
const userFlowSteps = computed<UserFlowStep[]>(() => [
  {
    id: 'certificates',
    label: t('viewMode.steps.certificates'),
    help: t('certificates.userView.hero.description'),
    helpLabel: t('certificates.userView.hero.title'),
  },
  {
    id: 'applications',
    label: t('viewMode.steps.applications'),
    help: t('assets.userView.description'),
    helpLabel: t('assets.userView.title'),
    completed: userAssetItems.value.length > 0,
  },
  {
    id: 'deployments',
    label: t('viewMode.steps.deployments'),
    help: t('deploymentPlans.userView.description'),
    helpLabel: t('deploymentPlans.userView.title'),
  },
])

const latestPublishedWorkflowVersion = computed(() => {
  const currentVersionId = String(selectedWorkflowTemplate.value?.currentVersionId ?? '')
  const current = publishedWorkflowVersionItems.value.find((item) =>
    String(item.id ?? '') === currentVersionId && workflowVersionStatus(item) === 'published',
  )
  if (current) return current
  return publishedWorkflowVersionItems.value[0] ?? null
})

const selectedWorkflowVersion = computed(() =>
  publishedWorkflowVersionItems.value.find((item) => String(item.id ?? '') === assetDraft.workflowVersionId)
    ?? latestPublishedWorkflowVersion.value,
)

const selectedGateway = computed(() =>
  gatewayItems.value.find((item) => String(item.id ?? '') === assetDraft.workflowGatewayId) ?? null,
)

const workflowExecutionEnabled = computed(() =>
  assetDraft.managementMode === 'WORKFLOW' || assetDraft.managedExecutionMode === 'WORKFLOW_OVERRIDE',
)

const effectiveCapabilityOwnerType = computed(() =>
  String(readNested(effectiveCapability.value, ['source', 'ownerType']) ?? ''),
)

const pluginFallbackCapability = computed(() => {
  if (assetDraft.pluginOverrideVersionId.trim()) return null
  if (effectiveCapabilityOwnerType.value === 'APPLICATION_ASSET') return inheritedEffectiveCapability.value
  return effectiveCapability.value ?? inheritedEffectiveCapability.value
})

const pluginProjectionVersionId = computed(() =>
  assetDraft.pluginOverrideVersionId.trim()
  || String(readNested(pluginFallbackCapability.value, ['plugin', 'pluginVersionId']) ?? ''),
)

const deploymentInputBindingsFingerprint = computed(() => JSON.stringify(deploymentInputBindings.value))

const fixedPkcs12Artifact = computed(() => workflowBindingProjection.value?.artifacts.find((artifact) => isFixedPkcs12Artifact(artifact)) ?? null)
const fixedPkcs12CertificateFormatId = computed(() => fixedPkcs12Artifact.value?.binding?.certificateFormatId?.trim() ?? '')
const isFixedPkcs12Contract = computed(() => Boolean(fixedPkcs12Artifact.value))
const showAgentCertificateFormatSelector = computed(() => !pluginProjectionVersionId.value
  || Boolean(workflowBindingProjection.value && !isFixedPkcs12Contract.value)
  || Boolean(workflowProjectionError.value))
const agentCertificateFormatReady = computed(() => isFixedPkcs12Contract.value || Boolean(assetDraft.agentCertificateFormatId.trim()))

const pendingPluginCapability = computed<ApiRecord | null>(() => {
  const pluginVersionId = assetDraft.pluginOverrideVersionId.trim()
  if (!pluginVersionId) return null
  const plugin = compatibleManagedPlugins.value.find(
    (item) => String(item.pluginVersionId ?? '') === pluginVersionId,
  )
  if (!plugin) return null
  const executionLocations = Array.isArray(plugin.executionLocations)
    ? plugin.executionLocations.map((item) => String(item)).filter(Boolean)
    : []
  return {
    capabilityKey: 'certificate.deploy',
    source: {
      ownerType: 'APPLICATION_ASSET',
      precedence: 'ASSET_OVERRIDE',
    },
    plugin: {
      pluginVersionId,
      pluginId: String(plugin.pluginId ?? ''),
      version: String(plugin.version ?? ''),
      runtime: String(plugin.runtime ?? ''),
    },
    executionLocation: executionLocations[0] ?? '',
  }
})

const managedExecutionModeOptions = computed(() => [
  {
    value: 'PLUGIN',
    label: t('assets.executionModes.plugin.title'),
    description: t('assets.executionModes.plugin.description'),
    tone: 'info' as const,
  },
  {
    value: 'WORKFLOW_OVERRIDE',
    label: t('assets.executionModes.workflowOverride.title'),
    description: t('assets.executionModes.workflowOverride.description'),
    tone: 'warning' as const,
  },
])

const agentCertificateFormatOptions = computed(() => {
  const selectedId = assetDraft.agentCertificateFormatId.trim()
  if (!selectedId || certificateFormatItems.value.some((item) => String(item.id ?? '') === selectedId)) return certificateFormatItems.value
  return [{ id: selectedId, format: 'unknown', parameters: { configName: t('assets.certificateFormats.savedConfigMissingWithId', { id: selectedId }) } }, ...certificateFormatItems.value]
})

const deploymentCredentialOptions = computed(() => credentialProfileItems.value.map((item) => ({
  id: item.id,
  label: `${credentialProfileLabel(item)} / ${credentialProfileSummary(item, t)}`,
  kind: item.kind,
})))

const deploymentArtifactOptions = computed<Record<string, DeploymentArtifactOption[]>>(() => {
  if (!workflowBindingProjection.value) return {}
  return Object.fromEntries(workflowBindingProjection.value.artifacts.map((artifact) => [artifact.slot, certificateFormatItems.value.map((format) => ({
    id: String(format.id ?? ''),
    label: workflowCertificateFormatLabel(format),
    outputs: workflowCertificateOutputOptions(String(format.id ?? '')).map((output) => ({ key: output.key, label: output.label })),
  }))]))
})

const workflowProjectionReady = computed(() => {
  const requiresProjection = (assetDraft.managementMode === 'MANAGED_TARGET'
    && assetDraft.managedExecutionMode === 'PLUGIN'
    && Boolean(pluginProjectionVersionId.value))
    || (workflowExecutionEnabled.value && Boolean(editingServiceAssetId.value))
  if (!requiresProjection) return true
  return !workflowProjectionLoading.value
    && !workflowProjectionRefreshing.value
    && !workflowProjectionError.value
    && Boolean(workflowBindingProjection.value?.saveable)
})

const workflowVariableConfiguredCount = computed(() => Object.values(deploymentInputBindings.value).slice(1)
  .reduce((count, namespace) => count + Object.keys(namespace).length, 0))

const effectiveVerifyUrl = computed(() => {
  const explicit = assetDraft.verifyUrl.trim()
  if (explicit) return explicit
  const address = assetDraft.address.trim()
  const port = Number(assetDraft.port)
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return ''
  return `${assetDraft.protocol.toLowerCase()}://${address}:${port}`
})

const workflowTargetPreview = computed(() =>
  workflowExecutionEnabled.value ? buildWorkflowTargetInfo() : null,
)

const commonStepReady = computed(() => {
  const port = Number(assetDraft.port)
  return Boolean(
    assetDraft.address.trim()
    && assetDraft.platform
    && Number.isInteger(port)
    && port >= 1
    && port <= 65535,
  )
})

const agentStepReady = computed(() => {
  if (assetDraft.managementMode !== 'MANAGED_TARGET') return true
  const pluginExecutionReady = assetDraft.managedExecutionMode !== 'PLUGIN'
    || Boolean(assetDraft.pluginOverrideVersionId.trim() || pluginFallbackCapability.value)
  const pluginInputReady = assetDraft.managedExecutionMode !== 'PLUGIN'
    || !pluginProjectionVersionId.value
    || workflowProjectionReady.value
  return Boolean(
    assetDraft.siteAssetId.trim()
    && agentCertificateFormatReady.value
    && assetDraft.managedTargetId.trim()
    && pluginExecutionReady
    && pluginInputReady,
  )
})

const workflowStepReady = computed(() => {
  if (!workflowExecutionEnabled.value) return true
  const selectedVersionIsPublished = assetDraft.workflowVersionId
    && workflowVersionStatus(selectedWorkflowVersion.value) === 'published'
  const versionSelectionReady = selectedVersionIsPublished
  const gatewayReady = assetDraft.workflowRunner === 'CONTROL_PLANE' || assetDraft.workflowGatewayId.trim()
  return Boolean(
    assetDraft.workflowId.trim()
    && versionSelectionReady
    && gatewayReady
    && workflowProjectionReady.value
  )
})

const modeStepReady = computed(() =>
  assetDraft.managementMode === 'WORKFLOW'
    ? workflowStepReady.value
    : agentStepReady.value && workflowStepReady.value,
)

const currentAvailableStep = computed<AssetWizardStep>(() => {
  if (!commonStepReady.value) return 1
  if (!modeStepReady.value) return 2
  return 3
})

const canGoPreviousAssetStep = computed(() => assetWizardStep.value > 1)
const canGoNextAssetStep = computed(() =>
  (assetWizardStep.value === 1 && commonStepReady.value)
  || (assetWizardStep.value === 2 && modeStepReady.value),
)

const createDisabled = computed(() => {
  return createLoading.value
    || !commonStepReady.value
    || !modeStepReady.value
    || !certificateSupplyCanSave.value
})

const isEditMode = computed(() => Boolean(editingServiceAssetId.value))

async function openRouteAssetDetail(applicationAssetId: string) {
  if (!applicationAssetId) return
  selectedServiceAsset.value = {
    id: applicationAssetId,
    name: applicationAssetId,
    status: 'UNKNOWN',
    risk: 'MEDIUM',
    raw: { id: applicationAssetId },
  }
  activeDetailTab.value = 'overview'
  rollbackError.value = ''
  rollbackRequestId.value = ''
  selectedAssetDetail.value = null
  snapshotItems.value = []
  detailError.value = ''
  snapshotError.value = ''
  deploymentRecords.value = []
  deploymentRecordsError.value = ''
  detailModalOpen.value = true
  void loadDeploymentRecords(applicationAssetId)
  await refreshAssetDetail(applicationAssetId)
  const loadedDetail = selectedAssetDetail.value as ApiRecord | null
  if (loadedDetail && String(readNested(loadedDetail, ['id']) ?? '') === applicationAssetId) {
    selectedServiceAsset.value = assetOverviewCardRow(toAssetOverviewCard(loadedDetail))
  }
}

async function loadAssetContext(row: ViewRow) {
  selectedServiceAsset.value = row
  activeDetailTab.value = 'overview'
  rollbackError.value = ''
  rollbackRequestId.value = ''
  deploymentRecords.value = []
  deploymentRecordsError.value = ''
  const applicationAssetId = String(row.raw?.id ?? row.id ?? '')
  void loadDeploymentRecords(applicationAssetId)
  await refreshAssetDetail(applicationAssetId)
}

async function openDetailModal(row: ViewRow) {
  detailModalOpen.value = true
  await loadAssetContext(row)
}

async function openDeploymentDialog(row?: ViewRow) {
  if (row) await loadAssetContext(row)
  const applicationAssetId = selectedApplicationAssetId.value
  if (!applicationAssetId) return
  deploymentDialogOpen.value = true
  deploymentError.value = ''
  deploymentErrorIssues.value = []
  deploymentPlanId.value = ''
  deploymentDryRunChecks.value = []
  await loadDeploymentDialogOptions()
}

function closeDeploymentDialog() {
  if (deploymentLoading.value) return
  deploymentDialogOpen.value = false
  deploymentPlanId.value = ''
}

function resetBulkCertificateUpdateState(): void {
  bulkCertificateUpdateMode.value = false
  bulkCertificateUpdateAssetIds.value = []
  bulkCertificateUpdateDomain.value = ''
}

async function loadDeploymentDialogOptions() {
  deploymentLoading.value = true
  deploymentError.value = ''
  deploymentErrorIssues.value = []
  try {
    const [certificates, certificateVersions] = await Promise.all([
      listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      fetchAllRecords((page, pageSize) => listCertificateVersions({ page, pageSize, sort: 'createdAt:desc' })),
    ])
    deploymentCertificateItems.value = [...(certificates.data?.items ?? [])]
    deploymentCertificateVersionItems.value = certificateVersions
  } catch (cause) {
    deploymentErrorIssues.value = extractDeploymentInputIssues(cause)
    deploymentError.value = cause instanceof Error ? cause.message : t('assets.deployment.errors.loadOptionsFailed')
  } finally {
    deploymentLoading.value = false
  }
}

async function runCertificateDeployment(
  applicationAssetId: string,
  selection: CertificateDeploymentSelection,
  settings: { dryRunEnabled: boolean },
  showPreflight: boolean,
): Promise<'PENDING_APPROVAL' | 'STARTED'> {
  if (!applicationAssetId || !selection.certificateVersionId) {
    throw new Error(t('assets.deployment.errors.missingApplicationAssetId'))
  }
  const created = await createDeploymentPlanFromApplicationAsset({
    applicationAssetId,
    certificateAssetId: selection.certificateAssetId,
    selectionMode: selection.selectionMode,
    targetCertificateVersionId: selection.certificateVersionId,
    reuseDraft: false,
  })
  const planId = String(created.data?.id ?? '')
  if (!planId) throw new Error(t('assets.deployment.errors.createPlanMissingId'))
  if (!bulkCertificateUpdateMode.value) deploymentPlanId.value = planId

  if (settings.dryRunEnabled) {
    const preflight = await dryRunDeploymentPlan({ planId })
    if (showPreflight) deploymentDryRunChecks.value = extractDeploymentPreflightChecks(preflight.data)
  } else if (showPreflight) {
    deploymentDryRunChecks.value = []
  }

  const submitted = await submitDeploymentPlan(planId)
  const submittedPlan = submitted.data ?? {}
  const status = String(submittedPlan.status ?? '')
  if (status === 'PENDING_APPROVAL') return 'PENDING_APPROVAL'
  await executeDeploymentPlan(planId)
  return 'STARTED'
}

async function deployCertificateVersion(selection: CertificateDeploymentSelection) {
  deploymentLoading.value = true
  deploymentError.value = ''
  deploymentErrorIssues.value = []
  try {
    const settingsResult = await getDeploymentTaskSettings()
    const settings = settingsResult.data?.deploymentTasks ?? { dryRunEnabled: false, approvalEnabled: true }
    const isBulk = bulkCertificateUpdateMode.value
    const targetAssetIds = isBulk
      ? [...bulkCertificateUpdateAssetIds.value]
      : [selectedApplicationAssetId.value]
    const failures: Array<{ id: string; message: string }> = []
    let pendingApprovalCount = 0
    let startedCount = 0

    for (const applicationAssetId of targetAssetIds) {
      try {
        const status = await runCertificateDeployment(applicationAssetId, selection, settings, !isBulk)
        if (status === 'PENDING_APPROVAL') pendingApprovalCount += 1
        else startedCount += 1
      } catch (cause) {
        if (deploymentErrorIssues.value.length === 0) {
          deploymentErrorIssues.value = extractDeploymentInputIssues(cause)
        }
        failures.push({
          id: applicationAssetId,
          message: cause instanceof Error ? cause.message : t('assets.deployment.errors.deployFailed'),
        })
      }
    }

    if (!isBulk) {
      if (failures.length > 0) {
        deploymentError.value = failures[0]?.message ?? t('assets.deployment.errors.deployFailed')
        return
      }
      await loadDeploymentRecords(selectedApplicationAssetId.value)
      deploymentDialogOpen.value = false
      notifyDeploymentStarted(pendingApprovalCount > 0 ? 'warning' : 'success')
      return
    }

    const succeededCount = pendingApprovalCount + startedCount
    if (succeededCount === 0) {
      deploymentError.value = t('assets.selection.bulkUpdateFailed', { count: failures.length })
      return
    }

    replaceSelectedAssetIds(failures.map((failure) => failure.id))
    deploymentDialogOpen.value = false
    await loadAssetOverviewPage(assetOverviewPage.value)
    const successMessage = failures.length > 0
      ? t('assets.selection.bulkUpdatePartialSuccess', { succeeded: succeededCount, failed: failures.length })
      : t('assets.selection.bulkUpdateSuccess', { count: succeededCount })
    notifySelectionMessage(successMessage, failures.length > 0 ? 'warning' : (pendingApprovalCount > 0 ? 'warning' : 'success'))
  } catch (cause) {
    deploymentErrorIssues.value = extractDeploymentInputIssues(cause)
    deploymentError.value = cause instanceof Error ? cause.message : t('assets.deployment.errors.deployFailed')
  } finally {
    deploymentLoading.value = false
  }
}

function extractDeploymentInputIssues(cause: unknown): DeploymentInputIssueDetail[] {
  if (!(cause instanceof ApiClientError) || !cause.details || typeof cause.details !== 'object') return []
  const issues = (cause.details as Record<string, unknown>).issues
  if (!Array.isArray(issues)) return []
  return issues.filter((item): item is DeploymentInputIssueDetail => Boolean(item && typeof item === 'object'))
}

function deploymentInputIssueLabel(issue: DeploymentInputIssueDetail): string {
  const code = issue.code?.trim() || 'UNKNOWN'
  const key = `deploymentInputs.issues.${code}`
  return te(key) ? t(key) : t('deploymentInputs.issues.unknown', { code })
}

function deploymentInputIssuePath(issue: DeploymentInputIssueDetail): string {
  return issue.path?.trim() || issue.slot?.trim() || t('deploymentPlans.common.notProvided')
}

function notifyDeploymentStarted(tone: 'success' | 'warning'): void {
  window.dispatchEvent(new CustomEvent('gcac:toast', {
    detail: {
      message: t(tone === 'warning'
        ? 'deploymentPlans.feedback.executeTaskPendingApproval'
        : 'deploymentPlans.feedback.executeTaskStarted'),
      tone,
    },
  }))
}

async function loadDeploymentRecords(applicationAssetId: string) {
  if (!applicationAssetId) return
  deploymentRecordsLoading.value = true
  deploymentRecordsError.value = ''
  try {
    const result = await listDeploymentPlansByApplicationAsset(applicationAssetId)
    deploymentRecords.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    deploymentRecords.value = []
    deploymentRecordsError.value = cause instanceof Error ? cause.message : t('assets.deployment.errors.loadRecordsFailed')
  } finally {
    deploymentRecordsLoading.value = false
  }
}

function extractDeploymentPreflightChecks(data: ApiRecord | undefined): ApiRecord[] {
  if (!data) return []
  if (Array.isArray(data.checks)) return data.checks as ApiRecord[]
  const steps = Array.isArray(data.steps) ? data.steps as ApiRecord[] : []
  for (const step of steps) {
    const resultDetail = readNested(step, ['inputSnapshot', 'resultDetail'])
    const checks = readNested(resultDetail, ['dryRunChecks'])
    if (Array.isArray(checks)) return checks as ApiRecord[]
  }
  return []
}

function deploymentRecordRunStatus(record: ApiRecord): string {
  const run = readNested(record, ['latestRun'])
  return String(readNested(run, ['status']) ?? record.status ?? 'UNKNOWN')
}

function deploymentRecordRunType(record: ApiRecord): string {
  const run = readNested(record, ['latestRun'])
  return String(readNested(run, ['type']) ?? '')
}

function deploymentRecordApprovalStatus(record: ApiRecord): string {
  return String(record.approvalStatus ?? readNested(record, ['approval', 'status']) ?? 'NOT_REQUIRED')
}

function deploymentRecordPreflightCheckCount(record: ApiRecord): number {
  const checks = readNested(record, ['latestPreflight', 'checks'])
  return Array.isArray(checks) ? checks.length : 0
}

function deploymentRecordTime(record: ApiRecord): string {
  return renderValue(record.updatedAt ?? record.createdAt)
}

function resetCertificateSupplyDraft(): void {
  certificateSupplyDraft.supplyMode = 'manual'
  certificateSupplyDraft.certificateAssetId = ''
  certificateSupplyDraft.certificateVersionId = ''
  certificateSupplyDraft.providerType = 'internal_ca'
  certificateSupplyDraft.providerId = ''
  certificateSupplyDraft.certificateAuthorityId = ''
  certificateSupplyDraft.acmeProviderProfileId = ''
  certificateSupplyDraft.dnsProviderId = ''
  certificateSupplyDraft.credentialRef = ''
  certificateSupplyDraft.certificateProfileVersionId = ''
  certificateSupplyDraft.autoRenew = false
  certificateSupplyDraft.renewalWindowDays = 30
  certificateSupplyDraft.rotateKeyOnRenewal = false
  certificateSupplyData.value = null
  certificateSupplyPreview.value = null
  certificateSupplyError.value = ''
}

function applyCertificateSupplyData(data: CertificateSupplyData): void {
  certificateSupplyData.value = data
  const version = data.currentVersion ?? {}
  certificateSupplyDraft.supplyMode = String(version.supplyMode ?? 'manual') === 'dedicated' ? 'dedicated' : 'manual'
  certificateSupplyDraft.certificateAssetId = String(version.certificateAssetId ?? '')
  certificateSupplyDraft.certificateVersionId = String(version.certificateVersionId ?? '')
  certificateSupplyDraft.providerType = String(version.providerType ?? 'internal_ca') === 'acme' ? 'acme' : 'internal_ca'
  certificateSupplyDraft.providerId = String(version.providerId ?? '')
  certificateSupplyDraft.certificateAuthorityId = String(version.certificateAuthorityId ?? '')
  certificateSupplyDraft.acmeProviderProfileId = String(version.acmeProviderProfileId ?? '')
  certificateSupplyDraft.dnsProviderId = String(version.dnsProviderId ?? '')
  certificateSupplyDraft.credentialRef = String(version.credentialRef ?? '')
  certificateSupplyDraft.certificateProfileVersionId = String(version.certificateProfileVersionId ?? '')
  certificateSupplyDraft.autoRenew = version.autoRenew === true
  certificateSupplyDraft.renewalWindowDays = Number(version.renewalWindowDays ?? 30)
  certificateSupplyDraft.rotateKeyOnRenewal = version.rotateKeyOnRenewal === true
  certificateSupplyPreview.value = null
}

function certificateSupplyPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    supplyMode: certificateSupplyDraft.supplyMode,
    autoRenew: certificateSupplyDraft.autoRenew,
    renewalWindowDays: certificateSupplyDraft.renewalWindowDays,
    rotateKeyOnRenewal: certificateSupplyDraft.rotateKeyOnRenewal,
  }
  if (certificateSupplyDraft.supplyMode === 'manual') {
    if (certificateSupplyDraft.certificateAssetId) payload.certificateAssetId = certificateSupplyDraft.certificateAssetId
    if (certificateSupplyDraft.certificateVersionId) payload.certificateVersionId = certificateSupplyDraft.certificateVersionId
    return payload
  }
  payload.providerType = certificateSupplyDraft.providerType
  if (certificateSupplyDraft.providerId) payload.providerId = certificateSupplyDraft.providerId
  if (certificateSupplyDraft.certificateAuthorityId) payload.certificateAuthorityId = certificateSupplyDraft.certificateAuthorityId
  if (certificateSupplyDraft.acmeProviderProfileId) payload.acmeProviderProfileId = certificateSupplyDraft.acmeProviderProfileId
  if (certificateSupplyDraft.dnsProviderId) payload.dnsProviderId = certificateSupplyDraft.dnsProviderId
  if (certificateSupplyDraft.credentialRef.trim()) payload.credentialRef = certificateSupplyDraft.credentialRef.trim()
  if (certificateSupplyDraft.certificateProfileVersionId) payload.certificateProfileVersionId = certificateSupplyDraft.certificateProfileVersionId
  return payload
}

function selectCertificateSupplyCandidate(versionId: string): void {
  const candidate = certificateSupplyCandidates.value.find((item) => String(item.certificateVersionId ?? '') === versionId)
  certificateSupplyDraft.certificateAssetId = String(candidate?.certificateAssetId ?? '')
}

async function loadApplicationCertificateSupplyPolicy(applicationAssetId: string): Promise<void> {
  resetCertificateSupplyDraft()
  if (!applicationAssetId) return
  certificateSupplyLoading.value = true
  try {
    const result = await getApplicationCertificateSupplyPolicy(applicationAssetId)
    applyCertificateSupplyData((result.data ?? {}) as CertificateSupplyData)
  } catch (cause) {
    certificateSupplyError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.certificateSupply.errors.loadFailed')
  } finally {
    certificateSupplyLoading.value = false
  }
}

async function previewCertificateSupplyPolicy(): Promise<void> {
  if (!editingServiceAssetId.value || certificateSupplyLoading.value) return
  const sequence = ++certificateSupplyPreviewSequence
  try {
    const result = await previewApplicationCertificateSupplyPolicy(editingServiceAssetId.value, certificateSupplyPayload())
    if (sequence === certificateSupplyPreviewSequence) certificateSupplyPreview.value = (result.data ?? {}) as CertificateSupplyData
  } catch (cause) {
    if (sequence !== certificateSupplyPreviewSequence) return
    certificateSupplyPreview.value = null
    certificateSupplyError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.certificateSupply.errors.previewFailed')
  }
}

async function saveCertificateSupplyPolicy(applicationAssetId: string): Promise<void> {
  if (!applicationAssetId) return
  certificateSupplySaving.value = true
  try {
    const result = await saveApplicationCertificateSupplyPolicy(applicationAssetId, certificateSupplyPayload())
    applyCertificateSupplyData((result.data ?? {}) as CertificateSupplyData)
  } finally {
    certificateSupplySaving.value = false
  }
}

async function openCreateDialog() {
  resetDraft()
  resetCertificateSupplyDraft()
  if (isUserViewMode.value) {
    assetDraft.managementMode = 'MANAGED_TARGET'
    assetDraft.managedExecutionMode = 'PLUGIN'
  }
  assetWizardStep.value = 1
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
  await Promise.all([loadDevices(), loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
  selectUserModeDefaults()
}

function setOnboardingDialogOpen(open: boolean): void {
  onboardingDialogOpen.value = open
  if (open || route.query.onboarding !== '1') return
  const query = { ...route.query }
  delete query.onboarding
  delete query.session
  void router.replace({ query })
}

/**
 * 资产页的“添加资产”入口与设备页共用同一标准接入向导。
 * 应用配方向导仍由应用工作台独立入口维护，不在这里复制云资源表单。
 */
function openStandardAssetOnboarding(): void {
  resumeApplicationOnboarding.value = false
  deviceOnboardingInitialSelection.value = undefined
  onboardingDialogOpen.value = false
  deviceOnboardingOpen.value = true
}

async function openCustomManualCreateDialog(): Promise<void> {
  setOnboardingDialogOpen(false)
  await nextTick()
  await openCreateDialog()
}

function openDeviceOnboardingFromApplication(initialSelection: DeviceOnboardingInitialSelection): void {
  resumeApplicationOnboarding.value = true
  deviceOnboardingInitialSelection.value = initialSelection
  onboardingDialogOpen.value = false
  deviceOnboardingOpen.value = true
}

function setDeviceOnboardingOpen(open: boolean): void {
  deviceOnboardingOpen.value = open
  if (open || !resumeApplicationOnboarding.value) return
  resumeApplicationOnboarding.value = false
  deviceOnboardingInitialSelection.value = undefined
  void nextTick().then(() => setOnboardingDialogOpen(true))
}

function completeDeviceOnboarding(): void {
  void loadAssetOverviewPage(assetOverviewPage.value)
  if (resumeApplicationOnboarding.value) setDeviceOnboardingOpen(false)
}

function navigateUserFlow(stepId: string) {
  if (stepId === 'certificates') {
    void router.push({ name: 'certificate.list' })
    return
  }
  if (stepId === 'applications') return
  void router.push({ name: 'asset.list' })
}

async function openEditDialog(row: ViewRow) {
  resetDraft()
  resetCertificateSupplyDraft()
  assetWizardStep.value = 1
  editingServiceAssetId.value = String(row.raw?.id ?? row.id ?? '')
  const detail = await getAssetDetail(editingServiceAssetId.value)
  editAssetDetail.value = detail.data ?? null
  await loadApplicationCertificateSupplyPolicy(editingServiceAssetId.value)
  const source = detail.data ?? row.raw
  targetSelectionInitializing.value = true
  const targetContext = readRecord(readNested(source, ['targetBindingDetail']))
  const contextHost = readRecord(targetContext?.host)
  const contextFramework = readRecord(targetContext?.frameworkInstance)
  const contextSite = readRecord(targetContext?.siteAsset)
  const contextManagedTarget = readRecord(targetContext?.managedTarget)
  assetDraft.frameworkInstanceId = String(contextFramework?.id ?? '')
  assetDraft.address = String(readNested(source, ['address']) ?? '')
  assetDraft.port = String(readNested(source, ['port']) ?? '443')
  assetDraft.protocol = String(readNested(source, ['protocol']) ?? 'HTTPS') as AssetProtocol
  assetDraft.platform = String(readNested(source, ['platform']) ?? 'LINUX') as AssetPlatform
  assetDraft.verifyUrl = String(readNested(source, ['verifyUrl']) ?? readNested(source, ['metadata', 'verifyUrl']) ?? '')
  assetDraft.displayName = String(readNested(source, ['displayName']) ?? '')
  assetDraft.environment = String(readNested(source, ['environment']) ?? '')
  const tags = readNested(source, ['tags'])
  assetDraft.tagsText = Array.isArray(tags) ? tags.map((item: unknown) => String(item)).join(', ') : ''
  assetDraft.frameworkType = normalizeFrameworkType(contextFramework?.frameworkType ?? assetDraft.frameworkType)
  assetDraft.siteAssetId = String(contextSite?.id ?? '')
  assetDraft.managedTargetId = String(contextManagedTarget?.id ?? '')
  const deploymentStrategy = readDeploymentStrategy(source)
  const managedTargetStrategy = readRecord(readNested(deploymentStrategy, ['managedTarget']))
  assetDraft.managementMode = resolveDeploymentStrategyMode(deploymentStrategy)
  assetDraft.managedExecutionMode = String(managedTargetStrategy?.executionMode ?? 'PLUGIN') as ManagedExecutionMode
  assetDraft.approvalRequired = readNested(deploymentStrategy, ['approvalRequired']) === true
  const workflowExecutionBindingId = String(
    readNested(deploymentStrategy, ['workflow', 'workflowExecutionBindingId'])
      ?? readNested(managedTargetStrategy, ['workflowExecutionBindingId'])
      ?? '',
  )
  if (assetDraft.managementMode === 'WORKFLOW') {
    const inputBindings = readInputBindingsV1(readNested(deploymentStrategy, ['workflow', 'inputBindings']))
      ?? createInputBindingsV1()
    const workflowTarget = readWorkflowTargetFromAsset(source, deploymentStrategy)
    if (workflowTarget) {
      assetDraft.frameworkType = workflowTarget.frameworkType
      assetDraft.verifyUrl = workflowTarget.verifyUrl ?? assetDraft.verifyUrl
      assetDraft.port = workflowTarget.port ? String(workflowTarget.port) : assetDraft.port
      assetDraft.protocol = workflowTarget.protocol ?? assetDraft.protocol
      assetDraft.workflowTargetSiteName = workflowTarget.siteName
      assetDraft.workflowTargetBindingInformation = workflowTarget.bindingInformation ?? ''
      assetDraft.workflowTargetHostHeader = workflowTarget.hostHeader ?? ''
      assetDraft.workflowTargetSniName = workflowTarget.sniName ?? ''
    }
    assetDraft.workflowId = String(readNested(deploymentStrategy, ['workflow', 'workflowId']) ?? '')
    assetDraft.workflowPluginVersionId = String(readNested(deploymentStrategy, ['workflow', 'pluginVersionId']) ?? '')
    assetDraft.workflowCapabilityKey = String(readNested(deploymentStrategy, ['workflow', 'capabilityKey']) ?? '')
    assetDraft.workflowKey = String(readNested(deploymentStrategy, ['workflow', 'workflowKey']) ?? '')
    pluginBindingId.value = String(readNested(deploymentStrategy, ['workflow', 'pluginBindingId']) ?? '')
    assetDraft.workflowVersionSelection = readWorkflowVersionSelection(deploymentStrategy)
    assetDraft.workflowVersionId = String(readNested(deploymentStrategy, ['workflow', 'workflowVersionId']) ?? '')
    assetDraft.workflowRunner = String(readNested(deploymentStrategy, ['workflow', 'runner']) ?? 'CONTROL_PLANE') as WorkflowRunnerType
    assetDraft.workflowGatewayId = String(readNested(deploymentStrategy, ['workflow', 'gatewayId']) ?? '')
    deploymentInputBindings.value = inputBindings
  } else {
    assetDraft.managementMode = 'MANAGED_TARGET'
    assetDraft.agentCertificateFormatId = String(
      readNested(managedTargetStrategy, ['certificateFormatId'])
        ?? readNested(source, ['metadata', 'certificateFormatId'])
        ?? readNested(source, ['certificateFormatId'])
        ?? '',
    )
  }
  assetDraft.deviceId = String(contextHost?.id ?? contextManagedTarget?.deviceId ?? '')
  await loadDevices()
  await loadServiceInstances(assetDraft.deviceId)
  await refreshAssetTargets()
  await loadManagedTargets(assetDraft.siteAssetId, contextManagedTarget ?? undefined)
  targetSelectionInitializing.value = false
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
  await Promise.all([loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
  if (assetDraft.managementMode === 'MANAGED_TARGET' && assetDraft.managedTargetId) {
    await loadManagedTargetPluginResolution(assetDraft.managedTargetId)
  }
  const shouldLoadWorkflowBinding = Boolean(workflowExecutionBindingId)
    && (assetDraft.managementMode === 'WORKFLOW' || assetDraft.managedExecutionMode === 'WORKFLOW_OVERRIDE')
  if (shouldLoadWorkflowBinding) {
    try {
      await loadExistingWorkflowExecutionBinding(workflowExecutionBindingId)
    } catch (cause) {
      const canFallbackToPlugin = assetDraft.managementMode === 'MANAGED_TARGET'
        && assetDraft.managedExecutionMode === 'WORKFLOW_OVERRIDE'
        && cause instanceof ApiClientError
        && cause.errorCode === 'RESOURCE_NOT_FOUND'
      const canRecreateStandaloneBinding = assetDraft.managementMode === 'WORKFLOW'
        && cause instanceof ApiClientError
        && cause.errorCode === 'RESOURCE_NOT_FOUND'
      if (!canFallbackToPlugin && !canRecreateStandaloneBinding) throw cause
      assetDraft.workflowExecutionBindingId = ''
      assetDraft.workflowExecutionBindingVersion = 0
      if (canFallbackToPlugin) {
        // 工作流绑定已被历史清理时，受管目标仍可回到插件执行，避免脏 ID 阻塞资产编辑。
        assetDraft.managedExecutionMode = 'PLUGIN'
      }
    }
  }
  if (assetDraft.workflowId) await loadWorkflowVersions(assetDraft.workflowId)
  await refreshWorkflowBindingProjection()
}

function closeCreateDialog() {
  if (!createLoading.value) {
    createDialogOpen.value = false
    editingServiceAssetId.value = ''
    editAssetDetail.value = null
  }
}

async function loadWorkflowTemplates() {
  workflowListLoading.value = true
  workflowListError.value = ''
  try {
    const result = await listWorkflowTemplates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    workflowItems.value = filterCertificateDeploymentWorkflows(result.data?.items ?? [], {
      preserveWorkflowId: assetDraft.workflowId,
    })
  } catch (cause) {
    workflowItems.value = []
    workflowListError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadWorkflowListFailed')
  } finally {
    workflowListLoading.value = false
  }
}

async function loadWorkflowVersions(workflowId: string) {
  workflowVersionListLoading.value = true
  workflowVersionListError.value = ''
  workflowVersionItems.value = []
  if (!workflowId) {
    workflowVersionListLoading.value = false
    return
  }
  try {
    const result = await listWorkflowTemplateVersions(workflowId)
    workflowVersionItems.value = [...(result.data?.items ?? [])] as ApiRecord[]
    const currentVersionId = String(readNested(workflowItems.value.find((item) => String(item.id ?? '') === workflowId), ['currentVersionId']) ?? '')
    const current = publishedWorkflowVersionItems.value.find((item) => String(item.id ?? '') === currentVersionId)
    const latest = current ?? publishedWorkflowVersionItems.value[0]
    assetDraft.workflowVersionSelection = 'PINNED'
    assetDraft.workflowVersionId = String(latest?.id ?? '')
    if (selectedWorkflowVersion.value) {
      await refreshWorkflowBindingProjection()
    }
  } catch (cause) {
    workflowVersionListError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadWorkflowVersionsFailed')
  } finally {
    workflowVersionListLoading.value = false
  }
}

async function loadExistingPluginBinding(bindingId: string) {
  const result = await getPluginBinding(bindingId)
  const binding = readRecord(result.data) ?? {}
  const inputBindings = readInputBindingsV1(binding.inputBindings) ?? createInputBindingsV1()
  assetDraft.pluginOverrideVersionId = String(binding.pluginVersionId ?? '')
  pluginBindingVersion.value = Number(binding.version ?? 0)
  deploymentInputBindings.value = inputBindings
}

async function loadExistingWorkflowExecutionBinding(bindingId: string) {
  const result = await getWorkflowExecutionBinding(bindingId)
  const binding = readRecord(result.data) ?? {}
  assetDraft.workflowExecutionBindingId = String(binding.id ?? bindingId)
  assetDraft.workflowExecutionBindingVersion = Number(binding.version ?? 0)
  assetDraft.workflowPluginVersionId = String(binding.pluginVersionId ?? '')
  assetDraft.workflowCapabilityKey = String(binding.capabilityKey ?? '')
  assetDraft.workflowKey = String(binding.workflowKey ?? '')
  assetDraft.workflowId = String(binding.workflowTemplateId ?? '')
  // 后端绑定只保存 FIXED；编辑器用 PINNED 表示同一件事。
  assetDraft.workflowVersionSelection = 'PINNED'
  assetDraft.workflowVersionId = String(binding.workflowVersionId ?? '')
  assetDraft.workflowRunner = String(binding.runner ?? 'CONTROL_PLANE') as WorkflowRunnerType
  assetDraft.workflowGatewayId = String(binding.gatewayId ?? '')
  const inputBindings = readInputBindingsV1(binding.inputBindings) ?? createInputBindingsV1()
  deploymentInputBindings.value = inputBindings
}

async function loadDevices() {
  deviceListLoading.value = true
  try {
    const result = await listManagedDevices({ page: 1, pageSize: 200, sort: 'displayName:asc' })
    deviceItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    deviceItems.value = []
    createError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadTargetsFailed')
  } finally {
    deviceListLoading.value = false
  }
}

async function loadServiceInstances(hostId: string) {
  serviceInstanceListLoading.value = true
  serviceInstanceItems.value = []
  if (!hostId) {
    serviceInstanceListLoading.value = false
    return
  }
  try {
    const result = await listFrameworkInstances({
      page: 1,
      pageSize: 200,
      sort: 'updatedAt:desc',
      filters: { deviceId: hostId, status: 'ACTIVE' },
    })
    serviceInstanceItems.value = [...(result.data?.items ?? [])]
  } finally {
    serviceInstanceListLoading.value = false
  }
}

async function refreshWorkflowBindingProjection(options: { preserveRenderedForm?: boolean } = {}) {
  const sequence = ++workflowProjectionRequestSequence
  const preserveRenderedForm = options.preserveRenderedForm === true && workflowBindingProjection.value !== null
  if (!preserveRenderedForm) workflowBindingProjection.value = null
  workflowProjectionError.value = ''
  workflowProjectionRefreshing.value = preserveRenderedForm
  const pluginVersionId = pluginProjectionVersionId.value
  const shouldProjectPlugin = assetDraft.managementMode === 'MANAGED_TARGET'
    && assetDraft.managedExecutionMode === 'PLUGIN'
    && assetDraft.managedTargetId.trim()
    && pluginVersionId
  const shouldProjectWorkflow = workflowExecutionEnabled.value && editingServiceAssetId.value
  if (!shouldProjectPlugin && !shouldProjectWorkflow) {
    workflowProjectionLoading.value = false
    workflowProjectionRefreshing.value = false
    return
  }
  const workflowOverride = shouldProjectWorkflow ? buildWorkflowProjectionOverride() : undefined
  if (shouldProjectWorkflow && !workflowOverride) {
    // 工作流版本尚未加载完成时不回退到数据库旧策略，避免旧绑定阻塞当前编辑状态。
    workflowProjectionLoading.value = false
    workflowProjectionRefreshing.value = false
    return
  }
  workflowProjectionLoading.value = true
  try {
    const result = shouldProjectPlugin
      ? await projectApplicationAssetPluginInputs(assetDraft.managedTargetId, {
        capabilityKey: 'certificate.deploy',
        pluginVersionId,
        certificateFormatId: assetDraft.agentCertificateFormatId.trim() || undefined,
        applicationAsset: {
          id: editingServiceAssetId.value || 'draft',
          address: assetDraft.address.trim(),
          sniName: assetDraft.workflowTargetSniName.trim() || undefined,
          verifyUrl: assetDraft.verifyUrl.trim() || effectiveVerifyUrl.value || undefined,
          port: Number(assetDraft.port),
          protocol: assetDraft.protocol,
          displayName: assetDraft.displayName.trim() || assetDraft.address.trim(),
        },
        inputBindings: deploymentInputBindings.value,
      })
      : await projectDeploymentInputs(editingServiceAssetId.value, workflowOverride)
    if (sequence !== workflowProjectionRequestSequence) return
    workflowBindingProjection.value = result.data ?? null
    if (workflowBindingProjection.value) {
      const fixedFormatId = fixedPkcs12CertificateFormatId.value
      if (fixedFormatId && assetDraft.agentCertificateFormatId !== fixedFormatId) {
        // 固定 PKCS#12 合同的格式由插件投影回填，页面不接受用户选择。
        assetDraft.agentCertificateFormatId = fixedFormatId
      }
      const filteredBindings = filterEditableInputBindings(workflowBindingProjection.value, deploymentInputBindings.value)
      if (JSON.stringify(filteredBindings) !== deploymentInputBindingsFingerprint.value) {
        deploymentInputBindings.value = filteredBindings
      }
    }
  } catch (cause) {
    if (sequence !== workflowProjectionRequestSequence) return
    workflowProjectionError.value = cause instanceof ApiClientError ? cause.message : cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (sequence === workflowProjectionRequestSequence) {
      workflowProjectionLoading.value = false
      workflowProjectionRefreshing.value = false
    }
  }
}

function buildWorkflowProjectionOverride(): WorkflowDeploymentInputProjectionOverride | undefined {
  const workflowTemplateId = assetDraft.workflowId.trim()
  const workflowVersionId = String(selectedWorkflowVersion.value?.id ?? assetDraft.workflowVersionId).trim()
  if (!workflowTemplateId || !workflowVersionId) return undefined
  const pluginSource = readRecord(readNested(selectedWorkflowVersion.value, ['pluginSource']))
  const pluginVersionId = String(pluginSource?.pluginVersionId ?? assetDraft.workflowPluginVersionId).trim()
  return {
    workflowTemplateId,
    workflowVersionId,
    ...(pluginVersionId ? { pluginVersionId } : {}),
    inputBindings: deploymentInputBindings.value,
  }
}

function filterEditableInputBindings(projection: DeploymentInputProjectionV1, bindings: DeploymentInputBindingsV1): DeploymentInputBindingsV1 {
  const variableSlots = new Set(
    [...projection.requiredVariables, ...projection.advancedVariables]
      .filter((item) => item.configurationMode !== 'runtime' && item.bindingPolicy !== 'fixed')
      .map((item) => item.slot),
  )
  const connectionFields = new Map(
    projection.connections.map((connection) => [
      connection.slot,
      new Set(Object.entries(connection.fields)
        .filter(([, field]) => field.configurationMode !== 'runtime' && field.bindingPolicy !== 'fixed')
        .map(([path]) => path)),
    ]),
  )
  const credentialSlots = new Set(projection.credentials.map((item) => item.slot))
  const artifactSlots = new Set(projection.artifacts.map((item) => item.slot))
  const artifacts: DeploymentInputBindingsV1['artifacts'] = {}
  for (const artifact of projection.artifacts) {
    if (isFixedPkcs12Artifact(artifact) && artifact.binding) artifacts[artifact.slot] = artifact.binding
  }
  for (const [slot, binding] of Object.entries(bindings.artifacts)) {
    if (!artifactSlots.has(slot)) continue
    const artifact = projection.artifacts.find((item) => item.slot === slot)
    if (artifact && isFixedPkcs12Artifact(artifact)) {
      // 丢弃历史 pfx/private-key 映射，始终采用宿主按角色生成的标准输出键。
      continue
    }
    artifacts[slot] = binding
  }
  return createInputBindingsV1({
    variables: Object.fromEntries(Object.entries(bindings.variables).filter(([slot]) => variableSlots.has(slot))),
    connections: Object.fromEntries(Object.entries(bindings.connections).flatMap(([slot, binding]) => {
      const paths = connectionFields.get(slot)
      if (!paths) return []
      const editableBinding: Record<string, unknown> = {}
      for (const fieldPath of paths) {
        const value = readNested(binding, fieldPath.split('.'))
        if (value !== undefined) writeNested(editableBinding, fieldPath.split('.'), value)
      }
      return Object.keys(editableBinding).length ? [[slot, editableBinding]] : []
    })),
    credentials: Object.fromEntries(Object.entries(bindings.credentials).filter(([slot]) => credentialSlots.has(slot))),
    artifacts,
  })
}

function isFixedPkcs12Artifact(artifact: DeploymentInputProjectionV1['artifacts'][number]): boolean {
  return Object.values(artifact.outputs).some((output) => output.required && output.role.trim().toLowerCase() === 'pkcs12_bundle')
}

function writeNested(target: Record<string, unknown>, path: string[], value: unknown): void {
  const leaf = path[path.length - 1]
  if (!leaf) return
  let current = target
  for (const segment of path.slice(0, -1)) {
    const child = current[segment]
    current[segment] = child && typeof child === 'object' && !Array.isArray(child) ? child : {}
    current = current[segment] as Record<string, unknown>
  }
  current[leaf] = value
}

async function loadGateways() {
  gatewayListLoading.value = true
  gatewayListError.value = ''
  try {
    const result = await listGateways({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    gatewayItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    gatewayItems.value = []
    gatewayListError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadGatewayListFailed')
  } finally {
    gatewayListLoading.value = false
  }
}

async function loadCertificateFormatsForWorkflow() {
  certificateFormatLoading.value = true
  certificateFormatError.value = ''
  try {
    certificateFormatItems.value = await fetchAllRecords((page, pageSize) =>
      listCertificateFormats({ page, pageSize, sort: 'createdAt:desc' }),
    )
  } catch (cause) {
    certificateFormatItems.value = []
    certificateFormatError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadCertificateFormatsFailed')
  } finally {
    certificateFormatLoading.value = false
  }
}

async function refreshAssetDetail(serviceAssetId: string) {
  if (!serviceAssetId) {
    selectedAssetDetail.value = null
    linkageStatus.value = null
    snapshotItems.value = []
    detailError.value = ''
    snapshotError.value = ''
    return
  }
  detailLoading.value = true
  detailError.value = ''
  void loadAssetSnapshots(serviceAssetId)
  try {
    const result = await getAssetDetail(serviceAssetId)
    selectedAssetDetail.value = result.data ?? null
    try {
      const linkage = await getApplicationAssetLinkageStatus(serviceAssetId)
      linkageStatus.value = linkage.data ?? null
    } catch {
      linkageStatus.value = null
    }
  } catch (cause) {
    selectedAssetDetail.value = null
    if (cause instanceof ApiClientError) {
      detailError.value = cause.message
      return
    }
    const message = cause instanceof Error ? cause.message : t('assets.errors.loadAssetDetailFailed')
    detailError.value = message
  } finally {
    detailLoading.value = false
  }
}

async function repairSelectedAssetLinkage() {
  const id = String(selectedServiceAsset.value?.raw.id ?? '')
  if (!id || linkageRepairing.value) return
  linkageRepairing.value = true
  try {
    const result = await repairApplicationAssetLinkage(id)
    linkageStatus.value = (result.data?.after ?? result.data ?? null) as ApiRecord | null
  } finally {
    linkageRepairing.value = false
  }
}

async function loadAssetSnapshots(serviceAssetId: string) {
  snapshotLoading.value = true
  snapshotError.value = ''
  snapshotItems.value = []
  try {
    const snapshots = await listManagedTargetSnapshots({
      page: 1,
      pageSize: 20,
      sort: 'capturedAt:desc',
      filters: { applicationAssetId: serviceAssetId },
    })
    snapshotItems.value = [...(snapshots.data?.items ?? [])]
  } catch (cause) {
    snapshotItems.value = []
    snapshotError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadAssetDetailFailed')
  } finally {
    snapshotLoading.value = false
  }
}

async function rollbackFromLatestSnapshot() {
  const runId = latestSnapshotExecutionRunId.value.trim()
  if (!runId) return
  rollbackSubmitting.value = true
  rollbackError.value = ''
  rollbackRequestId.value = ''
  try {
    const result = await rollbackExecution(runId, {
      reason: 'application-asset-latest-snapshot',
    })
    rollbackRequestId.value = result.requestId
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      rollbackError.value = cause.message
      return
    }
    rollbackError.value = cause instanceof Error ? cause.message : t('assets.errors.rollbackFailed')
  } finally {
    rollbackSubmitting.value = false
  }
}

async function refreshAssetTargets() {
  siteListLoading.value = true
  siteListError.value = ''
  siteItems.value = []
  const deviceId = assetDraft.deviceId.trim()
  const frameworkInstanceId = assetDraft.frameworkInstanceId.trim()
  if (!deviceId) {
    serviceInstanceItems.value = []
  }
  if (!frameworkInstanceId) {
    siteListLoading.value = false
    return
  }
  try {
    const siteResult = await listSiteAssets({
      page: 1,
      pageSize: 200,
      sort: 'updatedAt:desc',
      filters: { frameworkInstanceId, status: 'ACTIVE' },
    })
    siteItems.value = [...(siteResult.data?.items ?? [])]
  } catch (cause) {
    siteListError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadTargetsFailed')
  } finally {
    siteListLoading.value = false
  }
}

async function loadManagedTargets(siteAssetId: string, currentTarget?: ApiRecord) {
  managedTargetListLoading.value = true
  managedTargetItems.value = []
  siteListError.value = ''
  if (!siteAssetId) {
    managedTargetListLoading.value = false
    return
  }
  try {
    const result = await listManagedTargets({
      page: 1,
      pageSize: 200,
      sort: 'updatedAt:desc',
      filters: { siteId: siteAssetId, status: 'ACTIVE' },
    })
    managedTargetItems.value = [...(result.data?.items ?? [])]
    if (currentTarget && assetDraft.managedTargetId && !managedTargetItems.value.some(
      (item) => String(item.id ?? '') === assetDraft.managedTargetId,
    )) {
      managedTargetItems.value.push(currentTarget)
    }
    if (assetDraft.managedTargetId && !managedTargetItems.value.some((item) => String(item.id ?? '') === assetDraft.managedTargetId)) {
      assetDraft.managedTargetId = ''
    }
    if (!assetDraft.managedTargetId && managedTargetItems.value.length === 1) {
      assetDraft.managedTargetId = String(managedTargetItems.value[0]?.id ?? '')
    }
  } catch (cause) {
    managedTargetItems.value = []
    assetDraft.managedTargetId = ''
    siteListError.value = cause instanceof ApiClientError
      ? cause.message
      : cause instanceof Error ? cause.message : t('assets.errors.loadTargetsFailed')
  } finally {
    managedTargetListLoading.value = false
  }
}

async function loadManagedTargetPluginResolution(managedTargetId: string): Promise<void> {
  const sequence = ++managedCapabilityRequestSequence
  effectiveCapability.value = null
  inheritedEffectiveCapability.value = null
  compatibleManagedPlugins.value = []
  if (!managedTargetId) return
  effectiveCapabilityLoading.value = true
  compatibleManagedPluginsLoading.value = true
  const applicationAssetId = editingServiceAssetId.value || undefined
  const inheritedCapabilityRequest = applicationAssetId
    ? getManagedTargetEffectiveCapability(managedTargetId, 'certificate.deploy')
    : Promise.resolve(null)
  const [effectiveResult, compatibleResult, inheritedResult] = await Promise.allSettled([
    getManagedTargetEffectiveCapability(managedTargetId, 'certificate.deploy', applicationAssetId),
    listManagedTargetCompatiblePlugins(managedTargetId, 'certificate.deploy', applicationAssetId, locale.value),
    inheritedCapabilityRequest,
  ])
  if (sequence !== managedCapabilityRequestSequence) return
  if (effectiveResult.status === 'fulfilled') {
    effectiveCapability.value = readRecord(effectiveResult.value.data) ?? null
    const plugin = readRecord(effectiveCapability.value?.plugin)
    const binding = readRecord(effectiveCapability.value?.binding)
    const source = readRecord(effectiveCapability.value?.source)
    if (assetDraft.managedExecutionMode === 'PLUGIN' && source?.ownerType === 'APPLICATION_ASSET') {
      assetDraft.pluginOverrideVersionId = String(plugin?.pluginVersionId ?? '')
      pluginBindingId.value = String(binding?.pluginBindingId ?? '')
      pluginBindingVersion.value = Number(binding?.version ?? 0)
      if (pluginBindingId.value) await loadExistingPluginBinding(pluginBindingId.value)
    }
  }
  if (inheritedResult.status === 'fulfilled' && inheritedResult.value) {
    inheritedEffectiveCapability.value = readRecord(inheritedResult.value.data) ?? null
  }
  if (compatibleResult.status === 'fulfilled') {
    const response = readRecord(compatibleResult.value.data) ?? {}
    const items = Array.isArray(response.items) ? response.items as ApiRecord[] : []
    compatibleManagedPlugins.value = items.filter((item) => item.compatible === true)
    const effectivePlugin = readRecord(readNested(effectiveCapability.value, ['plugin']))
    const effectivePluginVersionId = String(effectivePlugin?.pluginVersionId ?? '')
    if (
      effectivePluginVersionId
      && effectiveCapability.value?.compatible !== false
      && !compatibleManagedPlugins.value.some((item) => String(item.pluginVersionId ?? '') === effectivePluginVersionId)
    ) {
      const executionLocation = String(effectiveCapability.value?.executionLocation ?? '')
      compatibleManagedPlugins.value.push({
        ...effectivePlugin,
        pluginVersionId: effectivePluginVersionId,
        compatible: true,
        executionLocations: executionLocation ? [executionLocation] : [],
      })
      compatibleManagedPlugins.value.sort((left, right) =>
        String(left.pluginId ?? '').localeCompare(String(right.pluginId ?? '')))
    }
    const selectedPluginVersionId = assetDraft.pluginOverrideVersionId.trim()
    if (selectedPluginVersionId && !compatibleManagedPlugins.value.some(
      (item) => String(item.pluginVersionId ?? '') === selectedPluginVersionId,
    )) {
      const currentPluginId = String(readNested(effectiveCapability.value, ['plugin', 'pluginId']) ?? '')
      const replacementItem = currentPluginId
        ? compatibleManagedPlugins.value.find((item) => String(item.pluginId ?? '') === currentPluginId)
        : compatibleManagedPlugins.value.length === 1
          ? compatibleManagedPlugins.value[0]
          : undefined
      const replacement = String(replacementItem?.pluginVersionId ?? '')
      assetDraft.pluginOverrideVersionId = replacement
      pluginBindingId.value = ''
      pluginBindingVersion.value = 0
    }
  }
  effectiveCapabilityLoading.value = false
  compatibleManagedPluginsLoading.value = false
}

async function refreshServiceInstancesForDevice() {
  assetDraft.frameworkInstanceId = ''
  assetDraft.siteAssetId = ''
  assetDraft.managedTargetId = ''
  siteItems.value = []
  await loadServiceInstances(assetDraft.deviceId)
}

async function submitCreate() {
  createLoading.value = true
  createError.value = ''
  createRequestId.value = ''
  try {
    const workflowTarget = workflowExecutionEnabled.value ? buildWorkflowTargetInfo() : null
    const basePayload = {
      address: assetDraft.address.trim(),
      displayName: assetDraft.displayName.trim() || assetDraft.address.trim(),
      port: Number(assetDraft.port),
      protocol: assetDraft.protocol,
      platform: assetDraft.platform,
      verifyUrl: workflowTarget?.verifyUrl ?? assetDraft.verifyUrl.trim(),
      sniName: workflowTarget?.sniName ?? undefined,
      environment: assetDraft.environment.trim(),
      tags: splitCsv(assetDraft.tagsText),
    }
    if (isEditMode.value) {
      const result = await updateServiceAsset(editingServiceAssetId.value, {
        ...basePayload,
        deploymentStrategy: buildDeploymentStrategyPayload(workflowTarget ?? undefined),
        ...(workflowTarget ? { metadata: { ...(readRecord(readNested(editAssetDetail.value, ['metadata'])) ?? {}), workflowTarget } } : {}),
      })
      if (assetDraft.managementMode === 'MANAGED_TARGET') await saveManagedTargetConfiguration(editingServiceAssetId.value)
      else await saveStandaloneWorkflowConfiguration(editingServiceAssetId.value)
      await saveCertificateSupplyPolicy(editingServiceAssetId.value)
      createRequestId.value = result.requestId
      createDialogOpen.value = false
      editingServiceAssetId.value = ''
      await refreshAssetsAfterMutation()
      return
    }
    const result = await createServiceAsset({
      ...basePayload,
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
      metadata: workflowTarget ? { workflowTarget } : {},
      deploymentStrategy: buildDeploymentStrategyPayload(workflowTarget ?? undefined),
    })
    const createdAssetId = String(result.data?.id ?? '')
    if (createdAssetId) {
      if (assetDraft.managementMode === 'MANAGED_TARGET') await saveManagedTargetConfiguration(createdAssetId)
      else await saveStandaloneWorkflowConfiguration(createdAssetId)
      await saveCertificateSupplyPolicy(createdAssetId)
    }
    createRequestId.value = result.requestId
    createDialogOpen.value = false
    await refreshAssetsAfterMutation(true)
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      createError.value = cause.message
      return
    }
    createError.value = cause instanceof Error ? cause.message : t('assets.errors.createAssetFailed')
  } finally {
    createLoading.value = false
  }
}

async function saveManagedTargetConfiguration(applicationAssetId: string): Promise<void> {
  const explicitPluginVersionId = assetDraft.pluginOverrideVersionId.trim()
  const hasPluginInputOverride = hasInputBindingValues(deploymentInputBindings.value)
  const pluginVersionId = explicitPluginVersionId || (hasPluginInputOverride ? pluginProjectionVersionId.value : '')
  await saveApplicationAssetManagedTarget(applicationAssetId, {
    managedTargetId: assetDraft.managedTargetId,
    certificateFormatId: assetDraft.agentCertificateFormatId.trim(),
    executionMode: assetDraft.managedExecutionMode,
    capabilityKey: 'certificate.deploy',
    ...(assetDraft.managedExecutionMode === 'WORKFLOW_OVERRIDE'
      ? { workflowExecution: buildWorkflowExecutionInput() }
      : {}),
    ...(assetDraft.managedExecutionMode === 'PLUGIN' && pluginVersionId ? {
      pluginOverride: {
        pluginVersionId,
        pluginBindingId: pluginBindingId.value || undefined,
        expectedBindingVersion: pluginBindingId.value ? pluginBindingVersion.value : undefined,
        inputBindings: deploymentInputBindings.value,
      },
    } : {}),
  })
}

function hasInputBindingValues(bindings: DeploymentInputBindingsV1): boolean {
  return Object.keys(bindings.variables).length > 0
    || Object.keys(bindings.connections).length > 0
    || Object.keys(bindings.credentials).length > 0
    || Object.keys(bindings.artifacts).length > 0
}

async function saveStandaloneWorkflowConfiguration(applicationAssetId: string): Promise<void> {
  await saveApplicationAssetStandaloneWorkflow(applicationAssetId, {
    workflowExecution: buildWorkflowExecutionInput(),
  })
}

function buildWorkflowExecutionInput(): Record<string, unknown> {
  const identity = resolveWorkflowExecutionIdentity()
  const workflowVersionId = String(selectedWorkflowVersion.value?.id ?? assetDraft.workflowVersionId).trim()
  return {
    tenantId: authStore.user?.tenantId ?? tenantStore.currentTenantId,
    ...(identity.pluginVersionId ? { pluginVersionId: identity.pluginVersionId } : {}),
    ...(identity.capabilityKey ? { capabilityKey: identity.capabilityKey } : {}),
    ...(identity.workflowKey ? { workflowKey: identity.workflowKey } : {}),
    workflowTemplateId: assetDraft.workflowId.trim(),
    // 执行绑定只接受固定版本；“最新已发布”在保存前解析为当前选中的发布版本。
    workflowVersionSelection: 'FIXED',
    workflowVersionId,
    runner: assetDraft.workflowRunner,
    ...(assetDraft.workflowRunner === 'GATEWAY' ? { gatewayId: assetDraft.workflowGatewayId.trim() } : {}),
    inputBindings: deploymentInputBindings.value,
    ...(assetDraft.workflowExecutionBindingId ? {
      bindingId: assetDraft.workflowExecutionBindingId,
      expectedVersion: assetDraft.workflowExecutionBindingVersion,
    } : {}),
  }
}

function resolveWorkflowExecutionIdentity(): { pluginVersionId: string; capabilityKey: string; workflowKey: string } {
  const pluginSource = readRecord(readNested(selectedWorkflowVersion.value, ['pluginSource']))
  const capabilities = Array.isArray(selectedWorkflowTemplate.value?.capabilities)
    ? selectedWorkflowTemplate.value?.capabilities.filter((item): item is string => typeof item === 'string')
    : []
  const preferredCapability = capabilities.includes('certificate.deploy') ? 'certificate.deploy' : ''
  const capabilityKey = (preferredCapability
    || String(pluginSource?.capabilityKey ?? assetDraft.workflowCapabilityKey).trim())
  const pluginVersionId = String(pluginSource?.pluginVersionId ?? assetDraft.workflowPluginVersionId).trim()
  const workflowKey = String(assetDraft.workflowKey || capabilityKey).trim()
  return { pluginVersionId, capabilityKey, workflowKey }
}

function resetDraft() {
  editingServiceAssetId.value = ''
  editAssetDetail.value = null
  assetWizardStep.value = 1
  assetDraft.managementMode = 'MANAGED_TARGET'
  assetDraft.managedExecutionMode = 'PLUGIN'
  assetDraft.approvalRequired = false
  assetDraft.deviceId = ''
  assetDraft.frameworkInstanceId = ''
  assetDraft.address = ''
  assetDraft.port = '443'
  assetDraft.protocol = 'HTTPS'
  assetDraft.platform = 'LINUX'
  assetDraft.verifyUrl = ''
  assetDraft.frameworkType = ''
  assetDraft.siteAssetId = ''
  assetDraft.managedTargetId = ''
  assetDraft.agentCertificateFormatId = ''
  assetDraft.displayName = ''
  assetDraft.environment = ''
  assetDraft.tagsText = ''
  assetDraft.workflowId = ''
  assetDraft.workflowPluginVersionId = ''
  assetDraft.workflowCapabilityKey = ''
  assetDraft.workflowKey = ''
  assetDraft.pluginOverrideVersionId = ''
  assetDraft.workflowExecutionBindingId = ''
  assetDraft.workflowExecutionBindingVersion = 0
  assetDraft.workflowVersionSelection = 'PINNED'
  assetDraft.workflowVersionId = ''
  assetDraft.workflowRunner = 'CONTROL_PLANE'
  assetDraft.workflowGatewayId = ''
  assetDraft.workflowTargetSiteName = ''
  assetDraft.workflowTargetBindingInformation = ''
  assetDraft.workflowTargetHostHeader = ''
  assetDraft.workflowTargetSniName = ''
  workflowProjectionRequestSequence += 1
  workflowBindingProjection.value = null
  workflowProjectionLoading.value = false
  workflowProjectionRefreshing.value = false
  workflowProjectionError.value = ''
  pluginBindingId.value = ''
  pluginBindingVersion.value = 0
  effectiveCapability.value = null
  inheritedEffectiveCapability.value = null
  compatibleManagedPlugins.value = []
  workflowTargetAdvancedExpanded.value = false
  serviceInstanceItems.value = []
  siteItems.value = []
  managedTargetItems.value = []
  targetSelectionInitializing.value = false
  siteListError.value = ''
  workflowVersionItems.value = []
  workflowListError.value = ''
  workflowVersionListError.value = ''
  gatewayListError.value = ''
  credentialProfileError.value = ''
  certificateFormatError.value = ''
  deploymentInputBindings.value = createInputBindingsV1()
}

function selectUserModeDefaults() {
  if (!isUserViewMode.value) return
  if (!assetDraft.deviceId && deviceItems.value.length === 1) {
    assetDraft.deviceId = String(deviceItems.value[0]?.id ?? '')
  }
  if (!assetDraft.agentCertificateFormatId && certificateFormatItems.value.length === 1) {
    assetDraft.agentCertificateFormatId = String(certificateFormatItems.value[0]?.id ?? '')
  }
}

async function loadUserAssets() {
  if (!isUserViewMode.value) return
  userAssetsLoading.value = true
  userAssetsError.value = ''
  try {
    const result = await requestAssetsWithDisplayNames({
      page: 1,
      pageSize: ASSET_WORKSPACE_PAGE_SIZE,
      sort: 'updatedAt:desc',
    })
    userAssetItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    userAssetsError.value = cause instanceof Error ? cause.message : t('assets.userView.loadFailed')
  } finally {
    userAssetsLoading.value = false
  }
}

function userAssetName(asset: ApiRecord) {
  return String(asset.displayName ?? asset.address ?? asset.domainName ?? asset.id ?? t('assets.empty.notSet'))
}

function userAssetAddress(asset: ApiRecord) {
  const protocol = String(asset.protocol ?? 'HTTPS').toLowerCase()
  const address = String(asset.address ?? asset.domainName ?? '')
  const port = String(asset.port ?? '')
  return address ? `${protocol}://${address}${port ? `:${port}` : ''}` : t('assets.empty.notSet')
}

function userAssetTarget(asset: ApiRecord) {
  return String(
    readNested(asset, ['targetBinding', 'siteName'])
    ?? readNested(asset, ['siteDisplayName'])
    ?? readNested(asset, ['targetBinding', 'managedTargetLabel'])
    ?? t('assets.userView.targetPending'),
  )
}

function userAssetRow(asset: ApiRecord): ViewRow {
  const id = String(asset.id ?? asset.applicationAssetId ?? '')
  return {
    id,
    name: userAssetName(asset),
    status: String(asset.status ?? 'ACTIVE'),
    risk: 'MEDIUM',
    raw: asset,
  }
}

function isAssetSelected(assetId: string): boolean {
  return selectedAssetIds.value.has(assetId)
}

function replaceSelectedAssetIds(assetIds: readonly string[]): void {
  const nextIds = [...new Set(assetIds.map((assetId) => assetId.trim()).filter(Boolean))]
  const nextRecords = new Map<string, ApiRecord>()
  for (const assetId of nextIds) {
    const record = selectedAssetRecords.value.get(assetId)
    if (record) nextRecords.set(assetId, record)
  }
  selectedAssetIds.value = new Set(nextIds)
  selectedAssetRecords.value = nextRecords
}

function clearSelectedAssets(): void {
  selectedAssetIds.value = new Set()
  selectedAssetRecords.value = new Map()
}

function toggleAssetSelection(assetId: string, selected: boolean, asset?: ApiRecord): void {
  const next = new Set(selectedAssetIds.value)
  const nextRecords = new Map(selectedAssetRecords.value)
  if (selected) next.add(assetId)
  else next.delete(assetId)
  if (selected && asset) nextRecords.set(assetId, asset)
  if (!selected) nextRecords.delete(assetId)
  selectedAssetIds.value = next
  selectedAssetRecords.value = nextRecords
}

async function openBatchCertificateUpdateDialog(): Promise<void> {
  if (!canBatchUpdateCertificates.value || !canExecuteDeployments.value || deploymentLoading.value) return
  const firstAsset = selectedAssetItems.value[0]
  if (!firstAsset) return
  bulkCertificateUpdateMode.value = true
  bulkCertificateUpdateAssetIds.value = [...selectedAssetIds.value]
  bulkCertificateUpdateDomain.value = selectedCertificateDomain.value
  await openDeploymentDialog(assetOverviewCardRow(toAssetOverviewCard(firstAsset)))
}

async function deleteSelectedAssetCards(): Promise<void> {
  if (selectedAssetCount.value === 0 || bulkDeleteLoading.value) return
  const targetIds = [...selectedAssetIds.value]
  bulkDeleteLoading.value = true
  try {
    const results = await Promise.allSettled(targetIds.map((assetId) => deleteServiceAsset(assetId)))
    const failedIds = targetIds.filter((_, index) => results[index]?.status === 'rejected')
    replaceSelectedAssetIds(failedIds)
    await loadAssetOverviewPage(assetOverviewPage.value)
    const succeededCount = targetIds.length - failedIds.length
    if (failedIds.length > 0) {
      notifySelectionMessage(t('assets.selection.bulkDeletePartialSuccess', {
        succeeded: succeededCount,
        failed: failedIds.length,
      }), 'warning')
      return
    }
    clearSelectedAssets()
    notifySelectionMessage(t('assets.selection.bulkDeleteSuccess', { count: succeededCount }), 'success')
  } finally {
    bulkDeleteLoading.value = false
  }
}

function notifySelectionMessage(message: string, tone: 'success' | 'warning' | 'danger' | 'info'): void {
  window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message, tone } }))
}

function toAssetOverviewCard(asset: ApiRecord): AssetOverviewCard {
  const name = userAssetName(asset)
  return {
    id: firstAssetText(asset, ['id', 'address', 'displayName']) || name,
    asset,
    name,
    status: firstAssetText(asset, ['status', 'state']) || 'UNKNOWN',
    pluginVersionId: assetPluginVersionId(asset),
    certificate: assetOverviewCertificate(asset),
  }
}

function assetPluginVersionId(asset: ApiRecord): string {
  return firstAssetText(asset, [
    'targetBinding.pluginVersionId',
    'targetBindingDetail.pluginVersionId',
    'deploymentStrategy.workflow.pluginVersionId',
    'metadata.deploymentStrategy.workflow.pluginVersionId',
  ])
}

function assetPluginLogoUrl(pluginVersionId: string, variant: 'horizontal' | 'square'): string | undefined {
  if (!pluginVersionId) return undefined
  return `/api/v1/plugin-versions/${encodeURIComponent(pluginVersionId)}/resources/logos/${variant}`
}

function assetPluginLogoFallbackText(asset: ApiRecord): string {
  const label = assetDeviceLabel(asset)
  if (label && label !== t('assets.empty.notSet')) return Array.from(label)[0] ?? '?'
  const framework = assetFrameworkLabel(asset)
  if (framework && framework !== t('assets.empty.notSet')) return Array.from(framework)[0] ?? '?'
  return Array.from(userAssetName(asset))[0] ?? '?'
}

function assetCertificateStatusKey(card: AssetOverviewCard): Exclude<AssetCertificateCategory, 'all'> {
  return card.certificate.lifecycle === 'valid' ? 'valid' : 'updateAvailable'
}

function assetCertificateStatusLabel(card: AssetOverviewCard): string {
  return t(`assets.card.status.${assetCertificateCardStatusKey(card.certificate.lifecycle)}`)
}

function assetCertificateStatusTone(card: AssetOverviewCard): StatusTone {
  return assetCertificateStatusKey(card) === 'valid' ? 'success' : 'warning'
}

function assetFrameworkLabel(asset: ApiRecord): string {
  return firstAssetText(asset, [
    'targetBinding.frameworkType',
    'targetBindingDetail.frameworkType',
    'metadata.workflowTarget.frameworkType',
    'deploymentStrategy.workflow.target.frameworkType',
    'frameworkType',
  ]) || t('assets.empty.notSet')
}

function assetDeviceLabel(asset: ApiRecord): string {
  return firstAssetText(asset, [
    'targetBinding.deviceDisplayName',
    'targetBindingDetail.deviceDisplayName',
    'deviceDisplayName',
    'device.displayName',
    'device.hostname',
    'host.displayName',
    'host.hostname',
  ]) || t('assets.empty.notSet')
}

function assetSiteLabel(asset: ApiRecord): string {
  return firstAssetText(asset, [
    'targetBinding.siteName',
    'targetBindingDetail.siteAsset.siteName',
    'targetBindingDetail.siteAsset.name',
    'siteDisplayName',
    'metadata.workflowTarget.siteName',
    'deploymentStrategy.workflow.target.siteName',
  ]) || t('assets.empty.notSet')
}

function normalizeAssetSortValue(card: AssetOverviewCard, field: AssetSortField): string | number {
  switch (field) {
    case 'port':
      return Number(firstAssetText(card.asset, ['port'])) || 0
    case 'protocol':
      return firstAssetText(card.asset, ['protocol']).toLowerCase()
    case 'device':
      return assetDeviceLabel(card.asset).toLowerCase()
    case 'framework':
      return assetFrameworkLabel(card.asset).toLowerCase()
    case 'site':
      return assetSiteLabel(card.asset).toLowerCase()
    case 'status':
      return assetCertificateStatusKey(card)
    case 'updatedAt': {
      const timestamp = Date.parse(firstAssetText(card.asset, ['updatedAt', 'createdAt']))
      return Number.isNaN(timestamp) ? -1 : timestamp
    }
    case 'domain':
    default:
      return card.name.toLowerCase()
  }
}

function compareAssetOverviewCards(left: AssetOverviewCard, right: AssetOverviewCard): number {
  const leftValue = normalizeAssetSortValue(left, assetSortField.value)
  const rightValue = normalizeAssetSortValue(right, assetSortField.value)
  if (leftValue !== rightValue) {
    const result = leftValue > rightValue ? 1 : -1
    return assetSortOrder.value === 'asc' ? result : -result
  }
  const nameResult = left.name.localeCompare(right.name)
  if (nameResult !== 0) return nameResult
  return left.id.localeCompare(right.id)
}

function toggleAssetSort(field: AssetSortField): void {
  if (assetSortField.value === field) {
    assetSortOrder.value = assetSortOrder.value === 'asc' ? 'desc' : 'asc'
    return
  }
  assetSortField.value = field
  assetSortOrder.value = field === 'updatedAt' ? 'desc' : 'asc'
}

function assetSortIndicator(field: AssetSortField): string {
  if (assetSortField.value !== field) return ''
  return assetSortOrder.value === 'asc' ? '↑' : '↓'
}

function assetCardUrl(asset: ApiRecord): string {
  const protocol = firstAssetText(asset, ['protocol']) || 'HTTPS'
  const address = firstAssetText(asset, ['address', 'domainName', 'displayName'])
  if (address) {
    const normalizedProtocol = protocol.toLowerCase()
    const port = firstAssetText(asset, ['port'])
    const defaultPort = normalizedProtocol === 'https' ? '443' : normalizedProtocol === 'http' ? '80' : ''
    const portSuffix = port && port !== defaultPort ? `:${port}` : ''
    return `${normalizedProtocol}://${address}${portSuffix}`
  }

  return firstAssetText(asset, ['verifyUrl', 'metadata.verifyUrl']) || t('assets.empty.notSet')
}

function assetOverviewCertificate(asset: ApiRecord): AssetCardCertificate {
  const expiresAt = firstAssetText(asset, [
    'currentCertificate.notAfter',
    'metadata.currentCertificate.notAfter',
    'currentVersion.notAfter',
    'certificate.notAfter',
    'certificate.expiresAt',
    'certificateBinding.notAfter',
    'targetBinding.certificateBinding.notAfter',
    'notAfter',
    'expiresAt',
    'certificateNotAfter',
    'certificateExpiresAt',
  ])
  const lifecycle = resolveAssetCertificateLifecycle(asset, expiresAt)
  const countdown = getExpiryCountdown(expiresAt)
  return {
    name: firstAssetText(asset, [
      'currentCertificate.commonName',
      'currentCertificate.subject.commonName',
      'currentCertificate.name',
      'currentCertificate.fingerprintSha256',
      'metadata.currentCertificate.commonName',
      'metadata.currentCertificate.subject.commonName',
      'metadata.currentCertificate.name',
      'metadata.currentCertificate.fingerprintSha256',
      'currentVersion.commonName',
      'certificate.commonName',
      'certificate.subject.commonName',
      'certificate.name',
      'certificateBinding.domain',
      'certificateBinding.domainName',
      'targetBinding.certificateBinding.domain',
      'targetBinding.certificateBinding.domainName',
      'certificateName',
      'certificateDomain',
      'certificateVersionId',
    ]) || t('assets.empty.notSet'),
    lifecycle,
    lifecycleLabel: t(`assets.card.status.${assetCertificateCardStatusKey(lifecycle)}`),
    remainingLabel: assetCertificateRemainingLabel(lifecycle, countdown),
    tone: assetCertificateLifecycleTone(lifecycle),
  }
}

function assetCertificateDomain(asset: ApiRecord): string {
  const domain = firstAssetText(asset, [
    'currentCertificate.commonName',
    'currentCertificate.subject.commonName',
    'metadata.currentCertificate.commonName',
    'metadata.currentCertificate.subject.commonName',
    'certificate.commonName',
    'certificate.subject.commonName',
    'certificateBinding.domainName',
    'certificateBinding.domain',
    'targetBinding.certificateBinding.domainName',
    'targetBinding.certificateBinding.domain',
  ])
  return domain.trim().toLowerCase().replace(/\.$/, '')
}

function firstAssetText(asset: ApiRecord, candidates: readonly string[]): string {
  for (const candidate of candidates) {
    const value = readNested(asset, candidate.split('.'))
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function resolveAssetCertificateLifecycle(asset: ApiRecord, expiresAt: string): AssetCertificateLifecycle {
  const updateAvailable = [
    readNested(asset, ['currentCertificate', 'updateAvailable']),
    readNested(asset, ['metadata', 'currentCertificate', 'updateAvailable']),
  ].some((value) => value === true)
  if (updateAvailable) return 'updateAvailable'

  const status = firstAssetText(asset, [
    'currentCertificate.status',
    'metadata.currentCertificate.status',
    'currentVersion.status',
    'certificate.status',
    'certificateBinding.status',
    'targetBinding.certificateBinding.status',
    'certificateStatus',
    'certificateLifecycle',
  ]).toUpperCase()
  if (status === 'EXPIRED') return 'expired'
  if (status === 'EXPIRING' || status === 'EXPIRING_SOON' || status === 'CRITICAL') return 'expiringSoon'

  const countdown = getExpiryCountdown(expiresAt)
  if (!countdown) return 'unknown'
  if (countdown.expired) return 'expired'
  return countdown.days <= 10 ? 'expiringSoon' : 'valid'
}

function assetCertificateRemainingLabel(lifecycle: AssetCertificateLifecycle, countdown: ReturnType<typeof getExpiryCountdown>): string {
  if (!countdown) return t('assets.card.days.notRecorded')
  if (lifecycle === 'expired') return t('assets.card.days.expired', { days: countdown.days })
  if (countdown.days === 0) return t('assets.card.days.expiresToday')
  return t('assets.card.days.remaining', { days: countdown.days })
}

function assetCertificateCardStatusKey(lifecycle: AssetCertificateLifecycle): 'valid' | 'attention' | 'unknown' {
  if (lifecycle === 'valid') return 'valid'
  if (lifecycle === 'unknown') return 'unknown'
  return 'attention'
}

function assetCertificateLifecycleTone(lifecycle: AssetCertificateLifecycle): StatusTone {
  if (lifecycle === 'updateAvailable') return 'warning'
  if (lifecycle === 'valid') return 'success'
  if (lifecycle === 'expiringSoon') return 'warning'
  if (lifecycle === 'expired') return 'danger'
  return 'muted'
}

function assetCertificateNeedsUpdate(certificate: AssetCardCertificate): boolean {
  return certificate.lifecycle === 'updateAvailable' || certificate.lifecycle === 'expired'
}

function assetOverviewCardRow(card: AssetOverviewCard): ViewRow {
  const risk = firstAssetText(card.asset, ['risk', 'riskLevel', 'severity']).toUpperCase()
  return {
    id: card.id,
    name: card.name,
    status: card.status,
    risk: risk === 'LOW' || risk === 'MEDIUM' || risk === 'HIGH' || risk === 'CRITICAL' ? risk : 'MEDIUM',
    raw: card.asset,
  }
}

function splitCsv(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
}

function goToAssetStep(step: AssetWizardStep) {
  if (step > currentAvailableStep.value) return
  assetWizardStep.value = step
}

function goPreviousAssetStep() {
  if (assetWizardStep.value === 3) assetWizardStep.value = 2
  else if (assetWizardStep.value === 2) assetWizardStep.value = 1
}

async function goNextAssetStep() {
  if (assetWizardStep.value === 1 && commonStepReady.value) {
    await refreshManagedTargetSelection()
    assetWizardStep.value = 2
  }
  else if (assetWizardStep.value === 2 && modeStepReady.value) assetWizardStep.value = 3
}

async function refreshManagedTargetSelection() {
  const previousFrameworkId = assetDraft.frameworkInstanceId
  const previousSiteId = assetDraft.siteAssetId
  const previousTargetId = assetDraft.managedTargetId
  const previousTarget = managedTargetItems.value.find((item) => String(item.id ?? '') === previousTargetId)
  await loadServiceInstances(assetDraft.deviceId)
  const matchingFramework = serviceInstanceItems.value.find((item) => String(item.id ?? '') === previousFrameworkId)
    ?? serviceInstanceItems.value.find((item) => frameworkTypesMatch(item.frameworkType, assetDraft.frameworkType))
  assetDraft.frameworkInstanceId = String(matchingFramework?.id ?? '')
  await refreshAssetTargets()
  assetDraft.siteAssetId = siteItems.value.some((item) => String(item.id ?? '') === previousSiteId) ? previousSiteId : ''
  await loadManagedTargets(assetDraft.siteAssetId, previousTarget)
  assetDraft.managedTargetId = managedTargetItems.value.some((item) => String(item.id ?? '') === previousTargetId) ? previousTargetId : ''
}

function assetWizardStepState(step: AssetWizardStep): 'done' | 'active' | 'pending' {
  if (step < assetWizardStep.value) return 'done'
  if (step === assetWizardStep.value) return 'active'
  return 'pending'
}

function assetWizardStepStateLabel(step: AssetWizardStep): string {
  const state = assetWizardStepState(step)
  if (state === 'done') return t('assets.wizard.stepState.done')
  if (state === 'active') return t('assets.wizard.stepState.active')
  return t('assets.wizard.stepState.pending')
}

function buildDeploymentStrategyPayload(workflowTarget?: WorkflowTargetInfo): Record<string, unknown> {
  if (assetDraft.managementMode === 'WORKFLOW') {
    const gatewayId = assetDraft.workflowRunner === 'GATEWAY'
      ? assetDraft.workflowGatewayId.trim()
      : undefined
    const identity = resolveWorkflowExecutionIdentity()
    const workflowVersionId = String(selectedWorkflowVersion.value?.id ?? assetDraft.workflowVersionId).trim()
    return {
      type: 'WORKFLOW',
      approvalRequired: assetDraft.approvalRequired,
      workflow: {
        pluginBindingId: pluginBindingId.value || undefined,
        pluginVersionId: identity.pluginVersionId || undefined,
        capabilityKey: identity.capabilityKey || undefined,
        workflowId: assetDraft.workflowId.trim(),
        workflowVersionSelection: 'FIXED',
        workflowVersionId,
        runner: assetDraft.workflowRunner,
        gatewayId,
        target: workflowTarget,
        inputBindings: deploymentInputBindings.value,
      },
    }
  }

  return {
    ...buildManagedTargetDeploymentStrategy(assetDraft.managedTargetId, assetDraft.agentCertificateFormatId),
    approvalRequired: assetDraft.approvalRequired,
  }
}

function buildManagedTargetBindingPayload(): Record<string, unknown> | undefined {
  const target = selectedManagedTarget.value
    ?? readRecord(readNested(editAssetDetail.value, ['targetBindingDetail', 'managedTarget']))
  if (!target || !assetDraft.siteAssetId.trim() || !assetDraft.managedTargetId.trim()) return undefined
  return {
    managedTargetId: assetDraft.managedTargetId.trim(),
    status: 'ACTIVE',
    metadata: readRecord(target.metadata) ?? {},
  }
}

function buildWorkflowTargetInfo(): WorkflowTargetInfo {
  const port = normalizeWorkflowTargetPort(assetDraft.port)
  const hostHeader = assetDraft.workflowTargetHostHeader.trim() || assetDraft.address.trim()
  const bindingInformation = assetDraft.workflowTargetBindingInformation.trim() || `*:${port}:${hostHeader}`
  const verifyUrl = assetDraft.verifyUrl.trim() || effectiveVerifyUrl.value
  const protocol = normalizeWorkflowTargetProtocol(assetDraft.protocol)
  const frameworkType = normalizeWorkflowTargetFramework(assetDraft.frameworkType)
  const siteName = assetDraft.workflowTargetSiteName.trim() || assetDraft.displayName.trim() || assetDraft.address.trim()
  const sniName = assetDraft.workflowTargetSniName.trim() || hostHeader
  return {
    frameworkType,
    siteName,
    bindingInformation,
    hostHeader,
    port,
    protocol,
    verifyUrl,
    sniName,
  }
}

function normalizeWorkflowTargetFramework(value: string): string {
  return normalizeFrameworkType(value)
}

function normalizeWorkflowTargetProtocol(value: string): AssetProtocol {
  const normalized = value.trim().toUpperCase()
  return ['HTTPS', 'TLS', 'STARTTLS', 'HTTP', 'CUSTOM'].includes(normalized) ? normalized as AssetProtocol : 'HTTPS'
}

function normalizeWorkflowTargetPort(value: string): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : Number(assetDraft.port) || 443
}

function workflowCertificateOutputOptions(certificateFormatId: string): Array<{ key: string; label: string; role: string }> {
  const format = certificateFormatItems.value.find((item) => String(item.id ?? '') === certificateFormatId)
  if (!format) return []
  const parameters = readRecord(format.parameters) ?? {}
  const formatName = String(format.format ?? '').toLowerCase()
  const containsPrivateKey = Boolean(format.containsPrivateKey || parameters.includePrivateKey)
  const fingerprintOutput = {
    key: 'fingerprintSha256',
    label: t('certificates.detailPanel.fields.fingerprintSha256'),
    role: 'fingerprint_sha256',
  }
  const options: Array<{ key: string; label: string; role: string }> = []
  if (formatName === 'pem') {
    if (parameters.includeLeafCertificate !== false && (parameters.includeCertificateChain || parameters.generateChainFile)) {
      options.push({ key: 'fullchain', label: `fullchain / ${t('assets.certificateOutputs.publicCertificateWithChain')}`, role: 'public_certificate' })
    }
    if (parameters.includeLeafCertificate !== false) {
      options.push({ key: 'leafPem', label: `leafPem / ${t('assets.certificateOutputs.publicCertificate')}`, role: 'public_certificate' })
      // 兼容历史工作流仍使用的输出键。
      options.push({ key: 'public', label: `public / ${t('assets.certificateOutputs.publicCertificate')}`, role: 'public_certificate' })
    }
    if (parameters.includeCertificateChain || parameters.generateChainFile) {
      options.push({ key: 'orderedChainPem', label: `orderedChainPem / ${t('assets.certificateOutputs.certificateChain')}`, role: 'certificate_chain' })
      // 兼容历史工作流仍使用的输出键。
      options.push({ key: 'chain', label: `chain / ${t('assets.certificateOutputs.certificateChain')}`, role: 'certificate_chain' })
    }
    if (containsPrivateKey || parameters.generatePrivateKeyFile) {
      options.push({ key: 'privateKeyPem', label: `privateKeyPem / ${t('assets.certificateOutputs.privateKey')}`, role: 'private_key' })
      // 兼容历史工作流仍使用的输出键。
      options.push({ key: 'private', label: `private / ${t('assets.certificateOutputs.privateKey')}`, role: 'private_key' })
    }
    options.push({ key: 'bundle', label: `bundle / ${t('assets.certificateOutputs.pemBundle')}`, role: 'bundle' })
    options.push(fingerprintOutput)
    return dedupeOutputOptions(options)
  }
  if (formatName === 'der') {
    return [
      { key: 'leafPem', label: `leafPem / DER ${t('assets.certificateOutputs.publicCertificate')}`, role: 'public_certificate' },
      { key: 'public', label: `public / DER ${t('assets.certificateOutputs.publicCertificate')}`, role: 'public_certificate' },
      fingerprintOutput,
    ]
  }
  return [{ key: 'bundle', label: `bundle / ${t('assets.certificateOutputs.container', { format: formatName.toUpperCase() })}`, role: 'bundle' }, fingerprintOutput]
}

function dedupeOutputOptions(options: Array<{ key: string; label: string; role: string }>): Array<{ key: string; label: string; role: string }> {
  const seen = new Set<string>()
  return options.filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
}

function workflowCertificateFormatLabel(item: ApiRecord): string {
  const format = String(item.format ?? 'unknown').toUpperCase()
  const parameters = readRecord(item.parameters) ?? {}
  const preset = String(parameters.outputPreset ?? '')
  const privateKey = item.containsPrivateKey || parameters.includePrivateKey || parameters.generatePrivateKeyFile
    ? t('assets.certificateFormats.withPrivateKey')
    : t('assets.certificateFormats.withoutPrivateKey')
  const configName = localizeCertificateFormatName(String(parameters.configName ?? item.name ?? item.displayName ?? item.id ?? ''), t)
  const parts = [
    configName,
    format,
    preset,
    privateKey,
  ].filter(Boolean)
  return parts.join(' / ')
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readWorkflowBindingText(bindings: Record<string, unknown>, name: string): string {
  const value = bindings[name]
  return typeof value === 'string' ? value.trim() : ''
}

async function loadCredentialsForWorkflowVariables() {
  credentialProfileLoading.value = true
  credentialProfileError.value = ''
  try {
    credentialProfileItems.value = await loadCredentialProfiles()
  } catch (cause) {
    credentialProfileItems.value = []
    credentialProfileError.value = cause instanceof Error ? cause.message : t('assets.errors.loadCredentialProfilesFailed')
  } finally {
    credentialProfileLoading.value = false
  }
}

function readDeploymentStrategy(source: unknown): ApiRecord | null {
  const direct = readNested(source, ['deploymentStrategy'])
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct as ApiRecord
  const metadata = readNested(source, ['metadata', 'deploymentStrategy'])
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) return metadata as ApiRecord
  return null
}

function readWorkflowVersionSelection(deploymentStrategy: ApiRecord | null): WorkflowVersionSelection {
  // 页面不再暴露版本策略；当前发布版本会在加载工作流后解析并固定为执行快照。
  void deploymentStrategy
  return 'PINNED'
}

function readWorkflowTargetFromAsset(source: unknown, deploymentStrategy: ApiRecord | null = readDeploymentStrategy(source)): WorkflowTargetInfo | null {
  const target = readRecord(readNested(source, ['metadata', 'workflowTarget']))
    ?? readRecord(readNested(deploymentStrategy, ['workflow', 'target']))
    ?? readRecord(readNested(source, ['deploymentStrategy', 'workflow', 'target']))
  if (!target) return null
  const port = normalizeWorkflowTargetPort(String(target.port ?? ''))
  return {
    frameworkType: normalizeWorkflowTargetFramework(String(target.frameworkType ?? '')),
    siteName: String(target.siteName ?? ''),
    bindingInformation: typeof target.bindingInformation === 'string' ? target.bindingInformation : undefined,
    hostHeader: typeof target.hostHeader === 'string' ? target.hostHeader : undefined,
    port,
    protocol: normalizeWorkflowTargetProtocol(String(target.protocol ?? 'HTTPS')),
    verifyUrl: typeof target.verifyUrl === 'string' ? target.verifyUrl : undefined,
    sniName: typeof target.sniName === 'string' ? target.sniName : undefined,
  }
}

function workflowTemplateLabel(item: ApiRecord): string {
  return String(item.name ?? item.displayName ?? item.templateName ?? item.id ?? '')
}

function workflowVersionLabel(item: ApiRecord): string {
  const version = workflowVersionDisplayValue(item)
  const status = workflowVersionStatus(item)
  return `${version}${status ? ` / ${workflowVersionStatusLabel(status)}` : ''}`
}

function workflowVersionDisplayValue(item: ApiRecord): string {
  return workflowVersionValue(item) || String(item.name ?? item.id ?? '')
}

function workflowDslVersion(item: ApiRecord): string {
  return workflowVersionValue(item)
}

function workflowVersionValue(item: ApiRecord): string {
  const candidates = [
    readNested(item, ['content', 'metadata', 'version']),
    item.version,
    item.versionNo,
    item.id,
  ]
  return candidates.find((value): value is string | number => (typeof value === 'string' && value.trim().length > 0) || typeof value === 'number')
    ?.toString()
    .trim() ?? ''
}

function preferWorkflowVersion(candidate: ApiRecord, existing: ApiRecord, selectedId: string, currentId: string): boolean {
  const candidateId = String(candidate.id ?? '')
  const existingId = String(existing.id ?? '')
  if (candidateId === selectedId) return existingId !== selectedId
  if (existingId === selectedId) return false
  if (candidateId === currentId) return existingId !== currentId
  if (existingId === currentId) return false
  return String(candidate.createdAt ?? '').localeCompare(String(existing.createdAt ?? '')) > 0
}

function compareWorkflowVersionsByDsl(left: ApiRecord, right: ApiRecord): number {
  const semanticOrder = compareSemanticVersions(workflowDslVersion(right), workflowDslVersion(left))
  if (semanticOrder !== 0) return semanticOrder
  return String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))
}

function compareSemanticVersions(left: string, right: string): number {
  const leftParts = left.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const rightParts = right.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (Number.isFinite(leftParts[index]) ? leftParts[index]! : 0)
      - (Number.isFinite(rightParts[index]) ? rightParts[index]! : 0)
    if (difference !== 0) return difference
  }
  return left.localeCompare(right)
}

function workflowVersionStatus(item: ApiRecord | null | undefined): string {
  return String(item?.status ?? '').toLowerCase()
}

function workflowVersionStatusLabel(status: string): string {
  if (status === 'published') return t('designSystem.status.PUBLISHED')
  if (status === 'draft') return t('designSystem.status.DRAFT')
  if (status === 'archived') return t('assets.status.archived')
  return status || t('assets.status.unknownStatus')
}

function gatewayLabel(item: ApiRecord): string {
  const name = String(item.name ?? item.displayName ?? item.gatewayId ?? item.id ?? '')
  const status = String(item.status ?? '')
  return status ? `${name} (${status})` : name
}

function renderValue(value: unknown, fallback = t('common.notAvailable')): string {
  return formatMaybeLocalTime(value, fallback)
}

function assetOverviewQueryFilters(): BusinessListQuery['filters'] {
  return {
    address: assetOverviewFilters.address.trim(),
    status: assetOverviewFilters.status,
  }
}

async function requestAssetsWithDisplayNames(query: BusinessListQuery): Promise<ApiPageResult> {
  const result = await listAssets(query)
  const page = result.data
  if (!page) return result
  return {
    ...result,
    data: {
      ...page,
      items: page.items.map((item) => enrichAssetDisplayNames(item)),
    },
  }
}

async function loadAssetOverviewPage(page: number): Promise<void> {
  const requestedPage = Math.max(1, Math.trunc(page) || 1)
  assetOverviewLoading.value = true
  assetOverviewError.value = ''
  try {
    let result = await requestAssetsWithDisplayNames({
      page: requestedPage,
      pageSize: assetOverviewPageSize.value,
      sort: 'address:asc',
      filters: assetOverviewQueryFilters(),
    })

    // 删除或筛选收窄后，服务端可能返回一个空的末页；回退一页保持卡片工作台可导航。
    if ((result.data?.items.length ?? 0) === 0 && (result.data?.total ?? 0) > 0 && requestedPage > 1) {
      result = await requestAssetsWithDisplayNames({
        page: requestedPage - 1,
        pageSize: assetOverviewPageSize.value,
        sort: 'address:asc',
        filters: assetOverviewQueryFilters(),
      })
    }

    const resultPage = result.data
    if (!resultPage) {
      assetOverviewPage.value = requestedPage
      assetOverviewTotal.value = 0
      assetOverviewItems.value = []
      return
    }

    assetOverviewPage.value = resultPage.page > 0 ? resultPage.page : requestedPage
    assetOverviewPageSize.value = resultPage.pageSize > 0 ? resultPage.pageSize : assetOverviewPageSize.value
    assetOverviewTotal.value = resultPage.total
    assetOverviewItems.value = [...resultPage.items]
    const nextSelectedRecords = new Map(selectedAssetRecords.value)
    for (const asset of resultPage.items) {
      const assetId = toAssetOverviewCard(asset).id
      if (selectedAssetIds.value.has(assetId)) nextSelectedRecords.set(assetId, asset)
    }
    selectedAssetRecords.value = nextSelectedRecords
  } catch (cause) {
    assetOverviewError.value = cause instanceof Error ? cause.message : t('businessPage.apiFailed')
  } finally {
    assetOverviewLoading.value = false
  }
}

async function changeAssetOverviewPageSize(pageSize: number): Promise<void> {
  const target = Math.trunc(pageSize)
  if (!Number.isFinite(target) || target <= 0 || target === assetOverviewPageSize.value) return
  assetOverviewPageSize.value = target
  await loadAssetOverviewPage(1)
}

async function refreshAssetsAfterMutation(resetPage = false): Promise<void> {
  if (isUserViewMode.value) {
    await loadUserAssets()
    return
  }
  await loadAssetOverviewPage(resetPage ? 1 : assetOverviewPage.value)
}

async function applyAssetOverviewFilters(): Promise<void> {
  await loadAssetOverviewPage(1)
}

async function clearAssetOverviewFilters(): Promise<void> {
  assetOverviewFilters.address = ''
  assetOverviewFilters.status = ''
  await applyAssetOverviewFilters()
}

async function deleteAssetOverviewCard(card: AssetOverviewCard): Promise<void> {
  await deleteServiceAsset(card.id)
  toggleAssetSelection(card.id, false)
  await loadAssetOverviewPage(assetOverviewPage.value)
}

function enrichAssetDisplayNames(asset: ApiRecord): ApiRecord {
  const workflowTarget = readWorkflowTargetFromAsset(asset)
  return {
    ...asset,
    targetBinding: asset.targetBinding ?? (workflowTarget
      ? {
          frameworkType: workflowTarget.frameworkType,
          metadata: {
            siteName: workflowTarget.siteName,
            bindingInformation: workflowTarget.bindingInformation,
            hostHeader: workflowTarget.hostHeader,
            port: workflowTarget.port,
          },
      }
      : undefined),
    siteDisplayName: readNested(asset, ['targetBinding', 'siteName']) ?? readNested(asset, ['siteDisplayName']) ?? workflowTarget?.siteName,
  }
}

function siteName(site: ApiRecord): string {
  return String(site.siteName ?? site.name ?? site.displayName ?? site.id ?? '')
}

function readNested(value: unknown, path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function detailFieldValue(candidates: readonly string[]): unknown {
  const source = selectedAssetDetail.value ?? selectedServiceAsset.value?.raw ?? null
  if (!source) return undefined
  for (const candidate of candidates) {
    if (candidate === 'deploymentStrategyCompatibilityLabel') {
      return deploymentStrategyCompatibilityLabel(readNested(source, ['deploymentStrategy', 'compatibilityMode']))
    }
    const value = readNested(source, candidate.split('.'))
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function siteLabel(site: ApiRecord): string {
  const siteName = String(site.siteName ?? site.id ?? '')
  const hostHeader = String(site.hostHeader ?? '')
  const bindingInformation = String(site.bindingInformation ?? '')
  return hostHeader ? `${siteName} (${hostHeader})` : `${siteName} (${bindingInformation || t('assets.empty.noBindingInformation')})`
}

function certificateVersionLabel(versionId: string): string {
  if (!versionId) return t('assets.empty.notSet')
  return versionId
}

function certificateBindingCurrentLabel(binding: ApiRecord): string {
  const configuredCertificate = readRecord(readNested(binding, ['configuredCertificate']))
  return firstAssetText(configuredCertificate ?? {}, ['subject', 'fingerprintSha256'])
    || certificateVersionLabel(String(binding.certificateVersionId ?? binding.localCertificateVersionId ?? ''))
}

function snapshotTypeLabel(value: unknown): string {
  const normalized = String(value ?? '')
  if (normalized === 'PRE_DEPLOY') return t('assets.snapshotTypes.preDeploy')
  if (normalized === 'POST_DEPLOY') return t('assets.snapshotTypes.postDeploy')
  if (normalized === 'POST_ROLLBACK') return t('assets.snapshotTypes.postRollback')
  if (normalized === 'ERROR_STATE') return t('assets.snapshotTypes.errorState')
  if (normalized === 'ROLLBACK_POINT') return t('assets.snapshotTypes.rollbackPoint')
  return normalized || t('designSystem.status.UNKNOWN')
}

watch(
  currentAvailableStep,
  (step) => {
    if (assetWizardStep.value > step) assetWizardStep.value = step
  },
  { immediate: true },
)

watch(deploymentDialogOpen, (opened) => {
  if (!opened) resetBulkCertificateUpdateState()
})

watch(
  () => assetDraft.managementMode,
  async (mode) => {
    if (mode === 'MANAGED_TARGET') {
      await loadDevices()
      return
    }
    await Promise.all([loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
  },
)

watch(isUserViewMode, (enabled) => {
  if (enabled) {
    void loadUserAssets()
    return
  }
  void loadAssetOverviewPage(1)
}, { immediate: true })

watch(
  () => [
    route.query.detailModal,
    route.query.assetId,
    isUserViewMode.value,
  ],
  () => {
    if (route.query.detailModal !== '1') return
    const assetId = typeof route.query.assetId === 'string' ? route.query.assetId : ''
    if (!assetId) return
    const routeKey = `${isUserViewMode.value ? 'user' : 'professional'}:${assetId}`
    if (openedDetailRouteKey === routeKey || openingRouteAssetKey === routeKey) return
    openingRouteAssetKey = routeKey
    openedDetailRouteKey = routeKey
    void openRouteAssetDetail(assetId).finally(() => {
      if (openingRouteAssetKey === routeKey) openingRouteAssetKey = ''
    })
  },
  { immediate: true },
)

watch(
  () => route.query.onboarding,
  (value) => {
    if (value === '1') onboardingDialogOpen.value = true
  },
  { immediate: true },
)
watch(
  () => route.query.create,
  (value) => {
    if (value !== '1' || createDialogOpen.value) return
    void openCreateDialog().finally(() => {
      const query = { ...route.query }
      delete query.create
      void router.replace({ query })
    })
  },
  { immediate: true },
)

watch([isUserViewMode, deviceItems, certificateFormatItems], () => {
  selectUserModeDefaults()
}, { deep: true })

watch(
  () => [
    assetDraft.pluginOverrideVersionId,
    pluginProjectionVersionId.value,
    assetDraft.managedTargetId,
    assetDraft.agentCertificateFormatId,
    assetDraft.address,
    assetDraft.port,
    assetDraft.protocol,
    assetDraft.workflowTargetSniName,
  ],
  async () => {
    await refreshWorkflowBindingProjection()
  },
)

watch(
  () => deploymentInputBindingsFingerprint.value,
  async () => {
    if (!workflowBindingProjection.value) return
    await refreshWorkflowBindingProjection({ preserveRenderedForm: true })
  },
)

watch(
  () => assetDraft.workflowId,
  async (workflowId, previousWorkflowId) => {
    if (previousWorkflowId && workflowId !== previousWorkflowId) {
      assetDraft.workflowVersionId = ''
      assetDraft.workflowExecutionBindingId = ''
      assetDraft.workflowExecutionBindingVersion = 0
      assetDraft.workflowPluginVersionId = ''
      assetDraft.workflowCapabilityKey = ''
      assetDraft.workflowKey = ''
      pluginBindingId.value = ''
      pluginBindingVersion.value = 0
    }
    if (!workflowExecutionEnabled.value) return
    await loadWorkflowVersions(workflowId)
  },
)

watch(
  () => assetDraft.workflowVersionId,
  async (workflowVersionId, previousWorkflowVersionId) => {
    if (previousWorkflowVersionId && workflowVersionId !== previousWorkflowVersionId) {
      assetDraft.workflowExecutionBindingId = ''
      assetDraft.workflowExecutionBindingVersion = 0
      assetDraft.workflowPluginVersionId = ''
      assetDraft.workflowCapabilityKey = ''
      assetDraft.workflowKey = ''
      pluginBindingId.value = ''
      pluginBindingVersion.value = 0
    }
    if (!workflowExecutionEnabled.value) return
    await refreshWorkflowBindingProjection()
  },
)

watch(
  () => assetDraft.workflowRunner,
  (runner) => {
    if (runner === 'CONTROL_PLANE') assetDraft.workflowGatewayId = ''
  },
)

watch(
  () => assetDraft.deviceId,
  async () => {
    if (targetSelectionInitializing.value) return
    await refreshServiceInstancesForDevice()
  },
)

watch(
  () => assetDraft.frameworkInstanceId,
  async () => {
    if (targetSelectionInitializing.value) return
    const service = selectedServiceInstance.value
    assetDraft.frameworkType = normalizeFrameworkType(service?.frameworkType)
    assetDraft.siteAssetId = ''
    assetDraft.managedTargetId = ''
    await refreshAssetTargets()
  },
)


watch(
  () => assetDraft.frameworkType,
  async () => {
    if (isEditMode.value) return
    if (workflowExecutionEnabled.value) return
    if (assetDraft.managementMode === 'MANAGED_TARGET') return
    assetDraft.siteAssetId = ''
    assetDraft.managedTargetId = ''
    await refreshAssetTargets()
  },
)

watch(
  () => assetDraft.siteAssetId,
  async () => {
    if (targetSelectionInitializing.value) return
    assetDraft.managedTargetId = ''
    await loadManagedTargets(assetDraft.siteAssetId)
  },
)

watch(
  () => assetDraft.managedTargetId,
  async (managedTargetId) => {
    if (targetSelectionInitializing.value) return
    assetDraft.pluginOverrideVersionId = ''
    pluginBindingId.value = ''
    pluginBindingVersion.value = 0
    await loadManagedTargetPluginResolution(managedTargetId)
  },
)

watch(
  () => [
    certificateSupplyDraft.supplyMode,
    certificateSupplyDraft.certificateVersionId,
    certificateSupplyDraft.providerType,
    certificateSupplyDraft.providerId,
    certificateSupplyDraft.certificateAuthorityId,
    certificateSupplyDraft.acmeProviderProfileId,
    certificateSupplyDraft.dnsProviderId,
    certificateSupplyDraft.credentialRef,
    certificateSupplyDraft.certificateProfileVersionId,
    certificateSupplyDraft.autoRenew,
    certificateSupplyDraft.renewalWindowDays,
    certificateSupplyDraft.rotateKeyOnRenewal,
  ],
  () => {
    certificateSupplyPreview.value = null
    if (editingServiceAssetId.value && !certificateSupplyLoading.value) void previewCertificateSupplyPolicy()
  },
)

watch(
  () => assetDraft.managedExecutionMode,
  async (mode) => {
    if (assetDraft.managementMode !== 'MANAGED_TARGET') return
    if (mode === 'PLUGIN') {
      assetDraft.workflowExecutionBindingId = ''
      assetDraft.workflowExecutionBindingVersion = 0
      await loadManagedTargetPluginResolution(assetDraft.managedTargetId)
      return
    }
    assetDraft.pluginOverrideVersionId = ''
    pluginBindingId.value = ''
    pluginBindingVersion.value = 0
    await Promise.all([loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
  },
)

function deploymentStrategyCompatibilityLabel(value: unknown): string {
  if (value === 'UNIFIED') return t('assets.compatibilityModes.unified')
  if (value === 'LEGACY_ADAPTED') return t('assets.compatibilityModes.legacyAdapted')
  return t('assets.compatibilityModes.legacy')
}

async function fetchAllRecords(
  loader: (page: number, pageSize: number) => Promise<ApiPageResult>,
  pageSize = 200,
): Promise<ApiRecord[]> {
  const items: ApiRecord[] = []
  let page = 1
  let total = Number.POSITIVE_INFINITY

  while (items.length < total) {
    const result = await loader(page, pageSize)
    const currentItems = result.data?.items ?? []
    items.push(...currentItems)
    total = Number(result.data?.total ?? items.length)
    if (currentItems.length < pageSize) break
    page += 1
  }

  return items
}

function deviceLabel(device: ApiRecord): string {
  const name = String(device.displayName ?? device.hostname ?? device.primaryIp ?? device.id ?? '')
  const type = String(device.productFamily ?? device.deviceType ?? device.extensionType ?? '')
  return type ? `${name} (${type})` : name
}

function serviceInstanceLabel(service: ApiRecord): string {
  const name = String(service.displayName ?? service.frameworkKey ?? service.id ?? '')
  const frameworkType = String(service.frameworkType ?? '')
  return frameworkType ? `${name} (${frameworkType})` : name
}

function managedTargetLabel(target: ApiRecord): string {
  const targetType = String(target.targetType ?? '')
  const bindingKey = String(target.bindingKey ?? '')
  const targetKey = String(target.targetKey ?? '')
  if (targetType && bindingKey) return `${targetType} (${bindingKey})`
  return targetType || bindingKey || targetKey || String(target.id ?? '')
}

</script>

<template>
  <section class="asset-page">
    <template v-if="isUserViewMode">
      <GcUserFlowWizard
        :steps="userFlowSteps"
        active-step="applications"
        :title="t('viewMode.steps.applications')"
        :help="t('assets.userView.description')"
        :help-label="t('assets.userView.title')"
        :ariaLabel="t('assets.userView.listTitle')"
        @select="navigateUserFlow"
      >
        <template #actions>
          <GcPermissionButton permission="service_asset.manage" @click="openCreateDialog">
            {{ t('assets.userView.addAction') }}
          </GcPermissionButton>
        </template>

        <section class="asset-user-view__summary">
          <div>
            <strong>{{ userAssetItems.length }}</strong>
            <span>{{ t('assets.userView.listTitle') }}</span>
          </div>
          <GcHelpTip
            :content="t('assets.userView.listDescription')"
            :ariaLabel="t('assets.userView.listTitle')"
          />
        </section>

        <section class="asset-user-view__content">
          <header class="asset-user-view__section-head">
            <h3>{{ t('assets.userView.listTitle') }}</h3>
          </header>

          <GcEmptyState
            v-if="userAssetsError"
            :title="t('assets.userView.loadFailed')"
          >
            <p class="asset-user-view__error">{{ userAssetsError }}</p>
            <GcButton variant="secondary" @click="loadUserAssets">{{ t('businessPage.retry') }}</GcButton>
          </GcEmptyState>
          <div v-else-if="userAssetsLoading" class="asset-user-view__state">{{ t('common.loading') }}</div>
          <GcEmptyState
            v-else-if="userAssetItems.length === 0"
            :title="t('assets.userView.emptyTitle')"
          >
            <GcHelpTip
              :content="t('assets.userView.emptyDescription')"
              :ariaLabel="t('assets.userView.emptyTitle')"
            />
            <GcPermissionButton permission="service_asset.manage" @click="openCreateDialog">
              {{ t('assets.userView.addAction') }}
            </GcPermissionButton>
          </GcEmptyState>
          <div v-else class="asset-user-view__grid">
            <article v-for="asset in userAssetItems" :key="String(asset.id)" class="gc-card asset-user-view__card">
              <header>
                <div>
                  <h3>{{ userAssetName(asset) }}</h3>
                  <p>{{ userAssetAddress(asset) }}</p>
                </div>
                <GcStatusTag :status="String(asset.status ?? 'ACTIVE')" />
              </header>
              <div class="asset-user-view__location">
                <span>{{ t('assets.userView.deploymentLocation') }}</span>
                <strong>{{ userAssetTarget(asset) }}</strong>
              </div>
              <div class="asset-user-view__actions">
                <GcPermissionButton
                  class="gc-button gc-button--primary"
                  :data-testid="`user-asset-card-deploy-${String(asset.id)}`"
                  permission="deployment.plan.execute"
                  @click="openDeploymentDialog(userAssetRow(asset))"
                >
                  {{ t('assets.actions.deployCertificate') }}
                </GcPermissionButton>
              </div>
            </article>
          </div>
        </section>
      </GcUserFlowWizard>
    </template>

    <template v-else>
      <section class="asset-page__workspace" data-testid="asset-professional-workspace">
        <header class="asset-page__workspace-head">
          <div class="asset-page__workspace-view">
            <span class="asset-page__workspace-view-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 5h5v5H5V5Zm9 0h5v5h-5V5ZM5 14h5v5H5v-5Zm9 0h5v5h-5v-5Z" /></svg>
            </span>
            <div class="asset-page__presentation-toggle" role="group" :aria-label="t('assets.resourceName')">
              <GcButton
                variant="ghost"
                class="asset-page__presentation-toggle-button"
                :class="{ 'asset-page__presentation-toggle-button--active': assetPresentation === 'cards' }"
                :aria-pressed="assetPresentation === 'cards'"
                :aria-label="t('assets.card.presentation.cards')"
                @click="assetPresentation = 'cards'"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h5v5H5V5Zm9 0h5v5h-5V5ZM5 14h5v5H5v-5Zm9 0h5v5h-5v-5Z" /></svg>
              </GcButton>
              <GcButton
                variant="ghost"
                class="asset-page__presentation-toggle-button"
                :class="{ 'asset-page__presentation-toggle-button--active': assetPresentation === 'list' }"
                :aria-pressed="assetPresentation === 'list'"
                :aria-label="t('assets.card.presentation.list')"
                @click="assetPresentation = 'list'"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h2v2H5V6Zm4 0h10v2H9V6ZM5 11h2v2H5v-2Zm4 0h10v2H9v-2ZM5 16h2v2H5v-2Zm4 0h10v2H9v-2Z" /></svg>
              </GcButton>
            </div>
            <div class="certificate-page__category-tabs" role="group" :aria-label="t('assets.columns.status')">
              <button
                class="certificate-page__category-tab"
                :class="{ 'certificate-page__category-tab--active': assetCertificateCategory === 'all' }"
                type="button"
                :aria-pressed="assetCertificateCategory === 'all'"
                @click="assetCertificateCategory = 'all'"
              >
                {{ t('businessPage.all') }}
              </button>
              <button
                class="certificate-page__category-tab"
                :class="{ 'certificate-page__category-tab--active': assetCertificateCategory === 'valid' }"
                type="button"
                :aria-pressed="assetCertificateCategory === 'valid'"
                @click="assetCertificateCategory = 'valid'"
              >
                {{ t('assets.card.status.valid') }}
              </button>
              <button
                class="certificate-page__category-tab"
                :class="{ 'certificate-page__category-tab--active': assetCertificateCategory === 'updateAvailable' }"
                type="button"
                :aria-pressed="assetCertificateCategory === 'updateAvailable'"
                @click="assetCertificateCategory = 'updateAvailable'"
              >
                {{ t('assets.card.status.attention') }}
              </button>
            </div>
            <span class="asset-page__workspace-selection">
              {{ t('assets.card.total', { count: assetOverviewTotal }) }}
            </span>
            <span v-if="selectedAssetCount > 0" class="asset-page__workspace-selected-count">
              {{ t('assets.selection.selectedCount', { count: selectedAssetCount, total: assetOverviewTotal }) }}
            </span>
            <div v-if="selectedAssetCount > 0" class="asset-page__selection-actions" data-testid="asset-selection-actions">
              <GcConfirmAction
                v-if="canManageAssets"
                class="asset-page__selection-delete-action"
                :action-name="t('assets.selection.actions.bulkDelete')"
                :impact-count="selectedAssetCount"
                :risk-text="t('assets.selection.bulkDeleteRisk')"
                :confirm-text="t('assets.actions.delete')"
                :disabled="bulkDeleteLoading"
                data-testid="asset-bulk-delete-action"
                @confirm="deleteSelectedAssetCards"
              />
              <GcPermissionButton
                v-if="canBatchUpdateCertificates && canExecuteDeployments"
                class="asset-page__selection-update-action gc-button--secondary"
                permission="deployment.plan.execute"
                data-testid="asset-bulk-update-action"
                @click="openBatchCertificateUpdateDialog"
              >
                {{ t('assets.selection.actions.bulkUpdateCertificate') }}
              </GcPermissionButton>
            </div>
          </div>
          <div class="asset-page__workspace-actions">
            <GcButton
              variant="secondary"
              :aria-expanded="assetOverviewFiltersVisible"
              data-testid="asset-overview-filter-toggle"
              @click="assetOverviewFiltersVisible = !assetOverviewFiltersVisible"
            >
              {{ t('businessPage.toggleFilters') }}
            </GcButton>
            <GcButton variant="secondary" :loading="assetOverviewLoading" @click="loadAssetOverviewPage(assetOverviewPage)">
              {{ t('common.refresh') }}
            </GcButton>
            <GcPermissionButton class="gc-button gc-button--primary" permission="service_asset.manage" @click="openStandardAssetOnboarding">
              {{ t('assets.card.actions.add') }}
            </GcPermissionButton>
          </div>
        </header>

        <form
          v-if="assetOverviewFiltersVisible"
          class="asset-page__filters"
          data-testid="asset-overview-filters"
          @submit.prevent="applyAssetOverviewFilters"
        >
          <label class="asset-page__filter">
            <span>{{ t('assets.columns.domain') }}</span>
            <input
              v-model="assetOverviewFilters.address"
              :placeholder="t('assets.columns.domain')"
              @change="applyAssetOverviewFilters"
            >
          </label>
          <label class="asset-page__filter">
            <span>{{ t('assets.columns.status') }}</span>
            <select v-model="assetOverviewFilters.status" data-testid="asset-overview-status-filter" @change="applyAssetOverviewFilters">
              <option value="">{{ t('businessPage.all') }}</option>
              <option v-for="option in assetOverviewStatusOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <div class="asset-page__filter-actions">
            <GcButton type="submit" variant="primary">{{ t('tasks.actions.search') }}</GcButton>
            <GcButton type="button" variant="ghost" @click="clearAssetOverviewFilters">{{ t('businessPage.clearFilters') }}</GcButton>
          </div>
        </form>

        <section class="asset-page__card-view" :aria-label="t('businessPage.resourceList', { resource: t('assets.resourceName') })">
          <p v-if="assetOverviewLoading" class="asset-page__card-state">{{ t('common.loading') }}</p>
          <GcEmptyState
            v-else-if="assetOverviewError"
            :title="t('businessPage.apiFailed')"
            :description="assetOverviewError"
          >
            <GcButton variant="secondary" @click="loadAssetOverviewPage(assetOverviewPage)">{{ t('businessPage.retry') }}</GcButton>
          </GcEmptyState>
          <GcEmptyState
            v-else-if="visibleAssetOverviewCards.length === 0"
            :title="t('assets.empty.title')"
            :description="t('assets.empty.description')"
          />
          <div v-else-if="assetPresentation === 'cards'" class="asset-page__card-grid" data-testid="asset-professional-card-grid">
            <GcCard
              v-for="card in visibleAssetOverviewCards"
              :key="card.id"
              as="article"
              class="asset-page__card"
              :selected="isAssetSelected(card.id)"
              :aria-label="card.name"
              data-testid="asset-professional-card"
            >
              <template #header>
                <span class="asset-page__card-icon" aria-hidden="true">
                  <GcPluginLogo
                    :logo-url="assetPluginLogoUrl(card.pluginVersionId, 'horizontal')"
                    :square-logo-url="assetPluginLogoUrl(card.pluginVersionId, 'square')"
                    :fallback-text="assetPluginLogoFallbackText(card.asset)"
                    :alt="t('plugins.aria.logo', { name: assetDeviceLabel(card.asset) })"
                    size="onboarding"
                  />
                </span>
                <div class="asset-page__card-heading">
                  <h3>{{ card.name }}</h3>
                  <p class="asset-page__card-url" :title="assetCardUrl(card.asset)">{{ assetCardUrl(card.asset) }}</p>
                </div>
                <input
                  :checked="isAssetSelected(card.id)"
                  class="asset-page__card-select"
                  type="checkbox"
                  :aria-label="t('assets.aria.selectCard', { name: card.name })"
                  :data-testid="`asset-card-select-${card.id}`"
                  @click.stop
                  @change="toggleAssetSelection(card.id, ($event.target as HTMLInputElement).checked, card.asset)"
                >
              </template>

              <template #body>
                <dl class="asset-page__card-facts">
                  <div>
                    <dt>{{ t('assets.card.fields.certificate') }}</dt>
                    <dd v-auto-fit-card-fact-text class="asset-page__card-fact-value asset-page__card-certificate-name">{{ card.certificate.name }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('assets.card.fields.validity') }}</dt>
                    <dd v-auto-fit-card-fact-text class="asset-page__card-fact-value asset-page__card-certificate-status">
                      <strong class="asset-page__card-certificate-remaining">{{ card.certificate.remainingLabel }}</strong>
                      <GcStatusTag
                        class="asset-page__card-certificate-state"
                        :status="card.certificate.lifecycle"
                        :label="card.certificate.lifecycleLabel"
                        :tone="card.certificate.tone"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t('assets.card.fields.device') }}</dt>
                    <dd v-auto-fit-card-fact-text class="asset-page__card-fact-value asset-page__card-device-name">{{ assetDeviceLabel(card.asset) }}</dd>
                  </div>
                </dl>
              </template>

              <template #footer>
                <GcPermissionButton
                  class="asset-page__card-deploy-button gc-button"
                  :class="assetCertificateNeedsUpdate(card.certificate)
                    ? 'asset-page__card-deploy-button--update'
                    : 'asset-page__card-deploy-button--latest'"
                  :data-testid="`asset-card-deploy-${card.id}`"
                  permission="deployment.plan.execute"
                  @click="openDeploymentDialog(assetOverviewCardRow(card))"
                >
                  {{ t(assetCertificateNeedsUpdate(card.certificate) ? 'assets.card.actions.deployUpdate' : 'assets.card.actions.upToDate') }}
                </GcPermissionButton>
                <GcPermissionButton
                  class="asset-page__card-icon-action"
                  :data-testid="`asset-card-detail-${card.id}`"
                  permission="service_asset.read"
                  :aria-label="t('assets.aria.detailCard', { name: card.name })"
                  :title="t('assets.actions.detail')"
                  @click="openDetailModal(assetOverviewCardRow(card))"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h5" /></svg>
                  <span class="asset-page__icon-action-label">{{ t('assets.actions.detail') }}</span>
                </GcPermissionButton>
                <GcPermissionButton
                  class="asset-page__card-icon-action"
                  :data-testid="`asset-card-edit-${card.id}`"
                  permission="service_asset.manage"
                  :aria-label="t('assets.aria.editCard', { name: card.name })"
                  :title="t('assets.actions.edit')"
                  @click="openEditDialog(assetOverviewCardRow(card))"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4.8L8 20l11.2-11.2a2.8 2.8 0 0 0-4-4L4 16Zm9.8-8.8 3 3" /></svg>
                  <span class="asset-page__icon-action-label">{{ t('assets.actions.edit') }}</span>
                </GcPermissionButton>
                <span v-if="canManageAssets" class="asset-page__card-delete" :data-testid="`asset-card-delete-${card.id}`">
                  <GcConfirmAction
                    class="asset-page__card-icon-action"
                    trigger-variant="icon"
                    :trigger-aria-label="t('assets.aria.deleteCard', { name: card.name })"
                    :trigger-title="t('assets.actions.delete')"
                    :action-name="t('assets.actions.delete')"
                    :impact-count="1"
                    :risk-text="t('assets.actions.deleteRisk')"
                    :confirm-text="t('assets.actions.delete')"
                    @confirm="deleteAssetOverviewCard(card)"
                  >
                    <template #trigger-icon>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M8 7l1-2h6l1 2m-9 0 1 13h8l1-13" /></svg>
                      <span class="asset-page__icon-action-label">{{ t('assets.actions.delete') }}</span>
                    </template>
                  </GcConfirmAction>
                </span>
              </template>
            </GcCard>
          </div>

          <GcDataTable
            v-else
            class="asset-page__asset-table"
            :columns="assetListColumns"
            :rows="assetListRows"
            :ariaLabel="t('businessPage.resourceList', { resource: t('assets.resourceName') })"
          >
            <template #header-domain>
              <button class="asset-page__header-sort" type="button" @click="toggleAssetSort('domain')">
                {{ t('assets.columns.domain') }} {{ assetSortIndicator('domain') }}
              </button>
            </template>
            <template #header-port>
              <button class="asset-page__header-sort" type="button" @click="toggleAssetSort('port')">
                {{ t('assets.columns.port') }} {{ assetSortIndicator('port') }}
              </button>
            </template>
            <template #header-protocol>
              <button class="asset-page__header-sort" type="button" @click="toggleAssetSort('protocol')">
                {{ t('assets.columns.protocol') }} {{ assetSortIndicator('protocol') }}
              </button>
            </template>
            <template #header-device>
              <button class="asset-page__header-sort" type="button" @click="toggleAssetSort('device')">
                {{ t('assets.columns.device') }} {{ assetSortIndicator('device') }}
              </button>
            </template>
            <template #header-framework>
              <button class="asset-page__header-sort" type="button" @click="toggleAssetSort('framework')">
                {{ t('assets.columns.framework') }} {{ assetSortIndicator('framework') }}
              </button>
            </template>
            <template #header-site>
              <button class="asset-page__header-sort" type="button" @click="toggleAssetSort('site')">
                {{ t('assets.columns.site') }} {{ assetSortIndicator('site') }}
              </button>
            </template>
            <template #header-status>
              <button class="asset-page__header-sort" type="button" @click="toggleAssetSort('status')">
                {{ t('assets.columns.status') }} {{ assetSortIndicator('status') }}
              </button>
            </template>
            <template #cell-domain="{ row }">
              <div class="asset-page__table-domain">
                <input
                  :checked="isAssetSelected(row.id)"
                  class="asset-page__card-select"
                  type="checkbox"
                  :aria-label="t('assets.aria.selectCard', { name: row.domain })"
                  :data-testid="`asset-list-select-${row.id}`"
                  @change="toggleAssetSelection(row.id, ($event.target as HTMLInputElement).checked, row.card.asset)"
                >
                <button
                  class="asset-page__table-domain-button"
                  type="button"
                  :aria-label="t('assets.aria.detailCard', { name: row.domain })"
                  @click="openDetailModal(assetOverviewCardRow(row.card))"
                >
                  <strong>{{ row.domain }}</strong>
                  <span>{{ assetCardUrl(row.card.asset) }}</span>
                </button>
              </div>
            </template>
            <template #cell-status="{ row }">
              <GcStatusTag
                class="asset-page__card-certificate-state"
                :status="row.status"
                :label="assetCertificateStatusLabel(row.card)"
                :tone="assetCertificateStatusTone(row.card)"
              />
            </template>
            <template #cell-actions="{ row }">
              <div class="asset-page__table-actions">
                <GcPermissionButton
                  class="asset-page__card-icon-action"
                  permission="deployment.plan.execute"
                  :data-testid="`asset-list-deploy-${row.id}`"
                  :aria-label="t('assets.actions.deployCertificate')"
                  :title="t('assets.actions.deployCertificate')"
                  @click="openDeploymentDialog(assetOverviewCardRow(row.card))"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
                  <span class="asset-page__icon-action-label">{{ t('assets.actions.deployCertificate') }}</span>
                </GcPermissionButton>
                <GcPermissionButton
                  class="asset-page__card-icon-action"
                  permission="service_asset.read"
                  :data-testid="`asset-list-detail-${row.id}`"
                  :aria-label="t('assets.aria.detailCard', { name: row.domain })"
                  :title="t('assets.actions.detail')"
                  @click="openDetailModal(assetOverviewCardRow(row.card))"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8M8 13h5" /></svg>
                  <span class="asset-page__icon-action-label">{{ t('assets.actions.detail') }}</span>
                </GcPermissionButton>
                <GcPermissionButton
                  class="asset-page__card-icon-action"
                  permission="service_asset.manage"
                  :data-testid="`asset-list-edit-${row.id}`"
                  :aria-label="t('assets.aria.editCard', { name: row.domain })"
                  :title="t('assets.actions.edit')"
                  @click="openEditDialog(assetOverviewCardRow(row.card))"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4.8L8 20l11.2-11.2a2.8 2.8 0 0 0-4-4L4 16Zm9.8-8.8 3 3" /></svg>
                  <span class="asset-page__icon-action-label">{{ t('assets.actions.edit') }}</span>
                </GcPermissionButton>
                <span v-if="canManageAssets" class="asset-page__card-delete">
                  <GcConfirmAction
                    class="asset-page__card-icon-action"
                    trigger-variant="icon"
                    :trigger-aria-label="t('assets.aria.deleteCard', { name: row.domain })"
                    :trigger-title="t('assets.actions.delete')"
                    :action-name="t('assets.actions.delete')"
                    :impact-count="1"
                    :risk-text="t('assets.actions.deleteRisk')"
                    :confirm-text="t('assets.actions.delete')"
                    @confirm="deleteAssetOverviewCard(row.card)"
                  >
                    <template #trigger-icon>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M8 7l1-2h6l1 2m-9 0 1 13h8l1-13" /></svg>
                      <span class="asset-page__icon-action-label">{{ t('assets.actions.delete') }}</span>
                    </template>
                  </GcConfirmAction>
                </span>
              </div>
            </template>
          </GcDataTable>

          <GcPagination
            v-if="!assetOverviewLoading && !assetOverviewError"
            class="asset-page__pagination"
            :total="assetOverviewTotal"
            :page="assetOverviewPage"
            :page-size="assetOverviewPageSize"
            data-testid="asset-overview-pagination"
            @update:page="loadAssetOverviewPage"
            @update:page-size="changeAssetOverviewPageSize"
          />
        </section>
      </section>
    </template>

    <GcModal
      v-model:open="detailModalOpen"
      :title="t('assets.detail.title')"
      :description="t('assets.detail.description')"
      size="xxl"
    >
      <section v-if="selectedServiceAsset" class="asset-detail-modal">
        <header class="asset-detail-modal__hero">
          <div class="asset-detail-modal__hero-copy">
            <p class="asset-detail-modal__eyebrow">{{ t('assets.resourceName') }}</p>
            <h2>{{ selectedServiceAsset.name }}</h2>
            <span>
              {{ renderValue(selectedServiceAsset.raw.address ?? selectedServiceAsset.raw.displayName) }}
              / {{ renderValue(selectedServiceAsset.raw.protocol) }}
              / {{ renderValue(selectedServiceAsset.raw.port) }}
            </span>
          </div>
          <div class="asset-detail-modal__hero-side">
            <GcStatusTag :status="String(selectedServiceAsset.status)" />
            <div class="asset-detail-modal__spotlight">
              <small>{{ t('assets.columns.framework') }}</small>
              <strong>{{ renderValue(readNested(selectedAssetDetail ?? selectedServiceAsset.raw, ['targetBinding', 'frameworkType'])) }}</strong>
            </div>
          </div>
        </header>

        <GcTabs v-model="activeDetailTab" :tabs="detailTabs" :aria-label="t('assets.detail.tabsAriaLabel')" />

        <section v-if="activeDetailTab === 'overview'" class="asset-detail-modal__sections">
          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>{{ t('assets.linkage.title') }}</h3>
              <p>{{ t('assets.linkage.description') }}</p>
            </div>
            <div v-if="linkageStatus" class="asset-binding__detail">
              <div><dt>{{ t('assets.linkage.status') }}</dt><dd><GcStatusTag :status="String(linkageStatus.status ?? 'UNKNOWN')" /></dd></div>
              <div><dt>{{ t('assets.linkage.agent') }}</dt><dd>{{ renderValue(readNested(linkageStatus, ['agent', 'version'])) }}</dd></div>
              <div><dt>{{ t('assets.linkage.plugin') }}</dt><dd>{{ renderValue(readNested(linkageStatus, ['plugin', 'version'])) }}</dd></div>
              <div><dt>{{ t('assets.linkage.policy') }}</dt><dd>{{ renderValue(readNested(linkageStatus, ['policy', 'matchedIdentity'])) }}</dd></div>
            </div>
            <div class="asset-detail-modal__links">
              <GcButton v-if="Boolean(linkageStatus?.repairable)" :loading="linkageRepairing" @click="repairSelectedAssetLinkage">{{ t('assets.linkage.repair') }}</GcButton>
            </div>
          </article>

          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>{{ t('assets.detail.sections.overview.title') }}</h3>
              <p>{{ t('assets.detail.sections.overview.description') }}</p>
            </div>
            <dl class="asset-detail-modal__grid">
              <div class="asset-detail-modal__item" v-for="field in assetDetailFields" :key="field.label">
                <dt>{{ field.label }}</dt>
                <dd>{{ renderValue(detailFieldValue(field.candidates)) }}</dd>
              </div>
            </dl>
            <nav class="asset-detail-modal__links">
              <RouterLink
                v-for="link in assetContextLinks"
                :key="link.label"
                class="gc-button"
                :to="{ path: link.to, query: { [link.queryKey]: String(selectedServiceAsset.raw.id ?? '') } }"
              >
                {{ link.label }}
              </RouterLink>
            </nav>
          </article>

          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>{{ t('assets.detail.sections.targetBinding.title') }}</h3>
              <p>{{ t('assets.detail.sections.targetBinding.description') }}</p>
            </div>
            <p v-if="detailLoading" class="asset-summary__loading">{{ t('assets.detail.loadingTargetBinding') }}</p>
            <p v-else-if="detailError" class="asset-summary__error">{{ detailError }}</p>
            <dl v-else-if="selectedAssetDetail" class="asset-binding__detail">
              <div>
                <dt>{{ t('assets.fields.frameworkType') }}</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBinding', 'frameworkType'])) }}</dd>
              </div>
              <div>
                <dt>{{ t('assets.columns.site') }}</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'siteName'])) }}</dd>
              </div>
              <div>
                <dt>{{ t('assets.fields.managedTarget') }}</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'managedTarget', 'targetType'])) }}</dd>
              </div>
              <div>
                <dt>{{ t('assets.fields.bindingInformation') }}</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'bindingInformation'])) }}</dd>
              </div>
              <div>
                <dt>{{ t('assets.fields.hostHeader') }}</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'hostHeader'])) }}</dd>
              </div>
              <div>
                <dt>{{ t('assets.fields.port') }}</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'port'])) }}</dd>
              </div>
            </dl>
          </article>

          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>{{ t('assets.detail.sections.certificateBindings.title') }}</h3>
              <p>{{ t('assets.detail.sections.certificateBindings.description') }}</p>
            </div>
            <p v-if="!bindingRelations.length" class="asset-summary__loading">{{ t('assets.detail.emptyCertificateBindings') }}</p>
            <ul v-else class="asset-binding-relations">
              <li v-for="binding in bindingRelations" :key="String(binding.id ?? '')" class="asset-binding-relations__item">
                <div class="asset-binding-relations__grid">
                  <div>
                    <span>{{ t('assets.fields.bindingKey') }}</span>
                    <strong>{{ renderValue(binding.bindingKey) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.domain') }}</span>
                    <strong>{{ renderValue(binding.domainName ?? binding.domain) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.currentCertificate') }}</span>
                    <strong>{{ certificateBindingCurrentLabel(binding) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.targetCertificate') }}</span>
                    <strong>{{ certificateVersionLabel(String(binding.targetCertificateVersionId ?? binding.certificateVersionId ?? '')) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.expectedFingerprint') }}</span>
                    <strong>{{ renderValue(binding.desiredFingerprintSha256 ?? binding.targetFingerprintSha256) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.certificateStore') }}</span>
                    <strong>{{ renderValue(binding.storeThumbprint) }}</strong>
                  </div>
                </div>
              </li>
            </ul>
          </article>

          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>{{ t('assets.deployment.title') }}</h3>
              <p>{{ t('assets.deployment.description') }}</p>
            </div>
            <div class="asset-deployment__actions">
              <GcPermissionButton
                class="gc-button gc-button--primary"
                permission="deployment.plan.execute"
                @click="openDeploymentDialog()"
              >
                {{ t('assets.actions.deployCertificate') }}
              </GcPermissionButton>
            </div>
            <p v-if="deploymentRecordsLoading" class="asset-summary__loading">{{ t('assets.deployment.loadingRecords') }}</p>
            <p v-else-if="deploymentRecordsError" class="asset-summary__error">{{ deploymentRecordsError }}</p>
            <p v-else-if="!deploymentRecordsForDisplay.length" class="asset-summary__loading">{{ t('assets.deployment.emptyRecords') }}</p>
            <ul v-else class="asset-binding-relations">
              <li v-for="record in deploymentRecordsForDisplay" :key="String(record.id ?? '')" class="asset-binding-relations__item">
                <div class="asset-binding-relations__grid">
                  <div>
                    <span>{{ t('assets.deployment.fields.status') }}</span>
                    <GcStatusTag :status="String(record.status ?? 'UNKNOWN')" />
                  </div>
                  <div>
                    <span>{{ t('assets.deployment.fields.approval') }}</span>
                    <GcStatusTag :status="deploymentRecordApprovalStatus(record)" />
                  </div>
                  <div>
                    <span>{{ t('assets.deployment.fields.latestRun') }}</span>
                    <strong>{{ deploymentRecordRunType(record) || t('common.notAvailable') }} / {{ deploymentRecordRunStatus(record) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.deployment.fields.preflight') }}</span>
                    <strong>{{ record.latestPreflight ? t('assets.deployment.preflightAvailable', { count: deploymentRecordPreflightCheckCount(record) }) : t('assets.deployment.preflightUnavailable') }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.deployment.fields.rollback') }}</span>
                    <strong>{{ record.latestRollback ? deploymentRecordRunStatus({ latestRun: record.latestRollback }) : t('assets.deployment.rollbackUnavailable') }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.deployment.fields.updatedAt') }}</span>
                    <strong>{{ deploymentRecordTime(record) }}</strong>
                  </div>
                </div>
              </li>
            </ul>
          </article>
        </section>

        <section v-else class="asset-detail-modal__sections">
          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>{{ t('assets.detail.sections.snapshots.title') }}</h3>
              <p>{{ t('assets.detail.sections.snapshots.description') }}</p>
            </div>
            <p v-if="snapshotLoading" class="asset-summary__loading">{{ t('assets.detail.loadingSnapshots') }}</p>
            <p v-else-if="snapshotError" class="asset-summary__error">{{ snapshotError }}</p>
            <ul v-else-if="snapshotItems.length" class="asset-binding-relations">
              <li v-for="snapshot in snapshotItems" :key="String(snapshot.id ?? '')" class="asset-binding-relations__item">
                <div class="asset-binding-relations__grid">
                  <div>
                    <span>{{ t('assets.fields.snapshotType') }}</span>
                    <strong>{{ snapshotTypeLabel(snapshot.snapshotType) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.columns.status') }}</span>
                    <GcStatusTag :status="String(snapshot.status ?? 'UNKNOWN')" />
                  </div>
                  <div>
                    <span>{{ t('assets.fields.time') }}</span>
                    <strong>{{ renderValue(snapshot.capturedAt ?? snapshot.createdAt) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.certificateStore') }}</span>
                    <strong>{{ renderValue(snapshot.storeThumbprint) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.bindingInformation') }}</span>
                    <strong>{{ renderValue(snapshot.bindingInformation) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.executionRun') }}</span>
                    <strong>{{ renderValue(snapshot.executionRunId) }}</strong>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="asset-summary__loading">{{ t('assets.detail.emptySnapshots') }}</p>
            <div class="asset-deployment__actions">
              <p v-if="rollbackError" class="asset-summary__error">{{ rollbackError }}</p>
              <p v-else-if="rollbackRequestId" class="asset-form__request">{{ t('assets.detail.rollbackSubmitted') }}</p>
              <button class="gc-button" type="button" :disabled="!canRollbackFromSnapshot" @click="rollbackFromLatestSnapshot">
                {{ rollbackSubmitting ? t('assets.actions.rollingBack') : t('assets.actions.rollbackFromLatestSnapshot') }}
              </button>
            </div>
          </article>
        </section>
      </section>
    </GcModal>

    <GcModal
      v-model:open="deploymentDialogOpen"
      :title="deploymentDialogTitle"
      :description="deploymentDialogDescription"
      size="lg"
      width="min(100%, var(--gc-size-modal-lg))"
      :busy="deploymentLoading"
      :error="deploymentError"
      :show-error-details="deploymentErrorIssues.length > 0"
    >
      <template #error-details>
        <section v-if="deploymentErrorIssues.length" class="asset-deployment__error-details">
          <h3>{{ t('deploymentInputs.issues.title') }}</h3>
          <ul>
            <li v-for="(issue, index) in deploymentErrorIssues" :key="`${issue.code ?? 'unknown'}:${issue.path ?? issue.slot ?? 'unknown'}:${index}`">
              <strong>{{ deploymentInputIssueLabel(issue) }}</strong>
              <code>{{ deploymentInputIssuePath(issue) }}</code>
              <span v-if="issue.bindingLayer">{{ issue.bindingLayer }}</span>
            </li>
          </ul>
          <p>{{ t('deploymentPlans.errors.inputIssuesHint') }}</p>
        </section>
      </template>
      <GcCertificateDeploymentForm
        :application-asset="deploymentApplicationAsset"
        :site-name="deploymentSiteName"
        :certificate="deploymentCertificate"
        :certificates="deploymentCertificateItems"
        :certificate-versions="deploymentCertificateVersions"
        :preflight-checks="deploymentDryRunChecks"
        :loading="deploymentLoading"
        :submit-label="deploymentSubmitLabel"
        @submit="deployCertificateVersion"
        @cancel="closeDeploymentDialog"
      />
    </GcModal>

    <GcModal
      v-model:open="createDialogOpen"
      :title="isEditMode ? t('assets.form.editTitle') : t('assets.form.createTitle')"
      :description="isUserViewMode ? undefined : (isEditMode ? t('assets.form.editDescription') : t('assets.form.createDescription'))"
      size="xxl"
      width="min(100%, var(--gc-size-modal-wide))"
    >
      <section v-if="isUserViewMode" class="asset-form asset-user-form gc-native-select-surface">
        <header class="asset-user-form__header">
          <h3>{{ isEditMode ? t('assets.form.editTitle') : t('assets.userView.form.title') }}</h3>
          <GcHelpTip
            :content="t('assets.userView.form.description')"
            :ariaLabel="t('assets.userView.form.title')"
          />
        </header>

        <div class="asset-form__grid">
          <label class="asset-form__field">
            <span>{{ t('assets.fields.domain') }} <strong>*</strong></span>
            <input v-model="assetDraft.address" data-testid="asset-address-input" :placeholder="t('assets.form.placeholders.hostHeader')" autocomplete="off" />
          </label>
          <label class="asset-form__field">
            <span>{{ t('assets.fields.displayName') }}</span>
            <input v-model="assetDraft.displayName" :placeholder="t('assets.form.placeholders.displayName')" autocomplete="off" />
          </label>
          <label class="asset-form__field">
            <span>{{ t('assets.fields.port') }} <strong>*</strong></span>
            <input v-model="assetDraft.port" data-testid="asset-port-input" inputmode="numeric" autocomplete="off" />
          </label>
          <label class="asset-form__field">
            <span>{{ t('assets.fields.protocol') }} <strong>*</strong></span>
            <select v-model="assetDraft.protocol">
              <option value="HTTPS">HTTPS</option>
              <option value="TLS">TLS</option>
              <option value="STARTTLS">STARTTLS</option>
            </select>
          </label>
          <label class="asset-form__field asset-form__field--wide">
            <span>{{ t('assets.fields.platform') }} <strong>*</strong></span>
            <select v-model="assetDraft.platform">
              <option v-for="option in assetPlatformOptions" :key="option.value" :value="option.value">
                {{ t(option.labelKey) }}
              </option>
            </select>
          </label>
        </div>
        <label class="asset-form__approval-option">
          <input
            v-model="assetDraft.approvalRequired"
            type="checkbox"
            :aria-label="t('assets.fields.approvalRequired')"
          />
          <span>
            <strong>{{ t('assets.fields.approvalRequired') }}</strong>
            <small>{{ t('assets.form.approvalRequiredHint') }}</small>
          </span>
        </label>

        <section class="asset-certificate-supply" :aria-label="t('assets.certificateSupply.title')">
          <header class="asset-certificate-supply__header">
            <div>
              <h4>{{ t('assets.certificateSupply.title') }}</h4>
              <p>{{ t('assets.certificateSupply.description') }}</p>
            </div>
            <span v-if="certificateSupplyLoading" class="asset-form__hint">{{ t('common.loading') }}</span>
          </header>
          <div class="asset-certificate-supply__mode" role="group" :aria-label="t('assets.certificateSupply.modeLabel')">
            <label>
              <input v-model="certificateSupplyDraft.supplyMode" type="radio" value="manual">
              <span>{{ t('assets.certificateSupply.manual') }}</span>
            </label>
            <label>
              <input v-model="certificateSupplyDraft.supplyMode" type="radio" value="dedicated">
              <span>{{ t('assets.certificateSupply.dedicated') }}</span>
            </label>
          </div>
          <div v-if="certificateSupplyDraft.supplyMode === 'manual'" class="asset-form__grid">
            <label class="asset-form__field asset-form__field--wide">
              <span>{{ t('assets.certificateSupply.certificateVersion') }}</span>
              <select v-model="certificateSupplyDraft.certificateVersionId" @change="selectCertificateSupplyCandidate(certificateSupplyDraft.certificateVersionId)">
                <option value="">{{ t('assets.certificateSupply.selectCertificate') }}</option>
                <option v-for="candidate in certificateSupplyCandidates" :key="String(candidate.certificateVersionId ?? candidate.certificateAssetId)" :value="String(candidate.certificateVersionId ?? '')">
                  {{ String(candidate.name ?? candidate.primaryDomain ?? candidate.certificateAssetId) }} · {{ candidate.versionNo ? `v${String(candidate.versionNo)}` : String(candidate.certificateVersionId ?? t('common.notAvailable')) }}
                </option>
              </select>
              <small>{{ t('assets.certificateSupply.domainMatch', { domain: certificateSupplyData?.primaryDomain ?? assetDraft.address }) }}</small>
            </label>
          </div>
          <div v-else class="asset-form__grid">
            <label class="asset-form__field">
              <span>{{ t('assets.certificateSupply.provider') }}</span>
              <select v-model="certificateSupplyDraft.providerType">
                <option value="internal_ca">{{ t('assets.certificateSupply.internalCa') }}</option>
                <option value="acme">{{ t('assets.certificateSupply.acme') }}</option>
              </select>
            </label>
            <label v-if="certificateSupplyDraft.providerType === 'internal_ca'" class="asset-form__field">
              <span>{{ t('assets.certificateSupply.ca') }}</span>
              <select v-model="certificateSupplyDraft.certificateAuthorityId">
                <option value="">{{ t('assets.certificateSupply.selectCa') }}</option>
                <option v-for="authority in certificateSupplyProviders.authorities ?? []" :key="String(authority.id)" :value="String(authority.id)">{{ String(authority.name ?? authority.id) }}</option>
              </select>
            </label>
            <label v-if="certificateSupplyDraft.providerType === 'internal_ca'" class="asset-form__field">
              <span>{{ t('assets.certificateSupply.profile') }}</span>
              <select v-model="certificateSupplyDraft.certificateProfileVersionId">
                <option value="">{{ t('assets.certificateSupply.selectProfile') }}</option>
                <option v-for="version in certificateSupplyProfileVersions" :key="version.id" :value="version.id">{{ version.label }}</option>
              </select>
            </label>
            <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field">
              <span>{{ t('assets.certificateSupply.acmeProvider') }}</span>
              <select v-model="certificateSupplyDraft.providerId">
                <option value="">{{ t('assets.certificateSupply.selectProvider') }}</option>
                <option v-for="provider in certificateSupplyProviders.acme ?? []" :key="String(provider.id)" :value="String(provider.id)">{{ String(provider.name ?? provider.id) }}</option>
              </select>
            </label>
            <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field">
              <span>{{ t('assets.certificateSupply.acmeProfile') }}</span>
              <select v-model="certificateSupplyDraft.acmeProviderProfileId">
                <option value="">{{ t('assets.certificateSupply.selectAcmeProfile') }}</option>
                <option v-for="profile in certificateSupplyProviders.acmeProviderProfiles ?? []" :key="String(profile.id)" :value="String(profile.id)">{{ String(profile.name ?? profile.id) }}</option>
              </select>
            </label>
            <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field">
              <span>{{ t('assets.certificateSupply.dnsProvider') }}</span>
              <select v-model="certificateSupplyDraft.dnsProviderId">
                <option value="">{{ t('assets.certificateSupply.selectDnsProvider') }}</option>
                <option v-for="provider in certificateSupplyProviders.dns ?? []" :key="String(provider.id)" :value="String(provider.id)">{{ String(provider.name ?? provider.id) }}</option>
              </select>
            </label>
            <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field">
              <span>{{ t('assets.certificateSupply.secretRef') }}</span>
              <input v-model="certificateSupplyDraft.credentialRef" :placeholder="t('assets.certificateSupply.secretRefPlaceholder')" autocomplete="off">
            </label>
          </div>
          <div class="asset-certificate-supply__facts">
            <div><span>{{ t('assets.certificateSupply.custodyMode') }}</span><strong>{{ certificateSupplyCapability.custodyMode ?? t('common.notAvailable') }}</strong></div>
            <div><span>{{ t('assets.certificateSupply.artifactMode') }}</span><strong>{{ certificateSupplyCapability.deploymentArtifactMode ?? t('common.notAvailable') }}</strong></div>
            <div><span>{{ t('assets.certificateSupply.canSave') }}</span><strong>{{ certificateSupplyReadiness.canSave === false ? t('common.no') : t('common.yes') }}</strong></div>
            <div><span>{{ t('assets.certificateSupply.canIssue') }}</span><strong>{{ certificateSupplyReadiness.canIssue ? t('common.yes') : t('common.no') }}</strong></div>
            <div><span>{{ t('assets.certificateSupply.canDeploy') }}</span><strong>{{ certificateSupplyReadiness.canDeploy ? t('common.yes') : t('common.no') }}</strong></div>
            <div v-if="certificateSupplyData?.currentVersion"><span>{{ t('assets.certificateSupply.lifecycle') }}</span><strong>{{ String(certificateSupplyData.currentVersion.status ?? t('common.notAvailable')) }}</strong></div>
          </div>
          <p v-if="certificateSupplyReadiness.reasons?.length" class="asset-form__hint">{{ certificateSupplyReadiness.reasons.join(', ') }}</p>
          <p v-if="certificateSupplyError" class="asset-form__error">{{ certificateSupplyError }}</p>
        </section>

        <section class="asset-user-form__location">
          <header>
            <h4>{{ t('assets.userView.form.locationTitle') }}</h4>
            <GcHelpTip
              :content="t('assets.userView.form.locationDescription')"
              :ariaLabel="t('assets.userView.form.locationTitle')"
            />
          </header>
          <GcManagedTargetSelector
            v-model:device-id="assetDraft.deviceId"
            v-model:framework-instance-id="assetDraft.frameworkInstanceId"
            v-model:site-id="assetDraft.siteAssetId"
            v-model:managed-target-id="assetDraft.managedTargetId"
            :devices="deviceItems"
            :frameworks="serviceInstanceItems"
            :sites="filteredSiteItems"
            :managed-targets="managedTargetItems"
            :device-loading="deviceListLoading"
            :framework-loading="serviceInstanceListLoading"
            :site-loading="siteListLoading"
            :managed-target-loading="managedTargetListLoading"
            :labels="{ device: t('assets.userView.form.device'), framework: t('assets.userView.form.service'), site: t('assets.userView.form.site'), managedTarget: t('assets.userView.form.target') }"
            :placeholders="{ select: t('assets.select.generic'), loading: t('common.loading'), rediscovery: t('assets.errors.managedTargetRediscoveryRequired') }"
          />
          <label v-if="showAgentCertificateFormatSelector" class="asset-form__field">
            <span>{{ t('assets.userView.form.certificateFormat') }} <strong>*</strong></span>
            <select v-model="assetDraft.agentCertificateFormatId" :disabled="certificateFormatLoading">
              <option value="">{{ certificateFormatLoading ? t('assets.loading.certificateFormats') : t('assets.select.certificateFormat') }}</option>
              <option v-for="format in agentCertificateFormatOptions" :key="String(format.id)" :value="String(format.id)">
                {{ workflowCertificateFormatLabel(format) }}
              </option>
            </select>
          </label>
        </section>

        <section v-if="pluginProjectionVersionId" class="asset-user-form__inputs">
          <p v-show="workflowProjectionError" class="asset-form__error">{{ workflowProjectionError }}</p>
          <DeploymentInputForm
            v-if="workflowBindingProjection"
            v-model="deploymentInputBindings"
            :projection="workflowBindingProjection"
            :credential-options="deploymentCredentialOptions"
            :artifact-options="deploymentArtifactOptions"
            :loading="workflowProjectionLoading && !workflowProjectionRefreshing"
          />
        </section>

        <p v-if="siteListError" class="asset-form__error">{{ siteListError }}</p>
        <p v-if="certificateFormatError" class="asset-form__error">{{ certificateFormatError }}</p>
        <p v-if="createError" class="asset-form__error">{{ createError }}</p>
      </section>

      <section v-else class="asset-form asset-wizard">
        <div class="asset-wizard__progress">
          <GcProgressBar
            :value="assetWizardStep"
            :max="3"
            tone="info"
            :ariaLabel="t('assets.wizard.ariaLabel')"
          />
          <ol class="asset-wizard__steps" :aria-label="t('assets.wizard.ariaLabel')">
            <li class="asset-wizard__step" :class="`is-${assetWizardStepState(1)}`">
              <button type="button" class="asset-wizard__step-button" @click="goToAssetStep(1)">
                <span class="asset-wizard__step-index">1</span>
                <span>
                  <strong>{{ t('assets.wizard.steps.basicEntry') }}</strong>
                  <small>{{ assetWizardStepStateLabel(1) }}</small>
                </span>
              </button>
            </li>
            <li class="asset-wizard__step" :class="`is-${assetWizardStepState(2)}`">
              <button type="button" class="asset-wizard__step-button" :disabled="currentAvailableStep < 2" @click="goToAssetStep(2)">
                <span class="asset-wizard__step-index">2</span>
                <span>
                  <strong>{{ t('assets.wizard.steps.deploymentMode') }}</strong>
                  <small>{{ assetWizardStepStateLabel(2) }}</small>
                </span>
              </button>
            </li>
            <li class="asset-wizard__step" :class="`is-${assetWizardStepState(3)}`">
              <button type="button" class="asset-wizard__step-button" :disabled="currentAvailableStep < 3" @click="goToAssetStep(3)">
                <span class="asset-wizard__step-index">3</span>
                <span>
                  <strong>{{ t('assets.wizard.steps.confirmSave') }}</strong>
                  <small>{{ assetWizardStepStateLabel(3) }}</small>
                </span>
              </button>
            </li>
          </ol>
        </div>

        <section v-if="assetWizardStep === 1" class="asset-wizard__panel gc-native-select-surface">
          <header class="asset-wizard__panel-header">
            <div>
              <h3>{{ t('assets.wizard.panels.basicEntryTitle') }}</h3>
              <p>{{ t('assets.wizard.panels.basicEntryDescription') }}</p>
            </div>
            <span class="asset-wizard__panel-state" :class="commonStepReady ? 'is-done' : 'is-active'">
              {{ commonStepReady ? t('assets.wizard.stepState.readyNext') : t('assets.wizard.stepState.incomplete') }}
            </span>
          </header>

          <div class="asset-wizard__mode-grid">
            <button
              type="button"
              class="asset-wizard__mode-card"
              :class="{ 'is-selected': assetDraft.managementMode === 'MANAGED_TARGET' }"
              @click="assetDraft.managementMode = 'MANAGED_TARGET'"
            >
              <span>{{ t('devices.deployment.managedTarget') }}</span>
              <strong>{{ t('devices.deployment.managedTargetDescription') }}</strong>
            </button>
            <button
              type="button"
              class="asset-wizard__mode-card"
              :class="{ 'is-selected': assetDraft.managementMode === 'WORKFLOW' }"
              @click="assetDraft.managementMode = 'WORKFLOW'"
            >
              <span>{{ t('devices.deployment.independentWorkflow') }}</span>
              <strong>{{ t('devices.deployment.independentWorkflowDescription') }}</strong>
            </button>
          </div>

          <div class="asset-form__grid">
            <label class="asset-form__field">
              <span>{{ t('assets.fields.domain') }} <strong>*</strong></span>
              <input v-model="assetDraft.address" data-testid="asset-address-input" :placeholder="t('assets.form.placeholders.hostHeader')" autocomplete="off" />
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.displayName') }}</span>
              <input v-model="assetDraft.displayName" :placeholder="t('assets.form.placeholders.displayName')" autocomplete="off" />
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.port') }} <strong>*</strong></span>
              <input v-model="assetDraft.port" data-testid="asset-port-input" inputmode="numeric" autocomplete="off" />
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.protocol') }} <strong>*</strong></span>
              <select v-model="assetDraft.protocol">
                <option value="HTTPS">HTTPS</option>
                <option value="HTTP">HTTP</option>
                <option value="TLS">TLS</option>
                <option value="STARTTLS">STARTTLS</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.verifyUrl') }}</span>
              <input
                v-model="assetDraft.verifyUrl"
                :placeholder="t('assets.form.placeholders.verifyUrl')"
                autocomplete="off"
              />
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.platform') }} <strong>*</strong></span>
              <select v-model="assetDraft.platform">
                <option v-for="option in assetPlatformOptions" :key="option.value" :value="option.value">
                  {{ t(option.labelKey) }}
                </option>
              </select>
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.environment') }}</span>
              <input v-model="assetDraft.environment" placeholder="prod / staging" autocomplete="off" />
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.tags') }}</span>
              <input v-model="assetDraft.tagsText" placeholder="core, public, ssl" autocomplete="off" />
            </label>
          </div>
          <label class="asset-form__approval-option">
            <input
              v-model="assetDraft.approvalRequired"
              type="checkbox"
              :aria-label="t('assets.fields.approvalRequired')"
            />
            <span>
              <strong>{{ t('assets.fields.approvalRequired') }}</strong>
              <small>{{ t('assets.form.approvalRequiredHint') }}</small>
            </span>
          </label>
          <section class="asset-certificate-supply" :aria-label="t('assets.certificateSupply.title')">
            <header class="asset-certificate-supply__header">
              <div><h4>{{ t('assets.certificateSupply.title') }}</h4><p>{{ t('assets.certificateSupply.description') }}</p></div>
              <span v-if="certificateSupplyLoading" class="asset-form__hint">{{ t('common.loading') }}</span>
            </header>
            <div class="asset-certificate-supply__mode" role="group" :aria-label="t('assets.certificateSupply.modeLabel')">
              <label><input v-model="certificateSupplyDraft.supplyMode" type="radio" value="manual"><span>{{ t('assets.certificateSupply.manual') }}</span></label>
              <label><input v-model="certificateSupplyDraft.supplyMode" type="radio" value="dedicated"><span>{{ t('assets.certificateSupply.dedicated') }}</span></label>
            </div>
            <div v-if="certificateSupplyDraft.supplyMode === 'manual'" class="asset-form__grid">
              <label class="asset-form__field asset-form__field--wide">
                <span>{{ t('assets.certificateSupply.certificateVersion') }}</span>
                <select v-model="certificateSupplyDraft.certificateVersionId" @change="selectCertificateSupplyCandidate(certificateSupplyDraft.certificateVersionId)">
                  <option value="">{{ t('assets.certificateSupply.selectCertificate') }}</option>
                  <option v-for="candidate in certificateSupplyCandidates" :key="String(candidate.certificateVersionId ?? candidate.certificateAssetId)" :value="String(candidate.certificateVersionId ?? '')">{{ String(candidate.name ?? candidate.primaryDomain ?? candidate.certificateAssetId) }} · {{ candidate.versionNo ? `v${String(candidate.versionNo)}` : String(candidate.certificateVersionId ?? t('common.notAvailable')) }}</option>
                </select>
                <small>{{ t('assets.certificateSupply.domainMatch', { domain: certificateSupplyData?.primaryDomain ?? assetDraft.address }) }}</small>
              </label>
            </div>
            <div v-else class="asset-form__grid">
              <label class="asset-form__field"><span>{{ t('assets.certificateSupply.provider') }}</span><select v-model="certificateSupplyDraft.providerType"><option value="internal_ca">{{ t('assets.certificateSupply.internalCa') }}</option><option value="acme">{{ t('assets.certificateSupply.acme') }}</option></select></label>
              <label v-if="certificateSupplyDraft.providerType === 'internal_ca'" class="asset-form__field"><span>{{ t('assets.certificateSupply.ca') }}</span><select v-model="certificateSupplyDraft.certificateAuthorityId"><option value="">{{ t('assets.certificateSupply.selectCa') }}</option><option v-for="authority in certificateSupplyProviders.authorities ?? []" :key="String(authority.id)" :value="String(authority.id)">{{ String(authority.name ?? authority.id) }}</option></select></label>
              <label v-if="certificateSupplyDraft.providerType === 'internal_ca'" class="asset-form__field"><span>{{ t('assets.certificateSupply.profile') }}</span><select v-model="certificateSupplyDraft.certificateProfileVersionId"><option value="">{{ t('assets.certificateSupply.selectProfile') }}</option><option v-for="version in certificateSupplyProfileVersions" :key="version.id" :value="version.id">{{ version.label }}</option></select></label>
              <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field"><span>{{ t('assets.certificateSupply.acmeProvider') }}</span><select v-model="certificateSupplyDraft.providerId"><option value="">{{ t('assets.certificateSupply.selectProvider') }}</option><option v-for="provider in certificateSupplyProviders.acme ?? []" :key="String(provider.id)" :value="String(provider.id)">{{ String(provider.name ?? provider.id) }}</option></select></label>
              <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field"><span>{{ t('assets.certificateSupply.acmeProfile') }}</span><select v-model="certificateSupplyDraft.acmeProviderProfileId"><option value="">{{ t('assets.certificateSupply.selectAcmeProfile') }}</option><option v-for="profile in certificateSupplyProviders.acmeProviderProfiles ?? []" :key="String(profile.id)" :value="String(profile.id)">{{ String(profile.name ?? profile.id) }}</option></select></label>
              <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field"><span>{{ t('assets.certificateSupply.dnsProvider') }}</span><select v-model="certificateSupplyDraft.dnsProviderId"><option value="">{{ t('assets.certificateSupply.selectDnsProvider') }}</option><option v-for="provider in certificateSupplyProviders.dns ?? []" :key="String(provider.id)" :value="String(provider.id)">{{ String(provider.name ?? provider.id) }}</option></select></label>
              <label v-if="certificateSupplyDraft.providerType === 'acme'" class="asset-form__field"><span>{{ t('assets.certificateSupply.secretRef') }}</span><input v-model="certificateSupplyDraft.credentialRef" :placeholder="t('assets.certificateSupply.secretRefPlaceholder')" autocomplete="off"></label>
            </div>
            <div class="asset-certificate-supply__facts"><div><span>{{ t('assets.certificateSupply.custodyMode') }}</span><strong>{{ certificateSupplyCapability.custodyMode ?? t('common.notAvailable') }}</strong></div><div><span>{{ t('assets.certificateSupply.artifactMode') }}</span><strong>{{ certificateSupplyCapability.deploymentArtifactMode ?? t('common.notAvailable') }}</strong></div><div><span>{{ t('assets.certificateSupply.canSave') }}</span><strong>{{ certificateSupplyReadiness.canSave === false ? t('common.no') : t('common.yes') }}</strong></div><div><span>{{ t('assets.certificateSupply.canIssue') }}</span><strong>{{ certificateSupplyReadiness.canIssue ? t('common.yes') : t('common.no') }}</strong></div><div><span>{{ t('assets.certificateSupply.canDeploy') }}</span><strong>{{ certificateSupplyReadiness.canDeploy ? t('common.yes') : t('common.no') }}</strong></div><div v-if="certificateSupplyData?.currentVersion"><span>{{ t('assets.certificateSupply.lifecycle') }}</span><strong>{{ String(certificateSupplyData.currentVersion.status ?? t('common.notAvailable')) }}</strong></div></div>
            <p v-if="certificateSupplyReadiness.reasons?.length" class="asset-form__hint">{{ certificateSupplyReadiness.reasons.join(', ') }}</p>
            <p v-if="certificateSupplyError" class="asset-form__error">{{ certificateSupplyError }}</p>
          </section>
        </section>

        <section v-else-if="assetWizardStep === 2" class="asset-wizard__panel gc-native-select-surface">
          <header class="asset-wizard__panel-header">
            <div>
              <h3>{{ assetDraft.managementMode === 'WORKFLOW' ? t('assets.wizard.panels.workflowTitle') : t('devices.deployment.managedTargetTitle') }}</h3>
              <p v-if="assetDraft.managementMode === 'MANAGED_TARGET'">{{ t('devices.deployment.managedTargetPanelDescription') }}</p>
            </div>
            <span class="asset-wizard__panel-state" :class="modeStepReady ? 'is-done' : 'is-active'">
              {{ modeStepReady ? t('assets.wizard.stepState.readyNext') : t('assets.wizard.stepState.incomplete') }}
            </span>
          </header>

          <template v-if="assetDraft.managementMode === 'MANAGED_TARGET'">
            <GcManagedTargetSelector
              v-model:device-id="assetDraft.deviceId"
              v-model:framework-instance-id="assetDraft.frameworkInstanceId"
              v-model:site-id="assetDraft.siteAssetId"
              v-model:managed-target-id="assetDraft.managedTargetId"
              :devices="deviceItems"
              :frameworks="serviceInstanceItems"
              :sites="filteredSiteItems"
              :managed-targets="managedTargetItems"
              :device-loading="deviceListLoading"
              :framework-loading="serviceInstanceListLoading"
              :site-loading="siteListLoading"
              :managed-target-loading="managedTargetListLoading"
              :labels="{ device: t('devices.columns.name'), framework: t('assets.fields.frameworkType'), site: t('assets.fields.siteInstance'), managedTarget: t('assets.fields.managedTarget') }"
              :placeholders="{ select: t('assets.select.generic'), loading: t('common.loading'), rediscovery: t('assets.errors.managedTargetRediscoveryRequired') }"
            />
            <div class="asset-form__grid">
              <label v-if="showAgentCertificateFormatSelector" class="asset-form__field">
                <span>{{ t('assets.fields.certificateFormat') }} <strong>*</strong></span>
                <select v-model="assetDraft.agentCertificateFormatId" :disabled="certificateFormatLoading">
                  <option value="">{{ certificateFormatLoading ? t('assets.loading.certificateFormats') : t('assets.select.certificateFormat') }}</option>
                  <option v-for="format in agentCertificateFormatOptions" :key="String(format.id)" :value="String(format.id)">
                    {{ workflowCertificateFormatLabel(format) }}
                  </option>
                </select>
                <small>{{ t('assets.form.agentCertificateFormatHint') }}</small>
              </label>
            </div>
            <GcExecutionModeSelector
              v-model="assetDraft.managedExecutionMode"
              :label="t('assets.executionModes.label')"
              :options="managedExecutionModeOptions"
            />
            <template v-if="assetDraft.managedExecutionMode === 'PLUGIN'">
              <GcCompatiblePluginSelector
                v-model="assetDraft.pluginOverrideVersionId"
                :items="compatibleManagedPlugins"
                :loading="compatibleManagedPluginsLoading"
                :required="!pluginFallbackCapability"
                :label="t('assets.fields.updatePlugin')"
                :select-text="pluginFallbackCapability ? t('assets.select.updatePluginOptional') : t('assets.select.generic')"
                :loading-text="t('common.loading')"
                :empty-text="t('assets.errors.noCompatibleManagedPlugin')"
              />
              <GcEffectiveCapabilityCard
                :capability="effectiveCapability"
                :pending-capability="pendingPluginCapability"
                :loading="effectiveCapabilityLoading"
                :labels="{ loading: t('common.loading'), missing: t('assets.errors.capabilityAssignmentMissing'), pending: t('assets.capability.pendingAssignment'), source: t('assets.capability.source'), plugin: t('assets.capability.plugin'), runtime: t('assets.capability.runtime'), executionLocation: t('assets.capability.executionLocation') }"
              />
              <section v-if="pluginProjectionVersionId" class="asset-form__field--wide">
                <p v-show="workflowProjectionError" class="asset-form__error">{{ workflowProjectionError }}</p>
                <DeploymentInputForm
                  v-if="workflowBindingProjection"
                  v-model="deploymentInputBindings"
                  :projection="workflowBindingProjection"
                  :credential-options="deploymentCredentialOptions"
                  :artifact-options="deploymentArtifactOptions"
                  :loading="workflowProjectionLoading && !workflowProjectionRefreshing"
                />
              </section>
            </template>
            <p v-else class="asset-form__hint">{{ t('assets.executionModes.workflowOverride.notice') }}</p>
            <div class="asset-form__binding-summary">
              <div>
                <span>{{ t('assets.fields.bindingInformation') }}</span>
                <strong>{{ renderValue(currentBindingSummary.bindingInformation) }}</strong>
              </div>
              <div>
                <span>{{ t('assets.fields.hostHeader') }}</span>
                <strong>{{ renderValue(currentBindingSummary.hostHeader) }}</strong>
              </div>
              <div>
                <span>{{ t('assets.fields.port') }}</span>
                <strong>{{ renderValue(currentBindingSummary.port) }}</strong>
              </div>
            </div>
          </template>

          <template v-if="workflowExecutionEnabled">
            <div class="asset-form__grid">
              <GcWorkflowExecutionForm
                v-model:workflow-id="assetDraft.workflowId"
                v-model:runner="assetDraft.workflowRunner"
                v-model:gateway-id="assetDraft.workflowGatewayId"
                class="asset-form__field--wide"
                :workflows="workflowItems"
                :gateways="gatewayItems"
                :workflow-loading="workflowListLoading"
                :gateway-loading="gatewayListLoading"
                :labels="{
                  workflow: t('assets.fields.selectWorkflow'), workflowPlaceholder: t('assets.select.workflow'), runner: t('assets.fields.runner'), controlPlane: t('assets.runners.controlPlane'), gateway: t('assets.runners.gateway'), gatewayPlaceholder: t('assets.select.gateway'),
                }"
              />
              <section class="asset-form__field--wide workflow-target-form" :aria-label="t('assets.workflowTarget.title')">
                <div class="workflow-target-form__head">
                  <div>
                    <span>{{ t('assets.workflowTarget.title') }}</span>
                    <strong>{{ t('assets.workflowTarget.description') }}</strong>
                  </div>
                </div>
                <div class="workflow-target-form__grid">
                  <label class="asset-form__field">
                    <span>{{ t('assets.fields.frameworkType') }} <strong>*</strong></span>
                    <select v-model="assetDraft.frameworkType">
                      <option value="" disabled>{{ t('assets.select.generic') }}</option>
                      <option v-for="framework in availableFrameworkOptions" :key="framework" :value="framework">
                        {{ framework }}
                      </option>
                    </select>
                  </label>
                  <label class="asset-form__field">
                    <span>{{ t('assets.fields.siteName') }}</span>
                    <input
                      v-model="assetDraft.workflowTargetSiteName"
                      :placeholder="t('assets.form.placeholders.siteName')"
                      autocomplete="off"
                    />
                  </label>
                </div>
                <div class="workflow-target-form__advanced-head">
                  <div>
                    <span>{{ t('assets.workflowTarget.advancedTitle') }}</span>
                    <strong>{{ t('assets.workflowTarget.advancedDescription') }}</strong>
                  </div>
                  <button class="gc-button gc-button--ghost" type="button" @click="workflowTargetAdvancedExpanded = !workflowTargetAdvancedExpanded">
                    {{ workflowTargetAdvancedExpanded ? t('assets.workflowTarget.collapseAdvanced') : t('assets.workflowTarget.expandAdvanced') }}
                  </button>
                </div>
                <div v-if="workflowTargetAdvancedExpanded" class="workflow-target-form__grid">
                  <label class="asset-form__field">
                    <span>{{ t('assets.workflowTarget.bindingInformationLabel') }}</span>
                    <input v-model="assetDraft.workflowTargetBindingInformation" :placeholder="t('assets.form.placeholders.bindingInformation')" autocomplete="off" />
                    <small>{{ t('assets.workflowTarget.bindingInformationHelp') }}</small>
                  </label>
                  <label class="asset-form__field">
                    <span>{{ t('assets.workflowTarget.hostHeaderLabel') }}</span>
                    <input v-model="assetDraft.workflowTargetHostHeader" :placeholder="assetDraft.address || t('assets.form.placeholders.hostHeader')" autocomplete="off" />
                    <small>{{ t('assets.workflowTarget.hostHeaderHelp') }}</small>
                  </label>
                  <label class="asset-form__field">
                    <span>{{ t('assets.workflowTarget.sniNameLabel') }}</span>
                    <input v-model="assetDraft.workflowTargetSniName" :placeholder="assetDraft.workflowTargetHostHeader || assetDraft.address || t('assets.form.placeholders.sniName')" autocomplete="off" />
                    <small>{{ t('assets.workflowTarget.sniNameHelp') }}</small>
                  </label>
                </div>
                <div class="workflow-target-form__summary">
                  <span>{{ t('assets.workflowTarget.dslSyncHint') }}</span>
                  <strong>{{ workflowTargetPreview?.frameworkType }} / {{ workflowTargetPreview?.siteName }}</strong>
                </div>
              </section>
              <section class="asset-form__field asset-form__field--wide">
                <p v-if="!editingServiceAssetId" class="asset-form__hint">{{ t('deploymentInputs.saveAssetFirst') }}</p>
                <p v-show="editingServiceAssetId && workflowProjectionError" class="asset-form__error">{{ workflowProjectionError }}</p>
                <DeploymentInputForm
                  v-if="workflowBindingProjection"
                  v-model="deploymentInputBindings"
                  :projection="workflowBindingProjection"
                  :credential-options="deploymentCredentialOptions"
                  :artifact-options="deploymentArtifactOptions"
                  :loading="workflowProjectionLoading && !workflowProjectionRefreshing"
                />
              </section>
            </div>
            <p v-if="publishedWorkflowVersionItems.length === 0 && assetDraft.workflowId && !workflowVersionListLoading" class="asset-form__hint">
              {{ t('assets.workflowVariables.noPublishedVersion') }}
            </p>
            <p v-if="credentialProfileError" class="asset-form__error">{{ credentialProfileError }}</p>
            <p v-if="certificateFormatError" class="asset-form__error">{{ certificateFormatError }}</p>
          </template>
        </section>

        <section v-else class="asset-wizard__panel gc-native-select-surface">
          <header class="asset-wizard__panel-header">
            <div>
              <h3>{{ t('assets.wizard.panels.confirmTitle') }}</h3>
              <p>{{ t('assets.wizard.panels.confirmDescription') }}</p>
            </div>
            <span class="asset-wizard__panel-state is-active">{{ t('assets.wizard.stepState.pendingSubmit') }}</span>
          </header>
          <dl class="asset-wizard__review">
            <div>
              <dt>{{ t('assets.review.accessEntry') }}</dt>
              <dd>{{ assetDraft.protocol }}://{{ assetDraft.address }}:{{ assetDraft.port }}</dd>
            </div>
            <div>
              <dt>{{ t('assets.review.deploymentMode') }}</dt>
              <dd>
                {{ assetDraft.managementMode === 'WORKFLOW'
                  ? t('devices.deployment.independentWorkflow')
                  : assetDraft.managedExecutionMode === 'WORKFLOW_OVERRIDE'
                    ? t('assets.executionModes.workflowOverride.title')
                    : t('assets.executionModes.plugin.title') }}
              </dd>
            </div>
            <div>
              <dt>{{ t('assets.fields.platform') }}</dt>
              <dd>{{ assetDraft.platform }}</dd>
            </div>
            <div>
              <dt>{{ t('assets.fields.verifyUrl') }}</dt>
              <dd>{{ assetDraft.verifyUrl || t('assets.review.autoGeneratedByEntry') }}</dd>
            </div>
            <div v-if="assetDraft.managementMode === 'MANAGED_TARGET'">
              <dt>{{ t('devices.page.title') }}</dt>
              <dd>{{ deviceLabel(selectedDevice ?? {}) || editAgentLabel || t('assets.empty.notSelected') }} / {{ serviceInstanceLabel(selectedServiceInstance ?? {}) || assetDraft.frameworkType || t('assets.empty.notSelected') }} / {{ editSiteLabel || siteLabel(selectedSiteAsset ?? {}) || t('assets.empty.notSelected') }}</dd>
            </div>
            <div v-if="assetDraft.managementMode === 'MANAGED_TARGET'">
              <dt>{{ t('assets.fields.certificateFormat') }}</dt>
              <dd>{{ workflowCertificateFormatLabel(certificateFormatItems.find((item) => String(item.id ?? '') === assetDraft.agentCertificateFormatId) ?? {}) || t('assets.empty.notSelected') }}</dd>
            </div>
            <div v-if="workflowExecutionEnabled">
              <dt>{{ t('assets.review.workflowVersion') }}</dt>
              <dd>{{ workflowTemplateLabel(selectedWorkflowTemplate ?? {}) || t('assets.empty.notSelected') }} / {{ workflowVersionLabel(selectedWorkflowVersion ?? {}) || t('assets.empty.notSelected') }}</dd>
            </div>
            <div v-if="workflowExecutionEnabled">
              <dt>{{ t('assets.workflowTarget.title') }}</dt>
              <dd>
                {{ workflowTargetPreview?.frameworkType || t('assets.empty.notSet') }}
                / {{ workflowTargetPreview?.siteName || t('assets.empty.notSet') }}
                / {{ workflowTargetPreview?.bindingInformation || t('assets.empty.notSet') }}
              </dd>
            </div>
            <div v-if="workflowExecutionEnabled">
              <dt>{{ t('assets.fields.runner') }}</dt>
              <dd>{{ assetDraft.workflowRunner === 'GATEWAY' ? t('assets.review.gatewayRunner', { gateway: gatewayLabel(selectedGateway ?? {}) || assetDraft.workflowGatewayId }) : t('assets.runners.controlPlane') }}</dd>
            </div>
            <div v-if="workflowExecutionEnabled">
              <dt>{{ t('assets.workflowVariables.title') }}</dt>
              <dd>{{ workflowVariableConfiguredCount ? t('assets.review.variableCount', { count: workflowVariableConfiguredCount }) : t('assets.review.onlyBasicEntry') }}</dd>
            </div>
          </dl>
        </section>

        <p v-if="siteListError" class="asset-form__error">{{ siteListError }}</p>
        <p v-else-if="workflowListError" class="asset-form__error">{{ workflowListError }}</p>
        <p v-else-if="workflowVersionListError" class="asset-form__error">{{ workflowVersionListError }}</p>
        <p v-else-if="gatewayListError" class="asset-form__error">{{ gatewayListError }}</p>
        <p v-if="createError" class="asset-form__error">{{ createError }}</p>
        <p v-else-if="createRequestId" class="asset-form__request">{{ isEditMode ? t('assets.form.editRequestCompleted') : t('assets.form.createRequestCompleted') }}</p>
      </section>
      <template #actions>
        <button class="gc-button" type="button" :disabled="createLoading" @click="closeCreateDialog">{{ t('designSystem.deploymentWizard.actions.cancel') }}</button>
        <button v-if="!isUserViewMode" class="gc-button" type="button" :disabled="createLoading || !canGoPreviousAssetStep" @click="goPreviousAssetStep">{{ t('designSystem.deploymentWizard.actions.previous') }}</button>
        <button v-if="!isUserViewMode && assetWizardStep < 3" class="gc-button gc-button--primary" type="button" :disabled="createLoading || !canGoNextAssetStep" @click="goNextAssetStep">{{ t('designSystem.deploymentWizard.actions.next') }}</button>
        <button v-else-if="isUserViewMode || assetWizardStep >= 3" class="gc-button gc-button--primary" type="button" :disabled="createDisabled" @click="submitCreate">
          {{ createLoading ? (isEditMode ? t('assets.actions.saving') : t('assets.actions.creating')) : (isEditMode ? t('assets.actions.saveChanges') : t('assets.actions.confirmCreate')) }}
        </button>
      </template>
    </GcModal>
    <ApplicationOnboardingModal
      :open="onboardingDialogOpen"
      @update:open="setOnboardingDialogOpen"
      @custom-manual="openCustomManualCreateDialog"
      @add-device="openDeviceOnboardingFromApplication"
    />
    <DeviceOnboardingWizard
      :open="deviceOnboardingOpen"
      :initial-selection="deviceOnboardingInitialSelection"
      @update:open="setDeviceOnboardingOpen"
      @completed="completeDeviceOnboarding"
    />
  </section>
</template>

<style scoped>
.asset-page {
  display: grid;
  gap: var(--gc-space-5);
}

.asset-page__workspace {
  display: grid;
  gap: var(--gc-space-5);
  min-width: 0;
}

.asset-page__workspace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  min-height: var(--gc-control-height-comfortable);
}

.asset-page__workspace-actions,
.asset-page__filter-actions,
.asset-page__pagination {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
}

.asset-page__workspace-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.asset-page__workspace-view {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-4);
  min-width: 0;
}

.asset-page__presentation-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  padding: var(--gc-space-1);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-solid);
}

.asset-page__presentation-toggle-button {
  display: inline-grid;
  place-items: center;
  width: var(--gc-control-height-sm);
  min-width: var(--gc-control-height-sm);
  height: var(--gc-control-height-sm);
  min-height: var(--gc-control-height-sm);
  padding: 0;
  border: 0;
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text-muted);
}

.asset-page__presentation-toggle-button svg {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
}

.asset-page__presentation-toggle-button--active {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.certificate-page__category-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gc-space-1);
  min-width: 0;
  padding: var(--gc-space-1);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-muted);
}

.certificate-page__category-tab {
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-3);
  border: 0;
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  cursor: pointer;
}

.certificate-page__category-tab:hover,
.certificate-page__category-tab--active {
  color: var(--gc-color-primary);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.certificate-page__category-tab:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.asset-page__workspace-view-mark {
  display: grid;
  place-items: center;
  width: var(--gc-control-height-comfortable);
  height: var(--gc-control-height-comfortable);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-primary);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.asset-page__workspace-view-mark svg,
.asset-page__card-icon svg {
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.asset-page__workspace-selection,
.asset-page__workspace-selected-count,
.asset-page__card-state {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: var(--gc-font-weight-semibold);
}

.asset-page__workspace-selected-count {
  color: var(--gc-color-primary);
}

.asset-page__selection-actions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
}

.asset-page__selection-actions :deep(.gc-button),
.asset-page__selection-actions :deep(.gc-icon-button),
.asset-page__selection-delete-action,
.asset-page__selection-update-action {
  min-height: var(--gc-control-height-sm);
  padding: var(--gc-space-2) var(--gc-space-3);
  border-radius: var(--gc-radius-control);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.asset-page__selection-delete-action :deep(.gc-button) {
  border-color: var(--gc-color-danger-border);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.asset-page__selection-delete-action {
  border-color: var(--gc-color-danger-border);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.asset-page__selection-delete-action :deep(.gc-button:hover:not(:disabled)) {
  border-color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
}

.asset-page__selection-delete-action:hover:not(:disabled) {
  border-color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
}

.asset-page__card-state {
  margin: 0;
  padding: var(--gc-space-6);
  text-align: center;
}

.asset-page__filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  align-items: end;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.asset-page__filter {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.asset-page__filter span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.asset-page__filter input,
.asset-page__filter select {
  width: 100%;
  min-width: 0;
  min-height: var(--gc-control-height-sm);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  font: inherit;
}

.asset-page__filter input:focus-visible,
.asset-page__filter select:focus-visible {
  outline: none;
  border-color: var(--gc-color-primary-border);
  box-shadow: var(--gc-shadow-focus);
}

.asset-page__filter-actions {
  flex-wrap: wrap;
}

.asset-page__card-view {
  display: grid;
  gap: var(--gc-space-5);
  min-height: 0;
}

.asset-page__asset-table {
  min-width: 0;
}

.asset-page__asset-table :deep(th),
.asset-page__asset-table :deep(td) {
  white-space: nowrap;
}

.asset-page__header-sort {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.asset-page__header-sort:hover {
  color: var(--gc-color-text);
}

.asset-page__table-domain {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
}

.asset-page__table-domain-button {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
  padding: 0;
  border: 0;
  color: var(--gc-color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.asset-page__table-domain-button strong,
.asset-page__table-domain-button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-page__table-domain-button span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.asset-page__table-domain-button:focus-visible,
.asset-page__header-sort:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.asset-page__table-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-1);
}

.asset-page__card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--gc-size-certificate-card-min), 1fr));
  gap: var(--gc-space-4);
  align-content: start;
}

.asset-page__card {
  min-width: 0;
  border-color: var(--gc-color-border-soft);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-card);
  transition: border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.asset-page__card:hover {
  border-color: var(--gc-color-primary-border);
  box-shadow: var(--gc-shadow-hover);
  transform: translateY(calc(-1 * var(--gc-space-tight)));
}

.asset-page__card :deep(.gc-pro-card__header) {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  padding-bottom: 0;
  border-bottom: 0;
}

.asset-page__card :deep(.gc-pro-card__footer) {
  padding-top: 0;
  border-top: 0;
}

.asset-page__card-icon {
  display: grid;
  place-items: center;
  width: var(--gc-control-height-sm);
  height: var(--gc-control-height-sm);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.asset-page__card-icon :deep(.plugin-logo) {
  inline-size: 100%;
  block-size: 100%;
  border: 0;
  border-radius: inherit;
  box-shadow: none;
  background: transparent;
}

.asset-page__card-icon :deep(.plugin-logo img) {
  padding: var(--gc-space-1);
}

.asset-page__card-icon :deep(.plugin-logo--fallback) {
  font-size: var(--gc-font-size-md);
}

.asset-page__card-select {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
  margin: 0;
  accent-color: var(--gc-color-primary);
  cursor: pointer;
}

.asset-page__card-select:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus);
}

.asset-page__card-icon-action svg {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
}

.asset-page__card-icon-action,
.asset-page__card :deep(.asset-page__card-delete .gc-icon-button) {
  box-sizing: border-box;
  display: inline-grid;
  place-items: center;
  flex: 0 0 var(--gc-control-height-card-action);
  width: var(--gc-control-height-card-action);
  min-width: var(--gc-control-height-card-action);
  height: var(--gc-control-height-card-action);
  min-height: var(--gc-control-height-card-action);
  gap: 0;
  padding: 0;
  line-height: 1;
}

.asset-page__card-icon-action svg,
.asset-page__card :deep(.asset-page__card-delete .gc-icon-button svg) {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
}

.asset-page__icon-action-label,
.asset-page :deep(.asset-page__icon-action-label) {
  display: none;
}

.asset-page__icon-action-label {
  position: absolute;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.asset-page__card-heading {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.asset-page__card-heading h3 {
  margin: 0;
  overflow-wrap: anywhere;
}

.asset-page__card-url {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: var(--gc-line-height-tight);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-page__card-heading h3 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.asset-page__card-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-1);
  margin: 0;
  padding: 0;
}

.asset-page__card-facts div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
  padding: var(--gc-space-1);
  border-radius: var(--gc-radius-control);
  background: var(--gc-color-surface-muted);
}

.asset-page__card-facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-overline);
  font-weight: var(--gc-font-weight-semibold);
  letter-spacing: 0;
  text-transform: uppercase;
}

.asset-page__card-facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
  white-space: nowrap;
}

.asset-page__card-fact-value {
  min-width: 0;
}

.asset-page__card-certificate-name {
  min-width: 0;
}

.asset-page__card-certificate-status {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--gc-space-1);
  min-width: 0;
  width: 100%;
}

.asset-page__card-certificate-status .asset-page__card-certificate-remaining,
.asset-page__card-certificate-status .asset-page__card-certificate-state {
  font-size: inherit;
}

.asset-page__card-certificate-status .asset-page__card-certificate-state {
  padding-inline: var(--gc-space-1);
}

.asset-page__card-certificate-remaining {
  color: var(--gc-color-success);
  font-size: var(--gc-font-size-xs);
}

.asset-page__card :deep(.gc-pro-card__footer) {
  align-items: stretch;
  flex-wrap: nowrap;
  gap: var(--gc-space-2);
}

.asset-page__card-deploy-button {
  flex: 1 1 0;
  min-width: 0;
  height: var(--gc-control-height-card-action);
  min-height: var(--gc-control-height-card-action);
  padding: var(--gc-space-2) var(--gc-space-3);
  border-radius: var(--gc-radius-control);
  font-size: var(--gc-font-size-xs);
  font-weight: var(--gc-font-weight-semibold);
}

.asset-page__card-deploy-button--latest {
  border-color: var(--gc-color-success);
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-success);
  box-shadow: var(--gc-shadow-sm);
}

.asset-page__card-deploy-button--latest:hover:not(:disabled) {
  border-color: var(--gc-color-success);
  background: var(--gc-color-success);
  box-shadow: var(--gc-shadow-hover);
}

.asset-page__card-deploy-button--update {
  border-color: var(--gc-color-primary);
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-primary);
  box-shadow: var(--gc-shadow-sm);
}

.asset-page__card-deploy-button--update:hover:not(:disabled) {
  border-color: var(--gc-color-primary-hover);
  background: var(--gc-color-primary-hover);
  box-shadow: var(--gc-shadow-hover);
}

.asset-page__card-delete {
  display: contents;
}

.asset-page__pagination {
  justify-content: flex-end;
  padding-top: var(--gc-space-4);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  flex-wrap: wrap;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

@media (max-width: 57rem) {
  .asset-page__workspace-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .asset-page__workspace-actions,
  .asset-page__filter-actions {
    justify-content: flex-start;
  }

  .asset-page__filters {
    grid-template-columns: 1fr;
  }

  .asset-page__card-facts {
    grid-template-columns: 1fr;
  }
}

.asset-user-form__location,
.asset-user-form__location header {
  display: grid;
  gap: var(--gc-space-2);
}

.asset-user-view__section-head h3,
.asset-user-view__card h3,
.asset-user-view__card p,
.asset-user-form__header h3,
.asset-user-form__location h4,
.asset-user-form__location p {
  margin: 0;
}

.asset-user-form__header h3 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xl);
}

.asset-user-view__card p,
.asset-user-form__location p {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.asset-user-view__content,
.asset-user-form {
  display: grid;
  gap: var(--gc-space-4);
}

.asset-user-view__section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--gc-space-4);
}

.asset-user-view__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 6), 1fr));
  gap: var(--gc-space-3);
}

.asset-user-view__card {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
}

.asset-user-view__card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.asset-user-view__state {
  padding: var(--gc-space-6);
  color: var(--gc-color-text-muted);
  text-align: center;
}

.asset-user-form {
  padding: var(--gc-space-2);
}

.asset-user-form__location {
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-hover);
}

.asset-user-form__location h4 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
}

.asset-user-form__inputs {
  display: grid;
  gap: var(--gc-space-3);
}

.asset-user-view__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
}

.asset-user-view__summary > div {
  display: flex;
  align-items: baseline;
  gap: var(--gc-space-2);
}

.asset-user-view__summary strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xl);
  line-height: var(--gc-line-height-tight);
}

.asset-user-view__summary span,
.asset-user-view__error {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.asset-user-view__section-head h3 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
}

.asset-user-view__location {
  display: grid;
  gap: var(--gc-space-1);
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.asset-user-view__location span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.asset-user-view__location strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  overflow-wrap: anywhere;
}

.asset-user-view__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--gc-space-2);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.asset-user-form__header {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
}

.asset-user-form__header h3 {
  margin: 0;
}

.asset-user-form__location header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.asset-user-form__location header h4 {
  margin: 0;
}

.asset-detail-modal {
  display: grid;
  gap: var(--gc-space-3);
}

.asset-detail-modal__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4) var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-gradient-hero);
}

.asset-detail-modal__hero-copy {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.asset-detail-modal__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.asset-detail-modal__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-lg);
  line-height: 1.06;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.asset-detail-modal__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.asset-detail-modal__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: var(--gc-space-2);
  min-width: calc(var(--gc-size-card-min) - var(--gc-space-7));
}

.asset-detail-modal__spotlight {
  display: grid;
  gap: var(--gc-space-1);
  min-width: calc(var(--gc-size-card-min) - var(--gc-space-7));
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.asset-detail-modal__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.asset-detail-modal__spotlight strong {
  font-size: var(--gc-font-size-md);
  line-height: 1.15;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.asset-detail-modal__sections {
  display: grid;
  gap: var(--gc-space-3);
}

.asset-detail-modal__section {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-modal);
  background: var(--gc-gradient-surface);
}

.asset-detail-modal__section-head {
  display: grid;
  gap: var(--gc-space-1);
}

.asset-detail-modal__section-head h3,
.asset-detail-modal__section-head p {
  margin: 0;
}

.asset-detail-modal__section-head h3 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  letter-spacing: 0;
}

.asset-detail-modal__section-head p {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: 1.5;
}

.asset-detail-modal__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.asset-detail-modal__item {
  display: grid;
  gap: var(--gc-space-1);
  min-height: calc(var(--gc-space-9) * 2);
  padding: var(--gc-space-3);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-hover);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.asset-detail-modal__item dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.asset-detail-modal__item dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: 1.35;
  font-weight: 800;
  letter-spacing: 0;
  overflow-wrap: anywhere;
}

.asset-detail-modal__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
}

.asset-summary__error { margin: 0; }
.asset-summary__loading { margin: 0; color: var(--gc-color-text-muted); }
.asset-binding__detail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}
.asset-binding__detail div {
  display: grid;
  gap: var(--gc-space-1);
}
.asset-binding__detail dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}
.asset-binding__detail dd {
  margin: 0;
  word-break: break-word;
}
.asset-binding-relations {
  display: grid;
  gap: var(--gc-space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}
.asset-binding-relations__item {
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3);
  background: var(--gc-color-surface-muted);
}
.asset-binding-relations__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-3);
}
.asset-binding-relations__grid > div {
  display: grid;
  gap: var(--gc-space-1);
}
.asset-binding-relations__grid span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}
.asset-binding-relations__grid strong {
  word-break: break-word;
}
.asset-summary__error { color: var(--gc-color-danger); }

.asset-deployment__error-details {
  display: grid;
  gap: var(--gc-space-2);
}

.asset-deployment__error-details h3,
.asset-deployment__error-details p,
.asset-deployment__error-details ul {
  margin: 0;
}

.asset-deployment__error-details ul {
  display: grid;
  gap: var(--gc-space-1);
  padding-inline-start: var(--gc-space-5);
}

.asset-deployment__error-details li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  align-items: baseline;
}

.asset-deployment__error-details code {
  color: var(--gc-color-text-muted);
  overflow-wrap: anywhere;
}

.asset-deployment__error-details span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.asset-form { display: grid; gap: var(--gc-space-4); }
.asset-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.asset-form__field--wide { grid-column: 1 / -1; }
.asset-form__binding-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-3);
}
.asset-form__binding-summary > div {
  display: grid;
  gap: var(--gc-space-1);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-3);
  background: var(--gc-color-surface-muted);
}
.asset-form__binding-summary span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}
.asset-form__binding-summary strong {
  word-break: break-word;
}
.asset-deployment__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}
.asset-form__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.asset-form__field strong,
.asset-form__error { color: var(--gc-color-danger); }
.asset-form__field input,
.asset-form__field select,
.asset-form__field textarea,
.asset-form__readonly {
  width: 100%;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
}
.asset-form__field input,
.asset-form__field select,
.asset-form__field textarea {
  outline: none;
}
.asset-form__field input:focus,
.asset-form__field select:focus,
.asset-form__field textarea:focus {
  border-color: var(--gc-color-focus);
  box-shadow: var(--gc-shadow-focus);
  background: var(--gc-color-surface-solid);
}
.asset-form__field textarea {
  min-height: calc(var(--gc-space-12) * 3);
  resize: vertical;
  font-family: var(--gc-font-family-mono);
  line-height: 1.45;
}
.asset-form__approval-option {
  display: flex;
  align-items: flex-start;
  gap: var(--gc-space-3);
  grid-column: 1 / -1;
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-muted);
  color: var(--gc-color-text);
  cursor: pointer;
}
.asset-form__approval-option input {
  width: auto;
  flex: 0 0 auto;
  margin-top: var(--gc-space-1);
  padding: 0;
  accent-color: var(--gc-color-primary);
}
.asset-form__approval-option span {
  display: grid;
  gap: var(--gc-space-1);
}
.asset-certificate-supply {
  display: grid;
  gap: var(--gc-space-3);
  margin-top: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-panel);
  background: var(--gc-color-surface-muted);
}
.asset-certificate-supply__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}
.asset-certificate-supply__header h4,
.asset-certificate-supply__header p { margin: 0; }
.asset-certificate-supply__header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}
.asset-certificate-supply__mode { display: flex; flex-wrap: wrap; gap: var(--gc-space-4); }
.asset-certificate-supply__mode label {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  color: var(--gc-color-text);
  font-weight: var(--gc-font-weight-semibold);
}
.asset-certificate-supply__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--gc-space-3);
}
.asset-certificate-supply__facts > div { display: grid; gap: var(--gc-space-1); min-width: 0; }
.asset-certificate-supply__facts span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.asset-certificate-supply__facts strong { overflow-wrap: anywhere; color: var(--gc-color-text); font-size: var(--gc-font-size-sm); }
.asset-form__approval-option strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}
.asset-form__approval-option small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
  line-height: 1.45;
}
.asset-form__readonly {
  display: flex;
  align-items: center;
  min-height: var(--gc-control-height-md);
  font-weight: 700;
  word-break: break-word;
}
.asset-form__error,
.asset-form__request { margin: 0; font-weight: 750; }
.asset-form__request { color: var(--gc-color-text-muted); }
.asset-form__hint {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 750;
}

.workflow-target-form {
  display: grid;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-subtle);
}

.workflow-target-form__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.workflow-target-form__head > div:first-child {
  display: grid;
  gap: var(--gc-space-1);
}

.workflow-target-form__head span {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  font-weight: 900;
}

.workflow-target-form__head strong {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.workflow-target-form__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.workflow-target-form__advanced-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding-top: var(--gc-space-2);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.workflow-target-form__advanced-head > div {
  display: grid;
  gap: var(--gc-space-1);
}

.workflow-target-form__advanced-head span {
  color: var(--gc-color-text);
  font-weight: 900;
}

.workflow-target-form__advanced-head strong {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.workflow-target-form__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-selected);
}

.workflow-target-form__summary span {
  color: var(--gc-color-primary-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: 900;
}

.workflow-target-form__summary strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  overflow-wrap: anywhere;
}

.asset-wizard__progress {
  display: grid;
  gap: var(--gc-space-3);
}

.asset-wizard__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.asset-wizard__step-button {
  width: 100%;
  min-height: calc(var(--gc-space-9) * 2);
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-hover);
  color: var(--gc-color-text);
  text-align: left;
  cursor: pointer;
}

.asset-wizard__step-button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.asset-wizard__step.is-active .asset-wizard__step-button,
.asset-wizard__step.is-done .asset-wizard__step-button {
  border-color: var(--gc-color-primary-border-strong);
  background: var(--gc-color-surface-selected);
}

.asset-wizard__step-index {
  width: var(--gc-control-height-xs);
  height: var(--gc-control-height-xs);
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-info-border);
  color: var(--gc-color-primary-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: 900;
}

.asset-wizard__step.is-done .asset-wizard__step-index {
  background: var(--gc-color-success-bg);
  color: var(--gc-color-success);
}

.asset-wizard__step-button span:last-child {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.asset-wizard__step-button strong {
  font-size: var(--gc-font-size-sm);
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.asset-wizard__step-button small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 750;
}

.asset-wizard__panel {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-modal);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.asset-wizard__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--gc-space-3);
}

.asset-wizard__panel-header h3,
.asset-wizard__panel-header p {
  margin: 0;
}

.asset-wizard__panel-header h3 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
  line-height: 1.25;
}

.asset-wizard__panel-header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: 1.5;
}

.asset-wizard__panel-state {
  flex: 0 0 auto;
  border-radius: var(--gc-radius-full);
  padding: var(--gc-space-2) var(--gc-space-3);
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.asset-wizard__panel-state.is-done {
  background: var(--gc-color-success-bg);
  color: var(--gc-color-success);
}

.asset-wizard__panel-state.is-active {
  background: var(--gc-color-info-border);
  color: var(--gc-color-primary-strong);
}

.asset-wizard__mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.asset-wizard__mode-card {
  display: grid;
  gap: var(--gc-space-1);
  min-height: calc(var(--gc-space-10) * 2);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-text);
  text-align: left;
  cursor: pointer;
}

.asset-wizard__mode-card.is-selected {
  border-color: var(--gc-color-primary-strong);
  background: var(--gc-color-surface-selected);
  box-shadow: var(--gc-shadow-focus);
}

.asset-wizard__mode-card span {
  color: var(--gc-color-primary-strong);
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
}

.asset-wizard__mode-card strong {
  font-size: var(--gc-font-size-sm);
  line-height: 1.3;
}

.asset-wizard__review {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.asset-wizard__review div {
  display: grid;
  gap: var(--gc-space-1);
  min-height: calc(var(--gc-space-9) * 2);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-muted-bg);
  border-radius: var(--gc-radius-card);
  background: var(--gc-color-surface-subtle);
}

.asset-wizard__review dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.asset-wizard__review dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

@media (max-width: 53.75rem) {
  .asset-user-view__section-head,
  .asset-user-view__card header {
    align-items: stretch;
    flex-direction: column;
  }
  .asset-form__grid,
  .workflow-target-form__grid,
  .asset-wizard__steps,
  .asset-wizard__mode-grid,
  .asset-wizard__review { grid-template-columns: 1fr; }
  .asset-wizard__panel-header { display: grid; }
  .workflow-target-form__head,
  .workflow-target-form__advanced-head,
  .workflow-target-form__summary { align-items: stretch; flex-direction: column; }
  .asset-detail-modal__grid,
  .asset-binding__detail,
  .asset-form__binding-summary,
  .asset-binding-relations__grid { grid-template-columns: 1fr; }
}
</style>
