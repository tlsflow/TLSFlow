<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { createServiceAsset, deleteServiceAsset, getAssetDetail, getManagedTargetEffectiveCapability, listAssets, listManagedTargets, listManagedTargetCompatiblePlugins, listManagedTargetSnapshots, listFrameworkInstances, listSiteAssets, saveApplicationAssetManagedTarget, saveApplicationAssetStandaloneWorkflow, updateServiceAsset } from '@/api/modules/assets.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import { listGateways } from '@/api/modules/gateways.api'
import { getWorkflowExecutionBinding, listWorkflowTemplates, listWorkflowTemplateVersions } from '@/api/modules/workflow-templates.api'
import { listCertificateFormats } from '@/api/modules/certificates.api'
import { projectDeploymentInputs } from '@/api/modules/deployment-inputs.api'
import { getPluginBinding } from '@/api/modules/plugins.api'
import { listManagedDevices } from '@/api/modules/devices.api'
import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import type { ViewRow } from '@/composables/useBusinessPage'
import { DeploymentInputForm, GcCompatiblePluginSelector, GcEffectiveCapabilityCard, GcExecutionModeSelector, GcManagedTargetSelector, GcModal, GcStatusTag, GcTabs, GcWorkflowExecutionForm, type DeploymentArtifactOption, type DeploymentInputBindingsV1, type DeploymentInputProjectionV1 } from '@/design-system/components'
import { useAuthStore } from '@/stores/auth.store'
import { useTenantStore } from '@/stores/tenant.store'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
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
import {
  createInputBindingsV1,
  readInputBindingsV1,
} from './asset-input-bindings.model'

type AssetPlatform = 'LINUX' | 'WINDOWS' | 'APPLIANCE'
type AssetProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' | 'CUSTOM'
type AssetManagementMode = 'MANAGED_TARGET' | 'WORKFLOW'
type ManagedExecutionMode = 'PLUGIN' | 'WORKFLOW_OVERRIDE'
type WorkflowRunnerType = 'CONTROL_PLANE' | 'GATEWAY'
type WorkflowVersionSelection = 'PINNED' | 'LATEST_PUBLISHED'
type AssetWizardStep = 1 | 2 | 3

interface AssetDraft {
  managementMode: AssetManagementMode
  managedExecutionMode: ManagedExecutionMode
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

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const { t, locale } = useI18n()
const authStore = useAuthStore()
const tenantStore = useTenantStore()
const selectedServiceAsset = ref<ViewRow | null>(null)
const detailModalOpen = ref(false)
const activeDetailTab = ref<'overview' | 'snapshots'>('overview')
const detailTabs = computed(() => [
  { value: 'overview', label: t('assets.detail.tabs.overview') },
  { value: 'snapshots', label: t('assets.detail.tabs.snapshots') },
])
const createDialogOpen = ref(false)
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
const snapshotLoading = ref(false)
const snapshotError = ref('')
const rollbackSubmitting = ref(false)
const rollbackError = ref('')
const rollbackRequestId = ref('')
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
const pluginBindingId = ref('')
const pluginBindingVersion = ref(0)
const effectiveCapability = ref<ApiRecord | null>(null)
const inheritedEffectiveCapability = ref<ApiRecord | null>(null)
const effectiveCapabilityLoading = ref(false)
const compatibleManagedPlugins = ref<ApiRecord[]>([])
const compatibleManagedPluginsLoading = ref(false)
let managedCapabilityRequestSequence = 0

const assetPlatformOptions: ReadonlyArray<{ value: AssetPlatform; labelKey: string }> = [
  { value: 'LINUX', labelKey: 'assets.platforms.linux' },
  { value: 'WINDOWS', labelKey: 'assets.platforms.windows' },
  { value: 'APPLIANCE', labelKey: 'assets.platforms.appliance' },
]

const assetDraft = reactive<AssetDraft>({
  managementMode: 'MANAGED_TARGET',
  managedExecutionMode: 'PLUGIN',
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

const config = computed<BusinessPageConfig>(() => ({
  title: t('assets.title'),
  description: t('assets.description'),
  showHeader: false,
  showMetrics: false,
  showEmptyState: false,
  readPermission: 'service_asset.read',
  primaryPermission: 'service_asset.manage',
  primaryActionLabel: t('assets.actions.add'),
  primaryAction: openCreateDialog,
  moduleName: 'assets',
  resourceName: t('assets.resourceName'),
  defaultStatus: 'ACTIVE',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: t('assets.columns.domain'), candidates: ['address', 'displayName', 'domainName'] },
    { key: 'port', title: t('assets.columns.port'), candidates: ['port'] },
    { key: 'protocol', title: t('assets.columns.protocol'), candidates: ['protocol'] },
    { key: 'platform', title: t('assets.columns.platform'), candidates: ['platform'] },
    { key: 'frameworkType', title: t('assets.columns.framework'), candidates: ['targetBinding.frameworkDisplayName', 'targetBinding.frameworkType', 'metadata.workflowTarget.frameworkType', 'deploymentStrategy.workflow.target.frameworkType'] },
    { key: 'siteName', title: t('assets.columns.site'), candidates: ['siteDisplayName', 'targetBinding.siteName', 'targetBindingDetail.siteAsset.siteName', 'targetBinding.metadata.siteName', 'metadata.workflowTarget.siteName', 'deploymentStrategy.workflow.target.siteName', 'targetBinding.siteAssetId'] },
    { key: 'deviceId', title: t('devices.page.title'), candidates: ['targetBinding.deviceDisplayName', 'deviceDisplayName', 'targetBinding.deviceId', 'hostId'] },
    { key: 'status', title: t('assets.columns.status'), candidates: ['status'] },
    { key: 'actions', title: t('assets.columns.actions'), candidates: [] },
  ],
  metrics: [],
  detailFields: [
    { label: t('assets.fields.assetId'), candidates: ['id'] },
    { label: t('assets.fields.domain'), candidates: ['address', 'displayName'] },
    { label: t('assets.fields.addressType'), candidates: ['addressType'] },
    { label: t('assets.fields.port'), candidates: ['port'] },
    { label: t('assets.fields.protocol'), candidates: ['protocol'] },
    { label: t('assets.fields.verifyUrl'), candidates: ['verifyUrl', 'metadata.verifyUrl'] },
    { label: t('assets.fields.platform'), candidates: ['platform'] },
    { label: t('assets.fields.frameworkType'), candidates: ['targetBinding.frameworkType', 'metadata.workflowTarget.frameworkType', 'deploymentStrategy.workflow.target.frameworkType'] },
    { label: t('assets.fields.deploymentStrategyCompatibility'), candidates: ['deploymentStrategyCompatibilityLabel'] },
    { label: 'Agent ID', candidates: ['agentId'] },
    { label: 'SNI', candidates: ['sniName', 'metadata.workflowTarget.sniName', 'deploymentStrategy.workflow.target.sniName'] },
    { label: t('assets.fields.serviceInstanceId'), candidates: ['serviceInstanceId'] },
    { label: t('assets.fields.siteId'), candidates: ['targetBinding.siteAssetId', 'metadata.workflowTarget.siteName'] },
    { label: t('assets.fields.managedTargetId'), candidates: ['targetBinding.managedTargetId'] },
    { label: t('assets.fields.bindingKey'), candidates: ['targetBinding.bindingKey'] },
    { label: t('assets.fields.hostId'), candidates: ['hostId'] },
    { label: t('assets.fields.environment'), candidates: ['environment'] },
    { label: t('assets.fields.discoverySource'), candidates: ['discoverySource'] },
    { label: t('assets.fields.lastDiscoveredAt'), candidates: ['lastDiscoveredAt', 'updatedAt'] },
    { label: t('assets.fields.tags'), candidates: ['tags'] },
  ],
  contextLinks: [
    { label: t('assets.links.certificateBindings'), to: '/bindings', queryKey: 'serviceAssetId', candidates: ['id'] },
    { label: t('assets.links.executions'), to: '/executions', queryKey: 'serviceAssetId', candidates: ['id'] },
  ],
  emptyTitle: t('assets.empty.title'),
  emptyDescription: t('assets.empty.description'),
  load: loadAssetsWithDisplayNames,
  actions: [],
  rowActions: [
    {
      label: t('assets.actions.edit'),
      permission: 'service_asset.manage',
      reloadAfterRun: false,
      run: openEditDialog,
    },
    {
      label: t('assets.actions.detail'),
      permission: 'service_asset.read',
      reloadAfterRun: false,
      run: openDetailModal,
    },
    {
      label: t('assets.actions.delete'),
      permission: 'service_asset.manage',
      danger: true,
      confirmText: 'DELETE',
      riskText: t('assets.actions.deleteRisk'),
      run: async (row) => {
        await deleteServiceAsset(String(row.raw?.id ?? row.id ?? ''))
      },
    },
  ],
  onSelectionChange: handleServiceAssetSelection,
}))

const latestSnapshot = computed<ApiRecord | null>(() => snapshotItems.value[0] ?? null)

const latestSnapshotExecutionRunId = computed(() =>
  String(readNested(latestSnapshot.value, ['executionRunId']) ?? ''),
)

const bindingRelations = computed<ApiRecord[]>(() => {
  const items = readNested(selectedAssetDetail.value, ['targetBindingDetail', 'certificateBindings'])
  return Array.isArray(items) ? items as ApiRecord[] : []
})

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

const latestPublishedWorkflowVersion = computed(() => {
  const currentVersionId = String(selectedWorkflowTemplate.value?.currentVersionId ?? '')
  const current = workflowVersionItems.value.find((item) =>
    String(item.id ?? '') === currentVersionId && workflowVersionStatus(item) === 'published',
  )
  if (current) return current
  return [...workflowVersionItems.value]
    .filter((item) => workflowVersionStatus(item) === 'published')
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null
})

const selectedWorkflowVersion = computed(() =>
  assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED'
    ? latestPublishedWorkflowVersion.value
    : workflowVersionItems.value.find((item) => String(item.id ?? '') === assetDraft.workflowVersionId) ?? null,
)

const publishedWorkflowVersionItems = computed(() =>
  workflowVersionItems.value.filter((item) => workflowVersionStatus(item) === 'published'),
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
  if (!editingServiceAssetId.value) return true
  return !workflowProjectionError.value
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
  return Boolean(
    assetDraft.siteAssetId.trim()
    && assetDraft.agentCertificateFormatId.trim()
    && assetDraft.managedTargetId.trim()
    && pluginExecutionReady,
  )
})

const workflowStepReady = computed(() => {
  if (!workflowExecutionEnabled.value) return true
  const selectedVersionIsPublished = assetDraft.workflowVersionId
    && workflowVersionStatus(selectedWorkflowVersion.value) === 'published'
  const versionSelectionReady = assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED'
    ? workflowVersionStatus(selectedWorkflowVersion.value) === 'published'
    : selectedVersionIsPublished
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

const assetWizardProgress = computed(() => `${(assetWizardStep.value / 3) * 100}%`)

const canGoPreviousAssetStep = computed(() => assetWizardStep.value > 1)
const canGoNextAssetStep = computed(() =>
  (assetWizardStep.value === 1 && commonStepReady.value)
  || (assetWizardStep.value === 2 && modeStepReady.value),
)

const createDisabled = computed(() => {
  return createLoading.value
    || !commonStepReady.value
    || !modeStepReady.value
})

const isEditMode = computed(() => Boolean(editingServiceAssetId.value))

function handleServiceAssetSelection(row: ViewRow | null) {
  selectedServiceAsset.value = row
  rollbackError.value = ''
  rollbackRequestId.value = ''
}

async function openDetailModal(row: ViewRow) {
  selectedServiceAsset.value = row
  detailModalOpen.value = true
  activeDetailTab.value = 'overview'
  rollbackError.value = ''
  rollbackRequestId.value = ''
  await Promise.all([
    refreshAssetDetail(String(row.raw?.id ?? row.id ?? '')),
  ])
}

async function openCreateDialog() {
  resetDraft()
  assetWizardStep.value = 1
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
  await Promise.all([loadDevices(), loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
}

async function openEditDialog(row: ViewRow) {
  resetDraft()
  assetWizardStep.value = 1
  editingServiceAssetId.value = String(row.raw?.id ?? row.id ?? '')
  const detail = await getAssetDetail(editingServiceAssetId.value)
  editAssetDetail.value = detail.data ?? null
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
  await loadManagedTargets(assetDraft.siteAssetId)
  targetSelectionInitializing.value = false
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
  await Promise.all([loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
  if (assetDraft.managementMode === 'MANAGED_TARGET' && assetDraft.managedTargetId) {
    await loadManagedTargetPluginResolution(assetDraft.managedTargetId)
  }
  if (workflowExecutionBindingId) await loadExistingWorkflowExecutionBinding(workflowExecutionBindingId)
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
    workflowItems.value = [...(result.data?.items ?? [])]
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
    workflowVersionItems.value = [...(result.data?.items ?? [])]
    if (assetDraft.workflowVersionId && !workflowVersionItems.value.some((item) => String(item.id ?? '') === assetDraft.workflowVersionId)) {
      assetDraft.workflowVersionId = ''
    }
    if (assetDraft.workflowVersionSelection === 'PINNED' && !assetDraft.workflowVersionId && publishedWorkflowVersionItems.value.length === 1) {
      assetDraft.workflowVersionId = String(publishedWorkflowVersionItems.value[0]?.id ?? '')
    }
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
  assetDraft.workflowId = String(binding.workflowTemplateId ?? '')
  assetDraft.workflowVersionSelection = String(binding.workflowVersionSelection ?? 'PINNED') as WorkflowVersionSelection
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

async function refreshWorkflowBindingProjection() {
  workflowBindingProjection.value = null
  workflowProjectionError.value = ''
  if (!editingServiceAssetId.value) {
    workflowProjectionLoading.value = false
    return
  }
  workflowProjectionLoading.value = true
  try {
    const result = await projectDeploymentInputs(editingServiceAssetId.value)
    workflowBindingProjection.value = result.data ?? null
    if (workflowBindingProjection.value) {
      deploymentInputBindings.value = filterEditableInputBindings(workflowBindingProjection.value, deploymentInputBindings.value)
    }
  } catch (cause) {
    workflowProjectionError.value = cause instanceof ApiClientError ? cause.message : cause instanceof Error ? cause.message : String(cause)
  } finally {
    workflowProjectionLoading.value = false
  }
}

function filterEditableInputBindings(projection: DeploymentInputProjectionV1, bindings: DeploymentInputBindingsV1): DeploymentInputBindingsV1 {
  const variableSlots = new Set([...projection.requiredVariables, ...projection.advancedVariables].map((item) => item.slot))
  const connectionSlots = new Set(projection.connections.map((item) => item.slot))
  const credentialSlots = new Set(projection.credentials.map((item) => item.slot))
  const artifactSlots = new Set(projection.artifacts.map((item) => item.slot))
  return createInputBindingsV1({
    variables: Object.fromEntries(Object.entries(bindings.variables).filter(([slot]) => variableSlots.has(slot))),
    connections: Object.fromEntries(Object.entries(bindings.connections).filter(([slot]) => connectionSlots.has(slot))),
    credentials: Object.fromEntries(Object.entries(bindings.credentials).filter(([slot]) => credentialSlots.has(slot))),
    artifacts: Object.fromEntries(Object.entries(bindings.artifacts).filter(([slot]) => artifactSlots.has(slot))),
  })
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
    snapshotItems.value = []
    detailError.value = ''
    snapshotError.value = ''
    return
  }
  detailLoading.value = true
  snapshotLoading.value = true
  detailError.value = ''
  snapshotError.value = ''
  try {
    const [result, snapshots] = await Promise.all([
      getAssetDetail(serviceAssetId),
      listManagedTargetSnapshots({ page: 1, pageSize: 20, sort: 'capturedAt:desc', filters: { applicationAssetId: serviceAssetId } }),
    ])
    selectedAssetDetail.value = result.data ?? null
    snapshotItems.value = [...(snapshots.data?.items ?? [])]
  } catch (cause) {
    selectedAssetDetail.value = null
    snapshotItems.value = []
    if (cause instanceof ApiClientError) {
      detailError.value = cause.message
      snapshotError.value = cause.message
      return
    }
    const message = cause instanceof Error ? cause.message : t('assets.errors.loadAssetDetailFailed')
    detailError.value = message
    snapshotError.value = message
  } finally {
    detailLoading.value = false
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

async function loadManagedTargets(siteAssetId: string) {
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
        ...(workflowTarget ? { metadata: { ...(readRecord(readNested(editAssetDetail.value, ['metadata'])) ?? {}), workflowTarget } } : {}),
      })
      if (assetDraft.managementMode === 'MANAGED_TARGET') await saveManagedTargetConfiguration(editingServiceAssetId.value)
      else await saveStandaloneWorkflowConfiguration(editingServiceAssetId.value)
      createRequestId.value = result.requestId
      createDialogOpen.value = false
      editingServiceAssetId.value = ''
      await pageRef.value?.reload()
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
    }
    createRequestId.value = result.requestId
    createDialogOpen.value = false
    await pageRef.value?.reload()
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
  await saveApplicationAssetManagedTarget(applicationAssetId, {
    managedTargetId: assetDraft.managedTargetId,
    certificateFormatId: assetDraft.agentCertificateFormatId.trim(),
    executionMode: assetDraft.managedExecutionMode,
    capabilityKey: 'certificate.deploy',
    ...(assetDraft.managedExecutionMode === 'WORKFLOW_OVERRIDE'
      ? { workflowExecution: buildWorkflowExecutionInput() }
      : {}),
    ...(assetDraft.managedExecutionMode === 'PLUGIN' && assetDraft.pluginOverrideVersionId ? {
      pluginOverride: {
        pluginVersionId: assetDraft.pluginOverrideVersionId,
        pluginBindingId: pluginBindingId.value || undefined,
        expectedBindingVersion: pluginBindingId.value ? pluginBindingVersion.value : undefined,
        inputBindings: deploymentInputBindings.value,
      },
    } : {}),
  })
}

async function saveStandaloneWorkflowConfiguration(applicationAssetId: string): Promise<void> {
  await saveApplicationAssetStandaloneWorkflow(applicationAssetId, {
    workflowExecution: buildWorkflowExecutionInput(),
  })
}

function buildWorkflowExecutionInput(): Record<string, unknown> {
  return {
    tenantId: authStore.user?.tenantId ?? tenantStore.currentTenantId,
    workflowTemplateId: assetDraft.workflowId.trim(),
    workflowVersionSelection: assetDraft.workflowVersionSelection,
    ...(assetDraft.workflowVersionSelection === 'PINNED' ? { workflowVersionId: assetDraft.workflowVersionId.trim() } : {}),
    runner: assetDraft.workflowRunner,
    ...(assetDraft.workflowRunner === 'GATEWAY' ? { gatewayId: assetDraft.workflowGatewayId.trim() } : {}),
    inputBindings: deploymentInputBindings.value,
    ...(assetDraft.workflowExecutionBindingId ? {
      bindingId: assetDraft.workflowExecutionBindingId,
      expectedVersion: assetDraft.workflowExecutionBindingVersion,
    } : {}),
  }
}

function resetDraft() {
  editingServiceAssetId.value = ''
  editAssetDetail.value = null
  assetWizardStep.value = 1
  assetDraft.managementMode = 'MANAGED_TARGET'
  assetDraft.managedExecutionMode = 'PLUGIN'
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
  workflowBindingProjection.value = null
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
  await loadServiceInstances(assetDraft.deviceId)
  const matchingFramework = serviceInstanceItems.value.find((item) => String(item.id ?? '') === previousFrameworkId)
    ?? serviceInstanceItems.value.find((item) => frameworkTypesMatch(item.frameworkType, assetDraft.frameworkType))
  assetDraft.frameworkInstanceId = String(matchingFramework?.id ?? '')
  await refreshAssetTargets()
  assetDraft.siteAssetId = siteItems.value.some((item) => String(item.id ?? '') === previousSiteId) ? previousSiteId : ''
  await loadManagedTargets(assetDraft.siteAssetId)
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
    return {
      type: 'WORKFLOW',
      workflow: {
        pluginBindingId: pluginBindingId.value || undefined,
        workflowId: assetDraft.workflowId.trim(),
        workflowVersionSelection: assetDraft.workflowVersionSelection,
        ...(assetDraft.workflowVersionSelection === 'PINNED'
          ? { workflowVersionId: assetDraft.workflowVersionId.trim() }
          : {}),
        runner: assetDraft.workflowRunner,
        gatewayId,
        target: workflowTarget,
        inputBindings: deploymentInputBindings.value,
      },
    }
  }

  return {
    ...buildManagedTargetDeploymentStrategy(assetDraft.managedTargetId, assetDraft.agentCertificateFormatId),
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
  const options: Array<{ key: string; label: string; role: string }> = []
  if (formatName === 'pem') {
    if (parameters.includeLeafCertificate !== false && (parameters.includeCertificateChain || parameters.generateChainFile)) {
      options.push({ key: 'fullchain', label: `fullchain / ${t('assets.certificateOutputs.publicCertificateWithChain')}`, role: 'public_certificate' })
    }
    if (parameters.includeLeafCertificate !== false) options.push({ key: 'public', label: `public / ${t('assets.certificateOutputs.publicCertificate')}`, role: 'public_certificate' })
    if (parameters.includeCertificateChain || parameters.generateChainFile) options.push({ key: 'chain', label: `chain / ${t('assets.certificateOutputs.certificateChain')}`, role: 'certificate_chain' })
    if (containsPrivateKey || parameters.generatePrivateKeyFile) options.push({ key: 'private', label: `private / ${t('assets.certificateOutputs.privateKey')}`, role: 'private_key' })
    options.push({ key: 'bundle', label: `bundle / ${t('assets.certificateOutputs.pemBundle')}`, role: 'bundle' })
    return dedupeOutputOptions(options)
  }
  if (formatName === 'der') return [{ key: 'public', label: `public / DER ${t('assets.certificateOutputs.publicCertificate')}`, role: 'public_certificate' }]
  return [{ key: 'bundle', label: `bundle / ${t('assets.certificateOutputs.container', { format: formatName.toUpperCase() })}`, role: 'bundle' }]
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
  const parts = [
    String(item.name ?? item.displayName ?? item.id ?? ''),
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
  const value = String(readNested(deploymentStrategy, ['workflow', 'workflowVersionSelection']) ?? '')
  if (value === 'LATEST_PUBLISHED') return 'LATEST_PUBLISHED'
  if (value === 'PINNED') return 'PINNED'
  return String(readNested(deploymentStrategy, ['workflow', 'workflowVersionId']) ?? '').trim()
    ? 'PINNED'
    : 'LATEST_PUBLISHED'
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
  const version = String(item.version ?? item.versionNo ?? item.name ?? item.id ?? '')
  const status = workflowVersionStatus(item)
  return `${version}${status ? ` / ${workflowVersionStatusLabel(status)}` : ''}`
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

function renderValue(value: unknown, fallback = '—'): string {
  return formatMaybeLocalTime(value, fallback)
}

async function loadAssetsWithDisplayNames(): Promise<ApiPageResult> {
  const result = await listAssets({ page: 1, pageSize: 20, sort: 'updatedAt:desc' })
  const page = result.data
  if (!page || page.items.length === 0) return result
  return {
    ...result,
    data: {
      ...page,
      items: page.items.map((item) => enrichAssetDisplayNames(item)),
    },
  }
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

watch(
  () => assetDraft.pluginOverrideVersionId,
  async () => {
    if (editingServiceAssetId.value) await refreshWorkflowBindingProjection()
  },
)

watch(
  () => assetDraft.workflowId,
  async (workflowId, previousWorkflowId) => {
    if (previousWorkflowId && workflowId !== previousWorkflowId) {
      assetDraft.workflowVersionId = ''
    }
    if (!workflowExecutionEnabled.value) return
    await loadWorkflowVersions(workflowId)
  },
)

watch(
  () => assetDraft.workflowVersionId,
  async () => {
    if (!workflowExecutionEnabled.value) return
    await refreshWorkflowBindingProjection()
  },
)

watch(
  () => assetDraft.workflowVersionSelection,
  async () => {
    if (!workflowExecutionEnabled.value) return
    if (assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED') {
      assetDraft.workflowVersionId = ''
    } else if (!assetDraft.workflowVersionId && publishedWorkflowVersionItems.value.length === 1) {
      assetDraft.workflowVersionId = String(publishedWorkflowVersionItems.value[0]?.id ?? '')
    }
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
    <BusinessResourcePage ref="pageRef" :config="config" />

    <GcModal
      v-model:open="detailModalOpen"
      :title="t('assets.detail.title')"
      :description="t('assets.detail.description')"
      size="xxl"
      width="72vw"
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
              <h3>{{ t('assets.detail.sections.overview.title') }}</h3>
              <p>{{ t('assets.detail.sections.overview.description') }}</p>
            </div>
            <dl class="asset-detail-modal__grid">
              <div class="asset-detail-modal__item" v-for="field in config.detailFields" :key="field.label">
                <dt>{{ field.label }}</dt>
                <dd>{{ renderValue(detailFieldValue(field.candidates)) }}</dd>
              </div>
            </dl>
            <nav class="asset-detail-modal__links">
              <RouterLink
                v-for="link in config.contextLinks"
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
                <dt>Host Header</dt>
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
                    <span>Binding</span>
                    <strong>{{ renderValue(binding.bindingKey) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.domain') }}</span>
                    <strong>{{ renderValue(binding.domainName ?? binding.domain) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.currentCertificate') }}</span>
                    <strong>{{ certificateVersionLabel(String(binding.certificateVersionId ?? binding.localCertificateVersionId ?? '')) }}</strong>
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
                    <strong>{{ renderValue(snapshot.status) }}</strong>
                  </div>
                  <div>
                    <span>{{ t('assets.fields.time') }}</span>
                    <strong>{{ renderValue(snapshot.capturedAt ?? snapshot.createdAt) }}</strong>
                  </div>
                  <div>
                    <span>Thumbprint</span>
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
      v-model:open="createDialogOpen"
      :title="isEditMode ? t('assets.form.editTitle') : t('assets.form.createTitle')"
      :description="isEditMode ? t('assets.form.editDescription') : t('assets.form.createDescription')"
      size="xxl"
      width="980px"
    >
      <section class="asset-form asset-wizard">
        <div class="asset-wizard__progress">
          <div class="asset-wizard__progress-bar">
            <span class="asset-wizard__progress-fill" :style="{ width: assetWizardProgress }"></span>
          </div>
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
              <input v-model="assetDraft.address" placeholder="app.example.com" autocomplete="off" />
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.displayName') }}</span>
              <input v-model="assetDraft.displayName" :placeholder="t('assets.form.placeholders.displayName')" autocomplete="off" />
            </label>
            <label class="asset-form__field">
              <span>{{ t('assets.fields.port') }} <strong>*</strong></span>
              <input v-model="assetDraft.port" inputmode="numeric" placeholder="443" autocomplete="off" />
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
              <label class="asset-form__field">
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
              <section v-if="assetDraft.pluginOverrideVersionId" class="asset-form__field--wide">
                <p v-if="!editingServiceAssetId" class="asset-form__hint">{{ t('deploymentInputs.saveAssetFirst') }}</p>
                <p v-else-if="workflowProjectionError" class="asset-form__error">{{ workflowProjectionError }}</p>
                <DeploymentInputForm
                  v-else-if="workflowBindingProjection"
                  v-model="deploymentInputBindings"
                  :projection="workflowBindingProjection"
                  :credential-options="deploymentCredentialOptions"
                  :artifact-options="deploymentArtifactOptions"
                  :loading="workflowProjectionLoading"
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
                <span>Host Header</span>
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
                v-model:version-selection="assetDraft.workflowVersionSelection"
                v-model:workflow-version-id="assetDraft.workflowVersionId"
                v-model:runner="assetDraft.workflowRunner"
                v-model:gateway-id="assetDraft.workflowGatewayId"
                class="asset-form__field--wide"
                :workflows="workflowItems"
                :versions="publishedWorkflowVersionItems"
                :gateways="gatewayItems"
                :workflow-loading="workflowListLoading"
                :version-loading="workflowVersionListLoading"
                :gateway-loading="gatewayListLoading"
                :labels="{
                  workflow: t('assets.fields.selectWorkflow'), workflowPlaceholder: t('assets.select.workflow'),
                  versionSelection: t('assets.fields.workflowVersionSelection'), pinned: t('assets.workflowVersionSelection.pinned'), latestPublished: t('assets.workflowVersionSelection.latestPublished'),
                  version: t('assets.fields.publishedVersion'), versionPlaceholder: t('assets.select.publishedVersion'), runner: t('assets.fields.runner'), controlPlane: t('assets.runners.controlPlane'), gateway: t('assets.runners.gateway'), gatewayPlaceholder: t('assets.select.gateway'),
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
                    <input v-model="assetDraft.frameworkType" list="asset-framework-type-options" autocomplete="off">
                    <datalist id="asset-framework-type-options">
                      <option v-for="framework in availableFrameworkOptions" :key="framework" :value="framework" />
                    </datalist>
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
                <p v-else-if="workflowProjectionError" class="asset-form__error">{{ workflowProjectionError }}</p>
                <DeploymentInputForm
                  v-else-if="workflowBindingProjection"
                  v-model="deploymentInputBindings"
                  :projection="workflowBindingProjection"
                  :credential-options="deploymentCredentialOptions"
                  :artifact-options="deploymentArtifactOptions"
                  :loading="workflowProjectionLoading"
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
              <dd>{{ workflowTemplateLabel(selectedWorkflowTemplate ?? {}) || t('assets.empty.notSelected') }} / {{ assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED' ? t('assets.workflowVersionSelection.latestPublished') : workflowVersionLabel(selectedWorkflowVersion ?? {}) || t('assets.empty.notSelected') }}</dd>
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
        <button class="gc-button" type="button" :disabled="createLoading || !canGoPreviousAssetStep" @click="goPreviousAssetStep">{{ t('designSystem.deploymentWizard.actions.previous') }}</button>
        <button v-if="assetWizardStep < 3" class="gc-button gc-button--primary" type="button" :disabled="createLoading || !canGoNextAssetStep" @click="goNextAssetStep">{{ t('designSystem.deploymentWizard.actions.next') }}</button>
        <button v-else class="gc-button gc-button--danger" type="button" :disabled="createDisabled" @click="submitCreate">
          {{ createLoading ? (isEditMode ? t('assets.actions.saving') : t('assets.actions.creating')) : (isEditMode ? t('assets.actions.saveChanges') : t('assets.actions.confirmCreate')) }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.asset-page {
  display: grid;
  gap: var(--gc-space-4);
}

.asset-detail-modal {
  display: grid;
  gap: 12px;
}

.asset-detail-modal__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%),
    linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.asset-detail-modal__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.asset-detail-modal__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.asset-detail-modal__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 24px;
  line-height: 1.06;
  letter-spacing: -0.05em;
  overflow-wrap: anywhere;
}

.asset-detail-modal__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.asset-detail-modal__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.asset-detail-modal__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.asset-detail-modal__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.asset-detail-modal__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
  letter-spacing: -0.03em;
  overflow-wrap: anywhere;
}

.asset-detail-modal__sections {
  display: grid;
  gap: 10px;
}

.asset-detail-modal__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised));
}

.asset-detail-modal__section-head {
  display: grid;
  gap: 4px;
}

.asset-detail-modal__section-head h3,
.asset-detail-modal__section-head p {
  margin: 0;
}

.asset-detail-modal__section-head h3 {
  color: var(--gc-color-text);
  font-size: 15px;
  letter-spacing: -0.03em;
}

.asset-detail-modal__section-head p {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.asset-detail-modal__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.asset-detail-modal__item {
  display: grid;
  gap: 5px;
  min-height: 70px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
  border: 1px solid var(--gc-color-border-muted);
}

.asset-detail-modal__item dt {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.asset-detail-modal__item dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 13px;
  line-height: 1.35;
  font-weight: 800;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.asset-detail-modal__links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
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
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
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
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
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
  box-shadow: 0 0 0 4px var(--gc-color-focus-ring);
  background: var(--gc-color-surface-solid);
}
.asset-form__field textarea {
  min-height: 148px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  line-height: 1.45;
}
.asset-form__readonly {
  display: flex;
  align-items: center;
  min-height: 44px;
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
  border: 1px solid var(--gc-color-border);
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
  border-top: 1px solid var(--gc-color-border);
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
  border: 1px solid var(--gc-color-info-border);
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
  gap: 12px;
}

.asset-wizard__progress-bar {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--gc-color-muted-bg);
}

.asset-wizard__progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--gc-color-primary-strong), var(--gc-color-success));
  transition: width 160ms ease;
}

.asset-wizard__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.asset-wizard__step-button {
  width: 100%;
  min-height: 74px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 14px;
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
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--gc-color-info-border);
  color: var(--gc-color-primary-strong);
  font-size: 13px;
  font-weight: 900;
}

.asset-wizard__step.is-done .asset-wizard__step-index {
  background: var(--gc-color-success-bg);
  color: var(--gc-color-success);
}

.asset-wizard__step-button span:last-child {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.asset-wizard__step-button strong {
  font-size: 13px;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.asset-wizard__step-button small {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 750;
}

.asset-wizard__panel {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--gc-color-muted-bg);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-subtle));
}

.asset-wizard__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.asset-wizard__panel-header h3,
.asset-wizard__panel-header p {
  margin: 0;
}

.asset-wizard__panel-header h3 {
  color: var(--gc-color-text);
  font-size: 17px;
  line-height: 1.25;
}

.asset-wizard__panel-header p {
  margin-top: 4px;
  color: var(--gc-color-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.asset-wizard__panel-state {
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 6px 10px;
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-muted);
  font-size: 12px;
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
  gap: 10px;
}

.asset-wizard__mode-card {
  display: grid;
  gap: 5px;
  min-height: 82px;
  padding: 14px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 14px;
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-text);
  text-align: left;
  cursor: pointer;
}

.asset-wizard__mode-card.is-selected {
  border-color: var(--gc-color-primary-strong);
  background: var(--gc-color-surface-selected);
  box-shadow: 0 0 0 4px var(--gc-color-primary-soft);
}

.asset-wizard__mode-card span {
  color: var(--gc-color-primary-strong);
  font-size: 12px;
  font-weight: 900;
}

.asset-wizard__mode-card strong {
  font-size: 15px;
  line-height: 1.3;
}

.asset-wizard__review {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.asset-wizard__review div {
  display: grid;
  gap: 5px;
  min-height: 72px;
  padding: 11px 12px;
  border: 1px solid var(--gc-color-muted-bg);
  border-radius: 12px;
  background: var(--gc-color-surface-subtle);
}

.asset-wizard__review dt {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 850;
}

.asset-wizard__review dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 850;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

@media (max-width: 860px) {
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


