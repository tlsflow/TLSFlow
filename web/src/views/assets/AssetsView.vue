<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import { createServiceAsset, listAgents, listAssets, listServiceInstances } from '@/api/modules/assets.api'
import type { ApiRecord } from '@/api/modules/common'
import type { ViewRow } from '@/composables/useBusinessPage'
import { GcModal } from '@/design-system/components'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'

type AssetPlatform = 'WINDOWS' | 'LINUX' | 'APPLIANCE'
type AssetProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP'

interface AssetDraft {
  address: string
  port: string
  protocol: AssetProtocol
  platform: AssetPlatform
  agentId: string
  displayName: string
  environment: string
  tagsText: string
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const selectedServiceAsset = ref<ViewRow | null>(null)
const serviceItems = ref<ApiRecord[]>([])
const serviceListError = ref('')
const createDialogOpen = ref(false)
const createLoading = ref(false)
const createError = ref('')
const createRequestId = ref('')
const agentListLoading = ref(false)
const agentItems = ref<ApiRecord[]>([])

const assetDraft = reactive<AssetDraft>({
  address: '',
  port: '443',
  protocol: 'HTTPS',
  platform: 'LINUX',
  agentId: '',
  displayName: '',
  environment: '',
  tagsText: '',
})

const config: BusinessPageConfig = {
  title: '应用资产',
  description: '以域名或 IP 为主对象管理应用入口，聚焦地址、端口、协议、关联服务实例以及证书部署定位信息。',
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
  columns: [
    { key: 'name', title: '访问域名', candidates: ['address', 'displayName', 'domainName'] },
    { key: 'port', title: '端口', candidates: ['port'] },
    { key: 'protocol', title: '协议', candidates: ['protocol'] },
    { key: 'platform', title: '平台', candidates: ['platform'] },
    { key: 'agentId', title: 'Agent', candidates: ['agentId'] },
    { key: 'status', title: '状态', candidates: ['status'] },
  ],
  metrics: [
    { title: '应用资产总数', description: '当前租户下可见的域名或 IP 入口数量。', status: 'ACTIVE', risk: 'LOW' },
    { title: '待关注资产', description: '状态异常、发现陈旧或需要补齐执行信息的应用资产。', status: 'STALE', risk: 'MEDIUM' },
  ],
  detailFields: [
    { label: '应用资产 ID', candidates: ['id'] },
    { label: '访问域名', candidates: ['address', 'displayName'] },
    { label: '地址类型', candidates: ['addressType'] },
    { label: '端口', candidates: ['port'] },
    { label: '协议', candidates: ['protocol'] },
    { label: '平台', candidates: ['platform'] },
    { label: 'Agent ID', candidates: ['agentId'] },
    { label: 'SNI', candidates: ['sniName'] },
    { label: '服务实例 ID', candidates: ['serviceInstanceId'] },
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
  load: () => listAssets({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [],
  onSelectionChange: handleServiceAssetSelection,
}

const relatedServices = computed(() => {
  const serviceInstanceId = String(selectedServiceAsset.value?.raw?.serviceInstanceId ?? '')
  if (!serviceInstanceId) return []
  return serviceItems.value.filter((item) => String(item.id ?? '') === serviceInstanceId)
})

const showServiceSummary = computed(() =>
  Boolean(selectedServiceAsset.value) && (Boolean(serviceListError.value) || relatedServices.value.length > 0),
)

const filteredAgentItems = computed(() => {
  const expectedOsType = assetDraft.platform === 'APPLIANCE' ? 'NETWORK_DEVICE' : assetDraft.platform
  return agentItems.value.filter((item) => {
    const agentOsType = String(readNested(item, ['descriptor', 'osType']) ?? item.osType ?? '').toUpperCase()
    return agentOsType === expectedOsType
  })
})

const createDisabled = computed(() => {
  const port = Number(assetDraft.port)
  return createLoading.value
    || !assetDraft.address.trim()
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
    || !assetDraft.agentId.trim()
})

function handleServiceAssetSelection(row: ViewRow | null) {
  selectedServiceAsset.value = row
  void refreshServiceInstances(String(row?.raw?.hostId ?? ''))
}

async function refreshServiceInstances(hostId: string) {
  if (!hostId) {
    serviceItems.value = []
    serviceListError.value = ''
    return
  }
  serviceListError.value = ''
  try {
    const result = await listServiceInstances({ page: 1, pageSize: 20, sort: 'updatedAt:desc', filters: { hostId } })
    serviceItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    serviceItems.value = []
    if (cause instanceof ApiClientError) {
      serviceListError.value = cause.message
      return
    }
    serviceListError.value = cause instanceof Error ? cause.message : '加载关联服务实例失败'
  }
}

async function openCreateDialog() {
  resetDraft()
  createDialogOpen.value = true
  createError.value = ''
  createRequestId.value = ''
  await loadAgents()
}

function closeCreateDialog() {
  if (!createLoading.value) createDialogOpen.value = false
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

async function submitCreate() {
  createLoading.value = true
  createError.value = ''
  createRequestId.value = ''
  try {
    const result = await createServiceAsset({
      address: assetDraft.address.trim(),
      displayName: assetDraft.displayName.trim() || assetDraft.address.trim(),
      port: Number(assetDraft.port),
      protocol: assetDraft.protocol,
      platform: assetDraft.platform,
      agentId: assetDraft.agentId.trim(),
      environment: assetDraft.environment.trim() || undefined,
      discoverySource: 'MANUAL',
      status: 'ACTIVE',
      tags: splitCsv(assetDraft.tagsText),
      metadata: {},
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
  assetDraft.address = ''
  assetDraft.port = '443'
  assetDraft.protocol = 'HTTPS'
  assetDraft.platform = 'LINUX'
  assetDraft.agentId = ''
  assetDraft.displayName = ''
  assetDraft.environment = ''
  assetDraft.tagsText = ''
}

function splitCsv(value: string): string[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)))
}

function renderValue(value: unknown, fallback = '—'): string {
  if (value === undefined || value === null || value === '') return fallback
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function readNested(value: unknown, path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function agentLabel(agent: ApiRecord): string {
  const hostname = String(readNested(agent, ['descriptor', 'hostname']) ?? agent.hostname ?? agent.id ?? '')
  const osType = String(readNested(agent, ['descriptor', 'osType']) ?? agent.osType ?? '')
  return `${hostname} (${osType})`
}
</script>

<template>
  <BusinessResourcePage ref="pageRef" :config="config" />

  <section v-if="showServiceSummary" class="asset-summary" aria-label="应用资产关联信息">
    <article class="gc-card asset-summary__card">
      <header class="asset-summary__header">
        <div>
          <p>关联服务实例</p>
          <h2>{{ selectedServiceAsset?.name }}</h2>
          <span>应用资产是主对象，Host 只作为执行定位辅助字段保留在详情里。</span>
        </div>
      </header>

      <p v-if="serviceListError" class="asset-summary__error">{{ serviceListError }}</p>

      <ul v-if="relatedServices.length" class="asset-summary__list">
        <li v-for="service in relatedServices" :key="String(service.id)" class="asset-summary__item">
          <strong>{{ renderValue(service.displayName ?? service.serviceName ?? service.id) }}</strong>
          <span>Provider={{ renderValue(service.providerType) }} / 服务名={{ renderValue(service.serviceName) }}</span>
          <small>版本={{ renderValue(service.versionText) }} / 配置路径={{ renderValue(service.configPath) }} / 运行用户={{ renderValue(service.runtimeUser) }}</small>
          <small>发现来源={{ renderValue(service.discoverySource) }} / 状态={{ renderValue(service.status) }}</small>
        </li>
      </ul>
    </article>
  </section>

  <GcModal v-model:open="createDialogOpen" title="手动添加应用资产" description="名称使用应用访问域名；平台决定允许绑定的 Agent。">
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
          <span>平台 <strong>*</strong></span>
          <select v-model="assetDraft.platform">
            <option value="LINUX">Linux</option>
            <option value="WINDOWS">Windows</option>
            <option value="APPLIANCE">专用设备</option>
          </select>
        </label>
        <label class="asset-form__field">
          <span>Agent <strong>*</strong></span>
          <select v-model="assetDraft.agentId" :disabled="agentListLoading">
            <option value="">{{ agentListLoading ? '加载 Agent 中…' : '请选择 Agent' }}</option>
            <option v-for="agent in filteredAgentItems" :key="String(agent.id)" :value="String(agent.id)">
              {{ agentLabel(agent) }}
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
      <p v-if="createError" class="asset-form__error">{{ createError }}</p>
      <p v-else-if="createRequestId" class="asset-form__request">最近创建请求已完成。</p>
    </section>
    <template #actions>
      <button class="gc-button" type="button" :disabled="createLoading" @click="closeCreateDialog">取消</button>
      <button class="gc-button gc-button--danger" type="button" :disabled="createDisabled" @click="submitCreate">
        {{ createLoading ? '创建中…' : '确认创建' }}
      </button>
    </template>
  </GcModal>
</template>

<style scoped>
.asset-summary { display: grid; gap: var(--gc-space-4); }
.asset-summary__card { display: grid; gap: var(--gc-space-3); }
.asset-summary__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.asset-summary__header p,
.asset-summary__header h2,
.asset-summary__header span,
.asset-summary__error { margin: 0; }
.asset-summary__header p,
.asset-summary__header span { color: var(--gc-color-text-muted); font-weight: 750; }
.asset-summary__header h2 { margin-top: var(--gc-space-1); letter-spacing: -0.03em; }
.asset-summary__list { display: grid; gap: var(--gc-space-3); padding: 0; margin: 0; list-style: none; }
.asset-summary__item {
  display: grid;
  gap: var(--gc-space-1);
  border: 1px solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3);
}
.asset-summary__item span,
.asset-summary__item small { color: var(--gc-color-text-muted); }
.asset-summary__error { color: var(--gc-color-danger); }

.asset-form { display: grid; gap: var(--gc-space-4); }
.asset-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.asset-form__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.asset-form__field strong,
.asset-form__error { color: var(--gc-color-danger); }
.asset-form__field input,
.asset-form__field select {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
  outline: none;
}
.asset-form__field input:focus,
.asset-form__field select:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgb(96 165 250 / 14%);
  background: #fff;
}
.asset-form__error,
.asset-form__request { margin: 0; font-weight: 750; }
.asset-form__request { color: var(--gc-color-text-muted); }

@media (max-width: 860px) {
  .asset-form__grid { grid-template-columns: 1fr; }
}
</style>
