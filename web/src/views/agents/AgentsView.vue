<script setup lang="ts">
import { computed, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { checkAgentUpgrade, createAgentEnrollmentToken, disableAgent, getAgentDetail, listAgentCapabilities, listAgents, listAgentTaskQueue } from '@/api/modules/assets.api'
import type { ApiRecord } from '@/api/modules/common'
import { readNumber, readPath, readString, type ViewRow } from '@/composables/useBusinessPage'

interface EnrollmentTokenView {
  readonly token: string
  readonly tokenPreview: string
  readonly allowedRoles: readonly string[]
  readonly allowedZones: readonly string[]
  readonly maxUses: number
  readonly expiresAt: string
  readonly requestId: string
}

interface DetailNotice {
  readonly kind: 'info' | 'warning'
  readonly text: string
}

const issuedToken = ref<EnrollmentTokenView | null>(null)
const tokenCopied = ref(false)
const selectedAgent = ref<ViewRow | null>(null)
const agentDetail = ref<ApiRecord | null>(null)
const remoteCapabilities = ref<readonly ApiRecord[]>([])
const remoteTasks = ref<readonly ApiRecord[]>([])
const upgradePlan = ref<ApiRecord | null>(null)
const detailLoading = ref(false)
const detailNotice = ref<DetailNotice | null>(null)
let selectionRequestSeq = 0

const executionGroups = [
  { title: 'Full Agent', description: '常驻在线，适合自动部署、发现、回滚和实时日志。', status: 'ONLINE' },
  { title: 'Legacy Agent', description: '老旧环境保守路径，升级和回滚能力必须明确标识。', status: 'DEGRADED' },
  { title: 'Gateway Agent', description: '跨隔离区转发任务，不把生产网段暴露给控制台。', status: 'ROUTED' },
  { title: 'SSH', description: '无代理 Linux/Unix 路径，只保存后端 Secret 引用。', status: 'SECRET_REF' },
  { title: 'WinRM', description: '无代理 Windows 路径，凭据必须来自 Secret 引用。', status: 'SECRET_REF' },
  { title: 'CURL', description: 'HTTP/API 设备模板路径，禁止在前端长期保存密码或 Token。', status: 'TEMPLATE' }
]

const installCommand = computed(() => {
  if (!issuedToken.value?.token) return ''
  return `gcac-agent register --enrollment-token ${issuedToken.value.token}`
})

const selectedRaw = computed<ApiRecord | null>(() => agentDetail.value ?? selectedAgent.value?.raw ?? null)
const capabilityItems = computed(() => normalizeCapabilityItems(remoteCapabilities.value.length > 0 ? remoteCapabilities.value : collectArrays(selectedRaw.value, ['capabilities', 'capabilityKeys', 'capabilitySnapshot.capabilities', 'latestCapabilitySnapshot.capabilities'])))
const taskItems = computed(() => normalizeTaskItems(remoteTasks.value.length > 0 ? remoteTasks.value : collectArrays(selectedRaw.value, ['tasks', 'taskQueue', 'queue', 'recentTasks'])))
const taskSummary = computed(() => readTaskSummary(selectedRaw.value))
const recentError = computed(() => readRecentError(selectedRaw.value, taskItems.value))
const upgradeSuggestion = computed(() => readUpgradeSuggestion(upgradePlan.value, selectedRaw.value))

async function issueEnrollmentToken() {
  const result = await createAgentEnrollmentToken({
    allowedRoles: ['full_agent'],
    allowedZones: ['default'],
    maxUses: 1,
    ttlSeconds: 3600
  })
  const data = result.data
  if (!data || typeof data.token !== 'string') {
    throw new Error('后端没有返回一次性接入令牌')
  }
  issuedToken.value = {
    token: data.token,
    tokenPreview: typeof data.tokenPreview === 'string' ? data.tokenPreview : data.token,
    allowedRoles: Array.isArray(data.allowedRoles) ? data.allowedRoles.map(String) : ['full_agent'],
    allowedZones: Array.isArray(data.allowedZones) ? data.allowedZones.map(String) : ['default'],
    maxUses: typeof data.maxUses === 'number' ? data.maxUses : 1,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
    requestId: result.requestId
  }
  tokenCopied.value = false
}

async function copyToken() {
  if (!issuedToken.value?.token) return
  await navigator.clipboard.writeText(issuedToken.value.token)
  tokenCopied.value = true
}

async function copyInstallCommand() {
  if (!installCommand.value) return
  await navigator.clipboard.writeText(installCommand.value)
  tokenCopied.value = true
}

async function onAgentSelectionChange(row: ViewRow | null) {
  selectedAgent.value = row
  agentDetail.value = null
  remoteCapabilities.value = []
  remoteTasks.value = []
  upgradePlan.value = null
  detailNotice.value = null
  if (!row) return

  const requestSeq = ++selectionRequestSeq
  detailLoading.value = true
  const unavailable: string[] = []
  try {
    const [detailResult, capabilitiesResult, tasksResult, upgradeResult] = await Promise.allSettled([
      getAgentDetail(row.id),
      listAgentCapabilities(row.id),
      listAgentTaskQueue(row.id),
      checkAgentUpgrade(row.id)
    ])
    if (requestSeq !== selectionRequestSeq) return

    if (detailResult.status === 'fulfilled') agentDetail.value = detailResult.value.data ?? null
    else unavailable.push(endpointName(detailResult.reason, '详情'))

    if (capabilitiesResult.status === 'fulfilled') remoteCapabilities.value = capabilitiesResult.value.data?.items ?? []
    else unavailable.push(endpointName(capabilitiesResult.reason, 'Capability'))

    if (tasksResult.status === 'fulfilled') remoteTasks.value = tasksResult.value.data?.items ?? []
    else unavailable.push(endpointName(tasksResult.reason, '任务队列'))

    if (upgradeResult.status === 'fulfilled') upgradePlan.value = upgradeResult.value.data ?? null
    else unavailable.push(endpointName(upgradeResult.reason, '升级建议'))

    if (unavailable.length > 0) {
      detailNotice.value = {
        kind: 'warning',
        text: `${dedupe(unavailable).join('、')}接口暂不可用，当前展示列表已有字段和空状态；没有伪造成功数据。`
      }
    }
  } finally {
    if (requestSeq === selectionRequestSeq) detailLoading.value = false
  }
}

function endpointName(cause: unknown, label: string): string {
  if (cause instanceof ApiClientError && cause.status === 403) return `${label}无权限`
  return label
}

function dedupe(items: readonly string[]): string[] {
  return Array.from(new Set(items))
}

function collectArrays(record: ApiRecord | null, paths: readonly string[]): readonly unknown[] {
  if (!record) return []
  for (const path of paths) {
    const value = readPath(record, path)
    if (Array.isArray(value)) return value
  }
  return []
}

function normalizeCapabilityItems(items: readonly unknown[]) {
  return items.map((item, index) => {
    if (typeof item === 'string') {
      return { key: item, value: '已声明', source: '后端列表', confidence: '—', reportedAt: '—' }
    }
    const record = isRecord(item) ? item : {}
    return {
      key: readString(record, ['capabilityKey', 'key', 'name', 'code'], `capability-${index + 1}`),
      value: readString(record, ['value', 'state', 'status', 'level'], '—'),
      source: readString(record, ['source', 'evidence.source', 'declaredBy'], '后端上报'),
      confidence: formatConfidence(readPath(record, 'confidence')),
      reportedAt: readString(record, ['reportedAt', 'detectedAt', 'updatedAt'], '—')
    }
  })
}

function normalizeTaskItems(items: readonly unknown[]) {
  return items.map((item, index) => {
    const record = isRecord(item) ? item : {}
    return {
      id: readString(record, ['id', 'taskId'], `task-${index + 1}`),
      status: readString(record, ['status', 'state'], 'queued'),
      executionRunId: readString(record, ['executionRunId', 'runId'], '—'),
      updatedAt: readString(record, ['updatedAt', 'createdAt', 'resultAt'], '—'),
      error: readString(record, ['result.errorMessage', 'errorMessage', 'error'], '—')
    }
  })
}

function readTaskSummary(record: ApiRecord | null) {
  const summary = isRecord(readPath(record ?? {}, 'taskSummary')) ? readPath(record ?? {}, 'taskSummary') as ApiRecord : {}
  return {
    running: readNumber(summary, ['running', 'active']) ?? readNumber(record ?? {}, ['runningTasks', 'activeTasks']) ?? 0,
    queued: readNumber(summary, ['queued', 'pending']) ?? readNumber(record ?? {}, ['queuedTasks', 'queueDepth']) ?? 0,
    succeeded: readNumber(summary, ['succeeded', 'success']) ?? 0,
    failed: readNumber(summary, ['failed', 'failure']) ?? readNumber(record ?? {}, ['failedTasks']) ?? 0
  }
}

function readRecentError(record: ApiRecord | null, tasks: ReturnType<typeof normalizeTaskItems>): string {
  if (!record) return '暂无 Agent 数据'
  const direct = readString(record, ['recentError', 'lastError', 'errorMessage', 'health.lastError'], '')
  if (direct) return direct
  const failedTask = tasks.find((task) => task.status.toLowerCase().includes('fail') && task.error !== '—')
  return failedTask?.error ?? '暂无最近错误'
}

function readUpgradeSuggestion(plan: ApiRecord | null, record: ApiRecord | null): string {
  if (plan) {
    const status = readString(plan, ['status'], '')
    const targetVersion = readString(plan, ['targetVersion', 'version'], '')
    const reason = readString(plan, ['reason', 'message'], '')
    return [status, targetVersion ? `目标 ${targetVersion}` : '', reason].filter(Boolean).join(' · ') || JSON.stringify(plan)
  }
  if (!record) return '请选择 Agent 后查看升级建议'
  const direct = readString(record, ['upgradeSuggestion', 'upgradeRecommendation', 'upgrade.reason', 'upgradePlan.reason'], '')
  return direct || '暂无升级建议；若后端升级接口未开放，此处保持空状态。'
}

function formatConfidence(value: unknown): string {
  if (typeof value !== 'number') return '—'
  return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const config: BusinessPageConfig = {
  title: 'Agent',
  description: 'Full Agent、Legacy Agent、在线状态、心跳、能力集合和兼容 API 版本。',
  readPermission: 'agent.read',
  primaryPermission: 'agent.write',
  primaryActionLabel: '签发接入令牌',
  primaryAction: issueEnrollmentToken,
  moduleName: 'agents',
  resourceName: 'Agent',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: 'Agent 名称', candidates: ['name', 'hostname', 'agentName', 'agentKey', 'descriptor.hostname'] },
    { key: 'status', title: '在线状态', candidates: ['status', 'onlineStatus', 'state'] },
    { key: 'role', title: '类型', candidates: ['role', 'agentRole', 'descriptor.role'] },
    { key: 'version', title: '版本', candidates: ['descriptor.version', 'version', 'apiVersion'] },
    { key: 'lastSeenAt', title: '最近心跳', candidates: ['lastSeenAt', 'heartbeatAt', 'updatedAt', 'registeredAt'], kind: 'date' }
  ],
  detailFields: [
    { label: 'Agent ID', candidates: ['id', 'agentId'] },
    { label: '版本', candidates: ['descriptor.version', 'version', 'apiVersion'] },
    { label: 'OS', candidates: ['descriptor.osType', 'osType', 'os', 'platform'] },
    { label: '架构', candidates: ['descriptor.arch', 'arch', 'architecture'] },
    { label: '连接状态', candidates: ['status', 'onlineStatus', 'state', 'session.status'] },
    { label: '角色', candidates: ['role', 'agentRole'] },
    { label: '区域', candidates: ['zone', 'zoneId', 'zoneName'] },
    { label: '最近心跳', candidates: ['lastSeenAt', 'heartbeatAt', 'updatedAt', 'registeredAt'] }
  ],
  metrics: [
    { title: 'Agent 总数', description: 'Full、Legacy 和脚本包节点统一入口。', status: 'ONLINE', risk: 'MEDIUM' },
    { title: '高危待处理', description: '离线、版本不兼容或能力异常 Agent。', status: 'OFFLINE', risk: 'HIGH' }
  ],
  emptyTitle: '暂无 Agent',
  emptyDescription: '请签发接入令牌并安装 Agent；老旧环境走 Legacy 或脚本包路径。',
  load: () => listAgents({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  onSelectionChange: onAgentSelectionChange,
  actions: [
    { label: '禁用 Agent', permission: 'agent.write', danger: true, confirmText: 'DISABLE', riskText: '禁用 Agent 会影响自动部署和监控能力。', requiresSelection: true, run: (row) => disableAgent(row?.id ?? '', { dryRun: true }) }
  ]
}
</script>

<template>
  <BusinessResourcePage :config="config">
    <template #after-header>
      <section class="agent-execution-groups" aria-label="执行能力分组">
        <article v-for="group in executionGroups" :key="group.title" class="gc-card agent-execution-group">
          <strong>{{ group.title }}</strong>
          <span>{{ group.status }}</span>
          <p>{{ group.description }}</p>
        </article>
      </section>

      <section v-if="issuedToken" class="gc-card agent-token" aria-label="Agent 接入令牌">
        <header>
          <div>
            <p>一次性接入令牌</p>
            <h2>令牌已签发，只展示这一次</h2>
          </div>
          <button class="agent-token__close" type="button" aria-label="关闭令牌提示" @click="issuedToken = null">×</button>
        </header>

        <p class="agent-token__warning">离开或关闭后无法再次查看明文令牌；请立即复制并交给 Agent 安装流程。</p>

        <dl>
          <div>
            <dt>令牌预览</dt>
            <dd>{{ issuedToken.tokenPreview }}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{{ issuedToken.allowedRoles.join(', ') }}</dd>
          </div>
          <div>
            <dt>区域</dt>
            <dd>{{ issuedToken.allowedZones.join(', ') }}</dd>
          </div>
          <div>
            <dt>最大使用次数</dt>
            <dd>{{ issuedToken.maxUses }}</dd>
          </div>
          <div>
            <dt>过期时间</dt>
            <dd>{{ issuedToken.expiresAt }}</dd>
          </div>
          <div>
            <dt>requestId</dt>
            <dd>{{ issuedToken.requestId }}</dd>
          </div>
        </dl>

        <label class="agent-token__secret">
          <span>明文令牌</span>
          <textarea readonly :value="issuedToken.token" rows="3" />
        </label>

        <label class="agent-token__secret">
          <span>安装命令模板</span>
          <textarea readonly :value="installCommand" rows="2" />
        </label>

        <footer>
          <button class="gc-button" type="button" @click="copyToken">复制令牌</button>
          <button class="gc-button" type="button" @click="copyInstallCommand">复制安装命令</button>
          <span v-if="tokenCopied">已复制</span>
        </footer>
      </section>

      <section v-if="selectedAgent" class="gc-card agent-detail-panel" aria-label="Agent 详情展示">
        <header>
          <div>
            <p>Agent 执行详情</p>
            <h2>{{ selectedAgent.name }}</h2>
          </div>
          <span v-if="detailLoading" class="agent-detail-panel__loading">加载详情…</span>
        </header>

        <p v-if="detailNotice" class="agent-detail-panel__notice" :data-kind="detailNotice.kind">{{ detailNotice.text }}</p>

        <dl class="agent-detail-panel__summary">
          <div>
            <dt>版本</dt>
            <dd>{{ readString(selectedRaw ?? {}, ['descriptor.version', 'version', 'apiVersion']) }}</dd>
          </div>
          <div>
            <dt>OS</dt>
            <dd>{{ readString(selectedRaw ?? {}, ['descriptor.osType', 'osType', 'os', 'platform']) }}</dd>
          </div>
          <div>
            <dt>架构</dt>
            <dd>{{ readString(selectedRaw ?? {}, ['descriptor.arch', 'arch', 'architecture']) }}</dd>
          </div>
          <div>
            <dt>连接状态</dt>
            <dd>{{ readString(selectedRaw ?? {}, ['status', 'onlineStatus', 'state', 'session.status']) }}</dd>
          </div>
        </dl>

        <section class="agent-detail-grid">
          <article class="agent-detail-card">
            <h3>Capability</h3>
            <p v-if="capabilityItems.length === 0" class="agent-detail-empty">暂无 Capability 数据；等待后端上报或详情接口开放。</p>
            <ul v-else class="agent-capability-list">
              <li v-for="capability in capabilityItems" :key="capability.key">
                <strong>{{ capability.key }}</strong>
                <span>{{ capability.value }}</span>
                <small>来源 {{ capability.source }} · 置信度 {{ capability.confidence }} · {{ capability.reportedAt }}</small>
              </li>
            </ul>
          </article>

          <article class="agent-detail-card">
            <h3>任务队列</h3>
            <dl class="agent-task-summary">
              <div><dt>运行中</dt><dd>{{ taskSummary.running }}</dd></div>
              <div><dt>排队</dt><dd>{{ taskSummary.queued }}</dd></div>
              <div><dt>成功</dt><dd>{{ taskSummary.succeeded }}</dd></div>
              <div><dt>失败</dt><dd>{{ taskSummary.failed }}</dd></div>
            </dl>
            <p v-if="taskItems.length === 0" class="agent-detail-empty">暂无任务队列明细。</p>
            <ul v-else class="agent-task-list">
              <li v-for="task in taskItems" :key="task.id">
                <strong>{{ task.id }}</strong>
                <span>{{ task.status }}</span>
                <small>{{ task.executionRunId }} · {{ task.updatedAt }} · {{ task.error }}</small>
              </li>
            </ul>
          </article>

          <article class="agent-detail-card agent-detail-card--wide">
            <h3>最近错误</h3>
            <p>{{ recentError }}</p>
          </article>

          <article class="agent-detail-card agent-detail-card--wide">
            <h3>升级建议</h3>
            <p>{{ upgradeSuggestion }}</p>
          </article>
        </section>
      </section>
    </template>
  </BusinessResourcePage>
</template>

<style scoped>
.agent-execution-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: var(--gc-space-3);
}
.agent-execution-group {
  display: grid;
  gap: var(--gc-space-2);
  padding: 18px;
}
.agent-execution-group strong {
  font-size: 16px;
  letter-spacing: -0.02em;
}
.agent-execution-group span {
  width: fit-content;
  border-radius: 999px;
  padding: 4px 9px;
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-weak);
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
}
.agent-execution-group p {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.5;
  font-weight: 650;
}
.agent-token {
  display: grid;
  gap: var(--gc-space-4);
  padding: 24px;
  border-color: #bfdbfe;
  background: linear-gradient(135deg, #eff6ff, #fff);
}
.agent-token header {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: flex-start;
}
.agent-token h2,
.agent-token p {
  margin: 0;
}
.agent-token header p {
  color: var(--gc-color-text-muted);
  font-weight: 850;
}
.agent-token h2 {
  margin-top: 4px;
  font-size: 22px;
  letter-spacing: -0.03em;
}
.agent-token__close {
  border: 0;
  border-radius: 999px;
  width: 34px;
  height: 34px;
  cursor: pointer;
  color: var(--gc-color-text-muted);
  background: #fff;
  box-shadow: inset 0 0 0 1px var(--gc-color-border);
  font-size: 24px;
  line-height: 1;
}
.agent-token__warning {
  border: 1px solid #fed7aa;
  border-radius: 14px;
  padding: 12px 14px;
  color: #9a3412;
  background: #fff7ed;
  font-weight: 800;
}
.agent-token dl,
.agent-detail-panel__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}
.agent-token dt,
.agent-detail-panel dt,
.agent-task-summary dt {
  margin-bottom: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}
.agent-token dd,
.agent-detail-panel dd,
.agent-task-summary dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-weight: 800;
}
.agent-token__secret {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-weight: 850;
}
.agent-token__secret textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--gc-color-border);
  border-radius: 14px;
  padding: 12px;
  color: #0f172a;
  background: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  resize: vertical;
}
.agent-token footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  align-items: center;
}
.agent-token footer span {
  color: var(--gc-color-success);
  font-weight: 850;
}
.agent-detail-panel {
  display: grid;
  gap: var(--gc-space-4);
  padding: 24px;
}
.agent-detail-panel header {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: flex-start;
}
.agent-detail-panel h2,
.agent-detail-panel h3,
.agent-detail-panel p {
  margin: 0;
}
.agent-detail-panel header p {
  color: var(--gc-color-text-muted);
  font-weight: 850;
}
.agent-detail-panel h2 {
  margin-top: 4px;
  font-size: 22px;
  letter-spacing: -0.03em;
}
.agent-detail-panel__loading {
  color: var(--gc-color-text-muted);
  font-weight: 800;
}
.agent-detail-panel__notice {
  border: 1px solid #fde68a;
  border-radius: 14px;
  padding: 12px 14px;
  color: #92400e;
  background: #fffbeb;
  font-weight: 750;
}
.agent-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}
.agent-detail-card {
  display: grid;
  gap: var(--gc-space-3);
  border: 1px solid var(--gc-color-border);
  border-radius: 16px;
  padding: 18px;
  background: #fff;
}
.agent-detail-card--wide {
  grid-column: span 1;
}
.agent-detail-card h3 {
  font-size: 17px;
  letter-spacing: -0.02em;
}
.agent-detail-card p,
.agent-detail-empty,
.agent-capability-list small,
.agent-task-list small {
  color: var(--gc-color-text-muted);
  line-height: 1.55;
  font-weight: 650;
}
.agent-capability-list,
.agent-task-list {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.agent-capability-list li,
.agent-task-list li {
  display: grid;
  gap: 3px;
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--gc-color-surface-soft);
}
.agent-capability-list span,
.agent-task-list span {
  width: fit-content;
  border-radius: 999px;
  padding: 3px 8px;
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
}
.agent-task-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}
.agent-task-summary div {
  border-radius: 12px;
  padding: 10px;
  background: var(--gc-color-surface-soft);
}
@media (max-width: 900px) {
  .agent-detail-grid { grid-template-columns: 1fr; }
  .agent-task-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
