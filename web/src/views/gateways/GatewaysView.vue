<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import {
  createGatewayEnableSession,
  createLinuxGoInstallSession,
  createWindowsPowerShellInstallSession,
  listAgents,
} from '@/api/modules/assets.api'
import { listGateways, probeGateway } from '@/api/modules/gateways.api'
import { readNumber, readPath, readString, type ViewRow } from '@/composables/useBusinessPage'
import type { ApiRecord } from '@/api/modules/common'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { formatBrowserLocalTime, formatMaybeLocalTimeByCandidates } from '@/utils/browser-local-time'

type GatewayPlatform = 'linux_go_systemd' | 'windows_powershell_service'
type CopiedKind = 'install' | 'enable' | null

interface CommandSession {
  platform: GatewayPlatform
  zone: string
  command: string
  code?: string
  expiresAt?: string
  serviceName?: string
  configPath?: string
}

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const selectedGateway = ref<ViewRow | null>(null)
const detailModalOpen = ref(false)
const installModalOpen = ref(false)
const enableModalOpen = ref(false)
const installPending = ref(false)
const enablePending = ref(false)
const installError = ref('')
const enableError = ref('')
const selectedInstallPlatform = ref<GatewayPlatform>('linux_go_systemd')
const selectedEnablePlatform = ref<GatewayPlatform>('linux_go_systemd')
const installZone = ref('default')
const enableZone = ref('default')
const enableAgentId = ref('')
const enableAgents = ref<ApiRecord[]>([])
const installSession = ref<CommandSession | null>(null)
const enableSession = ref<CommandSession | null>(null)
const copiedKind = ref<CopiedKind>(null)

const platformOptions: Array<{ value: GatewayPlatform; label: string; description: string }> = [
  { value: 'linux_go_systemd', label: 'Linux systemd', description: '在 Linux 主机安装 Gateway Agent 服务' },
  { value: 'windows_powershell_service', label: 'Windows Service', description: '在 Windows 主机安装 Gateway Agent 服务' },
]

const gatewayRaw = computed<ApiRecord | null>(() => selectedGateway.value?.raw ?? null)
const routeChannels = computed(() => normalizeList(gatewayRaw.value, ['routeChannels', 'channels', 'adapters', 'protocols', 'supportedProtocols']))
const capabilities = computed(() => normalizeList(gatewayRaw.value, ['capabilities', 'capabilityKeys']))
const gatewayStats = computed(() => ({
  currentLoad: readNumber(gatewayRaw.value ?? {}, ['currentLoad', 'load', 'activeTasks']) ?? 0,
  maxConcurrentTasks: readNumber(gatewayRaw.value ?? {}, ['maxConcurrentTasks']) ?? 0,
  successRate: formatSuccessRate(readPath(gatewayRaw.value ?? {}, 'successRate') ?? readPath(gatewayRaw.value ?? {}, 'statistics.successRate')),
  lastHeartbeatAt: formatMaybeLocalTimeByCandidates(readString(gatewayRaw.value ?? {}, ['lastHeartbeatAt', 'lastSeenAt', 'heartbeatAt', 'updatedAt']), ['lastHeartbeatAt'])
}))
const gatewayRegion = computed(() => firstDisplayValue(gatewayRaw.value, ['zoneName', 'zoneId', 'zoneIds', 'networkZone']) || '默认区域')
const gatewayStatus = computed(() => readString(gatewayRaw.value ?? {}, ['status', 'state', 'onlineStatus']) || String(selectedGateway.value?.status ?? ''))
const gatewayDisplayName = computed(() => {
  const name = String(selectedGateway.value?.name ?? '').trim()
  if (name && !isTechnicalId(name)) return name
  return `${gatewayRegion.value}网关`
})
const gatewayOverview = computed(() => {
  const currentLoad = gatewayStats.value.currentLoad
  const maxConcurrentTasks = gatewayStats.value.maxConcurrentTasks
  return [
    { label: '连接状态', value: formatGatewayStatus(gatewayStatus.value), tone: statusTone(gatewayStatus.value) },
    { label: '服务区域', value: gatewayRegion.value },
    { label: '正在处理', value: `${currentLoad} 个任务` },
    { label: '可用容量', value: formatCapacity(currentLoad, maxConcurrentTasks) },
    { label: '成功率', value: gatewayStats.value.successRate },
    { label: '最近联络', value: gatewayStats.value.lastHeartbeatAt || '-' },
  ]
})
const gatewayAbilities = computed(() => {
  const values = new Set([...routeChannels.value, ...capabilities.value].map((item) => item.trim().toLowerCase()))
  const abilities: Array<{ key: string; title: string; description: string }> = []
  if (hasAny(values, ['probe.tcp', 'probe.http', 'probe.agent', 'gateway.probe.tcp', 'gateway.probe.http', 'gateway.probe.agent'])) {
    abilities.push({ key: 'probe', title: '连通性检查', description: '从该区域检查主机、网站或 Agent 是否可访问。' })
  }
  if (hasAny(values, ['forward.agent_task', 'gateway.forward.agent_task'])) {
    abilities.push({ key: 'agent-task', title: '任务转发', description: '把部署、检查等任务转给区域内的 Agent 执行。' })
  }
  if (hasAny(values, ['forward.direct_control', 'gateway.forward.direct_control'])) {
    abilities.push({ key: 'direct-control', title: '远程控制转发', description: '把受控操作转发到区域内 Agent，控制面无需直连内网端口。' })
  }
  return abilities
})

function openGatewayInstallModal() {
  installModalOpen.value = true
  installError.value = ''
  installSession.value = null
  copiedKind.value = null
}

async function openGatewayEnableModal() {
  enableModalOpen.value = true
  enableError.value = ''
  enableSession.value = null
  copiedKind.value = null
  await loadEnableAgents()
}

async function loadEnableAgents() {
  const result = await listAgents({ page: 1, pageSize: 100, sort: 'updatedAt:desc' })
  enableAgents.value = extractItems(result.data)
  if (!enableAgentId.value && enableAgents.value[0]) {
    enableAgentId.value = String(readPath(enableAgents.value[0], 'id') ?? '')
  }
}

async function generateGatewayInstallCommand() {
  installPending.value = true
  installError.value = ''
  copiedKind.value = null
  try {
    const payload = { zone: installZone.value || 'default', role: 'gateway', startAfterInstall: true }
    const result = selectedInstallPlatform.value === 'linux_go_systemd'
      ? await createLinuxGoInstallSession(payload)
      : await createWindowsPowerShellInstallSession(payload)
    const data = result.data ?? {}
    const rawBootstrapUrl = typeof data.bootstrapUrl === 'string' ? data.bootstrapUrl : ''
    const bootstrapUrl = rewriteUrlWithBrowserOrigin(rawBootstrapUrl)
    const fallback = typeof data.installCommand === 'string' ? data.installCommand : ''
    const command = buildInstallCommand(selectedInstallPlatform.value, bootstrapUrl, fallback)
    if (!command) throw new Error('后端没有返回 Gateway Agent 安装命令。')
    installSession.value = {
      platform: selectedInstallPlatform.value,
      zone: readString(data, ['zone']) || installZone.value || 'default',
      command,
      code: readString(data, ['bootstrapTokenPreview']),
      expiresAt: readString(data, ['expiresAt']),
      serviceName: readString(data, ['serviceName']),
      configPath: readString(data, ['configDir']),
    }
  } catch (cause) {
    installError.value = cause instanceof Error ? cause.message : '生成 Gateway Agent 安装命令失败。'
  } finally {
    installPending.value = false
  }
}

async function generateGatewayEnableCommand() {
  enablePending.value = true
  enableError.value = ''
  copiedKind.value = null
  try {
    const result = await createGatewayEnableSession({
      platform: selectedEnablePlatform.value,
      agentId: enableAgentId.value || undefined,
      zone: enableZone.value || 'default',
    })
    const data = result.data ?? {}
    const rawEnableUrl = typeof data.enableUrl === 'string' ? data.enableUrl : ''
    const enableUrl = rewriteUrlWithBrowserOrigin(rawEnableUrl)
    const fallback = typeof data.enableCommand === 'string' ? data.enableCommand : ''
    const command = buildEnableCommand(selectedEnablePlatform.value, enableUrl, fallback)
    if (!command) throw new Error('后端没有返回 Gateway 启用命令。')
    enableSession.value = {
      platform: selectedEnablePlatform.value,
      zone: readString(data, ['zone']) || enableZone.value || 'default',
      command,
      serviceName: readString(data, ['serviceName']),
      configPath: readString(data, ['configPath']),
    }
  } catch (cause) {
    enableError.value = cause instanceof Error ? cause.message : '生成 Gateway 启用命令失败。'
  } finally {
    enablePending.value = false
  }
}

function handleGatewaySelection(row: ViewRow | null) {
  selectedGateway.value = row
}

async function openDetailModal(row: ViewRow) {
  selectedGateway.value = row
  detailModalOpen.value = true
}

async function runProbe(row: ViewRow) {
  await probeGateway(buildGatewayProbePayload(row))
}

function buildGatewayProbePayload(row: ViewRow | undefined) {
  const raw = row?.raw ?? {}
  const targets = normalizeList(raw, ['reachableTargets', 'targets', 'targetCidrs', 'targetZones'])
  const channels = normalizeList(raw, ['routeChannels', 'channels', 'adapters', 'protocols', 'supportedProtocols'])
  const protocol = channels.find((item) => item.startsWith('probe.')) ?? 'probe.tcp'
  return {
    gatewayId: row?.id ?? '',
    targetId: targets[0] ?? row?.id ?? '',
    protocol,
    port: defaultPort(protocol)
  }
}

function defaultPort(protocol: string): number {
  const normalized = protocol.toLowerCase()
  if (normalized.includes('http') || normalized.includes('curl') || normalized.includes('agent')) return 443
  return 22
}

function firstDisplayValue(record: ApiRecord | null, paths: readonly string[]): string {
  if (!record) return ''
  for (const path of paths) {
    const value = readPath(record, path)
    if (value !== undefined && value !== null && value !== '') return renderValue(value)
  }
  return ''
}

function normalizeList(record: ApiRecord | null, paths: readonly string[]): string[] {
  if (!record) return []
  for (const path of paths) {
    const value = readPath(record, path)
    if (Array.isArray(value)) return value.map(renderValue).filter((item) => item && item !== '-')
    if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function formatSuccessRate(value: unknown): string {
  if (typeof value === 'number') return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`
  if (typeof value === 'string' && value.trim()) return value
  return '-'
}

function formatCapacity(currentLoad: number, maxConcurrentTasks: number): string {
  if (!maxConcurrentTasks) return '-'
  const available = Math.max(0, maxConcurrentTasks - currentLoad)
  return `可接收 ${available} 个任务`
}

function formatGatewayStatus(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'online') return '正常在线'
  if (normalized === 'offline') return '离线'
  if (normalized === 'disabled') return '已停用'
  if (normalized === 'revoked') return '已撤销'
  if (normalized === 'upgrading') return '升级中'
  return value || '-'
}

function statusTone(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'online') return 'good'
  if (normalized === 'offline' || normalized === 'disabled' || normalized === 'revoked') return 'bad'
  return 'warn'
}

function hasAny(values: Set<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => values.has(candidate))
}

function isTechnicalId(value: string): boolean {
  return /^(agt|gw|gateway|agent)_[a-z0-9_:-]+$/iu.test(value.trim())
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (Array.isArray(value)) return value.map(renderValue).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function extractItems(value: unknown): ApiRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value) && Array.isArray(value.items)) return value.items.filter(isRecord)
  return []
}

function isRecord(value: unknown): value is ApiRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rewriteUrlWithBrowserOrigin(rawUrl: string): string {
  if (!rawUrl || typeof window === 'undefined' || !window.location?.origin) return rawUrl
  try {
    const parsed = new URL(rawUrl, window.location.origin)
    return `${window.location.origin}${parsed.pathname}${parsed.search}`
  } catch {
    return rawUrl
  }
}

function buildInstallCommand(platform: GatewayPlatform, bootstrapUrl: string, fallbackCommand: string): string {
  if (!bootstrapUrl) return fallbackCommand
  return platform === 'linux_go_systemd'
    ? `curl -fsSL '${bootstrapUrl}' | sudo bash`
    : `irm '${bootstrapUrl}' | iex`
}

function buildEnableCommand(platform: GatewayPlatform, enableUrl: string, fallbackCommand: string): string {
  if (!enableUrl) return fallbackCommand
  return platform === 'linux_go_systemd'
    ? `curl -fsSL '${enableUrl}' | sudo bash`
    : `irm '${enableUrl}' | iex`
}

async function copyCommand(kind: Exclude<CopiedKind, null>, command: string | undefined) {
  if (!command) return
  if (await copyToClipboard(command)) copiedKind.value = kind
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 中文说明：浏览器权限拒绝时回退到旧复制路径。
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  return ok
}

function linkTarget(link: NonNullable<BusinessPageConfig['contextLinks']>[number]) {
  const row = selectedGateway.value
  if (!row) return null
  const value = link.candidates
    .map((candidate) => readPath(row.raw, candidate))
    .find((item) => item !== undefined && item !== null && item !== '')
  if (value === undefined || value === null || value === '') return null
  return { path: link.to, query: { [link.queryKey]: String(value) } }
}

function platformLabel(platform: GatewayPlatform): string {
  return platform === 'linux_go_systemd' ? 'Linux systemd' : 'Windows Service'
}

const config: BusinessPageConfig = {
  title: '网关',
  description: '管理区域路由 Gateway Agent。',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  showToolbarDangerHint: false,
  readPermission: 'gateway.read',
  primaryPermission: 'gateway.write',
  primaryActionLabel: '新增 Gateway Agent',
  primaryAction: openGatewayInstallModal,
  moduleName: 'gateways',
  resourceName: '网关',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '网关', candidates: ['name', 'gatewayName', 'id'] },
    { key: 'agentId', title: 'Agent', candidates: ['agentId'] },
    { key: 'zone', title: '区域', candidates: ['zoneName', 'zoneId', 'zoneIds', 'networkZone'] },
    { key: 'status', title: '状态', candidates: ['status', 'state', 'onlineStatus'] },
    { key: 'load', title: '负载', candidates: ['currentLoad', 'load', 'activeTasks'] },
    { key: 'updatedAt', title: '最近心跳', candidates: ['lastHeartbeatAt', 'lastSeenAt', 'heartbeatAt', 'updatedAt'] },
    { key: 'actions', title: '操作', candidates: [] },
  ],
  metrics: [],
  detailFields: [],
  contextLinks: [
    { label: '查看资产', to: '/assets', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] },
    { label: '查看执行记录', to: '/executions', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] },
  ],
  emptyTitle: '暂无网关',
  emptyDescription: '新增 Gateway Agent，或在现有 Agent 上启用 Gateway 角色。',
  load: () => listGateways({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [
    {
      label: '现有 Agent 启用 Gateway',
      permission: 'gateway.write',
      run: openGatewayEnableModal,
    },
  ],
  rowActions: [
    {
      label: '详情',
      permission: 'gateway.read',
      reloadAfterRun: false,
      run: openDetailModal,
    },
    {
      label: '探测',
      permission: 'gateway.write',
      danger: true,
      confirmText: 'PROBE',
      riskText: '将从该 Gateway 所在区域发起一次可达性探测。',
      run: runProbe,
    },
  ],
  onSelectionChange: handleGatewaySelection,
}
</script>

<template>
  <section class="gateway-page">
    <BusinessResourcePage ref="pageRef" :config="config" />

    <GcModal v-model:open="installModalOpen" title="新增 Gateway Agent" size="lg" width="58vw" :close-on-backdrop="false">
      <section class="gateway-command-modal">
        <div class="gateway-command-modal__field">
          <p class="gateway-command-modal__label">平台</p>
          <div class="gateway-command-modal__platforms">
            <button
              v-for="option in platformOptions"
              :key="option.value"
              class="gateway-command-modal__platform"
              :data-active="selectedInstallPlatform === option.value"
              type="button"
              @click="selectedInstallPlatform = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.description }}</span>
            </button>
          </div>
        </div>

        <label class="gateway-command-modal__field">
          <span class="gateway-command-modal__label">区域</span>
          <input v-model.trim="installZone" type="text" placeholder="default">
        </label>

        <button class="gc-button gateway-command-modal__primary" type="button" :disabled="installPending" @click="generateGatewayInstallCommand">
          {{ installPending ? '生成中...' : '生成安装命令' }}
        </button>
        <p v-if="installError" class="gateway-command-modal__error">{{ installError }}</p>

        <div v-if="installSession" class="gateway-command-modal__result">
          <dl class="gateway-command-modal__meta">
            <div><dt>平台</dt><dd>{{ platformLabel(installSession.platform) }}</dd></div>
            <div><dt>安装码</dt><dd>{{ installSession.code || '-' }}</dd></div>
            <div><dt>区域</dt><dd>{{ installSession.zone }}</dd></div>
            <div><dt>过期时间</dt><dd>{{ formatBrowserLocalTime(installSession.expiresAt) || '-' }}</dd></div>
          </dl>
          <label class="gateway-command-modal__field">
            <span class="gateway-command-modal__label">安装命令</span>
            <textarea readonly :value="installSession.command" rows="3" />
          </label>
        </div>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="installModalOpen = false">关闭</button>
        <button
          v-if="installSession"
          class="gc-button gateway-command-modal__primary"
          type="button"
          @click="copyCommand('install', installSession.command)"
        >
          {{ copiedKind === 'install' ? '已复制' : '复制安装命令' }}
        </button>
      </template>
    </GcModal>

    <GcModal v-model:open="enableModalOpen" title="现有 Agent 启用 Gateway" size="lg" width="58vw" :close-on-backdrop="false">
      <section class="gateway-command-modal">
        <div class="gateway-command-modal__field">
          <p class="gateway-command-modal__label">平台</p>
          <div class="gateway-command-modal__platforms">
            <button
              v-for="option in platformOptions"
              :key="option.value"
              class="gateway-command-modal__platform"
              :data-active="selectedEnablePlatform === option.value"
              type="button"
              @click="selectedEnablePlatform = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.description }}</span>
            </button>
          </div>
        </div>

        <label class="gateway-command-modal__field">
          <span class="gateway-command-modal__label">Agent</span>
          <select v-model="enableAgentId">
            <option value="">不绑定具体 Agent</option>
            <option v-for="agent in enableAgents" :key="String(readPath(agent, 'id'))" :value="String(readPath(agent, 'id'))">
              {{ readString(agent, ['agentKey', 'descriptor.agentKey', 'name', 'id']) }}
            </option>
          </select>
        </label>

        <label class="gateway-command-modal__field">
          <span class="gateway-command-modal__label">区域</span>
          <input v-model.trim="enableZone" type="text" placeholder="default">
        </label>

        <button class="gc-button gateway-command-modal__primary" type="button" :disabled="enablePending" @click="generateGatewayEnableCommand">
          {{ enablePending ? '生成中...' : '生成启用命令' }}
        </button>
        <p v-if="enableError" class="gateway-command-modal__error">{{ enableError }}</p>

        <div v-if="enableSession" class="gateway-command-modal__result">
          <dl class="gateway-command-modal__meta">
            <div><dt>平台</dt><dd>{{ platformLabel(enableSession.platform) }}</dd></div>
            <div><dt>区域</dt><dd>{{ enableSession.zone }}</dd></div>
            <div><dt>服务</dt><dd>{{ enableSession.serviceName || '-' }}</dd></div>
            <div><dt>配置</dt><dd>{{ enableSession.configPath || '-' }}</dd></div>
          </dl>
          <label class="gateway-command-modal__field">
            <span class="gateway-command-modal__label">启用命令</span>
            <textarea readonly :value="enableSession.command" rows="3" />
          </label>
        </div>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="enableModalOpen = false">关闭</button>
        <button
          v-if="enableSession"
          class="gc-button gateway-command-modal__primary"
          type="button"
          @click="copyCommand('enable', enableSession.command)"
        >
          {{ copiedKind === 'enable' ? '已复制' : '复制启用命令' }}
        </button>
      </template>
    </GcModal>

    <GcModal v-model:open="detailModalOpen" title="网关详情" size="xl" width="64vw">
      <section v-if="selectedGateway" class="gateway-detail-modal">
        <header class="gateway-detail-modal__hero">
          <div>
            <p>区域网关</p>
            <h2>{{ gatewayDisplayName }}</h2>
            <span>负责 {{ gatewayRegion }} 区域内的探测和转发</span>
          </div>
          <div class="gateway-detail-modal__hero-side">
            <GcStatusTag :status="String(selectedGateway.status)" />
          </div>
        </header>

        <section class="gateway-detail-modal__sections">
          <article class="gateway-detail-modal__section">
            <div class="gateway-detail-modal__section-head">
              <h3>运行概览</h3>
            </div>
            <dl class="gateway-detail-modal__summary">
              <div
                v-for="item in gatewayOverview"
                :key="item.label"
                class="gateway-detail-modal__summary-item"
                :data-tone="item.tone || 'neutral'"
              >
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
          </article>

          <article class="gateway-detail-modal__section">
            <div class="gateway-detail-modal__section-head">
              <h3>可用服务</h3>
            </div>
            <ul v-if="gatewayAbilities.length" class="gateway-detail-modal__abilities">
              <li v-for="ability in gatewayAbilities" :key="ability.key">
                <strong>{{ ability.title }}</strong>
                <span>{{ ability.description }}</span>
              </li>
            </ul>
            <p v-else class="gateway-detail-modal__empty">-</p>
          </article>

          <nav class="gateway-detail-modal__links">
            <template v-for="link in config.contextLinks" :key="link.label">
              <RouterLink v-if="linkTarget(link)" class="gc-button" :to="linkTarget(link)!">{{ link.label }}</RouterLink>
            </template>
          </nav>
        </section>
      </section>
    </GcModal>
  </section>
</template>

<style scoped>
.gateway-page {
  display: grid;
  gap: var(--gc-space-5);
}

.gateway-command-modal {
  display: grid;
  gap: var(--gc-space-4);
}

.gateway-detail-modal {
  display: grid;
  gap: var(--gc-space-3);
}

.gateway-command-modal__field {
  display: grid;
  gap: var(--gc-space-2);
}

.gateway-command-modal__label {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.gateway-command-modal__platforms {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.gateway-command-modal__platform {
  min-height: 86px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 14px;
  background: #fff;
  color: var(--gc-color-text);
  text-align: left;
  cursor: pointer;
}

.gateway-command-modal__platform[data-active='true'] {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.gateway-command-modal__platform strong,
.gateway-command-modal__platform span {
  display: block;
}

.gateway-command-modal__platform span {
  margin-top: 6px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: 1.45;
}

.gateway-command-modal input,
.gateway-command-modal select,
.gateway-command-modal textarea {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
  color: var(--gc-color-text);
  font: inherit;
}

.gateway-command-modal textarea {
  min-height: 94px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.gateway-command-modal__primary {
  justify-self: start;
  background: var(--gc-color-primary);
  color: #fff;
}

.gateway-command-modal__error {
  margin: 0;
  color: var(--gc-color-danger);
  font-weight: 800;
}

.gateway-command-modal__result {
  display: grid;
  gap: var(--gc-space-3);
}

.gateway-command-modal__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.gateway-command-modal__meta > div {
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 14px;
  background: #fff;
}

.gateway-command-modal__meta dt {
  margin-bottom: 6px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.gateway-command-modal__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--gc-color-text);
  font-weight: 800;
}

.gateway-detail-modal__hero {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-3);
  align-items: center;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 16px 18px;
  background: var(--gc-color-surface-soft);
}

.gateway-detail-modal__hero p,
.gateway-detail-modal__hero h2 {
  margin: 0;
}

.gateway-detail-modal__hero p {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.gateway-detail-modal__hero h2 {
  margin-top: 2px;
  font-size: 20px;
  line-height: 1.2;
}

.gateway-detail-modal__hero span {
  display: block;
  margin-top: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.gateway-detail-modal__hero-side,
.gateway-detail-modal__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
}

.gateway-detail-modal__hero-side {
  justify-content: flex-end;
}

.gateway-detail-modal__sections {
  display: grid;
  gap: var(--gc-space-3);
}

.gateway-detail-modal__section {
  display: grid;
  gap: var(--gc-space-2);
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 14px;
  background: #fff;
}

.gateway-detail-modal__section-head h3 {
  margin: 0;
  font-size: 15px;
}

.gateway-detail-modal__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}

.gateway-detail-modal__summary-item {
  min-height: 72px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
}

.gateway-detail-modal__summary-item[data-tone='good'] {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.gateway-detail-modal__summary-item[data-tone='warn'] {
  border-color: #fde68a;
  background: #fffbeb;
}

.gateway-detail-modal__summary-item[data-tone='bad'] {
  border-color: #fecaca;
  background: #fef2f2;
}

.gateway-detail-modal__summary-item dt {
  margin-bottom: 5px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.gateway-detail-modal__summary-item dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--gc-color-text);
  font-size: 16px;
  font-weight: 850;
}

.gateway-detail-modal__abilities {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.gateway-detail-modal__abilities li {
  min-height: 78px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--gc-color-surface-soft);
  color: var(--gc-color-text);
}

.gateway-detail-modal__abilities strong,
.gateway-detail-modal__abilities span {
  display: block;
}

.gateway-detail-modal__abilities strong {
  margin-bottom: 4px;
  font-size: var(--gc-font-size-sm);
  font-weight: 800;
}

.gateway-detail-modal__abilities span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: 1.45;
  font-weight: 700;
}

.gateway-detail-modal__empty {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-weight: 750;
}

@media (max-width: 900px) {
  .gateway-command-modal__platforms,
  .gateway-command-modal__meta,
  .gateway-detail-modal__summary,
  .gateway-detail-modal__abilities {
    grid-template-columns: 1fr;
  }

  .gateway-detail-modal__hero {
    display: grid;
  }
}
</style>
