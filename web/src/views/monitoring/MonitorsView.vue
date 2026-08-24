<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { listAssets } from '@/api/modules/assets.api'
import { listBindings } from '@/api/modules/bindings.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  createMonitorTarget,
  deleteMonitorTarget,
  listMonitorCertificateObservations,
  listMonitorTargets,
  listRiskEvents,
  probeMonitorServiceAsset,
  updateMonitorTarget,
} from '@/api/modules/monitors.api'
import { GcEmptyState, GcModal, GcPageHeader, GcStatusTag } from '@/design-system/components'

type MonitorMetric = 'availability' | 'latency' | 'certificate' | 'certificateHistory'
type ProbeStatus = 'READY' | 'WARNING' | 'ERROR'
type TargetStatus = ProbeStatus | 'NONE'

interface MonitorTarget {
  readonly id: string
  readonly assetId: string
  readonly metrics: MonitorMetric[]
  readonly intervalSeconds: number
  readonly createdAt: number
}

interface ProbeResult {
  readonly status: ProbeStatus
  readonly latencyMs?: number
  readonly checkedAt: number
  readonly message: string
  readonly source?: string
  readonly httpStatus?: number
  readonly certificate?: Record<string, unknown>
}

interface CertificateObservation {
  readonly checkedAt: number
  readonly source?: string
  readonly fingerprintSha256: string
  readonly subject?: string
  readonly issuer?: string
  readonly serialNumber?: string
  readonly notBefore?: string
  readonly notAfter?: string
  readonly dnsNames?: string[]
  readonly verified?: boolean
  readonly verificationError?: string
}

const storageKey = 'gcac.monitor.targets.v1'
const historyStorageKey = 'gcac.monitor.probe-history.v1'

const assets = ref<ApiRecord[]>([])
const risks = ref<ApiRecord[]>([])
const bindings = ref<ApiRecord[]>([])
const monitorTargets = ref<MonitorTarget[]>([])
const probeResults = ref<Record<string, ProbeResult>>({})
const probeHistory = ref<Record<string, ProbeResult[]>>({})
const certificateObservations = ref<Record<string, CertificateObservation[]>>({})
const selectedAssetId = ref('')
const selectedIntervalSeconds = ref(60)
const selectedTargetId = ref('')
const loading = ref(false)
const probing = ref(false)
const addDialogOpen = ref(false)
const error = ref('')
const actionMessage = ref('')
const targetTimers = new Map<string, number>()
const scheduledProbeIds = new Set<string>()
const activeProbeIds = new Set<string>()

const defaultMetrics: MonitorMetric[] = ['availability', 'latency', 'certificate', 'certificateHistory']

const assetOptions = computed(() =>
  assets.value.filter((asset) => !monitorTargets.value.some((target) => target.assetId === readId(asset))),
)

const selectedTarget = computed(() =>
  monitorTargets.value.find((target) => target.id === selectedTargetId.value) ?? monitorTargets.value[0] ?? null,
)

const selectedAsset = computed(() =>
  selectedTarget.value ? assetById(selectedTarget.value.assetId) : null,
)

const selectedAssetRisks = computed(() =>
  selectedTarget.value ? risksForAsset(selectedTarget.value.assetId) : [],
)

const selectedProbeHistory = computed(() =>
  selectedTarget.value ? probeHistory.value[selectedTarget.value.assetId] ?? [] : [],
)

const selectedActualCertificate = computed(() =>
  selectedTarget.value ? latestCertificateObservation(selectedTarget.value.assetId) : null,
)

const selectedObservedCertificateHistory = computed(() =>
  selectedTarget.value ? certificateObservations.value[selectedTarget.value.assetId] ?? [] : [],
)

const monitorRows = computed(() =>
  monitorTargets.value.map((target) => {
    const asset = assetById(target.assetId)
    const assetRisks = risksForAsset(target.assetId)
    const probe = probeResults.value[target.assetId]
    return {
      target,
      title: assetLabel(asset),
      endpoint: endpointLabel(asset),
      status: statusFromProbeAndRisks(probe, assetRisks),
      statusLabel: probeStatusLabel(statusFromProbeAndRisks(probe, assetRisks)),
      recentResults: recentProbeResults(target.assetId),
    }
  }),
)

onMounted(() => {
  clearStoredMonitorState()
  void refreshAll()
})

onBeforeUnmount(() => {
  clearTargetProbeTimers()
})

async function refreshAll() {
  loading.value = true
  error.value = ''
  try {
    const [targetResult, assetResult, riskResult, bindingResult] = await Promise.all([
      listMonitorTargets({ page: 1, pageSize: 500, sort: 'createdAt:desc' }),
      listAssets({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listRiskEvents({ page: 1, pageSize: 200, sort: 'lastDetectedAt:desc' }),
      listBindings({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
    ])
    monitorTargets.value = (targetResult.data?.items ?? [])
      .map(normalizeMonitorTargetRecord)
      .filter((target): target is MonitorTarget => Boolean(target))
    trimProbeStateToTargets()
    assets.value = [...(assetResult.data?.items ?? [])]
    risks.value = [...(riskResult.data?.items ?? [])]
    bindings.value = [...(bindingResult.data?.items ?? [])]
    await refreshCertificateObservations()
    if (!monitorTargets.value.some((target) => target.id === selectedTargetId.value)) {
      selectedTargetId.value = monitorTargets.value[0]?.id ?? ''
    }
    resetTargetProbeTimers()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '监控数据加载失败'
  } finally {
    loading.value = false
  }
}

async function addMonitorTarget() {
  const assetId = selectedAssetId.value.trim()
  if (!assetId) return
  error.value = ''
  try {
    const result = await createMonitorTarget({
      serviceAssetId: assetId,
      metrics: [...defaultMetrics],
      intervalSeconds: normalizeProbeInterval(selectedIntervalSeconds.value),
    })
    const target = normalizeMonitorTargetRecord(result.data)
    if (!target) throw new Error('后端返回的监控目标无效')
    monitorTargets.value = [target, ...monitorTargets.value.filter((item) => item.id !== target.id)]
    selectedTargetId.value = target.id
    selectedAssetId.value = ''
    addDialogOpen.value = false
    actionMessage.value = '监控目标已添加。'
    void probeTarget(target)
    scheduleTargetProbe(target)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '监控目标添加失败'
  }
}

function openAddDialog() {
  selectedAssetId.value = assetOptions.value[0] ? readId(assetOptions.value[0]) : ''
  selectedIntervalSeconds.value = 60
  addDialogOpen.value = true
}

async function removeMonitorTarget(targetId: string) {
  const target = monitorTargets.value.find((item) => item.id === targetId)
  if (!target) return
  error.value = ''
  try {
    await deleteMonitorTarget(targetId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '监控目标删除失败'
    return
  }
  clearTargetProbeTimer(targetId)
  monitorTargets.value = monitorTargets.value.filter((item) => item.id !== targetId)
  if (target?.assetId) {
    const nextProbeResults = { ...probeResults.value }
    delete nextProbeResults[target.assetId]
    probeResults.value = nextProbeResults
  }
  selectedTargetId.value = monitorTargets.value[0]?.id ?? ''
  actionMessage.value = '监控目标已移除。'
}

function handleTargetIntervalInput(targetId: string, event: Event) {
  const input = event.target as HTMLInputElement
  updateTargetInterval(targetId, input.valueAsNumber)
}

async function updateTargetInterval(targetId: string, value: number) {
  const intervalSeconds = normalizeProbeInterval(value)
  const target = monitorTargets.value.find((item) => item.id === targetId)
  if (!target) return
  error.value = ''
  try {
    const result = await updateMonitorTarget(targetId, { intervalSeconds })
    const updated = normalizeMonitorTargetRecord(result.data) ?? { ...target, intervalSeconds }
    monitorTargets.value = monitorTargets.value.map((item) =>
      item.id === targetId ? updated : item,
    )
    scheduleTargetProbe(updated)
    actionMessage.value = '探测频率已更新。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '探测频率更新失败'
  }
}

async function probeAllTargets(options: { silent?: boolean } = {}) {
  probing.value = true
    if (!options.silent) actionMessage.value = ''
  try {
    for (const target of monitorTargets.value) {
      await probeTarget(target)
    }
    if (!options.silent) actionMessage.value = '站点检测已完成，可访问性、延时和证书信息已同步采集。'
  } finally {
    probing.value = false
  }
}

async function probeTarget(target: MonitorTarget) {
  if (activeProbeIds.has(target.id)) return
  activeProbeIds.add(target.id)
  try {
    const result = await probeMonitorServiceAsset({
      serviceAssetId: target.assetId,
      timeoutMs: 10000,
    })
    const data = result.data ?? {}
    saveProbeResult(target.assetId, {
      status: readString(data, ['status'], 'WARNING') as ProbeStatus,
      latencyMs: readNumber(data.latencyMs),
      checkedAt: Date.parse(readString(data, ['checkedAt'], '')) || Date.now(),
      message: readString(data, ['message'], '探测完成'),
      source: readString(data, ['source'], ''),
      httpStatus: readNumber(data.httpStatus),
      certificate: readObject(data.certificate),
    })
    await refreshCertificateObservations(target.assetId)
  } catch (cause) {
    saveProbeResult(target.assetId, {
      status: 'ERROR',
      checkedAt: Date.now(),
      message: cause instanceof Error ? cause.message : '探测请求失败',
    })
  } finally {
    activeProbeIds.delete(target.id)
  }
}

async function refreshCertificateObservations(assetId?: string) {
  const result = await listMonitorCertificateObservations({
    page: 1,
    pageSize: 500,
    filters: assetId ? { serviceAssetId: assetId } : undefined,
  })
  const grouped = groupCertificateObservations(result.data?.items ?? [])
  certificateObservations.value = assetId
    ? { ...certificateObservations.value, [assetId]: grouped[assetId] ?? [] }
    : grouped
}

function saveProbeResult(assetId: string, result: ProbeResult) {
  probeResults.value = { ...probeResults.value, [assetId]: result }
  const history = [result, ...(probeHistory.value[assetId] ?? [])].slice(0, 20)
  probeHistory.value = { ...probeHistory.value, [assetId]: history }
}

function resetTargetProbeTimers() {
  clearTargetProbeTimers()
  for (const target of monitorTargets.value) {
    scheduleTargetProbe(target, staggerDelaySeconds(target))
  }
}

function scheduleTargetProbe(target: MonitorTarget, delaySeconds = target.intervalSeconds) {
  clearTargetProbeTimer(target.id)
  if (!monitorTargets.value.some((item) => item.id === target.id)) return
  const delayMs = normalizeProbeInterval(delaySeconds) * 1000
  const timer = window.setTimeout(() => {
    void runScheduledProbe(target.id)
  }, delayMs)
  targetTimers.set(target.id, timer)
}

async function runScheduledProbe(targetId: string) {
  targetTimers.delete(targetId)
  if (scheduledProbeIds.has(targetId)) return
  const target = monitorTargets.value.find((item) => item.id === targetId)
  if (!target) return
  scheduledProbeIds.add(targetId)
  try {
    await probeTarget(target)
  } finally {
    scheduledProbeIds.delete(targetId)
    const latest = monitorTargets.value.find((item) => item.id === targetId)
    if (latest) scheduleTargetProbe(latest)
  }
}

function clearTargetProbeTimer(targetId: string) {
  const timer = targetTimers.get(targetId)
  if (timer !== undefined) window.clearTimeout(timer)
  targetTimers.delete(targetId)
}

function clearTargetProbeTimers() {
  for (const timer of targetTimers.values()) {
    window.clearTimeout(timer)
  }
  targetTimers.clear()
}

function staggerDelaySeconds(target: MonitorTarget): number {
  const index = monitorTargets.value.findIndex((item) => item.id === target.id)
  return normalizeProbeInterval(target.intervalSeconds) + Math.max(0, index) * 3
}

function normalizeProbeInterval(value: number): number {
  if (!Number.isFinite(value)) return 60
  return Math.min(3600, Math.max(10, Math.trunc(value)))
}

function assetById(assetId: string): ApiRecord | null {
  return assets.value.find((asset) => readId(asset) === assetId) ?? null
}

function risksForAsset(assetId: string): ApiRecord[] {
  const asset = assetById(assetId)
  const assetText = [assetId, readString(asset, ['address']), readString(asset, ['displayName']), readString(asset, ['domainName'])]
    .filter(Boolean)
    .map((value) => value.toLowerCase())
  const relatedBindings = bindingsForAsset(assetId).map((binding) => readId(binding)).filter(Boolean)
  return risks.value.filter((risk) => {
    const riskText = JSON.stringify(risk).toLowerCase()
    return assetText.some((text) => text && riskText.includes(text))
      || relatedBindings.some((bindingId) => riskText.includes(bindingId.toLowerCase()))
  })
}

function bindingsForAsset(assetId: string): ApiRecord[] {
  const asset = assetById(assetId)
  const address = readString(asset, ['address', 'domainName', 'displayName'], '').toLowerCase()
  return bindings.value.filter((binding) => {
    const bindingAssetId = readString(binding, ['serviceAssetId', 'applicationAssetId', 'assetId'], '')
    const domain = readString(binding, ['domainName', 'domain', 'hostHeader'], '').toLowerCase()
    return bindingAssetId === assetId || (!!address && domain === address)
  })
}

function observedCertificateName(certificate: CertificateObservation): string {
  return certificate.subject || certificate.dnsNames?.[0] || '未知证书'
}

function observedCertificateIssuer(certificate: CertificateObservation): string {
  return certificate.issuer || '未知颁发者'
}

function observedCertificateExpiresAt(certificate: CertificateObservation): string {
  return formatLocalDateText(certificate.notAfter ?? '')
}

function observedCertificateChangedAt(certificate: CertificateObservation): string {
  return formatLocalTime(certificate.checkedAt)
}

function statusFromProbeAndRisks(probe: ProbeResult | undefined, assetRisks: ApiRecord[]): TargetStatus {
  if (probe?.status === 'ERROR') return 'ERROR'
  if (assetRisks.some((risk) => ['critical', 'high'].includes(readString(risk, ['severity', 'risk'], '').toLowerCase()))) return 'WARNING'
  return probe?.status ?? 'NONE'
}

function recentProbeResults(assetId: string): ProbeResult[] {
  return (probeHistory.value[assetId] ?? []).slice(0, 10)
}

function latestCertificateObservation(assetId: string): CertificateObservation | null {
  return certificateObservations.value[assetId]?.[0] ?? null
}

function probeStatusLabel(status: TargetStatus): string {
  if (status === 'READY') return '正常'
  if (status === 'WARNING') return '警告'
  if (status === 'NONE') return '待执行'
  return '错误'
}

function probeHistoryBlockLabel(result: ProbeResult | undefined, index: number): string {
  if (!result) return `第 ${index + 1} 次：暂无探测`
  const latency = result.latencyMs === undefined ? '未采集延时' : `${result.latencyMs}ms`
  return `${formatLocalTime(result.checkedAt)} ${probeStatusLabel(result.status)} ${latency}`
}

function actualCertificateLabel(certificate: CertificateObservation | null): string {
  if (!certificate) return '未采集'
  const subject = certificate.subject || certificate.dnsNames?.[0] || '实测证书'
  return `${subject} / ${formatLocalDateText(certificate.notAfter ?? '')}`
}

function shortFingerprint(value: string | undefined): string {
  const normalized = normalizeFingerprint(value ?? '')
  if (!normalized) return '无指纹'
  return `${normalized.slice(0, 12)}...${normalized.slice(-12)}`
}

function verificationLabel(certificate: CertificateObservation | null): string {
  if (!certificate) return '未采集'
  if (certificate.verified) return '链验证通过'
  return certificate.verificationError ? `链验证失败：${certificate.verificationError}` : '未通过系统信任链验证'
}

function probeUrl(asset: ApiRecord | null): string {
  const explicitUrl = readString(asset, ['verifyUrl', 'metadata.verifyUrl'], '')
  if (explicitUrl) return explicitUrl
  const address = readString(asset, ['address', 'domainName', 'displayName'], '')
  if (!address) return ''
  const protocol = readString(asset, ['protocol'], 'HTTPS').toLowerCase() === 'http' ? 'http' : 'https'
  const port = Number(readString(asset, ['port'], protocol === 'https' ? '443' : '80'))
  const portText = (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80) ? '' : `:${port}`
  return `${protocol}://${address}${portText}/`
}

function endpointLabel(asset: ApiRecord | null): string {
  return probeUrl(asset) || '未配置访问地址'
}

function assetLabel(asset: ApiRecord | null): string {
  return readString(asset, ['displayName', 'address', 'domainName', 'name'], '未知资产')
}

function readId(record: ApiRecord | null | undefined): string {
  return readString(record, ['id', 'serviceAssetId', 'assetId'], '')
}

function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = ''): string {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readBoolean(record: ApiRecord | null | undefined, candidates: readonly string[]): boolean | undefined {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function normalizeFingerprint(value: string): string {
  return value.replace(/[^a-f0-9]/giu, '').toUpperCase()
}

function readPath(record: ApiRecord | null | undefined, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function formatLocalTime(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function formatLocalDateText(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function sourceLabel(source: string | undefined): string {
  if (source === 'control_plane') return '平台'
  if (source === 'gateway') return 'Gateway'
  return '未知'
}

function groupCertificateObservations(items: readonly ApiRecord[]): Record<string, CertificateObservation[]> {
  return items.reduce<Record<string, CertificateObservation[]>>((acc, item) => {
    const assetId = readString(item, ['serviceAssetId'], '')
    const observation = normalizeStoredCertificateObservation(item)
    if (!assetId || !observation) return acc
    acc[assetId] = [...(acc[assetId] ?? []), observation]
    return acc
  }, {})
}

function normalizeStoredCertificateObservation(item: ApiRecord): CertificateObservation | null {
  const fingerprint = normalizeFingerprint(readString(item, ['fingerprintSha256'], ''))
  if (!fingerprint) return null
  const observedAt = Date.parse(readString(item, ['observedAt', 'checkedAt'], '')) || readNumber(item.checkedAt) || Date.now()
  const dnsNamesValue = readPath(item, 'dnsNames')
  return {
    checkedAt: observedAt,
    source: readString(item, ['source'], ''),
    fingerprintSha256: fingerprint,
    subject: readString(item, ['subject'], ''),
    issuer: readString(item, ['issuer'], ''),
    serialNumber: readString(item, ['serialNumber'], ''),
    notBefore: readString(item, ['notBefore'], ''),
    notAfter: readString(item, ['notAfter'], ''),
    dnsNames: Array.isArray(dnsNamesValue) ? dnsNamesValue.map(String).filter(Boolean) : undefined,
    verified: readBoolean(item, ['verified']),
    verificationError: readString(item, ['verificationError'], ''),
  }
}

function normalizeMonitorTargetRecord(value: unknown): MonitorTarget | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const assetId = typeof record.serviceAssetId === 'string' ? record.serviceAssetId : record.assetId
  if (typeof record.id !== 'string' || typeof assetId !== 'string') return null
  const createdAtValue = typeof record.createdAt === 'string' ? Date.parse(record.createdAt) : record.createdAt
  return {
    id: record.id,
    assetId,
    metrics: Array.isArray(record.metrics) ? record.metrics.filter(isMonitorMetric) : [...defaultMetrics],
    intervalSeconds: normalizeProbeInterval(readNumber(record.intervalSeconds) ?? 60),
    createdAt: typeof createdAtValue === 'number' && Number.isFinite(createdAtValue) ? createdAtValue : Date.now(),
  }
}

function isMonitorMetric(value: unknown): value is MonitorMetric {
  return typeof value === 'string' && defaultMetrics.includes(value as MonitorMetric)
}

function clearStoredMonitorState() {
  try {
    if (localStorage.getItem(storageKey) !== null) localStorage.removeItem(storageKey)
    if (localStorage.getItem(historyStorageKey) !== null) localStorage.removeItem(historyStorageKey)
  } catch {
    // 中文说明：隐私模式或禁用存储时清理失败不能阻断后端数据加载。
  }
}

function trimProbeStateToTargets() {
  const assetIds = new Set(monitorTargets.value.map((target) => target.assetId))
  probeResults.value = Object.fromEntries(
    Object.entries(probeResults.value).filter(([assetId]) => assetIds.has(assetId)),
  )
  probeHistory.value = Object.fromEntries(
    Object.entries(probeHistory.value).filter(([assetId]) => assetIds.has(assetId)),
  )
}
</script>

<template>
  <section class="gc-page monitor-page">
    <GcPageHeader
      title="监控"
      description="从应用资产列表手动添加监控目标，按资产查看可访问性、访问延时、证书信息和证书历史。"
    >
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="refreshAll">
          {{ loading ? '刷新中...' : '刷新数据' }}
        </button>
        <button class="gc-button gc-button--danger" type="button" :disabled="probing || monitorTargets.length === 0" @click="() => probeAllTargets()">
          {{ probing ? '检测中...' : '检测站点' }}
        </button>
        <button class="gc-button gc-button--danger" type="button" :disabled="loading" @click="openAddDialog">
          添加监控
        </button>
      </template>
    </GcPageHeader>

    <p v-if="actionMessage" class="monitor-page__message">{{ actionMessage }}</p>
    <GcEmptyState v-if="error" title="监控数据加载失败" :description="error" />

    <GcEmptyState
      v-else-if="!loading && monitorTargets.length === 0"
      title="暂无监控目标"
      description="点击右上角添加监控，系统会按目标频率检测站点并同步采集证书信息。"
    />

    <section v-else class="monitor-page__workspace">
      <aside class="monitor-page__targets gc-card">
        <header class="monitor-page__section-head">
          <div>
            <strong>监控目标</strong>
            <span>{{ monitorRows.length }} 个资产</span>
          </div>
        </header>
        <button
          v-for="row in monitorRows"
          :key="row.target.id"
          class="monitor-page__target"
          :class="{ 'is-active': selectedTargetId === row.target.id }"
          type="button"
          @click="selectedTargetId = row.target.id"
        >
          <div>
            <strong>{{ row.title }}</strong>
            <span>{{ row.endpoint }}</span>
            <div class="monitor-page__probe-blocks" aria-label="最近 10 次探测结果">
              <i
                v-for="index in 10"
                :key="index"
                :data-status="row.recentResults[index - 1]?.status ?? 'NONE'"
                :title="probeHistoryBlockLabel(row.recentResults[index - 1], index - 1)"
              />
            </div>
          </div>
          <span class="monitor-page__target-status" :data-status="row.status">{{ row.statusLabel }}</span>
        </button>
      </aside>

      <section class="monitor-page__detail">
        <section class="monitor-page__summary gc-card">
          <div class="monitor-page__summary-title">
            <div>
              <span>当前目标</span>
              <h2>{{ assetLabel(selectedAsset) }}</h2>
              <p>{{ endpointLabel(selectedAsset) }}</p>
            </div>
            <div v-if="selectedTarget" class="monitor-page__target-actions">
              <label class="monitor-page__target-interval">
                <span>探测频率</span>
                <input
                  :value="selectedTarget.intervalSeconds"
                  type="number"
                  min="10"
                  step="10"
                  @change="handleTargetIntervalInput(selectedTarget.id, $event)"
                />
                <b>s</b>
              </label>
              <button class="gc-button" type="button" @click="removeMonitorTarget(selectedTarget.id)">
                移除
              </button>
            </div>
          </div>
          <div class="monitor-page__kpi-grid">
            <article>
              <span>可访问性</span>
              <strong>{{ selectedTarget ? (probeResults[selectedTarget.assetId]?.message ?? '等待站点检测') : '未选择' }}</strong>
            </article>
            <article>
              <span>访问延时</span>
              <strong>{{ selectedTarget && probeResults[selectedTarget.assetId]?.latencyMs !== undefined ? `${probeResults[selectedTarget.assetId]?.latencyMs} ms` : '未采集' }}</strong>
            </article>
            <article>
              <span>证书状态</span>
              <strong>{{ actualCertificateLabel(selectedActualCertificate) }}</strong>
            </article>
            <article>
              <span>实测证书变更</span>
              <strong>{{ selectedObservedCertificateHistory.length }}</strong>
            </article>
          </div>
        </section>

        <section class="monitor-page__panels">
          <article class="monitor-page__panel gc-card">
            <header class="monitor-page__section-head">
              <div>
                <strong>当前站点实测证书</strong>
                <span>随站点检测自动采集</span>
              </div>
            </header>
            <div v-if="!selectedActualCertificate" class="monitor-page__empty-line">暂无实测 TLS 证书。HTTPS 目标会在站点检测时自动采集证书信息。</div>
            <dl v-else class="monitor-page__certificate-detail">
              <div>
                <dt>SHA-256 指纹</dt>
                <dd :title="selectedActualCertificate.fingerprintSha256">{{ shortFingerprint(selectedActualCertificate.fingerprintSha256) }}</dd>
              </div>
              <div>
                <dt>主体</dt>
                <dd>{{ selectedActualCertificate.subject || '未知' }}</dd>
              </div>
              <div>
                <dt>颁发者</dt>
                <dd>{{ selectedActualCertificate.issuer || '未知' }}</dd>
              </div>
              <div>
                <dt>序列号</dt>
                <dd>{{ selectedActualCertificate.serialNumber || '未知' }}</dd>
              </div>
              <div>
                <dt>有效期</dt>
                <dd>{{ formatLocalDateText(selectedActualCertificate.notBefore ?? '') }} 至 {{ formatLocalDateText(selectedActualCertificate.notAfter ?? '') }}</dd>
              </div>
              <div>
                <dt>链验证</dt>
                <dd>{{ verificationLabel(selectedActualCertificate) }}</dd>
              </div>
              <div>
                <dt>SAN</dt>
                <dd>{{ selectedActualCertificate.dnsNames?.join(', ') || '未采集' }}</dd>
              </div>
              <div>
                <dt>采集时间</dt>
                <dd>{{ formatLocalTime(selectedActualCertificate.checkedAt) }} / {{ sourceLabel(selectedActualCertificate.source) }}</dd>
              </div>
            </dl>
          </article>

          <article class="monitor-page__panel gc-card">
            <header class="monitor-page__section-head">
              <div>
                <strong>绑定证书版本</strong>
                <span>按实测 TLS 证书变化保留版本记录</span>
              </div>
            </header>
            <div v-if="selectedObservedCertificateHistory.length === 0" class="monitor-page__empty-line">暂无绑定证书版本。站点检测采集到第一张证书后会自动保留。</div>
            <table v-else class="monitor-page__table">
              <thead>
                <tr>
                  <th>证书名称</th>
                  <th>颁发者名称</th>
                  <th>到期时间</th>
                  <th>更换时间</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in selectedObservedCertificateHistory" :key="`${item.checkedAt}-${item.fingerprintSha256}`">
                  <td>{{ observedCertificateName(item) }}</td>
                  <td>{{ observedCertificateIssuer(item) }}</td>
                  <td>{{ observedCertificateExpiresAt(item) }}</td>
                  <td>{{ observedCertificateChangedAt(item) }}</td>
                </tr>
              </tbody>
            </table>
          </article>

          <article class="monitor-page__panel monitor-page__panel--wide gc-card">
            <header class="monitor-page__section-head">
              <div>
                <strong>探测历史</strong>
                <span>后端探测结果最近 20 次记录</span>
              </div>
            </header>
            <div v-if="selectedProbeHistory.length === 0" class="monitor-page__empty-line">暂无探测历史。</div>
            <table v-else class="monitor-page__table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>延时</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in selectedProbeHistory" :key="`${item.checkedAt}-${item.message}`">
                  <td>{{ formatLocalTime(item.checkedAt) }}</td>
                  <td>{{ sourceLabel(item.source) }}</td>
                  <td>{{ item.status }}</td>
                  <td>{{ item.latencyMs === undefined ? '未采集' : `${item.latencyMs} ms` }}</td>
                  <td>{{ item.message }}</td>
                </tr>
              </tbody>
            </table>
          </article>

          <article class="monitor-page__panel gc-card">
            <header class="monitor-page__section-head">
              <div>
                <strong>风险事件</strong>
                <span>证书链、域名、指纹和执行状态</span>
              </div>
            </header>
            <div v-if="selectedAssetRisks.length === 0" class="monitor-page__empty-line">暂无相关事件。</div>
            <ul v-else class="monitor-page__risk-list">
              <li v-for="risk in selectedAssetRisks" :key="readId(risk)">
                <div>
                  <strong>{{ readString(risk, ['title', 'name'], '未命名事件') }}</strong>
                  <span>{{ readString(risk, ['summary', 'message'], '无摘要') }}</span>
                </div>
                <GcStatusTag :status="readString(risk, ['status'], 'OPEN')" />
              </li>
            </ul>
          </article>
        </section>
      </section>
    </section>

    <GcModal
      v-model:open="addDialogOpen"
      title="添加监控"
      description="从应用资产列表选择一个目标，系统会固定采集可访问性、访问延时、证书信息和证书历史。"
      size="md"
    >
      <div class="monitor-page__dialog-form">
        <label>
          <span>应用资产</span>
          <select v-model="selectedAssetId" :disabled="loading">
            <option value="">{{ loading ? '加载资产中...' : '请选择应用资产' }}</option>
            <option v-for="asset in assetOptions" :key="readId(asset)" :value="readId(asset)">
              {{ assetLabel(asset) }} / {{ endpointLabel(asset) }}
            </option>
          </select>
        </label>
        <label>
          <span>探测频率</span>
          <span class="monitor-page__dialog-number">
            <input v-model.number="selectedIntervalSeconds" type="number" min="10" step="10" />
            <b>s</b>
          </span>
        </label>
        <div v-if="assetOptions.length === 0 && !loading" class="monitor-page__empty-line">
          暂无可添加应用资产，已有目标请在详情中调整探测频率。
        </div>
        <p>默认监控可访问性、访问延时、证书信息和证书历史。</p>
      </div>
      <template #actions>
        <button class="gc-button" type="button" @click="addDialogOpen = false">取消</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="!selectedAssetId" @click="addMonitorTarget">
          添加监控
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.monitor-page {
  display: grid;
  gap: var(--gc-space-4);
}

.monitor-page__message {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 13px;
  font-weight: 750;
}

.monitor-page__workspace {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: var(--gc-space-4);
  align-items: start;
}

.monitor-page__targets,
.monitor-page__summary,
.monitor-page__panel {
  padding: 16px;
}

.monitor-page__targets {
  display: grid;
  gap: 10px;
}

.monitor-page__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.monitor-page__section-head > div {
  display: grid;
  gap: 3px;
}

.monitor-page__section-head strong {
  color: #0f172a;
  font-size: 15px;
}

.monitor-page__section-head span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.monitor-page__target {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.monitor-page__target.is-active {
  border-color: #2563eb;
  background: #eff6ff;
}

.monitor-page__target div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.monitor-page__target strong,
.monitor-page__target span {
  overflow-wrap: anywhere;
}

.monitor-page__target span {
  color: #64748b;
  font-size: 12px;
}

.monitor-page__target small {
  color: #475569;
  font-size: 11px;
  font-weight: 750;
}

.monitor-page__probe-blocks {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 4px;
  width: 100%;
  max-width: 170px;
  margin-top: 4px;
}

.monitor-page__probe-blocks i {
  display: block;
  aspect-ratio: 1;
  border-radius: 4px;
  background: #e2e8f0;
}

.monitor-page__probe-blocks i[data-status='READY'] {
  background: #22c55e;
}

.monitor-page__probe-blocks i[data-status='WARNING'] {
  background: #f59e0b;
}

.monitor-page__probe-blocks i[data-status='ERROR'] {
  background: #ef4444;
}

.monitor-page__target-status {
  flex: 0 0 auto;
  min-width: 54px;
  border-radius: 999px;
  padding: 4px 10px;
  text-align: center;
  font-size: 12px;
  font-weight: 850;
}

.monitor-page__target-status[data-status='READY'] {
  background: #dcfce7;
  color: #15803d;
}

.monitor-page__target-status[data-status='WARNING'] {
  background: #fef3c7;
  color: #b45309;
}

.monitor-page__target-status[data-status='ERROR'] {
  background: #fee2e2;
  color: #b91c1c;
}

.monitor-page__target-status[data-status='NONE'] {
  background: #e0f2fe;
  color: #64748b;
}

.monitor-page__dialog-form {
  display: grid;
  gap: 12px;
}

.monitor-page__dialog-form label {
  display: grid;
  gap: 8px;
  color: #64748b;
  font-size: 12px;
  font-weight: 850;
}

.monitor-page__dialog-form select,
.monitor-page__dialog-form input {
  min-height: 40px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: #fff;
  color: var(--gc-color-text);
}

.monitor-page__dialog-number {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.monitor-page__dialog-number input {
  width: 120px;
}

.monitor-page__dialog-number b {
  color: #64748b;
}

.monitor-page__dialog-form p {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  font-weight: 700;
}

.monitor-page__detail {
  display: grid;
  gap: var(--gc-space-4);
}

.monitor-page__summary {
  display: grid;
  gap: 16px;
}

.monitor-page__summary-title {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.monitor-page__summary-title span,
.monitor-page__summary-title p {
  color: #64748b;
  font-size: 12px;
  font-weight: 750;
}

.monitor-page__summary-title h2,
.monitor-page__summary-title p {
  margin: 0;
}

.monitor-page__summary-title h2 {
  color: #0f172a;
  font-size: 24px;
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.monitor-page__target-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.monitor-page__target-interval {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid #d9e2ef;
  border-radius: 8px;
  background: #f8fafc;
  color: #334155;
  font-size: 13px;
  font-weight: 800;
}

.monitor-page__target-interval input {
  width: 76px;
  border: 1px solid #d9e2ef;
  border-radius: 6px;
  padding: 5px 8px;
  color: #0f172a;
  font: inherit;
}

.monitor-page__target-interval b {
  color: #64748b;
}

.monitor-page__kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.monitor-page__kpi-grid article {
  display: grid;
  gap: 6px;
  min-height: 78px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 12px;
  background: #f8fafc;
}

.monitor-page__kpi-grid span {
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
}

.monitor-page__kpi-grid strong {
  color: #0f172a;
  font-size: 18px;
  overflow-wrap: anywhere;
}

.monitor-page__panels {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.monitor-page__panel {
  display: grid;
  gap: 12px;
  align-content: start;
}

.monitor-page__panel--wide {
  grid-column: 1 / -1;
}

.monitor-page__empty-line {
  color: #64748b;
  font-size: 13px;
  font-weight: 700;
}

.monitor-page__risk-list {
  display: grid;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.monitor-page__certificate-detail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.monitor-page__certificate-detail div {
  display: grid;
  gap: 5px;
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.monitor-page__certificate-detail dt {
  color: #64748b;
  font-size: 12px;
  font-weight: 850;
}

.monitor-page__certificate-detail dd {
  margin: 0;
  color: #0f172a;
  font-size: 12px;
  font-weight: 750;
  overflow-wrap: anywhere;
}

.monitor-page__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.monitor-page__table th,
.monitor-page__table td {
  border-bottom: 1px solid #e2e8f0;
  padding: 9px 8px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.monitor-page__table th {
  color: #64748b;
  font-weight: 850;
}

.monitor-page__risk-list li {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px;
  background: #fff;
}

.monitor-page__risk-list li div {
  display: grid;
  gap: 4px;
}

.monitor-page__risk-list li span {
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
}

@media (max-width: 1080px) {
  .monitor-page__workspace,
  .monitor-page__panels {
    grid-template-columns: 1fr;
  }

  .monitor-page__kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .monitor-page__summary-title,
  .monitor-page__section-head,
  .monitor-page__risk-list li {
    align-items: stretch;
    flex-direction: column;
  }

  .monitor-page__target-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .monitor-page__target-interval {
    justify-content: space-between;
  }

  .monitor-page__kpi-grid {
    grid-template-columns: 1fr;
  }

  .monitor-page__certificate-detail {
    grid-template-columns: 1fr;
  }
}
</style>
