<script setup lang="ts">
import { computed, ref } from 'vue'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { createAgentEnrollmentToken } from '@/api/modules/assets.api'
import { listGateways, probeGateway } from '@/api/modules/gateways.api'
import { readNumber, readPath, readString, type ViewRow } from '@/composables/useBusinessPage'
import type { ApiRecord } from '@/api/modules/common'

const enrollmentToken = ref<Record<string, unknown> | null>(null)
const selectedGateway = ref<ViewRow | null>(null)
const tokenValue = computed(() => String(enrollmentToken.value?.token ?? ''))
const tokenPreview = computed(() => String(enrollmentToken.value?.tokenPreview ?? ''))
const tokenExpiresAt = computed(() => String(enrollmentToken.value?.expiresAt ?? ''))
const tokenAuditRef = computed(() => String(enrollmentToken.value?.auditRef ?? ''))
const gatewayRaw = computed<ApiRecord | null>(() => selectedGateway.value?.raw ?? null)
const reachableTargets = computed(() => normalizeList(gatewayRaw.value, ['reachableTargets', 'targets', 'targetCidrs', 'targetZones']))
const proxyProtocols = computed(() => normalizeList(gatewayRaw.value, ['proxyProtocols', 'protocols', 'supportedProtocols', 'adapters']))
const routeRules = computed(() => normalizeRouteRules(gatewayRaw.value))
const gatewayStats = computed(() => ({
  total: readNumber(gatewayRaw.value ?? {}, ['taskStatistics.total', 'statistics.total', 'totalTasks']) ?? 0,
  running: readNumber(gatewayRaw.value ?? {}, ['taskStatistics.running', 'statistics.running', 'activeTasks', 'currentLoad']) ?? 0,
  failed: readNumber(gatewayRaw.value ?? {}, ['taskStatistics.failed', 'statistics.failed', 'failedTasks']) ?? 0,
  failureRate: readFailureRate(gatewayRaw.value)
}))

const executionHints = [
  { title: 'Gateway Agent', description: '隔离区入口，展示可达目标、代理协议、路由规则、任务统计和失败率。' },
  { title: 'SSH 无代理', description: 'Linux/Unix 目标只选择后端 Secret 引用，不在前端保存密码或私钥。' },
  { title: 'WinRM 无代理', description: 'Windows 目标走 WinRM/SMB/WMI，凭据必须由后端 Secret 管理。' },
  { title: 'CURL 无代理', description: '网络设备或 HTTP API 设备走模板执行，Token 只通过 Secret 引用注入。' }
]

async function createGatewayEnrollmentToken() {
  const result = await createAgentEnrollmentToken({
    allowedRoles: ['gateway'],
    allowedZones: ['default'],
    maxUses: 1,
    ttlSeconds: 3600
  })
  enrollmentToken.value = result.data ? { ...result.data } : {}
}

function onGatewaySelectionChange(row: ViewRow | null) {
  selectedGateway.value = row
}

function buildGatewayProbePayload(row: ViewRow | undefined) {
  const raw = row?.raw ?? {}
  const targets = normalizeList(raw, ['reachableTargets', 'targets', 'targetCidrs', 'targetZones'])
  const protocols = normalizeList(raw, ['proxyProtocols', 'protocols', 'supportedProtocols', 'adapters'])
  const protocol = protocols[0] ?? 'ssh'
  return {
    gatewayId: row?.id ?? '',
    targetId: targets[0] ?? row?.id ?? '',
    protocol,
    port: defaultPort(protocol)
  }
}

function defaultPort(protocol: string): number {
  const key = protocol.toLowerCase()
  if (key.includes('winrm')) return 5985
  if (key.includes('http') || key.includes('curl')) return 443
  return 22
}

function normalizeList(record: ApiRecord | null, paths: readonly string[]): string[] {
  if (!record) return []
  for (const path of paths) {
    const value = readPath(record, path)
    if (Array.isArray(value)) return value.map(formatUnknown).filter(Boolean)
    if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function normalizeRouteRules(record: ApiRecord | null) {
  const rules = collectFirstArray(record, ['routeRules', 'routes', 'routingRules'])
  return rules.map((item, index) => {
    if (typeof item === 'string') return { name: item, match: item, target: '—' }
    const rule = isRecord(item) ? item : {}
    return {
      name: readString(rule, ['name', 'id'], `rule-${index + 1}`),
      match: readString(rule, ['match', 'source', 'cidr', 'zone'], '—'),
      target: readString(rule, ['target', 'targetZone', 'nextHop', 'protocol'], '—')
    }
  })
}

function collectFirstArray(record: ApiRecord | null, paths: readonly string[]): readonly unknown[] {
  if (!record) return []
  for (const path of paths) {
    const value = readPath(record, path)
    if (Array.isArray(value)) return value
  }
  return []
}

function readFailureRate(record: ApiRecord | null): string {
  if (!record) return '0%'
  const direct = readPath(record, 'failureRate') ?? readPath(record, 'statistics.failureRate')
  if (typeof direct === 'number') return direct <= 1 ? `${Math.round(direct * 100)}%` : `${Math.round(direct)}%`
  if (typeof direct === 'string' && direct.trim()) return direct
  const failed = readNumber(record, ['taskStatistics.failed', 'statistics.failed', 'failedTasks']) ?? 0
  const total = readNumber(record, ['taskStatistics.total', 'statistics.total', 'totalTasks']) ?? 0
  return total > 0 ? `${Math.round((failed / total) * 100)}%` : '0%'
}

function formatUnknown(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const config: BusinessPageConfig = {
  title: '网关',
  description: '隔离区 Gateway、可达目标、协议适配器、负载、成功率和故障切换入口。',
  readPermission: 'gateway.read',
  primaryPermission: 'gateway.write',
  primaryActionLabel: '登记网关',
  primaryAction: createGatewayEnrollmentToken,
  moduleName: 'gateways',
  resourceName: '网关',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '网关名称', candidates: ['name', 'gatewayName', 'id'] },
    { key: 'status', title: '状态', candidates: ['status', 'state', 'onlineStatus'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'zone', title: '隔离区', candidates: ['zoneName', 'zoneId', 'zoneIds', 'networkZone'] },
    { key: 'load', title: '当前负载', candidates: ['currentLoad', 'load', 'activeTasks'] }
  ],
  metrics: [
    { title: '网关总数', description: '当前租户可用的 Gateway 和隔离区代理节点。', status: 'ONLINE', risk: 'MEDIUM' },
    { title: '高危待处理', description: '离线、不可达、负载过高或能力缺失的 Gateway。', status: 'OFFLINE', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '网关 ID', candidates: ['id', 'gatewayId'] },
    { label: '名称', candidates: ['name', 'gatewayName'] },
    { label: '隔离区', candidates: ['zoneName', 'zoneId', 'zoneIds', 'networkZone'] },
    { label: '适配器', candidates: ['adapters', 'protocols', 'supportedProtocols'] },
    { label: '能力', candidates: ['capabilities', 'capabilityKeys'] },
    { label: '当前负载', candidates: ['currentLoad', 'load', 'activeTasks'] },
    { label: '成功率', candidates: ['successRate', 'statistics.successRate'] },
    { label: '最近心跳', candidates: ['lastSeenAt', 'heartbeatAt', 'updatedAt'] }
  ],
  contextLinks: [
    { label: '查看资产', to: '/assets', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] },
    { label: '查看执行记录', to: '/executions', queryKey: 'gatewayId', candidates: ['id', 'gatewayId'] }
  ],
  emptyTitle: '暂无网关',
  emptyDescription: '如目标网络无法直连，请登记 Gateway 并验证协议适配器和可达范围。无代理连接必须使用后端 Secret 引用。',
  load: () => listGateways({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  onSelectionChange: onGatewaySelectionChange,
  actions: [
    { label: '探测网关可达性', permission: 'gateway.write', danger: true, confirmText: 'PROBE', riskText: '探测会访问隔离区目标网络，请确认范围和协议不会触发安全设备误报。', requiresSelection: true, run: (row) => probeGateway(buildGatewayProbePayload(row)) }
  ]
}
</script>

<template>
  <BusinessResourcePage :config="config">
    <template #after-header>
      <section class="gateway-execution-hints" aria-label="Gateway 与无代理分组提示">
        <article v-for="hint in executionHints" :key="hint.title" class="gc-card gateway-execution-hint">
          <strong>{{ hint.title }}</strong>
          <p>{{ hint.description }}</p>
        </article>
      </section>

      <section class="gc-card gateway-secret-warning" aria-label="无代理 Secret 引用提示">
        <strong>无代理连接安全边界</strong>
        <p>SSH、WinRM、CURL 只允许选择后端 Secret 引用。前端不得把密码、私钥或 Token 写入 URL、LocalStorage、日志或长期状态。</p>
      </section>

      <section v-if="enrollmentToken" class="gc-card gateway-enrollment" aria-label="Gateway Agent 注册令牌">
        <div>
          <p>Gateway Agent 注册令牌</p>
          <h2>请立即复制，令牌只展示一次</h2>
          <span>该令牌仅允许 role=gateway、zone=default、使用 1 次。Gateway Agent 注册完成后会通过 Agent 心跳进入网关列表。</span>
        </div>
        <dl>
          <div>
            <dt>令牌</dt>
            <dd><code>{{ tokenValue }}</code></dd>
          </div>
          <div>
            <dt>预览</dt>
            <dd>{{ tokenPreview }}</dd>
          </div>
          <div>
            <dt>过期时间</dt>
            <dd>{{ tokenExpiresAt }}</dd>
          </div>
          <div>
            <dt>审计参考</dt>
            <dd>{{ tokenAuditRef }}</dd>
          </div>
        </dl>
      </section>

      <section v-if="selectedGateway" class="gc-card gateway-detail-panel" aria-label="Gateway 详情展示">
        <header>
          <div>
            <p>Gateway 执行详情</p>
            <h2>{{ selectedGateway.name }}</h2>
          </div>
          <strong>{{ readString(gatewayRaw ?? {}, ['zoneName', 'zoneId', 'zoneIds', 'networkZone']) }}</strong>
        </header>

        <section class="gateway-detail-grid">
          <article class="gateway-detail-card">
            <h3>可达目标</h3>
            <p v-if="reachableTargets.length === 0" class="gateway-detail-empty">暂无可达目标数据；等待后端返回 reachableTargets/targetCidrs。</p>
            <ul v-else>
              <li v-for="target in reachableTargets" :key="target">{{ target }}</li>
            </ul>
          </article>

          <article class="gateway-detail-card">
            <h3>代理协议</h3>
            <p v-if="proxyProtocols.length === 0" class="gateway-detail-empty">暂无协议适配器数据。</p>
            <ul v-else>
              <li v-for="protocol in proxyProtocols" :key="protocol">{{ protocol }}</li>
            </ul>
          </article>

          <article class="gateway-detail-card">
            <h3>路由规则</h3>
            <p v-if="routeRules.length === 0" class="gateway-detail-empty">暂无路由规则；不是所有后端都会在列表返回规则详情。</p>
            <ul v-else>
              <li v-for="rule in routeRules" :key="rule.name">
                <strong>{{ rule.name }}</strong>
                <span>{{ rule.match }} → {{ rule.target }}</span>
              </li>
            </ul>
          </article>

          <article class="gateway-detail-card">
            <h3>任务统计</h3>
            <dl class="gateway-task-stats">
              <div><dt>总任务</dt><dd>{{ gatewayStats.total }}</dd></div>
              <div><dt>运行中</dt><dd>{{ gatewayStats.running }}</dd></div>
              <div><dt>失败</dt><dd>{{ gatewayStats.failed }}</dd></div>
              <div><dt>失败率</dt><dd>{{ gatewayStats.failureRate }}</dd></div>
            </dl>
          </article>
        </section>
      </section>
    </template>
  </BusinessResourcePage>
</template>

<style scoped>
.gateway-execution-hints {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--gc-space-3);
}
.gateway-execution-hint {
  display: grid;
  gap: var(--gc-space-2);
  padding: 18px;
}
.gateway-execution-hint strong {
  font-size: 16px;
  letter-spacing: -0.02em;
}
.gateway-execution-hint p,
.gateway-secret-warning p,
.gateway-detail-empty {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.55;
  font-weight: 650;
}
.gateway-secret-warning {
  display: grid;
  gap: var(--gc-space-2);
  padding: 18px 20px;
  border-color: #fed7aa;
  background: #fff7ed;
}
.gateway-secret-warning strong {
  color: #9a3412;
  font-size: 16px;
}
.gateway-enrollment { display: grid; gap: var(--gc-space-4); padding: 22px; }
.gateway-enrollment p,
.gateway-enrollment h2 { margin: 0; }
.gateway-enrollment p { color: var(--gc-color-text-muted); font-weight: 850; }
.gateway-enrollment h2 { margin-top: var(--gc-space-1); font-size: 20px; letter-spacing: -0.03em; }
.gateway-enrollment span { display: block; margin-top: var(--gc-space-2); color: var(--gc-color-text-muted); font-weight: 650; line-height: 1.55; }
.gateway-enrollment dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.gateway-enrollment dt { margin-bottom: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.gateway-enrollment dd { margin: 0; overflow-wrap: anywhere; font-weight: 750; }
.gateway-enrollment code {
  display: inline-block;
  border-radius: 10px;
  padding: 7px 9px;
  background: var(--gc-color-success-bg);
  color: var(--gc-color-success);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 850;
}
.gateway-detail-panel {
  display: grid;
  gap: var(--gc-space-4);
  padding: 24px;
}
.gateway-detail-panel header {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-4);
  align-items: flex-start;
}
.gateway-detail-panel h2,
.gateway-detail-panel h3,
.gateway-detail-panel p {
  margin: 0;
}
.gateway-detail-panel header p {
  color: var(--gc-color-text-muted);
  font-weight: 850;
}
.gateway-detail-panel header strong {
  border-radius: 999px;
  padding: 5px 10px;
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-weak);
  font-size: var(--gc-font-size-xs);
}
.gateway-detail-panel h2 {
  margin-top: 4px;
  font-size: 22px;
  letter-spacing: -0.03em;
}
.gateway-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}
.gateway-detail-card {
  display: grid;
  gap: var(--gc-space-3);
  border: 1px solid var(--gc-color-border);
  border-radius: 16px;
  padding: 18px;
  background: #fff;
}
.gateway-detail-card h3 {
  font-size: 17px;
  letter-spacing: -0.02em;
}
.gateway-detail-card ul {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.gateway-detail-card li {
  display: grid;
  gap: 3px;
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--gc-color-surface-soft);
  overflow-wrap: anywhere;
  font-weight: 750;
}
.gateway-detail-card li span {
  color: var(--gc-color-text-muted);
  font-weight: 650;
}
.gateway-task-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--gc-space-2);
  margin: 0;
}
.gateway-task-stats div {
  border-radius: 12px;
  padding: 10px;
  background: var(--gc-color-surface-soft);
}
.gateway-task-stats dt {
  margin-bottom: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}
.gateway-task-stats dd {
  margin: 0;
  font-weight: 900;
}
@media (max-width: 900px) {
  .gateway-enrollment dl,
  .gateway-detail-grid { grid-template-columns: 1fr; }
  .gateway-task-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
