<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import {
  createHost,
  createServiceInstance,
  deleteHost,
  listAssets,
  listCapabilities,
  listServiceInstances,
  previewDiscoveryMerge,
  startDiscovery,
  updateHost,
  updateServiceInstance,
} from '@/api/modules/assets.api'
import { GcCapabilityMatrix, GcModal, GcPermissionButton } from '@/design-system/components'
import type { CapabilityMatrixItem } from '@/design-system/components/GcCapabilityMatrix.vue'
import type { ViewRow } from '@/composables/useBusinessPage'

interface HostDraft {
  id: string
  hostname: string
  displayName: string
  primaryIp: string
  ipAddressesText: string
  osType: string
  osName: string
  osVersion: string
  arch: string
  environment: string
  zoneId: string
  ownerId: string
  compatibilityLevel: string
  managementMode: string
  managementChannelsText: string
  tagsText: string
}

interface ServiceDraft {
  id: string
  hostId: string
  providerType: string
  serviceName: string
  displayName: string
  versionText: string
  installPath: string
  configPath: string
  runtimeUser: string
  portsText: string
  discoverySource: string
  status: string
  manualOverridesText: string
}

interface DiscoveryConflictResolution {
  key: string
  action: 'keep' | 'use' | 'custom'
  customValue: string
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const selectedHost = ref<ViewRow | null>(null)
const hostDialogMode = ref<'create' | 'edit'>('create')
const hostDialogOpen = ref(false)
const hostLoading = ref(false)
const hostError = ref('')
const hostRequestId = ref('')
const serviceDialogMode = ref<'create' | 'edit'>('create')
const serviceDialogOpen = ref(false)
const serviceLoading = ref(false)
const serviceError = ref('')
const serviceRequestId = ref('')
const serviceItems = ref<ApiRecord[]>([])
const serviceListRequestId = ref('')
const serviceListError = ref('')
const discoveryLoading = ref(false)
const discoveryError = ref('')
const discoveryRequestId = ref('')
const discoveryActions = ref<ApiRecord[]>([])
const discoveryConflicts = ref<ApiRecord[]>([])
const conflictResolutions = reactive<Record<string, DiscoveryConflictResolution>>({})
const capabilityLoading = ref(false)
const capabilityRequestId = ref('')
const capabilityError = ref('')
const capabilityItems = ref<CapabilityMatrixItem[]>([])

const hostDraft = reactive<HostDraft>(emptyHostDraft())
const serviceDraft = reactive<ServiceDraft>(emptyServiceDraft())

const hostSubmitDisabled = computed(() => hostLoading.value || !hostDraft.hostname.trim())
const serviceSubmitDisabled = computed(() => serviceLoading.value || !serviceDraft.hostId.trim() || !serviceDraft.displayName.trim())
const selectedHostId = computed(() => selectedHost.value?.id ?? '')
const serviceRowsForSelectedHost = computed(() => serviceItems.value.filter((item) => String(item.hostId ?? '') === selectedHostId.value))
const selectedHostRaw = computed(() => selectedHost.value?.raw ?? null)
const conflictRows = computed(() => discoveryConflicts.value.map((conflict, index) => {
  const key = String(conflict.identityKey ?? `conflict-${index}`)
  if (!conflictResolutions[key]) {
    conflictResolutions[key] = { key, action: 'keep', customValue: stringifyValue(conflict.currentValue) }
  }
  return { key, conflict, resolution: conflictResolutions[key]! }
}))

const config: BusinessPageConfig = {
  title: '资产',
  description: '主机、服务实例、Agent 状态、Gateway 路径、兼容等级和最近发现结果。',
  readPermission: 'host.read',
  primaryPermission: 'host.write',
  primaryActionLabel: '登记资产',
  primaryAction: () => openHostDialog('create'),
  moduleName: 'assets',
  resourceName: '主机资产',
  defaultStatus: 'DISCOVERED',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '主机名/IP', candidates: ['hostname', 'name', 'ipAddress'] },
    { key: 'status', title: 'Agent 状态', candidates: ['agentStatus', 'status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'os', title: '操作系统', candidates: ['osName', 'os', 'osType', 'platform'] },
    { key: 'compatibility', title: '兼容等级', candidates: ['compatibilityLevel', 'capability.level'] }
  ],
  metrics: [
    { title: '资产总数', description: '当前租户可见主机和服务实例。', status: 'DISCOVERED', risk: 'LOW' },
    { title: '高危待处理', description: '离线、能力缺失或发现失败资产。', status: 'OFFLINE', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '资产 ID', candidates: ['id', 'hostId', 'assetId'] },
    { label: '主机/IP', candidates: ['hostname', 'name', 'ipAddress'] },
    { label: 'Zone', candidates: ['zoneId'] },
    { label: 'Owner', candidates: ['ownerId'] },
    { label: '操作系统', candidates: ['osName', 'os', 'osType', 'platform'] },
    { label: 'OS 版本', candidates: ['osVersion'] },
    { label: '架构', candidates: ['arch'] },
    { label: '管理通道', candidates: ['managementChannels', 'managementMode'] },
    { label: 'Agent', candidates: ['agentStatus', 'agent.id', 'agentId'] },
    { label: 'Gateway', candidates: ['gatewayName', 'gatewayId'] },
    { label: '兼容等级', candidates: ['compatibilityLevel', 'capability.level'] },
    { label: '标签', candidates: ['tags'] }
  ],
  contextLinks: [
    { label: '查看绑定', to: '/bindings', queryKey: 'hostId', candidates: ['id', 'hostId', 'assetId'] },
    { label: '查看执行记录', to: '/executions', queryKey: 'hostId', candidates: ['id', 'hostId', 'assetId'] }
  ],
  emptyTitle: '暂无资产',
  emptyDescription: '请先登记主机、接入 Agent/Gateway，或执行一次 Provider 发现。',
  load: () => listAssets({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [
    { label: '发起资产发现', permission: 'host.write', danger: true, confirmText: 'DISCOVER', riskText: '发现任务可能访问生产网络，请确认目标范围和凭据最小权限。', run: () => startDiscovery({ scope: 'current-filter', dryRun: true }) }
  ],
  onSelectionChange: handleHostSelection
}

function emptyHostDraft(): HostDraft {
  return {
    id: '',
    hostname: '',
    displayName: '',
    primaryIp: '',
    ipAddressesText: '',
    osType: 'UNKNOWN',
    osName: '',
    osVersion: '',
    arch: '',
    environment: '',
    zoneId: '',
    ownerId: '',
    compatibilityLevel: 'L1',
    managementMode: 'MONITOR_ONLY',
    managementChannelsText: '',
    tagsText: ''
  }
}

function emptyServiceDraft(): ServiceDraft {
  return {
    id: '',
    hostId: '',
    providerType: 'NGINX',
    serviceName: '',
    displayName: '',
    versionText: '',
    installPath: '',
    configPath: '',
    runtimeUser: '',
    portsText: '',
    discoverySource: 'MANUAL',
    status: 'ACTIVE',
    manualOverridesText: ''
  }
}

function assignHostDraft(next: HostDraft) {
  Object.assign(hostDraft, next)
}

function assignServiceDraft(next: ServiceDraft) {
  Object.assign(serviceDraft, next)
}

function handleHostSelection(row: ViewRow | null) {
  selectedHost.value = row
  void refreshServiceInstances(row?.id)
  void refreshCapabilities(row?.id)
}

function openHostDialog(mode: 'create' | 'edit') {
  hostDialogMode.value = mode
  hostError.value = ''
  hostRequestId.value = ''
  if (mode === 'edit' && selectedHostRaw.value) {
    assignHostDraft(hostDraftFromRecord(selectedHostRaw.value))
  } else {
    assignHostDraft(emptyHostDraft())
  }
  hostDialogOpen.value = true
}

function closeHostDialog() {
  if (!hostLoading.value) hostDialogOpen.value = false
}

function hostDraftFromRecord(record: ApiRecord): HostDraft {
  return {
    ...emptyHostDraft(),
    id: String(record.id ?? ''),
    hostname: String(record.hostname ?? ''),
    displayName: String(record.displayName ?? ''),
    primaryIp: String(record.primaryIp ?? ''),
    ipAddressesText: Array.isArray(record.ipAddresses) ? record.ipAddresses.map(String).join(', ') : '',
    osType: String(record.osType ?? 'UNKNOWN'),
    osName: String(record.osName ?? ''),
    osVersion: String(record.osVersion ?? ''),
    arch: String(record.arch ?? ''),
    environment: String(record.environment ?? ''),
    zoneId: String(record.zoneId ?? ''),
    ownerId: String(record.ownerId ?? ''),
    compatibilityLevel: String(record.compatibilityLevel ?? 'L1'),
    managementMode: String(record.managementMode ?? 'MONITOR_ONLY'),
    managementChannelsText: Array.isArray(record.managementChannels) ? record.managementChannels.map(String).join(', ') : '',
    tagsText: Array.isArray(record.tags) ? record.tags.map(String).join(', ') : ''
  }
}

function buildHostPayload() {
  const ipAddresses = splitCsv(hostDraft.ipAddressesText)
  const tags = splitCsv(hostDraft.tagsText)
  const managementChannels = splitCsv(hostDraft.managementChannelsText)
  return stripEmpty({
    hostname: hostDraft.hostname.trim(),
    displayName: hostDraft.displayName.trim(),
    primaryIp: hostDraft.primaryIp.trim(),
    ipAddresses,
    osType: hostDraft.osType,
    osName: hostDraft.osName.trim(),
    osVersion: hostDraft.osVersion.trim(),
    arch: hostDraft.arch.trim(),
    environment: hostDraft.environment.trim(),
    zoneId: hostDraft.zoneId.trim(),
    ownerId: hostDraft.ownerId.trim(),
    compatibilityLevel: hostDraft.compatibilityLevel,
    managementMode: hostDraft.managementMode,
    managementChannels,
    status: 'ACTIVE',
    tags
  })
}

async function submitHost() {
  if (!hostDraft.hostname.trim()) {
    hostError.value = '主机名/IP 不能为空。'
    return
  }
  hostLoading.value = true
  hostError.value = ''
  hostRequestId.value = ''
  try {
    const result = hostDialogMode.value === 'edit'
      ? await updateHost(hostDraft.id, buildHostPayload())
      : await createHost(buildHostPayload())
    hostRequestId.value = result.requestId
    hostDialogOpen.value = false
    await pageRef.value?.reload()
  } catch (cause) {
    handleDialogError(cause, hostError, hostRequestId, '保存 Host 失败，请检查输入。')
  } finally {
    hostLoading.value = false
  }
}

async function softDeleteSelectedHost() {
  if (!selectedHost.value) return
  hostLoading.value = true
  hostError.value = ''
  hostRequestId.value = ''
  try {
    const result = await deleteHost(selectedHost.value.id, { reason: 'manual_soft_delete_from_console' })
    hostRequestId.value = result.requestId
    await pageRef.value?.reload()
  } catch (cause) {
    handleDialogError(cause, hostError, hostRequestId, '软删除 Host 失败。')
  } finally {
    hostLoading.value = false
  }
}

function openServiceDialog(mode: 'create', service?: undefined): void
function openServiceDialog(mode: 'edit', service: ApiRecord): void
function openServiceDialog(mode: 'create' | 'edit', service?: ApiRecord) {
  serviceDialogMode.value = mode
  serviceError.value = ''
  serviceRequestId.value = ''
  if (mode === 'edit' && service) {
    assignServiceDraft(serviceDraftFromRecord(service))
  } else {
    const next = emptyServiceDraft()
    next.hostId = selectedHostId.value
    assignServiceDraft(next)
  }
  serviceDialogOpen.value = true
}

function closeServiceDialog() {
  if (!serviceLoading.value) serviceDialogOpen.value = false
}

function serviceDraftFromRecord(record: ApiRecord): ServiceDraft {
  const rawFacts = isPlainRecord(record.rawFacts) ? record.rawFacts : {}
  const manualOverrides = rawFacts.manualOverrides
  const ports = Array.isArray(rawFacts.ports) ? rawFacts.ports : []
  return {
    ...emptyServiceDraft(),
    id: String(record.id ?? ''),
    hostId: String(record.hostId ?? selectedHostId.value),
    providerType: String(record.providerType ?? 'NGINX'),
    serviceName: String(record.serviceName ?? ''),
    displayName: String(record.displayName ?? ''),
    versionText: String(record.versionText ?? ''),
    installPath: String(record.installPath ?? ''),
    configPath: String(record.configPath ?? ''),
    runtimeUser: String(record.runtimeUser ?? ''),
    portsText: ports.map(String).join(', '),
    discoverySource: String(record.discoverySource ?? 'MANUAL'),
    status: String(record.status ?? 'ACTIVE'),
    manualOverridesText: manualOverrides === undefined ? '' : stringifyValue(manualOverrides)
  }
}

function buildServicePayload() {
  return stripEmpty({
    hostId: serviceDraft.hostId.trim(),
    providerType: serviceDraft.providerType,
    serviceName: serviceDraft.serviceName.trim(),
    displayName: serviceDraft.displayName.trim(),
    versionText: serviceDraft.versionText.trim(),
    installPath: serviceDraft.installPath.trim(),
    configPath: serviceDraft.configPath.trim(),
    runtimeUser: serviceDraft.runtimeUser.trim(),
    discoverySource: serviceDraft.discoverySource,
    status: serviceDraft.status,
    rawFacts: {
      ports: splitCsv(serviceDraft.portsText).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0),
      manualOverrides: parseJsonOrText(serviceDraft.manualOverridesText)
    }
  })
}

async function submitService() {
  if (!serviceDraft.hostId.trim() || !serviceDraft.displayName.trim()) {
    serviceError.value = 'Host ID 和展示名称不能为空。'
    return
  }
  serviceLoading.value = true
  serviceError.value = ''
  serviceRequestId.value = ''
  try {
    const result = serviceDialogMode.value === 'edit'
      ? await updateServiceInstance(serviceDraft.id, buildServicePayload())
      : await createServiceInstance(buildServicePayload())
    serviceRequestId.value = result.requestId
    serviceDialogOpen.value = false
    await refreshServiceInstances(selectedHostId.value)
  } catch (cause) {
    handleDialogError(cause, serviceError, serviceRequestId, '保存 ServiceInstance 失败，请检查输入。')
  } finally {
    serviceLoading.value = false
  }
}

async function refreshServiceInstances(hostId?: string) {
  if (!hostId) {
    serviceItems.value = []
    return
  }
  serviceListError.value = ''
  try {
    const result = await listServiceInstances({ page: 1, pageSize: 20, sort: 'updatedAt:desc', filters: { hostId } })
    serviceItems.value = [...(result.data?.items ?? [])]
    serviceListRequestId.value = result.requestId
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      serviceListError.value = `${cause.message}（requestId：${cause.requestId}）`
      return
    }
    serviceListError.value = cause instanceof Error ? cause.message : '加载 ServiceInstance 失败。'
  }
}

async function runDiscoveryConflictPreview() {
  discoveryLoading.value = true
  discoveryError.value = ''
  discoveryRequestId.value = ''
  discoveryActions.value = []
  discoveryConflicts.value = []
  try {
    const result = await previewDiscoveryMerge({
      normalizedHash: `ui-preview-${Date.now()}`,
      source: 'MANUAL',
      normalizedPayload: {
        hosts: [
          {
            hostname: selectedHostRaw.value?.hostname ?? 'preview.example.com',
            displayName: `${selectedHostRaw.value?.displayName ?? selectedHostRaw.value?.hostname ?? 'preview'}-发现值`
          }
        ]
      }
    })
    discoveryRequestId.value = result.requestId
    const data = result.data ?? {}
    discoveryActions.value = Array.isArray(data.actions) ? data.actions as ApiRecord[] : []
    discoveryConflicts.value = Array.isArray(data.conflicts) ? data.conflicts as ApiRecord[] : []
  } catch (cause) {
    handleDialogError(cause, discoveryError, discoveryRequestId, '生成发现冲突预览失败。')
  } finally {
    discoveryLoading.value = false
  }
}

async function refreshCapabilities(hostId?: string) {
  capabilityError.value = ''
  capabilityItems.value = []
  if (!hostId) return
  capabilityLoading.value = true
  try {
    const result = await listCapabilities({ page: 1, pageSize: 8 })
    capabilityRequestId.value = result.requestId
    const definitions = result.data?.items ?? []
    capabilityItems.value = definitions.map((item, index) => toCapabilityMatrixItem(item, index))
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      capabilityError.value = `${cause.message}（requestId：${cause.requestId}）`
      return
    }
    capabilityError.value = cause instanceof Error ? cause.message : '加载 Capability 失败。'
  } finally {
    capabilityLoading.value = false
  }
}

function toCapabilityMatrixItem(item: ApiRecord, index: number): CapabilityMatrixItem {
  const name = String(item.name ?? item.label ?? item.key ?? `capability-${index + 1}`)
  const key = String(item.key ?? item.id ?? name)
  const risk = String(item.riskLevel ?? item.risk ?? '').toLowerCase()
  return {
    key,
    label: name,
    state: 'unknown',
    level: risk === 'critical' ? 'L5' : risk === 'high' ? 'L4' : 'L2',
    source: String(item.source ?? item.provider ?? '后端定义'),
    detail: [
      `置信度：${String(item.confidence ?? item.confidenceScore ?? '后端未返回')}`,
      `最后检测：${String(item.lastDetectedAt ?? item.updatedAt ?? '后端未返回')}`,
      `缺失原因/降级建议：${String(item.missingReason ?? item.degradeAdvice ?? item.description ?? '等待后端匹配结果')}`
    ].join('；')
  }
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function stripEmpty<T extends Record<string, unknown>>(record: T): T {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value === '' || value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    next[key] = value
  }
  return next as T
}

function parseJsonOrText(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return trimmed
  }
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function handleDialogError(cause: unknown, messageRef: { value: string }, requestIdRef: { value: string }, fallback: string) {
  if (cause instanceof ApiClientError) {
    messageRef.value = `${cause.message}（${cause.errorCode}）`
    requestIdRef.value = cause.requestId
    return
  }
  messageRef.value = cause instanceof Error ? cause.message : fallback
}
</script>

<template>
  <BusinessResourcePage ref="pageRef" :config="config" />

  <section class="asset-ops" aria-label="资产补充操作链路">
    <article class="gc-card asset-ops__card">
      <header class="asset-ops__header">
        <div>
          <p>Host 操作</p>
          <h2>{{ selectedHost?.name ?? '未选择 Host' }}</h2>
          <span>编辑和软删除只操作当前选中的 Host，后端仍做最终鉴权。</span>
        </div>
        <div class="asset-ops__buttons">
          <GcPermissionButton permission="host.write" :disabled="!selectedHost" @click="openHostDialog('edit')">编辑 Host</GcPermissionButton>
          <GcPermissionButton permission="host.write" danger :disabled="!selectedHost || hostLoading" @click="softDeleteSelectedHost">软删除 Host</GcPermissionButton>
        </div>
      </header>
      <p v-if="hostRequestId" class="asset-ops__request">最近 Host 操作 requestId：{{ hostRequestId }}</p>
      <p v-if="hostError" class="asset-ops__error">{{ hostError }}</p>
    </article>

    <article class="gc-card asset-ops__card">
      <header class="asset-ops__header">
        <div>
          <p>ServiceInstance</p>
          <h2>服务实例最小链路</h2>
          <span>展示 service type/provider、version、configPath、runtimeUser、ports、discoverySource、status、manualOverrides。</span>
        </div>
        <GcPermissionButton permission="host.write" :disabled="!selectedHost" @click="openServiceDialog('create')">新增 ServiceInstance</GcPermissionButton>
      </header>
      <p v-if="serviceListError" class="asset-ops__error">{{ serviceListError }}</p>
      <p v-else class="asset-ops__request">ServiceInstance requestId：{{ serviceListRequestId || '等待选择 Host' }}</p>
      <ul v-if="serviceRowsForSelectedHost.length" class="asset-ops__list">
        <li v-for="service in serviceRowsForSelectedHost" :key="String(service.id)" class="asset-ops__item">
          <div>
            <strong>{{ service.displayName ?? service.serviceName ?? service.id }}</strong>
            <span>{{ service.providerType }} / {{ service.serviceName ?? '未命名服务' }} · {{ service.versionText ?? '未知版本' }}</span>
            <small>configPath={{ service.configPath ?? '—' }} · runtimeUser={{ service.runtimeUser ?? '—' }} · discoverySource={{ service.discoverySource ?? '—' }} · status={{ service.status ?? '—' }}</small>
            <small>ports={{ stringifyValue((service.rawFacts as Record<string, unknown> | undefined)?.ports) }} · manualOverrides={{ stringifyValue((service.rawFacts as Record<string, unknown> | undefined)?.manualOverrides) }}</small>
          </div>
          <GcPermissionButton permission="host.write" @click="openServiceDialog('edit', service)">编辑服务实例</GcPermissionButton>
        </li>
      </ul>
      <p v-else class="asset-ops__empty">当前 Host 暂无 ServiceInstance；这不是错误，但部署链路没有服务上下文就很脆。</p>
    </article>

    <article class="gc-card asset-ops__card">
      <header class="asset-ops__header">
        <div>
          <p>发现快照/冲突</p>
          <h2>冲突处理最小入口</h2>
          <span>前端只列出冲突并记录 keep/use/custom 选择，不私自合并资产表。</span>
        </div>
        <GcPermissionButton permission="host.write" :disabled="discoveryLoading" @click="runDiscoveryConflictPreview">
          {{ discoveryLoading ? '预览中…' : '预览发现冲突' }}
        </GcPermissionButton>
      </header>
      <p v-if="discoveryRequestId" class="asset-ops__request">发现预览 requestId：{{ discoveryRequestId }}</p>
      <p v-if="discoveryError" class="asset-ops__error">{{ discoveryError }}</p>
      <p v-if="!conflictRows.length" class="asset-ops__empty">暂无冲突预览；点击按钮会用当前 Host 生成一次 dry-run merge-preview。</p>
      <ul v-else class="asset-ops__list">
        <li v-for="row in conflictRows" :key="row.key" class="asset-ops__item asset-ops__item--conflict">
          <div>
            <strong>{{ row.conflict.kind }} · {{ row.conflict.field }}</strong>
            <span>当前值：{{ stringifyValue(row.conflict.currentValue) }}</span>
            <span>发现值：{{ stringifyValue(row.conflict.discoveredValue) }}</span>
            <small>{{ row.conflict.reason }}</small>
          </div>
          <label>
            <span>处理方式</span>
            <select v-model="row.resolution.action">
              <option value="keep">keep 当前值</option>
              <option value="use">use 发现值</option>
              <option value="custom">custom 自定义</option>
            </select>
          </label>
          <input v-if="row.resolution.action === 'custom'" v-model="row.resolution.customValue" placeholder="自定义解决值" />
        </li>
      </ul>
      <p v-if="discoveryActions.length" class="asset-ops__request">预览动作数：{{ discoveryActions.length }}，这里只展示不落库。</p>
    </article>

    <GcCapabilityMatrix
      :items="capabilityItems"
      title="Capability 最小矩阵"
      description="展示能力名称、来源、置信度、最后检测时间、等级、缺失原因/降级建议；不在前端重算后端算法。"
    />
    <p v-if="capabilityLoading" class="asset-ops__request">Capability 加载中…</p>
    <p v-if="capabilityRequestId" class="asset-ops__request">Capability requestId：{{ capabilityRequestId }}</p>
    <p v-if="capabilityError" class="asset-ops__error">{{ capabilityError }}</p>
  </section>

  <GcModal
    v-model:open="hostDialogOpen"
    :title="hostDialogMode === 'edit' ? '编辑 Host 资产' : '登记主机资产'"
    description="登记表单补齐 zoneId、ownerId、arch、osVersion、managementChannels、tags；保留 Host 创建链路。"
    size="xl"
  >
    <section class="asset-form">
      <div class="asset-form__grid">
        <label class="asset-form__field"><span>主机名/IP <strong>*</strong></span><input v-model="hostDraft.hostname" placeholder="web-01.example.com" autocomplete="off" /></label>
        <label class="asset-form__field"><span>展示名称</span><input v-model="hostDraft.displayName" placeholder="生产 Nginx 节点 01" autocomplete="off" /></label>
        <label class="asset-form__field"><span>主 IP</span><input v-model="hostDraft.primaryIp" placeholder="10.0.0.10" autocomplete="off" /></label>
        <label class="asset-form__field"><span>IP 列表（逗号分隔）</span><input v-model="hostDraft.ipAddressesText" placeholder="10.0.0.10, 172.16.0.10" autocomplete="off" /></label>
        <label class="asset-form__field"><span>Zone ID</span><input v-model="hostDraft.zoneId" placeholder="zone-prod-a" autocomplete="off" /></label>
        <label class="asset-form__field"><span>Owner ID</span><input v-model="hostDraft.ownerId" placeholder="ops-team-a" autocomplete="off" /></label>
        <label class="asset-form__field"><span>操作系统类型</span><select v-model="hostDraft.osType"><option value="UNKNOWN">UNKNOWN</option><option value="LINUX">LINUX</option><option value="WINDOWS">WINDOWS</option><option value="UNIX">UNIX</option><option value="NETWORK_DEVICE">NETWORK_DEVICE</option></select></label>
        <label class="asset-form__field"><span>操作系统名称</span><input v-model="hostDraft.osName" placeholder="Ubuntu" autocomplete="off" /></label>
        <label class="asset-form__field"><span>OS 版本</span><input v-model="hostDraft.osVersion" placeholder="22.04" autocomplete="off" /></label>
        <label class="asset-form__field"><span>架构</span><input v-model="hostDraft.arch" placeholder="x86_64 / arm64" autocomplete="off" /></label>
        <label class="asset-form__field"><span>环境</span><input v-model="hostDraft.environment" placeholder="prod / staging" autocomplete="off" /></label>
        <label class="asset-form__field"><span>兼容等级</span><select v-model="hostDraft.compatibilityLevel"><option value="L1">L1</option><option value="L2">L2</option><option value="L3">L3</option><option value="L4">L4</option><option value="L5">L5</option></select></label>
        <label class="asset-form__field"><span>管理模式</span><select v-model="hostDraft.managementMode"><option value="MONITOR_ONLY">MONITOR_ONLY</option><option value="AGENT">AGENT</option><option value="LEGACY_AGENT">LEGACY_AGENT</option><option value="GATEWAY">GATEWAY</option><option value="AGENTLESS">AGENTLESS</option><option value="SCRIPT_PACKAGE">SCRIPT_PACKAGE</option></select></label>
        <label class="asset-form__field"><span>管理通道（逗号分隔）</span><input v-model="hostDraft.managementChannelsText" placeholder="ssh, agent, gateway" autocomplete="off" /></label>
        <label class="asset-form__field asset-form__field--wide"><span>标签（逗号分隔）</span><input v-model="hostDraft.tagsText" placeholder="prod, nginx, dmz" autocomplete="off" /></label>
      </div>
      <p v-if="hostError" class="asset-form__error">{{ hostError }}</p>
      <p v-if="hostRequestId" class="asset-form__request">requestId：{{ hostRequestId }}</p>
    </section>
    <template #actions>
      <button class="gc-button" type="button" :disabled="hostLoading" @click="closeHostDialog">取消</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="hostSubmitDisabled" @click="submitHost">{{ hostLoading ? '保存中…' : '确认保存' }}</button>
    </template>
  </GcModal>

  <GcModal
    v-model:open="serviceDialogOpen"
    :title="serviceDialogMode === 'edit' ? '编辑 ServiceInstance' : '新增 ServiceInstance'"
    description="最小维护服务类型、provider、版本、配置路径、运行用户、端口和人工覆盖信息。"
    size="xl"
  >
    <section class="asset-form">
      <div class="asset-form__grid">
        <label class="asset-form__field"><span>Host ID <strong>*</strong></span><input v-model="serviceDraft.hostId" autocomplete="off" /></label>
        <label class="asset-form__field"><span>展示名称 <strong>*</strong></span><input v-model="serviceDraft.displayName" placeholder="nginx-main" autocomplete="off" /></label>
        <label class="asset-form__field"><span>Service Type/Provider</span><select v-model="serviceDraft.providerType"><option value="NGINX">NGINX</option><option value="APACHE">APACHE</option><option value="TOMCAT">TOMCAT</option><option value="IIS">IIS</option><option value="CUSTOM">CUSTOM</option></select></label>
        <label class="asset-form__field"><span>服务名</span><input v-model="serviceDraft.serviceName" placeholder="nginx" autocomplete="off" /></label>
        <label class="asset-form__field"><span>版本</span><input v-model="serviceDraft.versionText" placeholder="1.24.0" autocomplete="off" /></label>
        <label class="asset-form__field"><span>安装路径</span><input v-model="serviceDraft.installPath" placeholder="/usr/sbin/nginx" autocomplete="off" /></label>
        <label class="asset-form__field"><span>配置路径</span><input v-model="serviceDraft.configPath" placeholder="/etc/nginx/nginx.conf" autocomplete="off" /></label>
        <label class="asset-form__field"><span>运行用户</span><input v-model="serviceDraft.runtimeUser" placeholder="nginx" autocomplete="off" /></label>
        <label class="asset-form__field"><span>Ports（逗号分隔）</span><input v-model="serviceDraft.portsText" placeholder="443, 8443" autocomplete="off" /></label>
        <label class="asset-form__field"><span>发现来源</span><select v-model="serviceDraft.discoverySource"><option value="MANUAL">MANUAL</option><option value="AGENT">AGENT</option><option value="SSH">SSH</option><option value="GATEWAY">GATEWAY</option></select></label>
        <label class="asset-form__field"><span>状态</span><select v-model="serviceDraft.status"><option value="ACTIVE">ACTIVE</option><option value="STALE">STALE</option><option value="UNREACHABLE">UNREACHABLE</option><option value="RETIRED">RETIRED</option></select></label>
        <label class="asset-form__field asset-form__field--wide"><span>manualOverrides（JSON 或文本）</span><textarea v-model="serviceDraft.manualOverridesText" rows="4" placeholder='{"reload":"systemctl reload nginx"}' /></label>
      </div>
      <p v-if="serviceError" class="asset-form__error">{{ serviceError }}</p>
      <p v-if="serviceRequestId" class="asset-form__request">requestId：{{ serviceRequestId }}</p>
    </section>
    <template #actions>
      <button class="gc-button" type="button" :disabled="serviceLoading" @click="closeServiceDialog">取消</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="serviceSubmitDisabled" @click="submitService">{{ serviceLoading ? '保存中…' : '确认保存' }}</button>
    </template>
  </GcModal>
</template>

<style scoped>
.asset-ops,
.asset-form { display: grid; gap: var(--gc-space-4); }
.asset-ops { margin-top: var(--gc-space-5); }
.asset-ops__card { display: grid; gap: var(--gc-space-3); }
.asset-ops__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.asset-ops__header p,
.asset-ops__header h2,
.asset-ops__header span,
.asset-ops__request,
.asset-ops__error,
.asset-ops__empty { margin: 0; }
.asset-ops__header p,
.asset-ops__header span,
.asset-ops__request,
.asset-ops__empty { color: var(--gc-color-text-muted); font-weight: 750; }
.asset-ops__header h2 { margin-top: var(--gc-space-1); letter-spacing: -0.03em; }
.asset-ops__buttons { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); justify-content: flex-end; }
.asset-ops__list { display: grid; gap: var(--gc-space-3); padding: 0; margin: 0; list-style: none; }
.asset-ops__item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--gc-space-3); align-items: center; border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3); }
.asset-ops__item--conflict { grid-template-columns: minmax(0, 1fr) 180px minmax(180px, 240px); }
.asset-ops__item div { display: grid; gap: var(--gc-space-1); }
.asset-ops__item span,
.asset-ops__item small { color: var(--gc-color-text-muted); }
.asset-ops__item label { display: grid; gap: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.asset-ops__item input,
.asset-ops__item select,
.asset-form__field input,
.asset-form__field select,
.asset-form__field textarea { width: 100%; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 10px 12px; color: var(--gc-color-text); background: var(--gc-color-surface-muted); outline: none; }
.asset-ops__error,
.asset-form__field strong,
.asset-form__error { color: var(--gc-color-danger); }
.asset-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.asset-form__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.asset-form__field--wide { grid-column: 1 / -1; }
.asset-form__field input:focus,
.asset-form__field select:focus,
.asset-form__field textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 4px rgb(96 165 250 / 14%); background: #fff; }
.asset-form__error { margin: 0; font-weight: 850; }
.asset-form__request { margin: 0; color: var(--gc-color-text-muted); font-weight: 750; }
@media (max-width: 860px) {
  .asset-ops__header,
  .asset-ops__item,
  .asset-ops__item--conflict { grid-template-columns: 1fr; display: grid; }
  .asset-form__grid { grid-template-columns: 1fr; }
}
</style>
