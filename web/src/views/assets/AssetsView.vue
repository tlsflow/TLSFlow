<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { createManagedTarget, createServiceAsset, createServiceInstance, createSiteAsset, getAgentDetail, getAssetDetail, listAgents, listAssets, listManagedTargetSnapshots, listManagedTargets, listServiceInstances, listSiteAssets, projectWorkflowBinding, updateServiceAsset } from '@/api/modules/assets.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import { listGateways } from '@/api/modules/gateways.api'
import { listWorkflowTemplates, listWorkflowTemplateVersions } from '@/api/modules/workflow-templates.api'
import { listCertificateFormats } from '@/api/modules/certificates.api'
import { listAgentPluginPackages, previewAgentPluginBinding } from '@/api/modules/plugins.api'
import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import type { ViewRow } from '@/composables/useBusinessPage'
import { GcModal, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { buildManagedTargetDeploymentStrategy, resolveDeploymentStrategyMode } from './asset-deployment-strategy.model'
import {
  loadWorkflowCredentials,
  workflowCredentialBinding,
  workflowCredentialLabel,
  workflowCredentialSummary,
  type WorkflowManagedCredential,
} from '@/views/workflows/workflow-credentials'

type AssetPlatform = 'WINDOWS' | 'LINUX' | 'APPLIANCE'
type AssetProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP' | 'CUSTOM'
type FrameworkType = 'IIS' | 'NGINX' | 'APACHE' | 'TOMCAT' | 'CUSTOM' | 'DEVICE_TEMPLATE'
type AssetManagementMode = 'MANAGED_TARGET' | 'WORKFLOW'
type AgentDeploymentMode = 'NATIVE_HANDLER' | 'PLUGIN'
type WorkflowRunnerType = 'CONTROL_PLANE' | 'GATEWAY'
type WorkflowVersionSelection = 'PINNED' | 'LATEST_PUBLISHED'
type AssetWizardStep = 1 | 2 | 3
type WorkflowVariableType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'file' | 'credential' | 'certificate'

interface AssetDraft {
  managementMode: AssetManagementMode
  address: string
  port: string
  protocol: AssetProtocol
  platform: AssetPlatform
  verifyUrl: string
  agentId: string
  agentDeploymentMode: AgentDeploymentMode
  agentPluginPackageId: string
  frameworkType: FrameworkType
  siteAssetId: string
  managedTargetId: string
  agentCertificateFormatId: string
  displayName: string
  environment: string
  tagsText: string
  workflowId: string
  workflowVersionSelection: WorkflowVersionSelection
  workflowVersionId: string
  workflowRunner: WorkflowRunnerType
  workflowGatewayId: string
  workflowTargetSiteName: string
  workflowTargetBindingInformation: string
  workflowTargetHostHeader: string
  workflowTargetSniName: string
}

interface WorkflowVariableRow {
  id: string
  name: string
  type: WorkflowVariableType
  value: string
  required: boolean
  description: string
  enumValues: string[]
  fromDefinition: boolean
}

interface WorkflowBindingProjection {
  required: ApiRecord[]
  advanced: ApiRecord[]
  runtime: ApiRecord[]
  basicConnections: WorkflowConnectionProjection[]
  advancedConnections: WorkflowConnectionProjection[]
  diagnostics: ApiRecord[]
}

interface WorkflowConnectionProjection extends ApiRecord {
  name: string
  protocol: string
  host?: string
  port?: number
  username?: string
  credentialRef?: string
  expectedHostKeyFingerprint?: string
  fieldModes?: {
    host?: 'required' | 'advanced'
    port?: 'required' | 'advanced'
    username?: 'required' | 'advanced'
    credential?: 'required' | 'advanced'
    hostKey?: 'required' | 'advanced'
  }
}

interface WorkflowVariablePreset {
  readonly name: string
  readonly type: WorkflowVariableType
  readonly descriptionKey: string
}

interface WorkflowCertificateArtifactBinding {
  certificateFormatId: string
  outputBindings: Record<string, string>
}

interface WorkflowTargetInfo {
  frameworkType: FrameworkType
  siteName: string
  bindingInformation?: string
  hostHeader?: string
  port: number
  protocol: AssetProtocol
  verifyUrl?: string
  sniName?: string
}

interface AgentBindingCandidate {
  protocol: string
  port?: number
  hostHeader: string
  bindingInformation: string
  listenIp?: string
}

interface AgentSiteCandidate {
  id: string
  siteName: string
  appPool?: string
  physicalPath?: string
  providerType: FrameworkType
  hostHeader: string
  listenIp?: string
  port?: number
  bindingInformation: string
  bindings: AgentBindingCandidate[]
  source: 'persisted' | 'agent_capability'
}

interface AgentManagedTargetCandidate {
  id: string
  agentId: string
  frameworkType: FrameworkType
  siteAssetId: string
  targetType: string
  targetKey: string
  bindingKey: string
  hostHeader: string
  port?: number
  source: 'agent_capability'
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const { t } = useI18n()
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
const agentListLoading = ref(false)
const agentItems = ref<ApiRecord[]>([])
const siteListLoading = ref(false)
const siteItems = ref<ApiRecord[]>([])
const siteListError = ref('')
const managedTargetListLoading = ref(false)
const managedTargetItems = ref<ApiRecord[]>([])
const managedTargetListError = ref('')
const fallbackSiteItems = ref<AgentSiteCandidate[]>([])
const fallbackManagedTargetItems = ref<AgentManagedTargetCandidate[]>([])
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
const workflowVariableRows = ref<WorkflowVariableRow[]>([])
const workflowBindingProjection = ref<WorkflowBindingProjection | null>(null)
const workflowProjectionLoading = ref(false)
const workflowProjectionError = ref('')
let workflowProjectionRequestSequence = 0
const workflowAdvancedExpanded = ref(false)
const workflowTargetAdvancedExpanded = ref(false)
const workflowConnectionBindings = ref<Record<string, Record<string, unknown>>>({})
const workflowVariablePresetName = ref('')
const workflowCredentialItems = ref<WorkflowManagedCredential[]>([])
const workflowCredentialLoading = ref(false)
const certificateFormatItems = ref<ApiRecord[]>([])
const certificateFormatLoading = ref(false)
const workflowListError = ref('')
const workflowVersionListError = ref('')
const gatewayListError = ref('')
const workflowCredentialError = ref('')
const certificateFormatError = ref('')
const workflowCertificateArtifactBindings = ref<Record<string, WorkflowCertificateArtifactBinding>>({})
const agentPluginPackageItems = ref<ApiRecord[]>([])
const agentPluginVariableBindings = ref<Record<string, string>>({})
const agentPluginSecretBindings = ref<Record<string, string>>({})
const agentPluginArtifactBindings = ref<Record<string, string>>({})
const agentPluginPreviewError = ref('')
let workflowVariableRowSeed = 1

const workflowVariablePresets: readonly WorkflowVariablePreset[] = [
  { name: 'deviceHost', type: 'string', descriptionKey: 'assets.workflowVariables.presets.deviceHost' },
  { name: 'sshUsername', type: 'string', descriptionKey: 'assets.workflowVariables.presets.sshUsername' },
  { name: 'credential', type: 'credential', descriptionKey: 'assets.workflowVariables.presets.credential' },
  { name: 'certificate', type: 'certificate', descriptionKey: 'assets.workflowVariables.presets.certificate' },
  { name: 'targetPlatform', type: 'enum', descriptionKey: 'assets.workflowVariables.presets.targetPlatform' },
  { name: 'verifyHost', type: 'string', descriptionKey: 'assets.workflowVariables.presets.verifyHost' },
  { name: 'verifyPort', type: 'number', descriptionKey: 'assets.workflowVariables.presets.verifyPort' },
  { name: 'verifyPath', type: 'string', descriptionKey: 'assets.workflowVariables.presets.verifyPath' },
  { name: 'apacheServiceName', type: 'string', descriptionKey: 'assets.workflowVariables.presets.apacheServiceName' },
  { name: 'apacheSiteConfigPath', type: 'string', descriptionKey: 'assets.workflowVariables.presets.apacheSiteConfigPath' },
  { name: 'certificateFilePath', type: 'string', descriptionKey: 'assets.workflowVariables.presets.certificateFilePath' },
  { name: 'certificateKeyFilePath', type: 'string', descriptionKey: 'assets.workflowVariables.presets.certificateKeyFilePath' },
  { name: 'backupRoot', type: 'string', descriptionKey: 'assets.workflowVariables.presets.backupRoot' },
  { name: 'expectedResponseContains', type: 'string', descriptionKey: 'assets.workflowVariables.presets.expectedResponseContains' },
  { name: 'virtualHostServerName', type: 'string', descriptionKey: 'assets.workflowVariables.presets.virtualHostServerName' },
  { name: 'frameworkType', type: 'enum', descriptionKey: 'assets.fields.frameworkType' },
  { name: 'siteName', type: 'string', descriptionKey: 'assets.fields.siteName' },
  { name: 'bindingInformation', type: 'string', descriptionKey: 'assets.fields.bindingInformation' },
  { name: 'hostHeader', type: 'string', descriptionKey: 'assets.fields.hostHeader' },
  { name: 'port', type: 'number', descriptionKey: 'assets.fields.port' },
  { name: 'protocol', type: 'enum', descriptionKey: 'assets.fields.protocol' },
  { name: 'verifyUrl', type: 'string', descriptionKey: 'assets.fields.verifyUrl' },
  { name: 'sniName', type: 'string', descriptionKey: 'assets.fields.sniName' },
]

const assetDraft = reactive<AssetDraft>({
  managementMode: 'MANAGED_TARGET',
  address: '',
  port: '443',
  protocol: 'HTTPS',
  platform: 'LINUX',
  verifyUrl: '',
  agentId: '',
  agentDeploymentMode: 'NATIVE_HANDLER',
  agentPluginPackageId: '',
  frameworkType: 'NGINX',
  siteAssetId: '',
  managedTargetId: '',
  agentCertificateFormatId: '',
  displayName: '',
  environment: '',
  tagsText: '',
  workflowId: '',
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
    { key: 'frameworkType', title: t('assets.columns.framework'), candidates: ['targetBinding.frameworkType', 'metadata.workflowTarget.frameworkType', 'deploymentStrategy.workflow.target.frameworkType'] },
    { key: 'siteName', title: t('assets.columns.site'), candidates: ['siteDisplayName', 'targetBindingDetail.siteAsset.siteName', 'targetBinding.metadata.siteName', 'metadata.workflowTarget.siteName', 'deploymentStrategy.workflow.target.siteName', 'targetBinding.siteAssetId'] },
    { key: 'agentId', title: 'Agent', candidates: ['agentDisplayName', 'agentName', 'targetBinding.agentDisplayName', 'agentId'] },
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

const filteredAgentItems = computed(() => {
  const expectedOsType = assetDraft.platform === 'APPLIANCE' ? 'NETWORK_DEVICE' : assetDraft.platform
  return agentItems.value.filter((item) => {
    const agentOsType = String(readNested(item, ['descriptor', 'osType']) ?? item.osType ?? '').toUpperCase()
    return agentOsType === expectedOsType
  })
})

const availableFrameworkOptions = computed<FrameworkType[]>(() => {
  if (assetDraft.managementMode === 'WORKFLOW') return ['NGINX', 'APACHE', 'TOMCAT', 'IIS', 'CUSTOM']
  if (assetDraft.platform === 'WINDOWS') return ['IIS']
  if (assetDraft.platform === 'LINUX') return ['NGINX', 'APACHE', 'TOMCAT']
  return ['DEVICE_TEMPLATE']
})

const filteredSiteItems = computed(() => {
  const persisted = siteItems.value.filter((item) => {
    const agentId = String(item.agentId ?? '')
    const providerType = String(item.providerType ?? '').toUpperCase()
    return (!assetDraft.agentId || agentId === assetDraft.agentId)
      && (!assetDraft.frameworkType || providerType === assetDraft.frameworkType)
  })
  if (persisted.length > 0) return persisted
  return fallbackSiteItems.value as unknown as ApiRecord[]
})

const filteredManagedTargetItems = computed(() => {
  const persisted = managedTargetItems.value.filter((item) => {
    const agentId = String(item.agentId ?? '')
    const frameworkType = String(item.frameworkType ?? '').toUpperCase()
    const siteAssetId = String(item.siteAssetId ?? '')
    return (!assetDraft.agentId || agentId === assetDraft.agentId)
      && (!assetDraft.frameworkType || frameworkType === assetDraft.frameworkType)
      && (!assetDraft.siteAssetId || siteAssetId === assetDraft.siteAssetId)
  })
  if (persisted.length > 0) return persisted
  return fallbackManagedTargetItems.value
    .filter((item) => !assetDraft.siteAssetId || item.siteAssetId === assetDraft.siteAssetId) as unknown as ApiRecord[]
})

const selectedSiteAsset = computed(() =>
  filteredSiteItems.value.find((item) => String(item.id ?? '') === assetDraft.siteAssetId) ?? null,
)

const selectedManagedTarget = computed(() =>
  filteredManagedTargetItems.value.find((item) => String(item.id ?? '') === assetDraft.managedTargetId) ?? null,
)

const editAgentLabel = computed(() => {
  if (!isEditMode.value) return ''
  const agentId = String(readNested(editAssetDetail.value, ['agentId']) ?? assetDraft.agentId ?? '')
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

const agentCertificateFormatOptions = computed(() => {
  const platform = assetDraft.platform.toLowerCase()
  const framework = assetDraft.frameworkType.toLowerCase()
  const matched = certificateFormatItems.value.filter((item) => {
    const parameters = readRecord(item.parameters) ?? {}
    const systemPlatform = String(parameters.systemPlatform ?? '').toLowerCase()
    const runtimePlatform = String(parameters.runtimePlatform ?? '').toLowerCase()
    return (!systemPlatform || systemPlatform === platform)
      && (!runtimePlatform || runtimePlatform === framework || runtimePlatform === 'other')
  })
  const base = matched.length > 0 ? matched : certificateFormatItems.value
  const selectedId = assetDraft.agentCertificateFormatId.trim()
  if (!selectedId || base.some((item) => String(item.id ?? '') === selectedId)) return base
  return [{ id: selectedId, format: 'unknown', parameters: { configName: t('assets.certificateFormats.savedConfigMissingWithId', { id: selectedId }) } }, ...base]
})

const selectedWorkflowVariableDefinitions = computed(() =>
  readWorkflowVariableDefinitions(selectedWorkflowVersion.value),
)

const selectedWorkflowCertificateVariables = computed(() =>
  Object.entries(selectedWorkflowVariableDefinitions.value)
    .filter(([, definition]) => workflowVariableType(definition) === 'certificate')
    .map(([name, definition]) => ({ name, definition, outputs: workflowCertificateOutputSlots(definition) })),
)

const workflowCertificateArtifactError = computed(() => validateWorkflowCertificateArtifactBindings())

const workflowVariableNames = computed(() =>
  new Set(workflowVariableRows.value.map((row) => row.name.trim()).filter(Boolean)),
)

const availableWorkflowVariablePresets = computed(() => {
  const declared = Object.entries(selectedWorkflowVariableDefinitions.value).map(([name, definition]) => ({
    name,
    type: workflowVariableType(definition),
    description: String(readNested(definition, ['description']) ?? ''),
  }))
  const merged = new Map<string, { name: string; type: WorkflowVariableType; description: string }>()
  const presetItems = workflowVariablePresets.map((item) => ({
    name: item.name,
    type: item.type,
    description: t(item.descriptionKey),
  }))
  for (const item of [...declared, ...presetItems]) {
    if (!workflowVariableNames.value.has(item.name)) merged.set(item.name, item)
  }
  return [...merged.values()]
})

const workflowVariablesError = computed(() => validateWorkflowVariableRows())

const workflowProjectionReady = computed(() => {
  const projection = workflowBindingProjection.value
  if (!projection) return !workflowVariablesError.value
  const unresolvedVariable = projection.required.some((item) => {
    if (String(item.status ?? '') === 'resolved') return false
    const row = workflowVariableRows.value.find((candidate) => candidate.name === String(item.name ?? ''))
    return !row || !rowValueHasContent(row)
  })
  const unresolvedConnection = projection.basicConnections.some((item) => {
    if (String(item.status ?? '') === 'resolved') return false
    const binding = workflowConnectionBindings.value[String(item.name ?? '')]
    return !String(binding?.host ?? item.host ?? '').trim()
      || !String(binding?.username ?? item.username ?? '').trim()
      || !String(binding?.credentialRef ?? item.credentialRef ?? '').trim()
  })
  return !unresolvedVariable && !unresolvedConnection && !workflowProjectionError.value
})

const workflowVariableConfiguredCount = computed(() =>
  workflowVariableRows.value.filter((row) => row.name.trim() && rowValueHasContent(row)).length,
)

const effectiveVerifyUrl = computed(() => {
  const explicit = assetDraft.verifyUrl.trim()
  if (explicit) return explicit
  const address = assetDraft.address.trim()
  const port = Number(assetDraft.port)
  if (!address || !Number.isInteger(port) || port < 1 || port > 65535) return ''
  return `${assetDraft.protocol.toLowerCase()}://${address}:${port}`
})

const workflowTargetPreview = computed(() =>
  assetDraft.managementMode === 'WORKFLOW' ? buildWorkflowTargetInfo() : null,
)

const commonStepReady = computed(() => {
  const port = Number(assetDraft.port)
  return Boolean(
    assetDraft.address.trim()
    && Number.isInteger(port)
    && port >= 1
    && port <= 65535,
  )
})

const agentStepReady = computed(() => {
  if (assetDraft.managementMode !== 'MANAGED_TARGET') return true
  return Boolean(assetDraft.managedTargetId.trim() && assetDraft.agentCertificateFormatId.trim())
})

const compatibleAgentPluginPackages = computed(() => agentPluginPackageItems.value.filter((item) => {
  if (item.catalogEnabled !== true) return false
  const compatibility = readRecord(readRecord(item.manifest)?.compatibility) ?? {}
  const platforms = Array.isArray(compatibility.platforms) ? compatibility.platforms.map((value) => String(value).toUpperCase()) : []
  const frameworks = Array.isArray(compatibility.frameworks) ? compatibility.frameworks.map((value) => String(value).toUpperCase()) : []
  if (!platforms.includes(assetDraft.platform)) return false
  return frameworks.length === 0 || frameworks.includes(assetDraft.frameworkType)
}))

const selectedAgentPluginPackage = computed(() =>
  agentPluginPackageItems.value.find((item) => String(item.id ?? '') === assetDraft.agentPluginPackageId) ?? null,
)

const selectedAgentPluginManifest = computed(() => readRecord(selectedAgentPluginPackage.value?.manifest) ?? {})
const selectedAgentPluginVariables = computed(() => Object.entries(readRecord(selectedAgentPluginManifest.value.variables) ?? {}))
const selectedAgentPluginArtifacts = computed(() => Object.entries(readRecord(selectedAgentPluginManifest.value.artifactInputs) ?? {}))

const workflowStepReady = computed(() => {
  if (assetDraft.managementMode !== 'WORKFLOW') return true
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
    && !workflowCertificateArtifactError.value
  )
})

const modeStepReady = computed(() =>
  assetDraft.managementMode === 'WORKFLOW' ? workflowStepReady.value : agentStepReady.value,
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
  await Promise.all([loadAgents(), loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
}

async function openEditDialog(row: ViewRow) {
  resetDraft()
  assetWizardStep.value = 1
  editingServiceAssetId.value = String(row.raw?.id ?? row.id ?? '')
  const detail = await getAssetDetail(editingServiceAssetId.value)
  editAssetDetail.value = detail.data ?? null
  const source = detail.data ?? row.raw
  assetDraft.address = String(readNested(source, ['address']) ?? '')
  assetDraft.port = String(readNested(source, ['port']) ?? '443')
  assetDraft.protocol = String(readNested(source, ['protocol']) ?? 'HTTPS') as AssetProtocol
  assetDraft.platform = String(readNested(source, ['platform']) ?? 'LINUX') as AssetPlatform
  assetDraft.verifyUrl = String(readNested(source, ['verifyUrl']) ?? readNested(source, ['metadata', 'verifyUrl']) ?? '')
  assetDraft.displayName = String(readNested(source, ['displayName']) ?? '')
  assetDraft.environment = String(readNested(source, ['environment']) ?? '')
  const tags = readNested(source, ['tags'])
  assetDraft.tagsText = Array.isArray(tags) ? tags.map((item: unknown) => String(item)).join(', ') : ''
  assetDraft.agentId = String(readNested(source, ['agentId']) ?? '')
  assetDraft.frameworkType = String(readNested(source, ['targetBinding', 'frameworkType']) ?? assetDraft.frameworkType) as FrameworkType
  assetDraft.siteAssetId = String(readNested(source, ['targetBinding', 'siteAssetId']) ?? '')
  assetDraft.managedTargetId = String(readNested(source, ['targetBinding', 'managedTargetId']) ?? '')
  const deploymentStrategy = readDeploymentStrategy(source)
  assetDraft.managementMode = resolveDeploymentStrategyMode(deploymentStrategy)
  if (assetDraft.managementMode === 'WORKFLOW') {
    const variableBindings = readRecord(readNested(deploymentStrategy, ['workflow', 'parameterBindings']))
      ?? readRecord(readNested(deploymentStrategy, ['workflow', 'variableBindings']))
      ?? {}
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
    assetDraft.workflowVersionSelection = readWorkflowVersionSelection(deploymentStrategy)
    assetDraft.workflowVersionId = String(readNested(deploymentStrategy, ['workflow', 'workflowVersionId']) ?? '')
    assetDraft.workflowRunner = String(readNested(deploymentStrategy, ['workflow', 'runner']) ?? 'CONTROL_PLANE') as WorkflowRunnerType
    assetDraft.workflowGatewayId = String(readNested(deploymentStrategy, ['workflow', 'gatewayId']) ?? '')
    workflowConnectionBindings.value = (readRecord(readNested(deploymentStrategy, ['workflow', 'connectionBindings'])) ?? {}) as Record<string, Record<string, unknown>>
    const bindingVerifyUrl = readWorkflowBindingText(variableBindings, 'verifyUrl')
    if (!assetDraft.verifyUrl.trim() && bindingVerifyUrl) assetDraft.verifyUrl = bindingVerifyUrl
    workflowVariableRows.value = variableRowsFromBindings(variableBindings)
    workflowCertificateArtifactBindings.value = readWorkflowCertificateArtifactBindingsFromAsset(source, deploymentStrategy)
  } else {
    assetDraft.managementMode = 'MANAGED_TARGET'
    assetDraft.agentId = String(readNested(deploymentStrategy, ['agent', 'agentId']) ?? assetDraft.agentId)
    assetDraft.agentDeploymentMode = String(readNested(deploymentStrategy, ['agent', 'mode']) ?? 'NATIVE_HANDLER') as AgentDeploymentMode
    assetDraft.agentPluginPackageId = String(readNested(deploymentStrategy, ['agent', 'plugin', 'pluginPackageId']) ?? '')
    assetDraft.siteAssetId = String(readNested(deploymentStrategy, ['agent', 'siteAssetId']) ?? assetDraft.siteAssetId)
    assetDraft.managedTargetId = String(readNested(deploymentStrategy, ['agent', 'managedTargetId']) ?? assetDraft.managedTargetId)
    assetDraft.agentCertificateFormatId = String(readNested(deploymentStrategy, ['agent', 'certificateFormatId']) ?? '')
    agentPluginVariableBindings.value = stringifyBindingValues(readRecord(readNested(deploymentStrategy, ['agent', 'plugin', 'variableBindings'])) ?? {})
    agentPluginSecretBindings.value = stringifyBindingValues(readRecord(readNested(deploymentStrategy, ['agent', 'plugin', 'secretBindings'])) ?? {})
    agentPluginArtifactBindings.value = stringifyArtifactBindings(readRecord(readNested(deploymentStrategy, ['agent', 'plugin', 'certificateArtifactBindings'])) ?? {})
  }
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
  await Promise.all([loadAgents(), loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow(), loadAgentPlugins()])
  if (assetDraft.workflowId) await loadWorkflowVersions(assetDraft.workflowId)
  if (selectedWorkflowVersion.value) syncWorkflowVariableRowsFromVersion()
}

function closeCreateDialog() {
  if (!createLoading.value) {
    createDialogOpen.value = false
    editingServiceAssetId.value = ''
    editAssetDetail.value = null
  }
}

async function loadAgents() {
  agentListLoading.value = true
  try {
    const result = await listAgents({ page: 1, pageSize: 200, sort: 'updatedAt:desc' })
    agentItems.value = [...(result.data?.items ?? [])]
  } finally {
    agentListLoading.value = false
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
    if (assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED') {
      syncWorkflowVariableRowsFromVersion()
    }
    ensureWorkflowCertificateArtifactBindings()
    if (selectedWorkflowVersion.value) {
      syncWorkflowVariableRowsFromVersion()
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

async function refreshWorkflowBindingProjection() {
  const requestSequence = ++workflowProjectionRequestSequence
  workflowBindingProjection.value = null
  workflowProjectionError.value = ''
  const version = selectedWorkflowVersion.value
  if (assetDraft.managementMode !== 'WORKFLOW' || !assetDraft.workflowId || !version) {
    workflowProjectionLoading.value = false
    return
  }
  workflowProjectionLoading.value = true
  try {
    const result = await projectWorkflowBinding({
      workflowId: assetDraft.workflowId,
      workflowVersionId: String(version.id ?? ''),
      serviceAssetId: editingServiceAssetId.value || undefined,
      asset: { address: assetDraft.address, port: Number(assetDraft.port), protocol: assetDraft.protocol, verifyUrl: assetDraft.verifyUrl },
      target: buildWorkflowTargetInfo(),
      connectionBindings: workflowConnectionBindings.value,
      parameterBindings: buildWorkflowVariableBindings(),
    })
    if (requestSequence !== workflowProjectionRequestSequence) return
    workflowBindingProjection.value = (result.data?.projection ?? null) as WorkflowBindingProjection | null
  } catch (cause) {
    if (requestSequence !== workflowProjectionRequestSequence) return
    workflowProjectionError.value = cause instanceof ApiClientError ? cause.message : cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (requestSequence === workflowProjectionRequestSequence) workflowProjectionLoading.value = false
  }
}

function projectionItemValue(item: ApiRecord): string {
  const name = String(item.name ?? '')
  const row = workflowVariableRows.value.find((candidate) => candidate.name === name)
  return row?.value ?? String(item.value ?? '')
}

function projectionItemType(item: ApiRecord): WorkflowVariableType {
  return workflowVariableType(item)
}

function updateProjectionVariable(item: ApiRecord, value: string) {
  const name = String(item.name ?? '')
  const row = workflowVariableRows.value.find((candidate) => candidate.name === name)
  if (row) row.value = value
  else workflowVariableRows.value.push({ id: nextWorkflowVariableRowId(), name, type: workflowVariableType(item), value, required: true, description: String(item.description ?? ''), enumValues: readStringArray(item.enum), fromDefinition: true })
}

function updateProjectionConnection(name: string, field: string, value: string) {
  workflowConnectionBindings.value = { ...workflowConnectionBindings.value, [name]: { ...(workflowConnectionBindings.value[name] ?? {}), [field]: field === 'port' ? Number(value) : value } }
}

function updateProjectionConnectionCredential(name: string, credentialId: string) {
  const credential = workflowCredentialItems.value.find((item) => item.id === credentialId)
  workflowConnectionBindings.value = {
    ...workflowConnectionBindings.value,
    [name]: {
      ...(workflowConnectionBindings.value[name] ?? {}),
      credentialRef: credentialId,
      credential: credential ? workflowCredentialBinding(credential) : undefined,
    },
  }
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
    const result = await listCertificateFormats({ page: 1, pageSize: 200, sort: 'createdAt:desc' })
    certificateFormatItems.value = [...(result.data?.items ?? [])]
    ensureWorkflowCertificateArtifactBindings()
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
  managedTargetListLoading.value = true
  siteListError.value = ''
  managedTargetListError.value = ''
  siteItems.value = []
  managedTargetItems.value = []
  fallbackSiteItems.value = []
  fallbackManagedTargetItems.value = []
  const agentId = assetDraft.agentId.trim()
  const frameworkType = assetDraft.frameworkType.trim()
  const siteAssetId = assetDraft.siteAssetId.trim()
  if (!agentId || !frameworkType) {
    siteListLoading.value = false
    managedTargetListLoading.value = false
    return
  }
  try {
    const siteResult = await listSiteAssets({
      page: 1,
      pageSize: 200,
      sort: 'updatedAt:desc',
      filters: {
        agentId,
        providerType: frameworkType,
      },
    })
    siteItems.value = [...(siteResult.data?.items ?? [])]
    if (siteItems.value.length === 0) {
      fallbackSiteItems.value = await loadAgentSiteCandidates(agentId, frameworkType as FrameworkType)
      fallbackManagedTargetItems.value = buildFallbackManagedTargetCandidates(agentId, fallbackSiteItems.value)
    }
    if (!siteAssetId) return
    const targetResult = await listManagedTargets({
      page: 1,
      pageSize: 200,
      sort: 'updatedAt:desc',
      filters: {
        agentId,
        frameworkType,
        siteAssetId,
      },
    })
    managedTargetItems.value = [...(targetResult.data?.items ?? [])]
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      siteListError.value = cause.message
      managedTargetListError.value = cause.message
    } else {
      const message = cause instanceof Error ? cause.message : t('assets.errors.loadTargetsFailed')
      siteListError.value = message
      managedTargetListError.value = message
    }
  } finally {
    siteListLoading.value = false
    managedTargetListLoading.value = false
  }
}

async function submitCreate() {
  createLoading.value = true
  createError.value = ''
  createRequestId.value = ''
  try {
    syncWorkflowTargetVariableRowsFromDraft()
    const workflowTarget = assetDraft.managementMode === 'WORKFLOW' ? buildWorkflowTargetInfo() : null
    const basePayload = {
      address: assetDraft.address.trim(),
      displayName: assetDraft.displayName.trim() || assetDraft.address.trim(),
      port: Number(assetDraft.port),
      protocol: assetDraft.protocol,
      platform: assetDraft.platform,
      verifyUrl: (workflowTarget?.verifyUrl ?? assetDraft.verifyUrl.trim()) || undefined,
      sniName: workflowTarget?.sniName ?? undefined,
      environment: assetDraft.environment.trim() || undefined,
      tags: splitCsv(assetDraft.tagsText),
      deploymentStrategy: buildDeploymentStrategyPayload(workflowTarget ?? undefined),
    }
    if (isEditMode.value) {
      const result = await updateServiceAsset(editingServiceAssetId.value, {
        ...basePayload,
        ...(workflowTarget ? { metadata: { ...(readRecord(readNested(editAssetDetail.value, ['metadata'])) ?? {}), workflowTarget } } : {}),
      })
      createRequestId.value = result.requestId
      createDialogOpen.value = false
      editingServiceAssetId.value = ''
      await pageRef.value?.reload()
      return
    }
    if (assetDraft.managementMode === 'WORKFLOW') {
      const result = await createServiceAsset({
        ...basePayload,
        discoverySource: 'MANUAL',
        status: 'ACTIVE',
        metadata: workflowTarget ? { workflowTarget } : {},
      })
      createRequestId.value = result.requestId
      createDialogOpen.value = false
      await pageRef.value?.reload()
      return
    }
    const resolvedBinding = await ensureTargetBindingResources()
    const result = await createServiceAsset({
      ...basePayload,
      agentId: assetDraft.agentId.trim(),
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
      metadata: {},
      targetBinding: {
        agentId: assetDraft.agentId.trim(),
        siteAssetId: resolvedBinding.siteAssetId,
        managedTargetId: resolvedBinding.managedTargetId,
        providerType: assetDraft.frameworkType,
        frameworkType: assetDraft.frameworkType,
        targetType: String(resolvedBinding.targetType),
        targetKey: String(resolvedBinding.targetKey),
        bindingKey: String(resolvedBinding.bindingKey ?? ''),
        status: 'ACTIVE',
        metadata: {
          siteName: resolvedBinding.siteName,
          bindingInformation: resolvedBinding.bindingInformation,
          hostHeader: resolvedBinding.hostHeader,
          port: resolvedBinding.port,
        },
      },
    })
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

function resetDraft() {
  editingServiceAssetId.value = ''
  editAssetDetail.value = null
  assetWizardStep.value = 1
  assetDraft.managementMode = 'MANAGED_TARGET'
  assetDraft.address = ''
  assetDraft.port = '443'
  assetDraft.protocol = 'HTTPS'
  assetDraft.platform = 'LINUX'
  assetDraft.verifyUrl = ''
  assetDraft.agentId = ''
  assetDraft.agentDeploymentMode = 'NATIVE_HANDLER'
  assetDraft.agentPluginPackageId = ''
  assetDraft.frameworkType = 'NGINX'
  assetDraft.siteAssetId = ''
  assetDraft.managedTargetId = ''
  assetDraft.agentCertificateFormatId = ''
  assetDraft.displayName = ''
  assetDraft.environment = ''
  assetDraft.tagsText = ''
  assetDraft.workflowId = ''
  assetDraft.workflowVersionSelection = 'PINNED'
  assetDraft.workflowVersionId = ''
  assetDraft.workflowRunner = 'CONTROL_PLANE'
  assetDraft.workflowGatewayId = ''
  assetDraft.workflowTargetSiteName = ''
  assetDraft.workflowTargetBindingInformation = ''
  assetDraft.workflowTargetHostHeader = ''
  assetDraft.workflowTargetSniName = ''
  workflowVariableRows.value = []
  workflowBindingProjection.value = null
  workflowConnectionBindings.value = {}
  workflowAdvancedExpanded.value = false
  workflowTargetAdvancedExpanded.value = false
  workflowVariablePresetName.value = ''
  siteItems.value = []
  managedTargetItems.value = []
  fallbackSiteItems.value = []
  fallbackManagedTargetItems.value = []
  siteListError.value = ''
  managedTargetListError.value = ''
  workflowVersionItems.value = []
  workflowListError.value = ''
  workflowVersionListError.value = ''
  gatewayListError.value = ''
  workflowCredentialError.value = ''
  certificateFormatError.value = ''
  workflowCertificateArtifactBindings.value = {}
  agentPluginPackageItems.value = []
  agentPluginVariableBindings.value = {}
  agentPluginSecretBindings.value = {}
  agentPluginArtifactBindings.value = {}
  agentPluginPreviewError.value = ''
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

function goNextAssetStep() {
  if (assetWizardStep.value === 1 && commonStepReady.value) assetWizardStep.value = 2
  else if (assetWizardStep.value === 2 && modeStepReady.value) assetWizardStep.value = 3
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
        workflowId: assetDraft.workflowId.trim(),
        workflowVersionSelection: assetDraft.workflowVersionSelection,
        ...(assetDraft.workflowVersionSelection === 'PINNED'
          ? { workflowVersionId: assetDraft.workflowVersionId.trim() }
          : {}),
        runner: assetDraft.workflowRunner,
        gatewayId,
        target: workflowTarget,
        connectionBindings: Object.keys(workflowConnectionBindings.value).length ? workflowConnectionBindings.value : undefined,
        parameterBindings: buildWorkflowVariableBindings(),
        variableBindings: buildWorkflowVariableBindings(),
        certificateArtifactBindings: buildWorkflowCertificateArtifactBindings(),
      },
    }
  }

  return {
    ...buildManagedTargetDeploymentStrategy(assetDraft.managedTargetId, assetDraft.agentCertificateFormatId),
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

function syncWorkflowTargetDraftFromRows(): void {
  if (assetDraft.managementMode !== 'WORKFLOW') return
  assetDraft.frameworkType = normalizeWorkflowTargetFramework(readWorkflowVariableText('frameworkType') || assetDraft.frameworkType)
  assetDraft.workflowTargetSiteName = readWorkflowVariableText('siteName') || assetDraft.workflowTargetSiteName || assetDraft.displayName.trim() || assetDraft.address.trim()
  assetDraft.workflowTargetBindingInformation = readWorkflowVariableText('bindingInformation') || assetDraft.workflowTargetBindingInformation
  assetDraft.workflowTargetHostHeader = readWorkflowVariableText('hostHeader') || assetDraft.workflowTargetHostHeader || assetDraft.address.trim()
  assetDraft.workflowTargetSniName = readWorkflowVariableText('sniName') || assetDraft.workflowTargetSniName || assetDraft.workflowTargetHostHeader || assetDraft.address.trim()
  assetDraft.protocol = normalizeWorkflowTargetProtocol(readWorkflowVariableText('protocol') || assetDraft.protocol)
  const port = readWorkflowVariableText('port')
  if (port) assetDraft.port = String(normalizeWorkflowTargetPort(port))
  const verifyUrl = readWorkflowVariableText('verifyUrl')
  if (verifyUrl) assetDraft.verifyUrl = verifyUrl
}

function syncWorkflowTargetVariableRowsFromDraft(): void {
  if (assetDraft.managementMode !== 'WORKFLOW') return
  const target = buildWorkflowTargetInfo()
  const values: Record<string, string> = {
    frameworkType: target.frameworkType,
    siteName: target.siteName,
    bindingInformation: target.bindingInformation ?? '',
    hostHeader: target.hostHeader ?? '',
    port: String(target.port),
    protocol: target.protocol,
    verifyUrl: target.verifyUrl ?? '',
    sniName: target.sniName ?? '',
  }
  for (const row of workflowVariableRows.value) {
    const value = values[row.name.trim()]
    if (value !== undefined && row.type !== 'certificate' && row.type !== 'credential') row.value = value
  }
}

function readWorkflowVariableText(name: string): string {
  const row = workflowVariableRows.value.find((item) => item.name.trim() === name)
  if (row && rowValueHasContent(row)) return row.value.trim()
  if (name === 'verifyUrl') return effectiveVerifyUrl.value
  return ''
}

function normalizeWorkflowTargetFramework(value: string): FrameworkType {
  const normalized = value.trim().toUpperCase()
  return ['IIS', 'NGINX', 'APACHE', 'TOMCAT', 'CUSTOM'].includes(normalized) ? normalized as FrameworkType : 'CUSTOM'
}

function normalizeWorkflowTargetProtocol(value: string): AssetProtocol {
  const normalized = value.trim().toUpperCase()
  return ['HTTPS', 'TLS', 'STARTTLS', 'HTTP', 'CUSTOM'].includes(normalized) ? normalized as AssetProtocol : 'HTTPS'
}

function normalizeWorkflowTargetPort(value: string): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : Number(assetDraft.port) || 443
}

function readWorkflowVariableDefinitions(version: ApiRecord | null): Record<string, ApiRecord> {
  const variables = readNested(version, ['content', 'variables'])
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return {}
  return variables as Record<string, ApiRecord>
}

function syncWorkflowVariableRowsFromVersion() {
  const definitions = Object.fromEntries(
    Object.entries(selectedWorkflowVariableDefinitions.value).filter(([name, definition]) => {
      const mode = String(definition.configurationMode ?? (definition.type === 'certificate' ? 'runtime' : definition.required || definition.type === 'credential' ? 'required' : 'advanced'))
      return name !== 'verifyUrl' && mode !== 'runtime'
    }),
  )
  if (Object.keys(definitions).length === 0) return
  const existing = new Map(workflowVariableRows.value.map((row) => [row.name, row]))
  const nextRows = Object.entries(definitions).map(([name, definition]) => {
    const current = existing.get(name)
    const type = workflowVariableType(definition)
    return {
      id: current?.id ?? nextWorkflowVariableRowId(),
      name,
      type,
      value: current?.value ?? '',
      required: Boolean(definition.required),
      description: String(definition.description ?? ''),
      enumValues: readStringArray(definition.enum),
      fromDefinition: true,
    }
  })
  const extraRows = workflowVariableRows.value.filter((row) => !definitions[row.name])
  workflowVariableRows.value = [...nextRows, ...extraRows]
  syncWorkflowTargetDraftFromRows()
}

function addWorkflowVariableRow() {
  const preset = availableWorkflowVariablePresets.value.find((item) => item.name === workflowVariablePresetName.value)
    ?? workflowVariablePresets
      .map((item) => ({ name: item.name, type: item.type, description: t(item.descriptionKey) }))
      .find((item) => !workflowVariableNames.value.has(item.name))
  workflowVariableRows.value.push({
    id: nextWorkflowVariableRowId(),
    name: preset?.name ?? '',
    type: preset?.type ?? 'string',
    value: suggestedWorkflowVariableValue(preset?.name ?? '', { type: preset?.type ?? 'string' }),
    required: false,
    description: preset?.description ?? '',
    enumValues: preset?.name === 'targetPlatform' ? ['linux', 'windows', 'appliance'] : [],
    fromDefinition: false,
  })
  workflowVariablePresetName.value = ''
}

function removeWorkflowVariableRow(rowId: string) {
  workflowVariableRows.value = workflowVariableRows.value.filter((row) => row.id !== rowId)
}

function variableRowsFromBindings(bindings: Record<string, unknown>): WorkflowVariableRow[] {
  return Object.entries(bindings).filter(([name]) => name !== 'verifyUrl').map(([name, value]) => {
    const definition = selectedWorkflowVariableDefinitions.value[name]
    const type = workflowVariableType(definition) || workflowVariableTypeFromValue(value)
    return {
      id: nextWorkflowVariableRowId(),
      name,
      type,
      value: valueToWorkflowVariableText(value),
      required: Boolean(definition?.required),
      description: String(definition?.description ?? ''),
      enumValues: readStringArray(definition?.enum),
      fromDefinition: Boolean(definition),
    }
  })
}

function buildWorkflowVariableBindings(): Record<string, unknown> | undefined {
  const bindings: Record<string, unknown> = {}
  for (const row of workflowVariableRows.value) {
    const name = row.name.trim()
    if (row.type === 'certificate') continue
    if (!name || !rowValueHasContent(row)) continue
    bindings[name] = workflowVariableValue(row)
  }
  if (effectiveVerifyUrl.value && bindings.verifyUrl === undefined) {
    bindings.verifyUrl = effectiveVerifyUrl.value
  }
  return Object.keys(bindings).length > 0 ? bindings : undefined
}

function buildWorkflowCertificateArtifactBindings(): Record<string, WorkflowCertificateArtifactBinding> | undefined {
  const output: Record<string, WorkflowCertificateArtifactBinding> = {}
  for (const item of selectedWorkflowCertificateVariables.value) {
    const current = workflowCertificateArtifactBindings.value[item.name]
    const certificateFormatId = current?.certificateFormatId?.trim()
    if (!certificateFormatId) continue
    const outputBindings: Record<string, string> = {}
    for (const slot of item.outputs) {
      const outputKey = current.outputBindings?.[slot.name]?.trim()
      if (outputKey) outputBindings[slot.name] = outputKey
    }
    if (Object.keys(outputBindings).length > 0) {
      output[item.name] = { certificateFormatId, outputBindings }
    }
  }
  return Object.keys(output).length > 0 ? output : undefined
}

function workflowVariableValue(row: WorkflowVariableRow): unknown {
  const raw = row.value.trim()
  if (row.type === 'number') return Number(raw)
  if (row.type === 'boolean') return raw === 'true'
  if (row.type === 'object') return JSON.parse(raw)
  if (row.type === 'credential') {
    const credential = workflowCredentialItems.value.find((item) => item.id === raw)
    return credential ? workflowCredentialBinding(credential) : raw
  }
  return raw
}

function validateWorkflowVariableRows(): string {
  const names = new Set<string>()
  for (const row of workflowVariableRows.value) {
    const name = row.name.trim()
    if (!name) return t('assets.validation.variableNameRequired')
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return t('assets.validation.variableNameInvalid', { name })
    if (names.has(name)) return t('assets.validation.variableDuplicated', { name })
    names.add(name)
    if (row.type === 'certificate') continue
    if (row.required && !rowValueHasContent(row)) return t('assets.validation.variableRequired', { name })
    if (row.type === 'number' && rowValueHasContent(row) && !Number.isFinite(Number(row.value))) return t('assets.validation.variableMustBeNumber', { name })
    if (row.type === 'object' && rowValueHasContent(row)) {
      try {
        const parsed = JSON.parse(row.value)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return t('assets.validation.variableMustBeJsonObject', { name })
      } catch {
        return t('assets.validation.variableInvalidJson', { name })
      }
    }
    if (row.type === 'credential' && rowValueHasContent(row) && !workflowCredentialItems.value.some((item) => item.id === row.value.trim())) {
      return t('assets.validation.variableCredentialInvalid', { name })
    }
  }
  return ''
}

function validateWorkflowCertificateArtifactBindings(): string {
  if (selectedWorkflowCertificateVariables.value.length === 0) return ''
  for (const item of selectedWorkflowCertificateVariables.value) {
    if (item.outputs.length === 0) continue
    const current = workflowCertificateArtifactBindings.value[item.name]
    if (!current?.certificateFormatId) return t('assets.validation.certificateFormatRequired', { name: item.name })
    const available = workflowCertificateOutputOptions(current.certificateFormatId)
    for (const slot of item.outputs) {
      const outputKey = current.outputBindings?.[slot.name]
      if (slot.required !== false && !outputKey) return t('assets.validation.certificateOutputRequired', { name: item.name, slot: slot.name })
      if (outputKey && available.length > 0 && !available.some((option) => option.key === outputKey)) return t('assets.validation.certificateOutputMissing', { name: item.name, slot: slot.name })
    }
  }
  return ''
}

function rowValueHasContent(row: WorkflowVariableRow): boolean {
  if (row.type === 'certificate') return true
  if (row.type === 'boolean') return row.value === 'true' || row.value === 'false'
  return row.value.trim().length > 0
}

function workflowVariableType(definition: ApiRecord | undefined): WorkflowVariableType {
  const type = String(definition?.type ?? '')
  if (['string', 'number', 'boolean', 'enum', 'object', 'file', 'credential', 'certificate'].includes(type)) return type as WorkflowVariableType
  return 'string'
}

function workflowCertificateOutputSlots(definition: ApiRecord): Array<{ name: string; role: string; required: boolean; description: string }> {
  const outputs = readRecord(readNested(definition, ['artifactContract', 'outputs']))
  if (!outputs) return []
  return Object.entries(outputs).map(([name, output]) => {
    const record = readRecord(output) ?? {}
    return {
      name,
      role: String(record.role ?? ''),
      required: record.required !== false,
      description: String(record.description ?? ''),
    }
  })
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

function workflowCertificateFormatOptions(variableName: string): ApiRecord[] {
  const selectedId = workflowCertificateArtifactBindings.value[variableName]?.certificateFormatId?.trim()
  if (!selectedId || certificateFormatItems.value.some((item) => String(item.id ?? '') === selectedId)) {
    return certificateFormatItems.value
  }
  return [
    {
      id: selectedId,
      format: 'unknown',
      parameters: { configName: t('assets.certificateFormats.savedConfigMissingWithId', { id: selectedId }) },
    },
    ...certificateFormatItems.value,
  ]
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

function workflowCertificateOutputSlotLabel(slot: { name: string; role: string; required: boolean; description: string }): string {
  const roleLabel = certificateArtifactRoleLabel(slot.role)
  return [slot.name, roleLabel, slot.required ? t('assets.common.required') : t('assets.common.optional')].filter(Boolean).join(' / ')
}

function certificateArtifactRoleLabel(role: string): string {
  if (role === 'public_certificate') return t('assets.certificateOutputs.publicCertificate')
  if (role === 'private_key') return t('assets.certificateOutputs.privateKey')
  if (role === 'certificate_chain') return t('assets.certificateOutputs.certificateChain')
  if (role === 'bundle') return t('assets.certificateOutputs.bundle')
  return role
}

function readWorkflowCertificateArtifactBindings(value: unknown): Record<string, WorkflowCertificateArtifactBinding> {
  const record = readRecord(value)
  if (!record) return {}
  const output: Record<string, WorkflowCertificateArtifactBinding> = {}
  for (const [variableName, binding] of Object.entries(record)) {
    const bindingRecord = readRecord(binding)
    const certificateFormatId = String(bindingRecord?.certificateFormatId ?? '').trim()
    const outputBindingsRecord = readRecord(bindingRecord?.outputBindings)
    if (!certificateFormatId || !outputBindingsRecord) continue
    output[variableName] = {
      certificateFormatId,
      outputBindings: Object.fromEntries(
        Object.entries(outputBindingsRecord)
          .map(([slotName, outputKey]) => [slotName, String(outputKey ?? '').trim()] as const)
          .filter(([, outputKey]) => Boolean(outputKey)),
      ),
    }
  }
  return output
}

function readWorkflowCertificateArtifactBindingsFromAsset(source: unknown, deploymentStrategy: ApiRecord | null): Record<string, WorkflowCertificateArtifactBinding> {
  const candidates = [
    readNested(deploymentStrategy, ['workflow', 'certificateArtifactBindings']),
    readNested(source, ['deploymentStrategy', 'workflow', 'certificateArtifactBindings']),
    readNested(source, ['metadata', 'deploymentStrategy', 'workflow', 'certificateArtifactBindings']),
    readNested(source, ['deploymentStrategy', 'workflowRequest', 'certificateArtifactBindings']),
    readNested(source, ['metadata', 'deploymentStrategy', 'workflowRequest', 'certificateArtifactBindings']),
    readNested(source, ['workflowRequest', 'certificateArtifactBindings']),
    readNested(source, ['strategyPayload', 'workflowRequest', 'certificateArtifactBindings']),
  ]
  for (const candidate of candidates) {
    const bindings = readWorkflowCertificateArtifactBindings(candidate)
    if (Object.keys(bindings).length > 0) return bindings
  }
  return {}
}

function ensureWorkflowCertificateArtifactBindings() {
  const certificateVariables = selectedWorkflowCertificateVariables.value
  if (certificateVariables.length === 0) {
    if (assetDraft.workflowVersionId && selectedWorkflowVersion.value) {
      workflowCertificateArtifactBindings.value = {}
    }
    return
  }
  const next: Record<string, WorkflowCertificateArtifactBinding> = { ...workflowCertificateArtifactBindings.value }
  for (const item of certificateVariables) {
    const current = next[item.name] ?? { certificateFormatId: '', outputBindings: {} }
    const available = workflowCertificateOutputOptions(current.certificateFormatId)
    const outputBindings: Record<string, string> = {}
    for (const slot of item.outputs) {
      const existing = current.outputBindings?.[slot.name]
      if (current.certificateFormatId && available.length === 0) {
        if (existing) outputBindings[slot.name] = existing
        continue
      }
      const matched = existing && available.some((option) => option.key === existing) ? existing : ''
      outputBindings[slot.name] = matched || suggestedCertificateOutputKey(slot.role, available)
    }
    next[item.name] = { certificateFormatId: current.certificateFormatId, outputBindings }
  }
  workflowCertificateArtifactBindings.value = Object.fromEntries(
    Object.entries(next).filter(([name]) => certificateVariables.some((item) => item.name === name)),
  )
}

function updateWorkflowCertificateFormat(variableName: string, certificateFormatId: string) {
  workflowCertificateArtifactBindings.value = {
    ...workflowCertificateArtifactBindings.value,
    [variableName]: {
      certificateFormatId,
      outputBindings: {},
    },
  }
  ensureWorkflowCertificateArtifactBindings()
}

function updateWorkflowCertificateOutput(variableName: string, slotName: string, outputKey: string) {
  const current = workflowCertificateArtifactBindings.value[variableName] ?? { certificateFormatId: '', outputBindings: {} }
  workflowCertificateArtifactBindings.value = {
    ...workflowCertificateArtifactBindings.value,
    [variableName]: {
      certificateFormatId: current.certificateFormatId,
      outputBindings: {
        ...current.outputBindings,
        [slotName]: outputKey,
      },
    },
  }
}

function suggestedCertificateOutputKey(role: string, options: Array<{ key: string; role: string }>): string {
  if (role === 'public_certificate') {
    const fullchain = options.find((item) => item.key === 'fullchain')
    if (fullchain) return fullchain.key
  }
  const roleMatched = options.find((item) => item.role === role)
  if (roleMatched) return roleMatched.key
  return options[0]?.key ?? ''
}

function workflowVariableTypeFromValue(value: unknown): WorkflowVariableType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value && typeof value === 'object') return 'object'
  return 'string'
}

function suggestedWorkflowVariableValue(name: string, definition: ApiRecord): string {
  const targetValue = suggestedAssetVariableValue(name)
  if (targetValue !== undefined) return targetValue
  const defaultValue = definition.default
  if (defaultValue !== undefined) return valueToWorkflowVariableText(defaultValue)
  if (workflowVariableType(definition) === 'certificate') return ''
  if (workflowVariableType(definition) === 'boolean') return 'false'
  return ''
}

function suggestedAssetVariableValue(name: string): string | undefined {
  if (name === 'deviceHost' || name === 'verifyHost') return assetDraft.address.trim()
  if (name === 'verifyPort' || name === 'port') return assetDraft.port.trim()
  if (name === 'verifyUrl') return effectiveVerifyUrl.value
  if (name === 'verifyPath') return '/'
  if (name === 'targetPlatform') return assetDraft.platform.toLowerCase()
  if (name === 'frameworkType') return assetDraft.frameworkType
  if (name === 'siteName') return String(selectedSiteAsset.value?.siteName ?? readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'siteName']) ?? '').trim()
    || assetDraft.workflowTargetSiteName.trim() || assetDraft.displayName.trim() || assetDraft.address.trim()
  if (name === 'hostHeader') return assetDraft.workflowTargetHostHeader.trim() || assetDraft.address.trim()
  if (name === 'sniName') return assetDraft.workflowTargetSniName.trim() || assetDraft.workflowTargetHostHeader.trim() || assetDraft.address.trim()
  if (name === 'bindingInformation') return String(currentBindingSummary.value.bindingInformation ?? '').trim()
    || assetDraft.workflowTargetBindingInformation.trim()
    || `*:${assetDraft.port.trim() || '443'}:${assetDraft.workflowTargetHostHeader.trim() || assetDraft.address.trim()}`
  if (name === 'protocol') return assetDraft.protocol
  return undefined
}

function valueToWorkflowVariableText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isWorkflowCredentialBindingRecord(value)) return String(value.id ?? '')
  return JSON.stringify(value, null, 2)
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function isWorkflowCredentialBindingRecord(value: unknown): value is { id?: unknown } {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).id === 'string'
    && typeof (value as Record<string, unknown>).kind === 'string'
}

function nextWorkflowVariableRowId(): string {
  const id = `workflow-variable-${workflowVariableRowSeed}`
  workflowVariableRowSeed += 1
  return id
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readWorkflowBindingText(bindings: Record<string, unknown>, name: string): string {
  const value = bindings[name]
  return typeof value === 'string' ? value.trim() : ''
}

async function loadCredentialsForWorkflowVariables() {
  workflowCredentialLoading.value = true
  workflowCredentialError.value = ''
  try {
    workflowCredentialItems.value = await loadWorkflowCredentials()
  } catch (cause) {
    workflowCredentialItems.value = []
    workflowCredentialError.value = cause instanceof Error ? cause.message : t('assets.errors.loadWorkflowCredentialsFailed')
  } finally {
    workflowCredentialLoading.value = false
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
    frameworkType: normalizeWorkflowTargetFramework(String(target.frameworkType ?? 'CUSTOM')),
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
  const items = page.items

  try {
    const [agents, sites] = await Promise.all([
      listAgents({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listSiteAssets({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
    ])
    const agentById = new Map((agents.data?.items ?? []).map((agent) => [String(agent.id ?? ''), agent]))
    const siteById = new Map((sites.data?.items ?? []).map((site) => [String(site.id ?? ''), site]))
    return {
      ...result,
      data: {
        ...page,
        items: items.map((item) => enrichAssetDisplayNames(item, agentById, siteById)),
      },
    }
  } catch {
    return result
  }
}

function enrichAssetDisplayNames(
  asset: ApiRecord,
  agentById: ReadonlyMap<string, ApiRecord>,
  siteById: ReadonlyMap<string, ApiRecord>,
): ApiRecord {
  const agentId = String(readNested(asset, ['agentId']) ?? readNested(asset, ['targetBinding', 'agentId']) ?? '')
  const siteAssetId = String(readNested(asset, ['targetBinding', 'siteAssetId']) ?? '')
  const agent = agentById.get(agentId)
  const site = siteById.get(siteAssetId)
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
    agentDisplayName: agent ? agentName(agent) : readNested(asset, ['agentDisplayName']),
    siteDisplayName: site ? siteName(site) : readNested(asset, ['siteDisplayName']) ?? workflowTarget?.siteName,
  }
}

function agentName(agent: ApiRecord): string {
  return String(
    agent.displayName
    ?? readNested(agent, ['descriptor', 'hostname'])
    ?? agent.hostname
    ?? agent.name
    ?? agent.id
    ?? '',
  )
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
    const value = readNested(source, candidate.split('.'))
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function agentLabel(agent: ApiRecord): string {
  const hostname = String(readNested(agent, ['descriptor', 'hostname']) ?? agent.hostname ?? agent.id ?? '')
  const osType = String(readNested(agent, ['descriptor', 'osType']) ?? agent.osType ?? '')
  return `${hostname} (${osType})`
}

function siteLabel(site: ApiRecord): string {
  const siteName = String(site.siteName ?? site.id ?? '')
  const hostHeader = String(site.hostHeader ?? '')
  const bindingInformation = String(site.bindingInformation ?? '')
  return hostHeader ? `${siteName} (${hostHeader})` : `${siteName} (${bindingInformation || t('assets.empty.noBindingInformation')})`
}

async function loadAgentSiteCandidates(agentId: string, frameworkType: FrameworkType): Promise<AgentSiteCandidate[]> {
  const detail = await getAgentDetail(agentId)
  const sites = frameworkType === 'IIS'
    ? readAgentIisSites(detail.data)
    : readAgentLinuxSites(detail.data, frameworkType)
  return sites
    .filter((site) => site.bindings.length > 0)
    .map((site, index) => {
      const preferred = site.bindings.find((binding) => binding.protocol.toUpperCase() === 'HTTPS') ?? site.bindings[0]
      return {
        id: `agent-site:${agentId}:${index}:${site.siteName}:${preferred.bindingInformation}`,
        siteName: site.siteName,
        appPool: site.appPool,
        physicalPath: site.physicalPath,
        providerType: frameworkType,
        hostHeader: preferred.hostHeader,
        port: preferred.port,
        bindingInformation: preferred.bindingInformation,
        bindings: site.bindings,
        source: 'agent_capability',
      }
    })
}

function readAgentIisSites(agentDetail: ApiRecord | undefined): Array<{
  siteName: string
  physicalPath?: string
  appPool?: string
  bindings: AgentBindingCandidate[]
}> {
  const snapshot = readNested(agentDetail, ['capabilitySnapshot', 'capabilities'])
  if (!Array.isArray(snapshot)) return []
  const iisSitesCapability = snapshot.find((item) =>
    item && typeof item === 'object' && String((item as Record<string, unknown>).capabilityKey ?? '') === 'windows.iis.sites')
  const rawSites = readNested(iisSitesCapability, ['value'])
  if (!Array.isArray(rawSites)) return []
  return rawSites
    .filter((site): site is Record<string, unknown> => Boolean(site) && typeof site === 'object')
    .map((site, index) => {
      const siteName = String(readNested(site, ['Name']) ?? readNested(site, ['name']) ?? `site-${index + 1}`)
      const physicalPath = String(readNested(site, ['PhysicalPath']) ?? readNested(site, ['physicalPath']) ?? '')
      const appPool = String(readNested(site, ['AppPool']) ?? readNested(site, ['appPool']) ?? '')
      const bindingsRaw = readNested(site, ['Bindings']) ?? readNested(site, ['bindings'])
      const bindings = Array.isArray(bindingsRaw)
        ? bindingsRaw
            .filter((binding): binding is Record<string, unknown> => Boolean(binding) && typeof binding === 'object')
            .map((binding) => {
              const protocol = String(readNested(binding, ['Protocol']) ?? readNested(binding, ['protocol']) ?? '')
              const port = Number(readNested(binding, ['Port']) ?? readNested(binding, ['port']) ?? 0) || undefined
              const hostHeader = String(readNested(binding, ['HostHeader']) ?? readNested(binding, ['hostHeader']) ?? '')
              const ip = String(readNested(binding, ['Ip']) ?? readNested(binding, ['ip']) ?? '*')
              return {
                protocol,
                port,
                hostHeader,
                bindingInformation: `${ip}:${port ?? ''}:${hostHeader}`,
              }
            })
        : []
      return { siteName, physicalPath, appPool, bindings }
    })
}

function readAgentLinuxSites(agentDetail: ApiRecord | undefined, frameworkType: Exclude<FrameworkType, 'IIS'>): Array<{
  siteName: string
  physicalPath?: string
  appPool?: string
  bindings: AgentBindingCandidate[]
}> {
  const capabilityKey = frameworkType === 'NGINX'
    ? 'linux.nginx.detail'
    : frameworkType === 'APACHE'
      ? 'linux.apache.detail'
      : 'linux.tomcat.detail'
  const detail = readAgentCapabilityRecord(agentDetail, capabilityKey)
  if (frameworkType === 'TOMCAT') {
    const connectorsRaw = readNested(detail, ['Connectors']) ?? readNested(detail, ['connectors'])
    const bindings = Array.isArray(connectorsRaw)
      ? connectorsRaw
          .filter((connector): connector is Record<string, unknown> => Boolean(connector) && typeof connector === 'object')
          .map((connector, index) => {
            const protocol = String(readNested(connector, ['Protocol']) ?? readNested(connector, ['protocol']) ?? '')
            const port = Number(readNested(connector, ['Port']) ?? readNested(connector, ['port']) ?? 0) || undefined
            const address = String(readNested(connector, ['Address']) ?? readNested(connector, ['address']) ?? '*')
            const hostHeader = address && address !== '*' ? address : `connector-${index + 1}`
            return {
              protocol,
              port,
              hostHeader,
              listenIp: address,
              bindingInformation: `${address}:${port ?? ''}:${hostHeader}`,
            }
          })
      : []
    return bindings.length > 0
      ? [{
          siteName: 'Tomcat Connector',
          physicalPath: String(readNested(detail, ['ConfigPath']) ?? readNested(detail, ['configPath']) ?? ''),
          bindings,
        }]
      : []
  }

  const rawSites = readNested(detail, ['Sites']) ?? readNested(detail, ['sites'])
  if (!Array.isArray(rawSites)) return []
  return rawSites
    .filter((site): site is Record<string, unknown> => Boolean(site) && typeof site === 'object')
    .map((site, index) => {
      const siteName = String(readNested(site, ['Name']) ?? readNested(site, ['name']) ?? `site-${index + 1}`)
      const physicalPath = String(readNested(site, ['SitePath']) ?? readNested(site, ['sitePath']) ?? '')
      const serverNamesRaw = readNested(site, ['ServerNames']) ?? readNested(site, ['serverNames'])
      const serverNames = Array.isArray(serverNamesRaw)
        ? serverNamesRaw.map((item) => String(item ?? '').trim()).filter(Boolean)
        : []
      const bindingsRaw = readNested(site, ['Listen']) ?? readNested(site, ['listen'])
      const bindings = Array.isArray(bindingsRaw)
        ? bindingsRaw
            .filter((binding): binding is Record<string, unknown> => Boolean(binding) && typeof binding === 'object')
            .map((binding) => {
              const protocol = String(readNested(binding, ['Protocol']) ?? readNested(binding, ['protocol']) ?? '')
              const port = Number(readNested(binding, ['Port']) ?? readNested(binding, ['port']) ?? 0) || undefined
              const address = String(readNested(binding, ['Address']) ?? readNested(binding, ['address']) ?? '*')
              const hostHeader = serverNames[0] || siteName
              return {
                protocol,
                port,
                hostHeader,
                listenIp: address,
                bindingInformation: `${address}:${port ?? ''}:${hostHeader}`,
              }
            })
        : []
      return { siteName, physicalPath, bindings }
    })
}

function readAgentCapabilityRecord(agentDetail: ApiRecord | undefined, capabilityKey: string): Record<string, unknown> {
  const snapshot = readNested(agentDetail, ['capabilitySnapshot', 'capabilities'])
  if (!Array.isArray(snapshot)) return {}
  const capability = snapshot.find((item) =>
    item && typeof item === 'object' && String((item as Record<string, unknown>).capabilityKey ?? '') === capabilityKey)
  const value = readNested(capability, ['value'])
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function buildFallbackManagedTargetCandidates(
  agentId: string,
  sites: AgentSiteCandidate[],
): AgentManagedTargetCandidate[] {
  return sites.map((site) => ({
    id: `agent-target:${agentId}:${site.siteName}:${site.bindingInformation}`.toLowerCase(),
    agentId,
    frameworkType: site.providerType,
    siteAssetId: site.id,
    targetType: 'SITE_BINDING',
    targetKey: `${agentId}:site-binding:${site.siteName}:${site.bindingInformation}`.toLowerCase(),
    bindingKey: site.bindingInformation,
    hostHeader: site.hostHeader,
    port: site.port,
    source: 'agent_capability',
  }))
}

async function ensureTargetBindingResources(): Promise<{
  siteAssetId: string
  managedTargetId: string
  targetType: string
  targetKey: string
  bindingKey?: string
  siteName: string
  bindingInformation: string
  hostHeader: string
  port?: number
}> {
  if (selectedManagedTarget.value && selectedSiteAsset.value && !String(selectedSiteAsset.value.id ?? '').startsWith('agent-site:')) {
    return {
      siteAssetId: String(selectedSiteAsset.value.id ?? assetDraft.siteAssetId.trim()),
      managedTargetId: String(selectedManagedTarget.value.id ?? assetDraft.managedTargetId.trim()),
      targetType: String(selectedManagedTarget.value.targetType ?? 'SITE_BINDING'),
      targetKey: String(selectedManagedTarget.value.targetKey ?? assetDraft.managedTargetId.trim()),
      bindingKey: String(selectedManagedTarget.value.bindingKey ?? ''),
      siteName: String(selectedSiteAsset.value.siteName ?? ''),
      bindingInformation: String(selectedSiteAsset.value.bindingInformation ?? ''),
      hostHeader: String(selectedSiteAsset.value.hostHeader ?? ''),
      port: Number(selectedSiteAsset.value.port ?? 0) || undefined,
    }
  }

  const fallbackSite = fallbackSiteItems.value.find((item) => item.id === assetDraft.siteAssetId.trim())
  if (!fallbackSite) {
    throw new Error(t('assets.errors.noAvailableSiteInstance'))
  }

  const agentId = assetDraft.agentId.trim()
  const frameworkType = assetDraft.frameworkType.trim() as FrameworkType
  let serviceInstance = (await listServiceInstances({
    page: 1,
    pageSize: 50,
    filters: { providerType: frameworkType },
  })).data?.items?.[0]
  if (serviceInstance) {
    const candidate = serviceInstance as ApiRecord
    const candidateAgentId = String(candidate.agentId ?? readNested(candidate, ['rawFacts', 'agentId']) ?? '')
    serviceInstance = candidateAgentId === agentId ? candidate : undefined
  }
  if (!serviceInstance?.id) {
    const createdService = await createServiceInstance({
      providerType: frameworkType,
      serviceName: frameworkType.toLowerCase(),
      displayName: frameworkType,
      providerKey: `${frameworkType.toLowerCase()}:${agentId}`,
      configPath: fallbackSite.physicalPath || undefined,
      rawFacts: {
        agentId,
      },
    })
    serviceInstance = createdService.data
  }

  const createdSite = await createSiteAsset({
    serviceInstanceId: String(serviceInstance?.id),
    agentId,
    providerType: frameworkType,
    siteType: 'WEB_SITE',
    siteName: fallbackSite.siteName,
    siteKey: `${agentId}:${frameworkType.toLowerCase()}:${fallbackSite.siteName}:${fallbackSite.bindingInformation}`.toLowerCase(),
    bindingInformation: fallbackSite.bindingInformation,
    hostHeader: fallbackSite.hostHeader || undefined,
    listenIp: fallbackSite.listenIp || fallbackSite.bindingInformation.split(':')[0] || '*',
    port: fallbackSite.port,
    protocol: fallbackSite.bindings.find((binding) => binding.bindingInformation === fallbackSite.bindingInformation)?.protocol?.toUpperCase() as AssetProtocol || 'HTTPS',
    configPath: fallbackSite.physicalPath || undefined,
    metadata: {
      appPool: fallbackSite.appPool,
      providerType: frameworkType,
      source: 'agent_capability_fallback',
    },
  })

  const createdTarget = await createManagedTarget({
    agentId,
    serviceInstanceId: String(serviceInstance?.id),
    siteAssetId: String(createdSite.data?.id),
    providerType: frameworkType,
    frameworkType,
    targetType: 'SITE_BINDING',
    targetKey: `${agentId}:site-binding:${fallbackSite.siteName}:${fallbackSite.bindingInformation}`.toLowerCase(),
    bindingKey: fallbackSite.bindingInformation,
    capabilityProfile: {
      providerType: frameworkType,
      bindingInformation: fallbackSite.bindingInformation,
      hostHeader: fallbackSite.hostHeader,
      port: fallbackSite.port,
      source: 'agent_capability_fallback',
    },
    status: 'ACTIVE',
    metadata: {},
  })

  return {
    siteAssetId: String(createdSite.data?.id),
    managedTargetId: String(createdTarget.data?.id),
    targetType: String(createdTarget.data?.targetType ?? 'SITE_BINDING'),
    targetKey: String(createdTarget.data?.targetKey ?? ''),
    bindingKey: String(createdTarget.data?.bindingKey ?? fallbackSite.bindingInformation),
    siteName: fallbackSite.siteName,
    bindingInformation: fallbackSite.bindingInformation,
    hostHeader: fallbackSite.hostHeader,
    port: fallbackSite.port,
  }
}

function managedTargetLabel(target: ApiRecord): string {
  const targetType = String(target.targetType ?? 'UNKNOWN')
  const bindingKey = String(target.bindingKey ?? '')
  const targetKey = String(target.targetKey ?? target.id ?? '')
  return bindingKey ? `${targetType} (${bindingKey})` : `${targetType} (${targetKey})`
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
      await loadAgents()
      return
    }
    await Promise.all([loadWorkflowTemplates(), loadGateways(), loadCredentialsForWorkflowVariables(), loadCertificateFormatsForWorkflow()])
  },
)

watch(
  () => assetDraft.workflowId,
  async (workflowId, previousWorkflowId) => {
    if (previousWorkflowId && workflowId !== previousWorkflowId) {
      assetDraft.workflowVersionId = ''
    }
    if (assetDraft.managementMode !== 'WORKFLOW') return
    await loadWorkflowVersions(workflowId)
  },
)

watch(
  () => assetDraft.workflowVersionId,
  async () => {
    if (assetDraft.managementMode !== 'WORKFLOW') return
    syncWorkflowVariableRowsFromVersion()
    ensureWorkflowCertificateArtifactBindings()
    await refreshWorkflowBindingProjection()
  },
)

watch(
  () => assetDraft.workflowVersionSelection,
  async () => {
    if (assetDraft.managementMode !== 'WORKFLOW') return
    if (assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED') {
      assetDraft.workflowVersionId = ''
    } else if (!assetDraft.workflowVersionId && publishedWorkflowVersionItems.value.length === 1) {
      assetDraft.workflowVersionId = String(publishedWorkflowVersionItems.value[0]?.id ?? '')
    }
    syncWorkflowVariableRowsFromVersion()
    ensureWorkflowCertificateArtifactBindings()
    await refreshWorkflowBindingProjection()
  },
)

watch(
  () => [assetDraft.address, assetDraft.port, assetDraft.protocol, assetDraft.verifyUrl, assetDraft.frameworkType] as const,
  async () => {
    if (assetDraft.managementMode === 'WORKFLOW') await refreshWorkflowBindingProjection()
  },
)

watch(
  () => [assetDraft.address, assetDraft.port, assetDraft.protocol, assetDraft.verifyUrl, assetDraft.platform] as const,
  () => undefined,
)

watch(
  () => [
    assetDraft.frameworkType,
    assetDraft.workflowTargetSiteName,
    assetDraft.workflowTargetBindingInformation,
    assetDraft.workflowTargetHostHeader,
    assetDraft.workflowTargetSniName,
    assetDraft.port,
    assetDraft.protocol,
    assetDraft.verifyUrl,
  ] as const,
  () => {
    if (assetDraft.managementMode === 'WORKFLOW') syncWorkflowTargetVariableRowsFromDraft()
  },
)

watch(
  () => assetDraft.workflowRunner,
  (runner) => {
    if (runner === 'CONTROL_PLANE') assetDraft.workflowGatewayId = ''
  },
)

watch(
  () => assetDraft.platform,
  async (platform) => {
    if (isEditMode.value) return
    const nextFramework = platform === 'WINDOWS' ? 'IIS' : 'NGINX'
    if (!availableFrameworkOptions.value.includes(assetDraft.frameworkType)) {
      assetDraft.frameworkType = nextFramework
    }
    assetDraft.siteAssetId = ''
    assetDraft.managedTargetId = ''
    siteItems.value = []
    managedTargetItems.value = []
    fallbackManagedTargetItems.value = []
    clearIncompatibleAgentPluginSelection()
    await refreshAssetTargets()
  },
)

watch(
  () => assetDraft.agentId,
  async () => {
    if (isEditMode.value) return
    assetDraft.siteAssetId = ''
    assetDraft.managedTargetId = ''
    managedTargetItems.value = []
    fallbackManagedTargetItems.value = []
    if (assetDraft.agentDeploymentMode === 'PLUGIN') await loadAgentPlugins()
    else await refreshAssetTargets()
  },
)

watch(() => assetDraft.agentPluginPackageId, syncAgentPluginDefaults)

watch(
  () => assetDraft.agentDeploymentMode,
  async (mode) => {
    if (mode === 'PLUGIN' && assetDraft.agentId) await loadAgentPlugins()
  },
)

watch(
  () => assetDraft.frameworkType,
  async () => {
    if (isEditMode.value) return
    if (assetDraft.managementMode === 'WORKFLOW') {
      syncWorkflowTargetVariableRowsFromDraft()
      return
    }
    assetDraft.siteAssetId = ''
    assetDraft.managedTargetId = ''
    managedTargetItems.value = []
    fallbackManagedTargetItems.value = []
    clearIncompatibleAgentPluginSelection()
    await refreshAssetTargets()
  },
)

watch(
  () => assetDraft.siteAssetId,
  async () => {
    if (isEditMode.value) return
    assetDraft.managedTargetId = ''
    await refreshAssetTargets()
    if (!assetDraft.siteAssetId || assetDraft.managedTargetId) return
    if (managedTargetItems.value.length === 1) {
      assetDraft.managedTargetId = String(managedTargetItems.value[0]?.id ?? '')
      return
    }
    if (fallbackManagedTargetItems.value.length === 1) {
      assetDraft.managedTargetId = String(fallbackManagedTargetItems.value[0]?.id ?? '')
    }
  },
)

async function loadAgentPlugins(): Promise<void> {
  const packageResult = await listAgentPluginPackages({ page: 1, pageSize: 500 })
  agentPluginPackageItems.value = [...(packageResult.data?.items ?? [])]
  clearIncompatibleAgentPluginSelection()
}

function clearIncompatibleAgentPluginSelection(): void {
  if (!assetDraft.agentPluginPackageId) return
  if (compatibleAgentPluginPackages.value.some((item) => String(item.id ?? '') === assetDraft.agentPluginPackageId)) return
  assetDraft.agentPluginPackageId = ''
  agentPluginVariableBindings.value = {}
  agentPluginSecretBindings.value = {}
  agentPluginArtifactBindings.value = {}
}

function agentPluginPackageLabel(item: ApiRecord): string {
  const manifest = readRecord(item.manifest) ?? {}
  const metadata = readRecord(manifest.metadata) ?? {}
  const name = String(metadata.displayName ?? manifest.name ?? manifest.pluginId ?? item.id ?? '')
  const version = String(manifest.version ?? '')
  return version ? `${name} (${version})` : name
}

function syncAgentPluginDefaults(): void {
  const variables = readRecord(selectedAgentPluginManifest.value.variables) ?? {}
  const nextVariables: Record<string, string> = {}
  const nextSecrets: Record<string, string> = {}
  for (const [name, rawDefinition] of Object.entries(variables)) {
    const definition = readRecord(rawDefinition) ?? {}
    if (definition.sensitive === true || definition.type === 'credential') nextSecrets[name] = agentPluginSecretBindings.value[name] ?? ''
    else nextVariables[name] = agentPluginVariableBindings.value[name] ?? suggestedAgentPluginVariableValue(name, definition)
  }
  agentPluginVariableBindings.value = nextVariables
  agentPluginSecretBindings.value = nextSecrets
  agentPluginArtifactBindings.value = Object.fromEntries(selectedAgentPluginArtifacts.value.map(([name, rawDefinition]) => [
    name,
    agentPluginArtifactBindings.value[name] || `value=${defaultArtifactOutputKey(readRecord(rawDefinition)?.type)}`,
  ]))
}

function buildAgentPluginVariableBindings(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(agentPluginVariableBindings.value).map(([name, value]) => {
    const definition = readRecord(readRecord(selectedAgentPluginManifest.value.variables)?.[name]) ?? {}
    if (definition.type === 'number') return [name, Number(value)]
    if (definition.type === 'boolean') return [name, value === 'true']
    if (definition.type === 'object') {
      try { return [name, JSON.parse(value)] } catch { return [name, value] }
    }
    return [name, value]
  }))
}

function buildAgentPluginSecretBindings(): Record<string, string> {
  return Object.fromEntries(Object.entries(agentPluginSecretBindings.value).filter(([, value]) => value.trim()).map(([name, value]) => [name, value.trim()]))
}

function buildAgentPluginCertificateBindings(): Record<string, WorkflowCertificateArtifactBinding> {
  return Object.fromEntries(Object.entries(agentPluginArtifactBindings.value).map(([name, value]) => [name, {
    certificateFormatId: assetDraft.agentCertificateFormatId.trim(),
    outputBindings: parseArtifactOutputBindings(value),
  }]))
}

function parseArtifactOutputBindings(value: string): Record<string, string> {
  return Object.fromEntries(value.split(',').map((item) => item.split('=').map((part) => part.trim())).filter((parts) => parts.length === 2 && parts[0] && parts[1]).map(([slot, output]) => [slot!, output!]))
}

function defaultArtifactOutputKey(type: unknown): string {
  if (type === 'private_key') return 'keyFile'
  if (type === 'certificate_chain') return 'chainFile'
  if (type === 'certificate') return 'certFile'
  return 'bundleFile'
}

function suggestedAgentPluginVariableValue(name: string, definition: ApiRecord): string {
  const targetValue = suggestedAssetVariableValue(name)
  if (targetValue !== undefined) return targetValue
  if (name === 'siteName') return String(selectedSiteAsset.value?.siteName ?? readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'siteName']) ?? '')
  if (name === 'bindingInformation') return String(currentBindingSummary.value.bindingInformation ?? '')
  if (name === 'appPoolName') return String(selectedSiteAsset.value?.appPool ?? readNested(editAssetDetail.value, ['targetBindingDetail', 'siteAsset', 'metadata', 'appPool']) ?? '')
  if (name === 'certificatePath') return String(selectedManagedTarget.value?.certPath ?? readNested(editAssetDetail.value, ['targetBindingDetail', 'certificateBinding', 'certPath']) ?? definition.default ?? '')
  if (name === 'privateKeyPath') return String(selectedManagedTarget.value?.keyPath ?? readNested(editAssetDetail.value, ['targetBindingDetail', 'certificateBinding', 'keyPath']) ?? definition.default ?? '')
  return formatPluginVariableValue(definition.default)
}

function formatPluginVariableValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function stringifyBindingValues(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, formatPluginVariableValue(item)]))
}

function stringifyArtifactBindings(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([name, item]) => {
    const outputs = readRecord(readRecord(item)?.outputBindings) ?? {}
    return [name, Object.entries(outputs).map(([slot, output]) => `${slot}=${String(output)}`).join(', ')]
  }))
}

async function previewSelectedAgentPlugin(): Promise<void> {
  const strategy = buildDeploymentStrategyPayload()
  const plugin = readRecord(readRecord(strategy.agent)?.plugin)
  if (!plugin) return
  agentPluginPreviewError.value = ''
  try {
    await previewAgentPluginBinding(assetDraft.agentId, plugin)
  } catch (cause) {
    agentPluginPreviewError.value = cause instanceof Error ? cause.message : t('plugins.agentDeployment.previewFailed')
  }
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

        <section v-if="assetWizardStep === 1" class="asset-wizard__panel">
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
              <span>{{ t('assets.managementModes.managedTarget') }}</span>
              <strong>{{ t('assets.managementModes.managedTargetDescription') }}</strong>
            </button>
            <button
              type="button"
              class="asset-wizard__mode-card"
              :class="{ 'is-selected': assetDraft.managementMode === 'WORKFLOW' }"
              @click="assetDraft.managementMode = 'WORKFLOW'"
            >
              <span>{{ t('assets.managementModes.independentWorkflow') }}</span>
              <strong>{{ t('assets.managementModes.independentWorkflowDescription') }}</strong>
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
              <div v-if="isEditMode" class="asset-form__readonly">{{ assetDraft.platform || '—' }}</div>
              <select v-else v-model="assetDraft.platform">
                <option value="LINUX">Linux</option>
                <option value="WINDOWS">Windows</option>
                <option value="APPLIANCE">{{ t('assets.platforms.appliance') }}</option>
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

        <section v-else-if="assetWizardStep === 2" class="asset-wizard__panel">
          <header class="asset-wizard__panel-header">
            <div>
              <h3>{{ assetDraft.managementMode === 'WORKFLOW' ? t('assets.wizard.panels.workflowTitle') : t('assets.wizard.panels.managedTargetTitle') }}</h3>
              <p v-if="assetDraft.managementMode === 'MANAGED_TARGET'">{{ t('assets.wizard.panels.managedTargetDescription') }}</p>
            </div>
            <span class="asset-wizard__panel-state" :class="modeStepReady ? 'is-done' : 'is-active'">
              {{ modeStepReady ? t('assets.wizard.stepState.readyNext') : t('assets.wizard.stepState.incomplete') }}
            </span>
          </header>

          <template v-if="assetDraft.managementMode === 'MANAGED_TARGET'">
            <div class="asset-form__grid">
              <label class="asset-form__field">
                <span>{{ t('plugins.agentDeployment.executionMode') }} <strong>*</strong></span>
                <select v-model="assetDraft.agentDeploymentMode">
                  <option value="NATIVE_HANDLER">{{ t('plugins.agentDeployment.nativeHandler') }}</option>
                  <option value="PLUGIN">{{ t('plugins.agentDeployment.pluginMode') }}</option>
                </select>
              </label>
              <label v-if="assetDraft.agentDeploymentMode === 'NATIVE_HANDLER'" class="asset-form__field">
                <span>{{ t('assets.fields.frameworkType') }} <strong>*</strong></span>
                <div v-if="isEditMode" class="asset-form__readonly">{{ assetDraft.frameworkType || '—' }}</div>
                <select v-else v-model="assetDraft.frameworkType">
                  <option v-for="framework in availableFrameworkOptions" :key="framework" :value="framework">
                    {{ framework }}
                  </option>
                </select>
              </label>
              <label v-if="assetDraft.agentDeploymentMode === 'NATIVE_HANDLER'" class="asset-form__field">
                <span>Agent <strong>*</strong></span>
                <div v-if="isEditMode" class="asset-form__readonly">{{ editAgentLabel }}</div>
                <select v-else v-model="assetDraft.agentId" :disabled="agentListLoading">
                  <option value="">{{ agentListLoading ? t('assets.loading.agents') : t('assets.select.agent') }}</option>
                  <option v-for="agent in filteredAgentItems" :key="String(agent.id)" :value="String(agent.id)">
                    {{ agentLabel(agent) }}
                  </option>
                </select>
              </label>
              <label class="asset-form__field">
                <span>{{ t('assets.fields.siteInstance') }} <strong>*</strong></span>
                <div v-if="isEditMode" class="asset-form__readonly">{{ editSiteLabel }}</div>
                <select v-else v-model="assetDraft.siteAssetId" :disabled="siteListLoading || !assetDraft.agentId">
                  <option value="">{{ siteListLoading ? t('assets.loading.sites') : t('assets.select.siteInstance') }}</option>
                  <option v-for="site in filteredSiteItems" :key="String(site.id)" :value="String(site.id)">
                    {{ siteLabel(site) }}
                  </option>
                </select>
              </label>
              <label class="asset-form__field">
                <span>{{ t('assets.fields.managedTarget') }} <strong>*</strong></span>
                <div v-if="isEditMode" class="asset-form__readonly">{{ editManagedTargetLabel }}</div>
                <select v-else v-model="assetDraft.managedTargetId" :disabled="managedTargetListLoading || !assetDraft.siteAssetId">
                  <option value="">{{ managedTargetListLoading ? t('assets.loading.managedTargets') : t('assets.select.managedTarget') }}</option>
                  <option v-for="target in filteredManagedTargetItems" :key="String(target.id)" :value="String(target.id)">
                    {{ managedTargetLabel(target) }}
                  </option>
                </select>
              </label>
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
              <label v-if="assetDraft.agentDeploymentMode === 'PLUGIN'" class="asset-form__field">
                <span>{{ t('plugins.agentDeployment.plugin') }} <strong>*</strong></span>
                <select v-model="assetDraft.agentPluginPackageId" :disabled="!assetDraft.agentId">
                  <option value="">{{ compatibleAgentPluginPackages.length ? t('plugins.agentDeployment.selectPlugin') : t('plugins.agentDeployment.noCompatiblePlugin') }}</option>
                  <option v-for="pluginPackage in compatibleAgentPluginPackages" :key="String(pluginPackage.id)" :value="String(pluginPackage.id)">
                    {{ agentPluginPackageLabel(pluginPackage) }}
                  </option>
                </select>
                <small>{{ t('plugins.agentDeployment.compatiblePluginHint') }}</small>
              </label>
            </div>
            <div v-if="assetDraft.agentDeploymentMode === 'PLUGIN' && selectedAgentPluginPackage" class="asset-form__grid">
              <label v-for="([name, rawDefinition]) in selectedAgentPluginVariables" :key="name" class="asset-form__field">
                <span>{{ name }} <strong v-if="readRecord(rawDefinition)?.required">*</strong></span>
                <select v-if="Array.isArray(readRecord(rawDefinition)?.enum)" v-model="agentPluginVariableBindings[name]">
                  <option v-for="option in readRecord(rawDefinition)?.enum as unknown[]" :key="String(option)" :value="String(option)">{{ String(option) }}</option>
                </select>
                <select v-else-if="readRecord(rawDefinition)?.type === 'boolean'" v-model="agentPluginVariableBindings[name]">
                  <option value="true">true</option><option value="false">false</option>
                </select>
                <input v-else-if="readRecord(rawDefinition)?.sensitive !== true && readRecord(rawDefinition)?.type !== 'credential'" v-model="agentPluginVariableBindings[name]" type="text">
                <input v-else v-model="agentPluginSecretBindings[name]" type="text" :placeholder="t('plugins.agentDeployment.secretRefPlaceholder')">
                <small>{{ String(readRecord(rawDefinition)?.description ?? '') }}</small>
              </label>
              <label v-for="([name]) in selectedAgentPluginArtifacts" :key="name" class="asset-form__field">
                <span>{{ t('plugins.agentDeployment.artifactBinding', { name }) }}</span>
                <input v-model="agentPluginArtifactBindings[name]" type="text" :placeholder="t('plugins.agentDeployment.artifactBindingPlaceholder')">
              </label>
              <button class="gc-button" type="button" @click="previewSelectedAgentPlugin">{{ t('plugins.agentDeployment.preview') }}</button>
              <p v-if="agentPluginPreviewError" class="asset-form__error">{{ agentPluginPreviewError }}</p>
            </div>
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

          <template v-else>
            <div class="asset-form__grid">
              <label class="asset-form__field">
                <span>{{ t('assets.fields.selectWorkflow') }} <strong>*</strong></span>
                <select v-model="assetDraft.workflowId" :disabled="workflowListLoading">
                  <option value="">{{ workflowListLoading ? t('assets.loading.workflows') : t('assets.select.workflow') }}</option>
                  <option v-for="workflow in workflowItems" :key="String(workflow.id)" :value="String(workflow.id)">
                    {{ workflowTemplateLabel(workflow) }}
                  </option>
                </select>
              </label>
              <label class="asset-form__field">
                <span>{{ t('assets.fields.workflowVersionSelection') }} <strong>*</strong></span>
                <select v-model="assetDraft.workflowVersionSelection" :disabled="!assetDraft.workflowId">
                  <option value="PINNED">{{ t('assets.workflowVersionSelection.pinned') }}</option>
                  <option value="LATEST_PUBLISHED">{{ t('assets.workflowVersionSelection.latestPublished') }}</option>
                </select>
              </label>
              <label class="asset-form__field">
                <span>{{ t('assets.fields.publishedVersion') }} <strong>*</strong></span>
                <select v-model="assetDraft.workflowVersionId" :disabled="workflowVersionListLoading || !assetDraft.workflowId || assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED'">
                  <option value="">{{ workflowVersionListLoading ? t('assets.loading.versions') : assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED' && selectedWorkflowVersion ? workflowVersionLabel(selectedWorkflowVersion) : t('assets.select.publishedVersion') }}</option>
                  <option
                    v-for="version in workflowVersionItems"
                    :key="String(version.id)"
                    :value="String(version.id)"
                    :disabled="workflowVersionStatus(version) !== 'published'"
                  >
                    {{ workflowVersionLabel(version) }}
                  </option>
                </select>
              </label>
              <label class="asset-form__field">
                <span>{{ t('assets.fields.runner') }} <strong>*</strong></span>
                <select v-model="assetDraft.workflowRunner">
                  <option value="CONTROL_PLANE">{{ t('assets.runners.controlPlane') }}</option>
                  <option value="GATEWAY">Gateway</option>
                </select>
              </label>
              <label v-if="assetDraft.workflowRunner === 'GATEWAY'" class="asset-form__field">
                <span>Gateway <strong>*</strong></span>
                <select v-model="assetDraft.workflowGatewayId" :disabled="gatewayListLoading">
                  <option value="">{{ gatewayListLoading ? t('assets.loading.gateways') : t('assets.select.gateway') }}</option>
                  <option v-for="gateway in gatewayItems" :key="String(gateway.id)" :value="String(gateway.id)">
                    {{ gatewayLabel(gateway) }}
                  </option>
                </select>
              </label>
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
              <section class="asset-form__field asset-form__field--wide workflow-variable-form" :aria-label="t('assets.workflowVariables.title')">
                <div class="workflow-variable-form__head">
                  <div>
                    <span>{{ t('assets.workflowVariables.title') }}</span>
                    <strong>{{ workflowProjectionLoading && !workflowBindingProjection ? t('common.loading') : workflowBindingProjection?.required.length ?? 0 }}</strong>
                  </div>
                  <button class="gc-button gc-button--ghost" type="button" :disabled="workflowProjectionLoading" @click="refreshWorkflowBindingProjection">{{ workflowProjectionLoading ? t('common.loading') : t('common.refresh') }}</button>
                </div>
                <p v-if="workflowProjectionError" class="asset-form__error">{{ workflowProjectionError }}</p>
                <template v-if="workflowBindingProjection">
                  <ul class="workflow-variable-form__rows">
                    <li v-for="item in workflowBindingProjection.required" :key="`projection:${item.name}`" class="workflow-variable-form__row">
                      <label class="workflow-variable-form__value">
                        <span>{{ item.name }} *</span>
                        <select v-if="projectionItemType(item) === 'credential'" :value="projectionItemValue(item)" :disabled="workflowCredentialLoading" @change="updateProjectionVariable(item, ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ workflowCredentialLoading ? t('assets.loading.credentials') : t('assets.select.credential') }}</option>
                          <option v-for="credential in workflowCredentialItems" :key="credential.id" :value="credential.id">
                            {{ workflowCredentialLabel(credential) }} / {{ workflowCredentialSummary(credential, t) }}
                          </option>
                        </select>
                        <select v-else-if="projectionItemType(item) === 'boolean'" :value="projectionItemValue(item)" @change="updateProjectionVariable(item, ($event.target as HTMLSelectElement).value)">
                          <option value="false">false</option>
                          <option value="true">true</option>
                        </select>
                        <input v-else :value="projectionItemValue(item)" :inputmode="projectionItemType(item) === 'number' ? 'decimal' : undefined" autocomplete="off" @input="updateProjectionVariable(item, ($event.target as HTMLInputElement).value)" />
                      </label>
                    </li>
                  </ul>
                  <div v-if="workflowBindingProjection.basicConnections.length" class="workflow-variable-form__rows">
                    <div v-for="item in workflowBindingProjection.basicConnections" :key="`connection:${item.name}`" class="workflow-variable-form__row">
                      <label class="workflow-variable-form__value">
                        <span>{{ t('assets.workflowVariables.presets.deviceHost') }} *</span>
                        <input :value="workflowConnectionBindings[String(item.name)]?.host ?? item.host ?? ''" autocomplete="off" @input="updateProjectionConnection(String(item.name), 'host', ($event.target as HTMLInputElement).value)" />
                      </label>
                      <label class="workflow-variable-form__value">
                        <span>{{ t('assets.workflowVariables.presets.sshUsername') }} *</span>
                        <input :value="workflowConnectionBindings[String(item.name)]?.username ?? item.username ?? ''" autocomplete="off" @input="updateProjectionConnection(String(item.name), 'username', ($event.target as HTMLInputElement).value)" />
                      </label>
                      <label class="workflow-variable-form__value">
                        <span>{{ t('assets.workflowVariables.presets.credential') }} *</span>
                        <select :value="workflowConnectionBindings[String(item.name)]?.credentialRef ?? item.credentialRef ?? ''" :disabled="workflowCredentialLoading" @change="updateProjectionConnectionCredential(String(item.name), ($event.target as HTMLSelectElement).value)">
                          <option value="">{{ workflowCredentialLoading ? t('assets.loading.credentials') : t('assets.select.credential') }}</option>
                          <option v-for="credential in workflowCredentialItems" :key="credential.id" :value="credential.id">
                            {{ workflowCredentialLabel(credential) }} / {{ workflowCredentialSummary(credential, t) }}
                          </option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <button v-if="workflowBindingProjection.advanced.length || workflowBindingProjection.advancedConnections.length || workflowBindingProjection.basicConnections.some((item) => item.fieldModes?.port === 'advanced' || item.fieldModes?.hostKey === 'advanced')" class="gc-button gc-button--ghost" type="button" @click="workflowAdvancedExpanded = !workflowAdvancedExpanded">
                    {{ workflowAdvancedExpanded ? t('agents.logs.collapse') : t('agents.logs.expand') }}
                  </button>
                  <div v-if="workflowAdvancedExpanded" class="workflow-variable-form__rows">
                    <div v-for="item in workflowBindingProjection.basicConnections" :key="`connection-advanced:${item.name}`" class="workflow-variable-form__row workflow-variable-form__row--connection-advanced">
                      <label v-if="item.fieldModes?.port === 'advanced'" class="workflow-variable-form__value">
                        <span>{{ t('assets.fields.port') }}</span>
                        <input :value="workflowConnectionBindings[String(item.name)]?.port ?? item.port ?? 22" inputmode="numeric" @input="updateProjectionConnection(String(item.name), 'port', ($event.target as HTMLInputElement).value)" />
                      </label>
                      <label v-if="item.fieldModes?.hostKey === 'advanced'" class="workflow-variable-form__value">
                        <span>{{ t('workflows.canvasModel.fields.expectedHostKeyFingerprint') }}</span>
                        <input :value="workflowConnectionBindings[String(item.name)]?.expectedHostKeyFingerprint ?? item.expectedHostKeyFingerprint ?? ''" autocomplete="off" @input="updateProjectionConnection(String(item.name), 'expectedHostKeyFingerprint', ($event.target as HTMLInputElement).value)" />
                      </label>
                    </div>
                    <div v-for="item in workflowBindingProjection.advanced" :key="`advanced:${item.name}`" class="workflow-variable-form__row workflow-variable-form__row--variable">
                      <span>{{ item.name }}</span>
                      <select v-if="projectionItemType(item) === 'credential'" :value="projectionItemValue(item)" :disabled="workflowCredentialLoading" @change="updateProjectionVariable(item, ($event.target as HTMLSelectElement).value)">
                        <option value="">{{ workflowCredentialLoading ? t('assets.loading.credentials') : t('assets.select.credential') }}</option>
                        <option v-for="credential in workflowCredentialItems" :key="credential.id" :value="credential.id">
                          {{ workflowCredentialLabel(credential) }} / {{ workflowCredentialSummary(credential, t) }}
                        </option>
                      </select>
                      <input v-else :value="projectionItemValue(item)" @input="updateProjectionVariable(item, ($event.target as HTMLInputElement).value)" />
                    </div>
                  </div>
                </template>
              </section>
              <section v-if="false" class="asset-form__field asset-form__field--wide workflow-variable-form" :aria-label="t('assets.workflowVariables.title')">
                <div class="workflow-variable-form__head">
                  <div>
                    <span>{{ t('assets.workflowVariables.title') }}</span>
                    <strong>{{ t('assets.workflowVariables.configuredCount', { configured: workflowVariableConfiguredCount, total: workflowVariableRows.length }) }}</strong>
                  </div>
                  <div class="workflow-variable-form__add">
                    <select v-model="workflowVariablePresetName" :disabled="availableWorkflowVariablePresets.length === 0">
                      <option value="">{{ availableWorkflowVariablePresets.length ? t('assets.select.variablePreset') : t('assets.empty.noVariablePreset') }}</option>
                      <option v-for="preset in availableWorkflowVariablePresets" :key="preset.name" :value="preset.name">
                        {{ preset.name }} / {{ preset.type }}
                      </option>
                    </select>
                    <button class="gc-button" type="button" @click="addWorkflowVariableRow">{{ t('assets.actions.addVariable') }}</button>
                  </div>
                </div>

                <div class="workflow-variable-form__verify">
                  <span>{{ t('assets.fields.verifyUrl') }}</span>
                  <strong>{{ effectiveVerifyUrl || t('assets.empty.basicEntryIncomplete') }}</strong>
                </div>

                <ul v-if="workflowVariableRows.length" class="workflow-variable-form__rows">
                  <li v-for="row in workflowVariableRows" :key="row.id" class="workflow-variable-form__row">
                    <label>
                      <span>{{ t('assets.workflowVariables.name') }}</span>
                      <input v-model="row.name" :readonly="row.fromDefinition" placeholder="deviceHost" autocomplete="off" />
                    </label>
                    <label>
                      <span>{{ t('assets.workflowVariables.type') }}</span>
                      <select v-model="row.type" :disabled="row.fromDefinition">
                        <option value="string">{{ t('assets.workflowVariableTypes.string') }}</option>
                        <option value="number">{{ t('assets.workflowVariableTypes.number') }}</option>
                        <option value="boolean">{{ t('assets.workflowVariableTypes.boolean') }}</option>
                        <option value="enum">{{ t('assets.workflowVariableTypes.enum') }}</option>
                        <option value="object">{{ t('assets.workflowVariableTypes.object') }}</option>
                        <option value="file">{{ t('assets.workflowVariableTypes.file') }}</option>
                        <option value="credential">{{ t('assets.workflowVariableTypes.credential') }}</option>
                        <option value="certificate">{{ t('assets.workflowVariableTypes.certificate') }}</option>
                      </select>
                    </label>
                    <label class="workflow-variable-form__value">
                      <span>{{ t('assets.workflowVariables.value') }}{{ row.required ? ' *' : '' }}</span>
                      <div v-if="row.type === 'certificate'" class="asset-form__readonly">{{ t('assets.workflowVariables.certificateAutoInjected') }}</div>
                      <select v-else-if="row.type === 'credential'" v-model="row.value" :disabled="workflowCredentialLoading">
                        <option value="">{{ workflowCredentialLoading ? t('assets.loading.credentials') : t('assets.select.credential') }}</option>
                        <option v-for="credential in workflowCredentialItems" :key="credential.id" :value="credential.id">
                          {{ workflowCredentialLabel(credential) }} / {{ workflowCredentialSummary(credential, t) }}
                        </option>
                      </select>
                      <select v-else-if="row.type === 'boolean'" v-model="row.value">
                        <option value="false">false</option>
                        <option value="true">true</option>
                      </select>
                      <select v-else-if="row.type === 'enum' && row.enumValues.length" v-model="row.value">
                        <option value="">{{ t('assets.select.generic') }}</option>
                        <option v-for="item in row.enumValues" :key="item" :value="item">{{ item }}</option>
                      </select>
                      <textarea v-else-if="row.type === 'object'" v-model="row.value" rows="3" placeholder="{ }"></textarea>
                      <input
                        v-else
                        v-model="row.value"
                        :inputmode="row.type === 'number' ? 'decimal' : undefined"
                        :placeholder="row.name"
                        autocomplete="off"
                      />
                    </label>
                    <div class="workflow-variable-form__row-actions">
                      <span>{{ row.fromDefinition ? 'DSL' : t('assets.workflowVariables.manual') }}</span>
                      <button class="gc-button gc-button--ghost" type="button" @click="removeWorkflowVariableRow(row.id)">{{ t('assets.actions.delete') }}</button>
                    </div>
                    <p v-if="row.type === 'certificate'" class="workflow-variable-form__description">{{ t('assets.workflowVariables.certificateDescription', { name: row.name }) }}</p>
                    <p v-else-if="row.description" class="workflow-variable-form__description">{{ row.description }}</p>
                  </li>
                </ul>
                <p v-else class="workflow-variable-form__empty">{{ t('assets.workflowVariables.empty') }}</p>
              </section>

              <section v-if="selectedWorkflowCertificateVariables.length" class="asset-form__field asset-form__field--wide workflow-certificate-form" :aria-label="t('assets.certificateBindings.title')">
                <div class="workflow-certificate-form__head">
                  <div>
                    <span>{{ t('assets.certificateBindings.title') }}</span>
                    <strong>{{ t('assets.certificateBindings.variableCount', { count: selectedWorkflowCertificateVariables.length }) }}</strong>
                  </div>
                  <small>{{ t('assets.certificateBindings.description') }}</small>
                </div>
                <ul class="workflow-certificate-form__rows">
                  <li v-for="item in selectedWorkflowCertificateVariables" :key="item.name" class="workflow-certificate-form__row">
                    <div class="workflow-certificate-form__variable">
                      <strong>{{ item.name }}</strong>
                      <span>{{ item.definition.description || t('assets.certificateBindings.defaultVariableDescription') }}</span>
                    </div>
                    <template v-if="item.outputs.length">
                      <label>
                        <span>{{ t('assets.fields.artifactFormat') }} <strong>*</strong></span>
                        <select
                          :value="workflowCertificateArtifactBindings[item.name]?.certificateFormatId ?? ''"
                          :disabled="certificateFormatLoading"
                          @change="updateWorkflowCertificateFormat(item.name, ($event.target as HTMLSelectElement).value)"
                        >
                          <option value="">{{ certificateFormatLoading ? t('assets.loading.certificateFormats') : t('assets.select.artifactFormat') }}</option>
                          <option v-for="format in workflowCertificateFormatOptions(item.name)" :key="String(format.id)" :value="String(format.id)">
                            {{ workflowCertificateFormatLabel(format) }}
                          </option>
                        </select>
                      </label>
                      <label v-for="slot in item.outputs" :key="`${item.name}:${slot.name}`">
                        <span>{{ workflowCertificateOutputSlotLabel(slot) }}</span>
                        <select
                          :value="workflowCertificateArtifactBindings[item.name]?.outputBindings?.[slot.name] ?? ''"
                          :disabled="!workflowCertificateArtifactBindings[item.name]?.certificateFormatId"
                          @change="updateWorkflowCertificateOutput(item.name, slot.name, ($event.target as HTMLSelectElement).value)"
                        >
                          <option value="">{{ slot.required ? t('assets.select.output') : t('assets.select.optionalOutput') }}</option>
                          <option
                            v-for="option in workflowCertificateOutputOptions(workflowCertificateArtifactBindings[item.name]?.certificateFormatId ?? '')"
                            :key="option.key"
                            :value="option.key"
                          >
                            {{ option.label }}
                          </option>
                        </select>
                        <small v-if="slot.description">{{ slot.description }}</small>
                      </label>
                    </template>
                    <p v-else class="workflow-certificate-form__empty">{{ t('assets.certificateBindings.noArtifactOutputs') }}</p>
                  </li>
                </ul>
              </section>
            </div>
            <p v-if="publishedWorkflowVersionItems.length === 0 && assetDraft.workflowId && !workflowVersionListLoading" class="asset-form__hint">
              {{ t('assets.workflowVariables.noPublishedVersion') }}
            </p>
            <p v-if="workflowVariablesError" class="asset-form__error">{{ workflowVariablesError }}</p>
            <p v-if="workflowCertificateArtifactError" class="asset-form__error">{{ workflowCertificateArtifactError }}</p>
            <p v-if="workflowCredentialError" class="asset-form__error">{{ workflowCredentialError }}</p>
            <p v-if="certificateFormatError" class="asset-form__error">{{ certificateFormatError }}</p>
          </template>
        </section>

        <section v-else class="asset-wizard__panel">
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
              <dd>{{ assetDraft.managementMode === 'WORKFLOW' ? t('assets.managementModes.independentWorkflow') : t('assets.managementModes.managedTarget') }}</dd>
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
              <dt>{{ t('assets.review.agentSiteTarget') }}</dt>
              <dd>{{ editAgentLabel || assetDraft.agentId || t('assets.empty.notSelected') }} / {{ editSiteLabel || assetDraft.siteAssetId || t('assets.empty.notSelected') }} / {{ editManagedTargetLabel || assetDraft.managedTargetId || t('assets.empty.notSelected') }}</dd>
            </div>
            <div v-if="assetDraft.managementMode === 'MANAGED_TARGET'">
              <dt>{{ t('assets.fields.certificateFormat') }}</dt>
              <dd>{{ workflowCertificateFormatLabel(certificateFormatItems.find((item) => String(item.id ?? '') === assetDraft.agentCertificateFormatId) ?? {}) || t('assets.empty.notSelected') }}</dd>
            </div>
            <div v-else>
              <dt>{{ t('assets.review.workflowVersion') }}</dt>
              <dd>{{ workflowTemplateLabel(selectedWorkflowTemplate ?? {}) || t('assets.empty.notSelected') }} / {{ assetDraft.workflowVersionSelection === 'LATEST_PUBLISHED' ? t('assets.workflowVersionSelection.latestPublished') : workflowVersionLabel(selectedWorkflowVersion ?? {}) || t('assets.empty.notSelected') }}</dd>
            </div>
            <div v-if="assetDraft.managementMode === 'WORKFLOW'">
              <dt>{{ t('assets.workflowTarget.title') }}</dt>
              <dd>
                {{ workflowTargetPreview?.frameworkType || t('assets.empty.notSet') }}
                / {{ workflowTargetPreview?.siteName || t('assets.empty.notSet') }}
                / {{ workflowTargetPreview?.bindingInformation || t('assets.empty.notSet') }}
              </dd>
            </div>
            <div v-if="assetDraft.managementMode === 'WORKFLOW'">
              <dt>{{ t('assets.fields.runner') }}</dt>
              <dd>{{ assetDraft.workflowRunner === 'GATEWAY' ? t('assets.review.gatewayRunner', { gateway: gatewayLabel(selectedGateway ?? {}) || assetDraft.workflowGatewayId }) : t('assets.runners.controlPlane') }}</dd>
            </div>
            <div v-if="assetDraft.managementMode === 'WORKFLOW'">
              <dt>{{ t('assets.workflowVariables.title') }}</dt>
              <dd>{{ workflowVariableConfiguredCount ? t('assets.review.variableCount', { count: workflowVariableConfiguredCount }) : t('assets.review.onlyBasicEntry') }}</dd>
            </div>
          </dl>
        </section>

        <p v-if="siteListError" class="asset-form__error">{{ siteListError }}</p>
        <p v-else-if="managedTargetListError" class="asset-form__error">{{ managedTargetListError }}</p>
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

.workflow-variable-form {
  display: grid;
  gap: 10px;
}

.workflow-variable-form__head,
.workflow-variable-form__add,
.workflow-variable-form__verify,
.workflow-variable-form__row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.workflow-variable-form__head {
  justify-content: space-between;
}

.workflow-variable-form__head > div:first-child {
  display: grid;
  gap: 3px;
}

.workflow-variable-form__head strong {
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.workflow-variable-form__add {
  flex: 0 1 360px;
}

.workflow-variable-form__verify {
  justify-content: space-between;
  padding: 9px 11px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 12px;
  background: var(--gc-color-surface-selected);
}

.workflow-variable-form__verify span {
  color: var(--gc-color-primary-strong);
  font-weight: 900;
}

.workflow-variable-form__verify strong {
  color: var(--gc-color-text);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.workflow-variable-form__rows {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.workflow-variable-form__row {
  display: grid;
  grid-template-columns: minmax(120px, 0.9fr) minmax(110px, 0.7fr) minmax(180px, 1.5fr) auto;
  gap: 10px;
  align-items: start;
  padding: 11px;
  border: 1px solid var(--gc-color-muted-bg);
  border-radius: 12px;
  background: var(--gc-color-surface-subtle);
}

.workflow-variable-form__row--variable {
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 2.2fr);
}

.workflow-variable-form__row--connection-advanced {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.workflow-variable-form__row--variable > input,
.workflow-variable-form__row--variable > select,
.workflow-variable-form__row--connection-advanced input {
  width: 100%;
  min-width: 0;
}

.workflow-variable-form__row label {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.workflow-variable-form__row label span,
.workflow-variable-form__row-actions span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 850;
}

.workflow-variable-form__row input[readonly] {
  color: var(--gc-color-muted);
  background: var(--gc-color-muted-bg);
}

.workflow-variable-form__value textarea {
  min-height: 78px;
}

.workflow-variable-form__row-actions {
  align-self: stretch;
  justify-content: space-between;
  flex-direction: column;
  min-width: 74px;
}

.workflow-variable-form__description {
  grid-column: 1 / -1;
  margin: -2px 0 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.workflow-variable-form__empty {
  margin: 0;
  padding: 14px;
  border: 1px dashed var(--gc-color-border-strong);
  border-radius: 12px;
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-subtle);
  font-size: 13px;
  font-weight: 750;
}

.workflow-certificate-form {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
}

.workflow-certificate-form__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.workflow-certificate-form__head > div,
.workflow-certificate-form__variable,
.workflow-certificate-form__row label {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.workflow-certificate-form__head span,
.workflow-certificate-form__row label span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 850;
}

.workflow-certificate-form__head strong,
.workflow-certificate-form__variable strong {
  color: var(--gc-color-text);
  overflow-wrap: anywhere;
}

.workflow-certificate-form__head small,
.workflow-certificate-form__variable span,
.workflow-certificate-form__row label small,
.workflow-certificate-form__empty {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.45;
}

.workflow-certificate-form__rows {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workflow-certificate-form__row {
  display: grid;
  grid-template-columns: minmax(150px, 0.8fr) minmax(220px, 1.2fr) minmax(180px, 1fr);
  gap: 10px;
  align-items: start;
  padding: 11px;
  border: 1px solid var(--gc-color-muted-bg);
  border-radius: 12px;
  background: var(--gc-color-surface-solid);
}

.workflow-certificate-form__empty {
  grid-column: 2 / -1;
  margin: 0;
  padding: 10px 12px;
  border: 1px dashed var(--gc-color-border-strong);
  border-radius: 10px;
  background: var(--gc-color-surface-subtle);
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
  .workflow-variable-form__head,
  .workflow-variable-form__add,
  .workflow-variable-form__verify { align-items: stretch; flex-direction: column; }
  .workflow-variable-form__add { flex-basis: auto; }
  .workflow-variable-form__row { grid-template-columns: 1fr; }
  .workflow-variable-form__row-actions { flex-direction: row; }
  .workflow-certificate-form__head { flex-direction: column; }
  .workflow-certificate-form__row { grid-template-columns: 1fr; }
  .workflow-certificate-form__empty { grid-column: 1; }
  .asset-detail-modal__grid,
  .asset-binding__detail,
  .asset-form__binding-summary,
  .asset-binding-relations__grid { grid-template-columns: 1fr; }
}
</style>


