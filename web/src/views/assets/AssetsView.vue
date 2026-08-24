<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { createManagedTarget, createServiceAsset, createServiceInstance, createSiteAsset, getAgentDetail, getAssetDetail, listAgents, listAssets, listManagedTargetSnapshots, listManagedTargets, listServiceInstances, listSiteAssets, updateServiceAsset } from '@/api/modules/assets.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import type { ViewRow } from '@/composables/useBusinessPage'
import { GcModal, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'

type AssetPlatform = 'WINDOWS' | 'LINUX' | 'APPLIANCE'
type AssetProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP'
type FrameworkType = 'IIS' | 'NGINX' | 'APACHE' | 'TOMCAT'

interface AssetDraft {
  address: string
  port: string
  protocol: AssetProtocol
  platform: AssetPlatform
  verifyUrl: string
  agentId: string
  frameworkType: FrameworkType
  siteAssetId: string
  managedTargetId: string
  displayName: string
  environment: string
  tagsText: string
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
const selectedServiceAsset = ref<ViewRow | null>(null)
const detailModalOpen = ref(false)
const activeDetailTab = ref<'overview' | 'snapshots'>('overview')
const detailTabs = [
  { value: 'overview', label: '基础信息' },
  { value: 'snapshots', label: '快照' },
]
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

const assetDraft = reactive<AssetDraft>({
  address: '',
  port: '443',
  protocol: 'HTTPS',
  platform: 'LINUX',
  verifyUrl: '',
  agentId: '',
  frameworkType: 'NGINX',
  siteAssetId: '',
  managedTargetId: '',
  displayName: '',
  environment: '',
  tagsText: '',
})

const config: BusinessPageConfig = {
  title: '应用资产',
  description: '以域名或 IP 为主对象管理应用入口，聚焦地址、端口、协议、站点与执行定位。',
  showHeader: false,
  showMetrics: false,
  showEmptyState: false,
  readPermission: 'service_asset.read',
  primaryPermission: 'service_asset.manage',
  primaryActionLabel: '添加资产',
  primaryAction: openCreateDialog,
  moduleName: 'assets',
  resourceName: '应用资产',
  defaultStatus: 'ACTIVE',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: '访问域名', candidates: ['address', 'displayName', 'domainName'] },
    { key: 'port', title: '端口', candidates: ['port'] },
    { key: 'protocol', title: '协议', candidates: ['protocol'] },
    { key: 'platform', title: '平台', candidates: ['platform'] },
    { key: 'frameworkType', title: '框架', candidates: ['targetBinding.frameworkType'] },
    { key: 'siteName', title: '站点', candidates: ['siteDisplayName', 'targetBindingDetail.siteAsset.siteName', 'targetBinding.metadata.siteName', 'targetBinding.siteAssetId'] },
    { key: 'agentId', title: 'Agent', candidates: ['agentDisplayName', 'agentName', 'targetBinding.agentDisplayName', 'agentId'] },
    { key: 'status', title: '状态', candidates: ['status'] },
    { key: 'actions', title: '操作', candidates: [] },
  ],
  metrics: [],
  detailFields: [
    { label: '应用资产 ID', candidates: ['id'] },
    { label: '访问域名', candidates: ['address', 'displayName'] },
    { label: '地址类型', candidates: ['addressType'] },
    { label: '端口', candidates: ['port'] },
    { label: '协议', candidates: ['protocol'] },
    { label: '验证 URL', candidates: ['verifyUrl', 'metadata.verifyUrl'] },
    { label: '平台', candidates: ['platform'] },
    { label: '框架类型', candidates: ['targetBinding.frameworkType'] },
    { label: 'Agent ID', candidates: ['agentId'] },
    { label: 'SNI', candidates: ['sniName'] },
    { label: '服务实例 ID', candidates: ['serviceInstanceId'] },
    { label: '站点 ID', candidates: ['targetBinding.siteAssetId'] },
    { label: '受管目标 ID', candidates: ['targetBinding.managedTargetId'] },
    { label: '绑定键', candidates: ['targetBinding.bindingKey'] },
    { label: '宿主机 ID', candidates: ['hostId'] },
    { label: '环境', candidates: ['environment'] },
    { label: '发现来源', candidates: ['discoverySource'] },
    { label: '最后发现时间', candidates: ['lastDiscoveredAt', 'updatedAt'] },
    { label: '标签', candidates: ['tags'] },
  ],
  contextLinks: [
    { label: '查看证书绑定', to: '/bindings', queryKey: 'serviceAssetId', candidates: ['id'] },
    { label: '查看执行记录', to: '/executions', queryKey: 'serviceAssetId', candidates: ['id'] },
  ],
  emptyTitle: '暂无应用资产',
  emptyDescription: '等待发现链路写入 ServiceAsset，或通过后端接口补录应用入口。',
  load: loadAssetsWithDisplayNames,
  actions: [],
  rowActions: [
    {
      label: '编辑',
      permission: 'service_asset.manage',
      reloadAfterRun: false,
      run: openEditDialog,
    },
    {
      label: '详情',
      permission: 'service_asset.read',
      reloadAfterRun: false,
      run: openDetailModal,
    },
  ],
  onSelectionChange: handleServiceAssetSelection,
}

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
  if (assetDraft.platform === 'WINDOWS') return ['IIS']
  if (assetDraft.platform === 'LINUX') return ['NGINX', 'APACHE', 'TOMCAT']
  return ['NGINX']
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

const createDisabled = computed(() => {
  const port = Number(assetDraft.port)
  const missingBindingSelection = !assetDraft.agentId.trim()
    || !assetDraft.siteAssetId.trim()
    || !assetDraft.managedTargetId.trim()
  return createLoading.value
    || !assetDraft.address.trim()
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || (!isEditMode.value && missingBindingSelection)
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
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
  await loadAgents()
}

async function openEditDialog(row: ViewRow) {
  resetDraft()
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
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
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
    const message = cause instanceof Error ? cause.message : '鍔犺浇搴旂敤璧勪骇璇︽儏澶辫触'
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
    rollbackError.value = cause instanceof Error ? cause.message : '鍙戣捣鍥為€€澶辫触'
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
      const message = cause instanceof Error ? cause.message : '加载站点和受管目标失败'
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
    if (isEditMode.value) {
      const result = await updateServiceAsset(editingServiceAssetId.value, {
        address: assetDraft.address.trim(),
        displayName: assetDraft.displayName.trim() || assetDraft.address.trim(),
        port: Number(assetDraft.port),
        protocol: assetDraft.protocol,
        platform: assetDraft.platform,
        verifyUrl: assetDraft.verifyUrl.trim() || undefined,
        environment: assetDraft.environment.trim() || undefined,
        tags: splitCsv(assetDraft.tagsText),
      })
      createRequestId.value = result.requestId
      createDialogOpen.value = false
      editingServiceAssetId.value = ''
      await pageRef.value?.reload()
      return
    }
    const resolvedBinding = await ensureTargetBindingResources()
    const result = await createServiceAsset({
      address: assetDraft.address.trim(),
      displayName: assetDraft.displayName.trim() || assetDraft.address.trim(),
      port: Number(assetDraft.port),
      protocol: assetDraft.protocol,
      platform: assetDraft.platform,
      verifyUrl: assetDraft.verifyUrl.trim() || undefined,
      agentId: assetDraft.agentId.trim(),
      environment: assetDraft.environment.trim() || undefined,
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
      tags: splitCsv(assetDraft.tagsText),
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
    createError.value = cause instanceof Error ? cause.message : '创建应用资产失败'
  } finally {
    createLoading.value = false
  }
}

function resetDraft() {
  editingServiceAssetId.value = ''
  editAssetDetail.value = null
  assetDraft.address = ''
  assetDraft.port = '443'
  assetDraft.protocol = 'HTTPS'
  assetDraft.platform = 'LINUX'
  assetDraft.verifyUrl = ''
  assetDraft.agentId = ''
  assetDraft.frameworkType = 'NGINX'
  assetDraft.siteAssetId = ''
  assetDraft.managedTargetId = ''
  assetDraft.displayName = ''
  assetDraft.environment = ''
  assetDraft.tagsText = ''
  siteItems.value = []
  managedTargetItems.value = []
  fallbackSiteItems.value = []
  fallbackManagedTargetItems.value = []
  siteListError.value = ''
  managedTargetListError.value = ''
}

function splitCsv(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
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
  return {
    ...asset,
    agentDisplayName: agent ? agentName(agent) : readNested(asset, ['agentDisplayName']),
    siteDisplayName: site ? siteName(site) : readNested(asset, ['siteDisplayName']),
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
  return hostHeader ? `${siteName} (${hostHeader})` : `${siteName} (${bindingInformation || '未提供绑定信息'})`
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
    throw new Error('未找到可用的站点实例，请先确认 Agent 详情中的框架站点已成功上报。')
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
  if (!versionId) return '未设置'
  return versionId
}

function snapshotTypeLabel(value: unknown): string {
  const normalized = String(value ?? '')
  if (normalized === 'PRE_DEPLOY') return '部署前'
  if (normalized === 'POST_DEPLOY') return '部署后'
  if (normalized === 'POST_ROLLBACK') return '回退后'
  if (normalized === 'ERROR_STATE') return '错误态'
  if (normalized === 'ROLLBACK_POINT') return '回退点'
  return normalized || '未知'
}

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
    await refreshAssetTargets()
  },
)

watch(
  () => assetDraft.frameworkType,
  async () => {
    if (isEditMode.value) return
    assetDraft.siteAssetId = ''
    assetDraft.managedTargetId = ''
    managedTargetItems.value = []
    fallbackManagedTargetItems.value = []
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
</script>

<template>
  <section class="asset-page">
    <BusinessResourcePage ref="pageRef" :config="config" />

    <GcModal
      v-model:open="detailModalOpen"
      title="应用详情"
      description="把资产详情、绑定关系、部署入口和快照都收在一个模态框里，避免页面被常驻详情拖长。"
      size="xxl"
      width="72vw"
    >
      <section v-if="selectedServiceAsset" class="asset-detail-modal">
        <header class="asset-detail-modal__hero">
          <div class="asset-detail-modal__hero-copy">
            <p class="asset-detail-modal__eyebrow">应用资产</p>
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
              <small>框架</small>
              <strong>{{ renderValue(readNested(selectedAssetDetail ?? selectedServiceAsset.raw, ['targetBinding', 'frameworkType'])) }}</strong>
            </div>
          </div>
        </header>

        <GcTabs v-model="activeDetailTab" :tabs="detailTabs" aria-label="应用详情标签页" />

        <section v-if="activeDetailTab === 'overview'" class="asset-detail-modal__sections">
          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>基础信息</h3>
              <p>应用资产是主对象，宿主机和站点只作为执行定位信息出现。</p>
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
              <h3>目标绑定</h3>
              <p>绑定必须明确落到站点和受管目标，而不是继续靠域名猜。</p>
            </div>
            <p v-if="detailLoading" class="asset-summary__loading">正在加载目标绑定详情...</p>
            <p v-else-if="detailError" class="asset-summary__error">{{ detailError }}</p>
            <dl v-else-if="selectedAssetDetail" class="asset-binding__detail">
              <div>
                <dt>框架类型</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBinding', 'frameworkType'])) }}</dd>
              </div>
              <div>
                <dt>站点</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'siteName'])) }}</dd>
              </div>
              <div>
                <dt>受管目标</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'managedTarget', 'targetType'])) }}</dd>
              </div>
              <div>
                <dt>绑定信息</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'bindingInformation'])) }}</dd>
              </div>
              <div>
                <dt>Host Header</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'hostHeader'])) }}</dd>
              </div>
              <div>
                <dt>端口</dt>
                <dd>{{ renderValue(readNested(selectedAssetDetail, ['targetBindingDetail', 'siteAsset', 'port'])) }}</dd>
              </div>
            </dl>
          </article>

          <article class="asset-detail-modal__section">
            <div class="asset-detail-modal__section-head">
              <h3>证书绑定关系</h3>
              <p>把证书关系明确到 binding 上，而不是只看域名。</p>
            </div>
            <p v-if="!bindingRelations.length" class="asset-summary__loading">暂无证书绑定关系。</p>
            <ul v-else class="asset-binding-relations">
              <li v-for="binding in bindingRelations" :key="String(binding.id ?? '')" class="asset-binding-relations__item">
                <div class="asset-binding-relations__grid">
                  <div>
                    <span>Binding</span>
                    <strong>{{ renderValue(binding.bindingKey) }}</strong>
                  </div>
                  <div>
                    <span>域名</span>
                    <strong>{{ renderValue(binding.domainName ?? binding.domain) }}</strong>
                  </div>
                  <div>
                    <span>当前证书</span>
                    <strong>{{ certificateVersionLabel(String(binding.certificateVersionId ?? binding.localCertificateVersionId ?? '')) }}</strong>
                  </div>
                  <div>
                    <span>目标证书</span>
                    <strong>{{ certificateVersionLabel(String(binding.targetCertificateVersionId ?? binding.certificateVersionId ?? '')) }}</strong>
                  </div>
                  <div>
                    <span>期望指纹</span>
                    <strong>{{ renderValue(binding.desiredFingerprintSha256 ?? binding.targetFingerprintSha256) }}</strong>
                  </div>
                  <div>
                    <span>证书存储</span>
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
              <h3>快照</h3>
              <p>部署前后与回退后的现场状态必须能直接看到，不能只剩任务记录。</p>
            </div>
            <p v-if="snapshotLoading" class="asset-summary__loading">正在加载快照...</p>
            <p v-else-if="snapshotError" class="asset-summary__error">{{ snapshotError }}</p>
            <ul v-else-if="snapshotItems.length" class="asset-binding-relations">
              <li v-for="snapshot in snapshotItems" :key="String(snapshot.id ?? '')" class="asset-binding-relations__item">
                <div class="asset-binding-relations__grid">
                  <div>
                    <span>快照类型</span>
                    <strong>{{ snapshotTypeLabel(snapshot.snapshotType) }}</strong>
                  </div>
                  <div>
                    <span>状态</span>
                    <strong>{{ renderValue(snapshot.status) }}</strong>
                  </div>
                  <div>
                    <span>时间</span>
                    <strong>{{ renderValue(snapshot.capturedAt ?? snapshot.createdAt) }}</strong>
                  </div>
                  <div>
                    <span>Thumbprint</span>
                    <strong>{{ renderValue(snapshot.storeThumbprint) }}</strong>
                  </div>
                  <div>
                    <span>绑定信息</span>
                    <strong>{{ renderValue(snapshot.bindingInformation) }}</strong>
                  </div>
                  <div>
                    <span>执行运行</span>
                    <strong>{{ renderValue(snapshot.executionRunId) }}</strong>
                  </div>
                </div>
              </li>
            </ul>
            <p v-else class="asset-summary__loading">暂无快照。</p>
            <div class="asset-deployment__actions">
              <p v-if="rollbackError" class="asset-summary__error">{{ rollbackError }}</p>
              <p v-else-if="rollbackRequestId" class="asset-form__request">已提交回退请求，请到“执行记录”查看回退运行。</p>
              <button class="gc-button" type="button" :disabled="!canRollbackFromSnapshot" @click="rollbackFromLatestSnapshot">
                {{ rollbackSubmitting ? '回退中...' : '从最新快照发起回退' }}
              </button>
            </div>
          </article>
        </section>
      </section>
    </GcModal>

    <GcModal
      v-model:open="createDialogOpen"
      :title="isEditMode ? '编辑应用资产' : '手动添加应用资产'"
      :description="isEditMode ? '编辑应用入口自身信息；站点与受管目标定位保持原绑定。' : '名称使用应用访问域名；平台决定允许绑定的 Agent。'"
    >
      <section class="asset-form">
        <div class="asset-form__grid">
          <label class="asset-form__field">
            <span>访问域名 <strong>*</strong></span>
            <input v-model="assetDraft.address" placeholder="app.example.com" autocomplete="off" />
          </label>
          <label class="asset-form__field">
            <span>显示名称</span>
            <input v-model="assetDraft.displayName" placeholder="留空则默认等于访问域名" autocomplete="off" />
          </label>
          <label class="asset-form__field">
            <span>端口 <strong>*</strong></span>
            <input v-model="assetDraft.port" inputmode="numeric" placeholder="443" autocomplete="off" />
          </label>
          <label class="asset-form__field">
            <span>协议 <strong>*</strong></span>
            <select v-model="assetDraft.protocol">
              <option value="HTTPS">HTTPS</option>
              <option value="HTTP">HTTP</option>
              <option value="TLS">TLS</option>
              <option value="STARTTLS">STARTTLS</option>
            </select>
          </label>
          <label class="asset-form__field">
            <span>验证 URL</span>
            <input
              v-model="assetDraft.verifyUrl"
              placeholder="留空则默认使用 https://访问域名:端口"
              autocomplete="off"
            />
          </label>
          <label class="asset-form__field">
            <span>平台 <strong>*</strong></span>
            <div v-if="isEditMode" class="asset-form__readonly">{{ assetDraft.platform || '—' }}</div>
            <select v-else v-model="assetDraft.platform">
              <option value="LINUX">Linux</option>
              <option value="WINDOWS">Windows</option>
              <option value="APPLIANCE">专用设备</option>
            </select>
          </label>
          <label class="asset-form__field">
            <span>框架类型 <strong>*</strong></span>
            <div v-if="isEditMode" class="asset-form__readonly">{{ assetDraft.frameworkType || '—' }}</div>
            <select v-else v-model="assetDraft.frameworkType">
              <option v-for="framework in availableFrameworkOptions" :key="framework" :value="framework">
                {{ framework }}
              </option>
            </select>
          </label>
          <label class="asset-form__field">
            <span>Agent <strong>*</strong></span>
            <div v-if="isEditMode" class="asset-form__readonly">{{ editAgentLabel }}</div>
            <select v-else v-model="assetDraft.agentId" :disabled="agentListLoading">
              <option value="">{{ agentListLoading ? '加载 Agent 中...' : '请选择 Agent' }}</option>
              <option v-for="agent in filteredAgentItems" :key="String(agent.id)" :value="String(agent.id)">
                {{ agentLabel(agent) }}
              </option>
            </select>
          </label>
          <label class="asset-form__field">
            <span>站点实例 <strong>*</strong></span>
            <div v-if="isEditMode" class="asset-form__readonly">{{ editSiteLabel }}</div>
            <select v-else v-model="assetDraft.siteAssetId" :disabled="siteListLoading || !assetDraft.agentId">
              <option value="">{{ siteListLoading ? '加载站点中...' : '请选择站点实例' }}</option>
              <option v-for="site in filteredSiteItems" :key="String(site.id)" :value="String(site.id)">
                {{ siteLabel(site) }}
              </option>
            </select>
          </label>
          <label class="asset-form__field">
            <span>受管目标 <strong>*</strong></span>
            <div v-if="isEditMode" class="asset-form__readonly">{{ editManagedTargetLabel }}</div>
            <select v-else v-model="assetDraft.managedTargetId" :disabled="managedTargetListLoading || !assetDraft.siteAssetId">
              <option value="">{{ managedTargetListLoading ? '加载目标中...' : '请选择受管目标' }}</option>
              <option v-for="target in filteredManagedTargetItems" :key="String(target.id)" :value="String(target.id)">
                {{ managedTargetLabel(target) }}
              </option>
            </select>
          </label>
          <label class="asset-form__field">
            <span>环境</span>
            <input v-model="assetDraft.environment" placeholder="prod / staging" autocomplete="off" />
          </label>
          <label class="asset-form__field">
            <span>标签</span>
            <input v-model="assetDraft.tagsText" placeholder="core, public, ssl" autocomplete="off" />
          </label>
        </div>
        <div class="asset-form__binding-summary">
          <div>
            <span>绑定信息</span>
            <strong>{{ renderValue(currentBindingSummary.bindingInformation) }}</strong>
          </div>
          <div>
            <span>Host Header</span>
            <strong>{{ renderValue(currentBindingSummary.hostHeader) }}</strong>
          </div>
          <div>
            <span>端口</span>
            <strong>{{ renderValue(currentBindingSummary.port) }}</strong>
          </div>
        </div>
        <p v-if="siteListError" class="asset-form__error">{{ siteListError }}</p>
        <p v-else-if="managedTargetListError" class="asset-form__error">{{ managedTargetListError }}</p>
        <p v-if="createError" class="asset-form__error">{{ createError }}</p>
        <p v-else-if="createRequestId" class="asset-form__request">{{ isEditMode ? '最近编辑请求已完成。' : '最近创建请求已完成。' }}</p>
      </section>
      <template #actions>
        <button class="gc-button" type="button" :disabled="createLoading" @click="closeCreateDialog">取消</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="createDisabled" @click="submitCreate">
          {{ createLoading ? (isEditMode ? '保存中...' : '创建中...') : (isEditMode ? '保存修改' : '确认创建') }}
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
  border: 1px solid #d9e5f7;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgb(59 130 246 / 12%), transparent 26%),
    linear-gradient(140deg, #f7fbff 0%, #ffffff 54%, #f3f7fc 100%);
}

.asset-detail-modal__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.asset-detail-modal__eyebrow {
  margin: 0;
  color: #5b6f88;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.asset-detail-modal__hero-copy h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.06;
  letter-spacing: -0.05em;
  overflow-wrap: anywhere;
}

.asset-detail-modal__hero-copy span {
  color: #64748b;
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
  background: #0f172a;
  color: #fff;
}

.asset-detail-modal__spotlight small {
  color: rgb(255 255 255 / 68%);
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
  border: 1px solid #e3ebf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
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
  color: #0f172a;
  font-size: 15px;
  letter-spacing: -0.03em;
}

.asset-detail-modal__section-head p {
  color: #64748b;
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
  background: #f8fbff;
  border: 1px solid #e4edf8;
}

.asset-detail-modal__item dt {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.asset-detail-modal__item dd {
  margin: 0;
  color: #0f172a;
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
.asset-form__readonly {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
}
.asset-form__field input,
.asset-form__field select {
  outline: none;
}
.asset-form__field input:focus,
.asset-form__field select:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgb(96 165 250 / 14%);
  background: #fff;
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

@media (max-width: 860px) {
  .asset-form__grid { grid-template-columns: 1fr; }
  .asset-detail-modal__grid,
  .asset-binding__detail,
  .asset-form__binding-summary,
  .asset-binding-relations__grid { grid-template-columns: 1fr; }
}
</style>


