<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { listAssets } from '@/api/modules/assets.api'
import {
  createMonitorTarget,
  deleteMonitorTarget,
  listMonitorProbeResults,
  listMonitorTargets,
  listRiskEvents,
  probeMonitorServiceAsset,
  scanMonitorRisks,
  updateMonitorTarget,
} from '@/api/modules/monitors.api'
import {
  createTlsInspectorTarget,
  listTlsInspectorTargets,
  runTlsInspection,
  type TlsInspectorTargetRecord,
} from '@/api/modules/tls-inspector.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcEmptyState, GcModal, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

type MonitorMetric = 'availability' | 'latency' | 'certificate' | 'certificateHistory'
type ProbeStatus = 'READY' | 'WARNING' | 'ERROR'
type RecordLike = Record<string, unknown>

interface MonitorTarget {
  readonly id: string
  readonly assetId: string
  readonly metrics: MonitorMetric[]
  readonly intervalSeconds: number
  readonly createdAt: string
}

interface ProbeResult {
  readonly status: ProbeStatus
  readonly latencyMs?: number
  readonly checkedAt?: string
  readonly message?: string
}

const storageKey = 'gcac.monitor.targets.v1'
const historyStorageKey = 'gcac.monitor.probe-history.v1'
const { t } = useI18n()

const assets = ref<ApiRecord[]>([])
const risks = ref<ApiRecord[]>([])
const monitorTargets = ref<MonitorTarget[]>([])
const probeResults = ref<Record<string, ProbeResult>>({})
const probeHistory = ref<Record<string, ProbeResult[]>>({})
const tlsTargets = ref<TlsInspectorTargetRecord[]>([])
const selectedAssetId = ref('')
const selectedIntervalSeconds = ref(60)
const loading = ref(false)
const probing = ref(false)
const addDialogOpen = ref(false)
const error = ref('')
const tlsInspectorAvailable = ref(true)
const activeProbeIds = new Set<string>()
let refreshTimer: ReturnType<typeof setInterval> | undefined

const defaultMetrics: MonitorMetric[] = ['availability', 'latency', 'certificate', 'certificateHistory']

const assetOptions = computed(() =>
  assets.value.filter((asset) => !monitorTargets.value.some((target) => target.assetId === readId(asset))),
)

const monitorRows = computed(() =>
  monitorTargets.value.map((target) => {
    const asset = assetById(target.assetId)
    const assetRisks = risksForAsset(target.assetId)
    const probe = probeResults.value[target.assetId]
    const tlsTarget = tlsTargets.value.find((item) => item.serviceAssetId === target.assetId)
    return {
      target,
      title: assetLabel(asset),
      endpoint: endpointLabel(asset),
      probe,
      tlsTarget,
      riskCount: assetRisks.length,
      highRiskCount: assetRisks.filter((risk) => ['HIGH', 'CRITICAL'].includes(readString(risk, ['risk', 'severity']).toUpperCase())).length,
      status: statusFromProbeAndRisks(probe, assetRisks),
      risks: assetRisks,
    }
  }),
)

onMounted(() => {
  clearStoredMonitorState()
  void refreshAll()
  refreshTimer = setInterval(() => {
    if (!loading.value && !probing.value) void refreshAll({ silent: true })
  }, 10_000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = undefined
})

async function refreshAll(options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true
  error.value = ''
  try {
    const [targetResult, probeResult, assetResult, riskResult, tlsResult] = await Promise.all([
      listMonitorTargets({ page: 1, pageSize: 200, sort: 'createdAt:desc' }),
      listMonitorProbeResults({ page: 1, pageSize: 200 }),
      listAssets({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listRiskEvents({ page: 1, pageSize: 200, sort: 'lastDetectedAt:desc' }),
      listTlsInspectorTargets({ page: 1, pageSize: 200 }).catch(() => null),
    ])
    monitorTargets.value = (targetResult.data?.items ?? [])
      .map(normalizeMonitorTarget)
      .filter((item): item is MonitorTarget => Boolean(item))
    assets.value = [...(assetResult.data?.items ?? [])]
    risks.value = [...(riskResult.data?.items ?? [])]
    probeHistory.value = groupProbeResults(probeResult.data?.items ?? [])
    probeResults.value = latestProbeResults(probeHistory.value)
    tlsTargets.value = tlsResult?.data?.items ?? []
    tlsInspectorAvailable.value = Boolean(tlsResult)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.loadFailed')
  } finally {
    if (!options.silent) loading.value = false
  }
}

function openAddDialog() {
  selectedAssetId.value = assetOptions.value[0] ? readId(assetOptions.value[0]) : ''
  selectedIntervalSeconds.value = 60
  addDialogOpen.value = true
}

async function addMonitorTarget() {
  if (!selectedAssetId.value) return
  error.value = ''
  try {
    const result = await createMonitorTarget({
      serviceAssetId: selectedAssetId.value,
      metrics: [...defaultMetrics],
      intervalSeconds: normalizeInterval(selectedIntervalSeconds.value),
    })
    const target = normalizeMonitorTarget(result.data)
    if (!target) throw new Error(t('monitoring.errors.invalidTarget'))
    monitorTargets.value = [target, ...monitorTargets.value]
    addDialogOpen.value = false
    void probeAndInspectTarget(target)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.addFailed')
  }
}

async function ensureTlsTarget(target: MonitorTarget) {
  const existing = tlsTargets.value.find((item) => item.serviceAssetId === target.assetId)
  if (existing) return existing
  const asset = assetById(target.assetId)
  const parsed = parseEndpoint(endpointLabel(asset))
  try {
    const result = await createTlsInspectorTarget({
      serviceAssetId: target.assetId,
      host: parsed.host,
      port: parsed.port,
      serverName: parsed.serverName,
      intervalSeconds: target.intervalSeconds,
    })
    if (result.data) {
      tlsTargets.value = [result.data, ...tlsTargets.value]
      tlsInspectorAvailable.value = true
      return result.data
    }
  } catch {
    tlsInspectorAvailable.value = false
    return null
  }
  return null
}

async function removeMonitorTarget(target: MonitorTarget) {
  error.value = ''
  try {
    await deleteMonitorTarget(target.id)
    monitorTargets.value = monitorTargets.value.filter((item) => item.id !== target.id)
    const tlsTarget = tlsTargets.value.find((item) => item.serviceAssetId === target.assetId)
    if (tlsTarget) {
      await fetchTlsTargetDelete(tlsTarget.id)
      tlsTargets.value = tlsTargets.value.filter((item) => item.id !== tlsTarget.id)
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.deleteFailed')
  }
}

async function fetchTlsTargetDelete(targetId: string) {
  try {
    await import('@/api/modules/tls-inspector.api').then(({ deleteTlsInspectorTarget }) => deleteTlsInspectorTarget(targetId))
  } catch {
    // 中文说明：独立服务删除失败不回滚已完成的轻量监控删除。
  }
}

async function updateTargetInterval(target: MonitorTarget, event: Event) {
  const input = event.target as HTMLInputElement
  const intervalSeconds = normalizeInterval(input.valueAsNumber)
  try {
    const result = await updateMonitorTarget(target.id, { intervalSeconds })
    const updated = normalizeMonitorTarget(result.data) ?? { ...target, intervalSeconds }
    monitorTargets.value = monitorTargets.value.map((item) => item.id === target.id ? updated : item)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.updateIntervalFailed')
  }
}

async function probeTarget(target: MonitorTarget) {
  if (activeProbeIds.has(target.id)) return
  activeProbeIds.add(target.id)
  probing.value = true
  try {
    const result = await probeMonitorServiceAsset({
      monitorTargetId: target.id,
      serviceAssetId: target.assetId,
      timeoutMs: 10_000,
    })
    const probe = normalizeProbeResult(result.data)
    if (probe) {
      probeResults.value = { ...probeResults.value, [target.assetId]: probe }
      probeHistory.value = {
        ...probeHistory.value,
        [target.assetId]: [probe, ...(probeHistory.value[target.assetId] ?? [])].slice(0, 20),
      }
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.probeFailed')
  } finally {
    activeProbeIds.delete(target.id)
    probing.value = activeProbeIds.size > 0
  }
}

async function inspectTarget(target: MonitorTarget) {
  const tlsTarget = await ensureTlsTarget(target)
  if (!tlsTarget) {
    error.value = t('monitoring.tls.messages.inspectorUnavailable')
    return
  }
  try {
    const result = await runTlsInspection(tlsTarget.id)
    if (!result.data) {
      error.value = t('monitoring.tls.messages.scanFailed')
      return
    }
    const inspection = result.data
    tlsInspectorAvailable.value = true
    tlsTargets.value = tlsTargets.value.map((item) =>
      item.id === tlsTarget.id
        ? {
            ...item,
            latestSummary: inspection.summary,
            latestSnapshotId: inspection.id,
            latestStatus: inspection.status,
            lastInspectedAt: inspection.finishedAt,
          }
        : item,
    )
  } catch (cause) {
    tlsInspectorAvailable.value = false
    error.value = cause instanceof Error ? cause.message : t('monitoring.tls.messages.scanFailed')
  }
}

async function probeAndInspectTarget(target: MonitorTarget) {
  await probeTarget(target)
  await inspectTarget(target)
}

async function probeAllTargets() {
  probing.value = true
  try {
    for (const target of monitorTargets.value) {
      await probeAndInspectTarget(target)
    }
    await refreshAll({ silent: true })
  } finally {
    probing.value = false
  }
}

function clearStoredMonitorState() {
  localStorage.removeItem(storageKey)
  localStorage.removeItem(historyStorageKey)
}

function assetById(assetId: string) {
  return assets.value.find((item) => readId(item) === assetId) ?? null
}

function risksForAsset(assetId: string) {
  return risks.value.filter((risk) => readString(risk, ['serviceAssetId', 'assetId']) === assetId)
}

function normalizeMonitorTarget(record: ApiRecord | null | undefined): MonitorTarget | null {
  if (!record) return null
  const id = readId(record)
  const assetId = readString(record, ['serviceAssetId', 'assetId'])
  if (!id || !assetId) return null
  return {
    id,
    assetId,
    metrics: Array.isArray(record.metrics) ? record.metrics.filter((item): item is MonitorMetric => typeof item === 'string') : defaultMetrics,
    intervalSeconds: normalizeInterval(Number(record.intervalSeconds ?? 60)),
    createdAt: readString(record, ['createdAt', 'updatedAt']),
  }
}

function normalizeProbeResult(record: ApiRecord | null | undefined): ProbeResult | null {
  if (!record) return null
  return {
    status: readString(record, ['status'], 'ERROR').toUpperCase() as ProbeStatus,
    latencyMs: typeof record.latencyMs === 'number' ? record.latencyMs : undefined,
    checkedAt: readString(record, ['checkedAt', 'checkedAtIso', 'createdAt']),
    message: readString(record, ['message', 'summary']),
  }
}

function groupProbeResults(records: readonly ApiRecord[]) {
  return records.reduce<Record<string, ProbeResult[]>>((result, record) => {
    const assetId = readString(record, ['serviceAssetId', 'assetId'])
    const probe = normalizeProbeResult(record)
    if (!assetId || !probe) return result
    result[assetId] = [...(result[assetId] ?? []), probe]
    return result
  }, {})
}

function latestProbeResults(history: Record<string, ProbeResult[]>) {
  return Object.fromEntries(Object.entries(history).map(([assetId, items]) => [assetId, items[0]]))
}

function statusFromProbeAndRisks(probe: ProbeResult | undefined, assetRisks: readonly ApiRecord[]) {
  if (probe?.status === 'ERROR') return 'ERROR'
  if (assetRisks.length || probe?.status === 'WARNING') return 'WARNING'
  return probe?.status ?? 'NONE'
}

function normalizeInterval(value: number) {
  if (!Number.isFinite(value)) return 60
  return Math.min(86_400, Math.max(60, Math.round(value)))
}

function readId(record: ApiRecord | RecordLike | null | undefined) {
  return readString(record, ['id'])
}

function readString(record: ApiRecord | RecordLike | null | undefined, keys: readonly string[], fallback = ''): string {
  if (!record) return fallback
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
  }
  return fallback
}

function assetLabel(record: ApiRecord | null) {
  return readString(record, ['displayName', 'name', 'address', 'host'], t('monitoring.fallback.unknownAsset'))
}

function endpointLabel(record: ApiRecord | null) {
  return readString(record, ['address', 'endpoint', 'url', 'host', 'hostname'], t('monitoring.fallback.noEndpoint'))
}

function parseEndpoint(value: string) {
  const source = value.includes('://') ? value : `https://${value}`
  try {
    const url = new URL(source)
    return { host: url.hostname, port: Number(url.port || 443), serverName: url.hostname }
  } catch {
    return { host: value, port: 443, serverName: value }
  }
}
</script>

<template>
  <section class="monitor-page">
    <header class="monitor-page__header">
      <div>
        <p class="monitor-page__eyebrow">{{ t('nav.monitorTls') }}</p>
        <h1>{{ t('nav.monitorTls') }}</h1>
        <p>{{ t('nav.monitorTlsDesc') }}</p>
      </div>
      <div class="monitor-page__actions">
        <button type="button" :disabled="loading || probing" @click="probeAllTargets">
          {{ probing ? t('monitoring.actions.probing') : t('monitoring.actions.probe') }}
        </button>
        <button type="button" :disabled="loading" @click="refreshAll()">{{ t('monitoring.actions.refresh') }}</button>
        <button class="monitor-page__primary" type="button" :disabled="!assetOptions.length" @click="openAddDialog">{{ t('monitoring.actions.add') }}</button>
      </div>
    </header>

    <GcEmptyState v-if="error" :title="t('monitoring.errors.loadFailed')" :description="error" />
    <GcEmptyState
      v-else-if="!loading && !monitorRows.length"
      :title="t('monitoring.empty.title')"
      :description="t('monitoring.empty.description')"
    />
    <div v-else class="monitor-page__list">
      <article v-for="row in monitorRows" :key="row.target.id" class="monitor-page__row">
        <div class="monitor-page__row-main">
          <div class="monitor-page__row-title">
            <div>
              <h2>{{ row.title }}</h2>
              <p>{{ row.endpoint }}</p>
            </div>
            <GcStatusTag :status="row.status" />
          </div>
          <div class="monitor-page__summary">
            <span>{{ t('monitoring.labels.probeInterval') }}: {{ row.target.intervalSeconds }}s</span>
            <span>{{ row.probe?.latencyMs ?? t('monitoring.probe.latencyNotCollected') }}{{ typeof row.probe?.latencyMs === 'number' ? ' ms' : '' }}</span>
            <span>{{ row.probe?.checkedAt ? formatMaybeLocalTime(row.probe.checkedAt) : t('monitoring.probe.waiting') }}</span>
          </div>
        </div>
        <div class="monitor-page__deep-summary">
          <template v-if="row.tlsTarget?.latestSummary">
            <span :data-risk="row.tlsTarget.latestSummary.legacyProtocolEnabled ? 'danger' : 'ok'">
              {{ t('monitoring.tls.labels.legacyProtocol') }}: {{ row.tlsTarget.latestSummary.legacyProtocolEnabled ? t('monitoring.tls.values.yes') : t('monitoring.tls.values.no') }}
            </span>
            <span :data-risk="row.tlsTarget.latestSummary.weakCipherDetected ? 'danger' : 'ok'">
              {{ t('monitoring.tls.labels.weakCipher') }}: {{ row.tlsTarget.latestSummary.weakCipherDetected ? t('monitoring.tls.values.yes') : t('monitoring.tls.values.no') }}
            </span>
            <span>{{ t('monitoring.tls.labels.trustPathIssues') }}: {{ row.tlsTarget.latestSummary.trustPathIssueCount ?? 0 }}</span>
          </template>
          <span v-else-if="!tlsInspectorAvailable">{{ t('monitoring.tls.states.unavailable') }}</span>
          <span v-else>{{ t('monitoring.tls.states.notInitialized') }}</span>
        </div>
        <div class="monitor-page__row-actions">
          <RouterLink class="monitor-page__tls-link" :to="{ name: 'monitor.tls.detail', params: { id: row.target.id } }">
            {{ t('monitoring.tls.actions.openDetail') }}
          </RouterLink>
          <button type="button" :disabled="activeProbeIds.has(row.target.id)" @click="probeAndInspectTarget(row.target)">
            {{ activeProbeIds.has(row.target.id) ? t('monitoring.actions.probing') : t('monitoring.actions.probe') }}
          </button>
          <label>
            {{ t('monitoring.labels.probeInterval') }}
            <input type="number" min="60" max="86400" :value="row.target.intervalSeconds" @change="updateTargetInterval(row.target, $event)">
          </label>
          <button type="button" @click="removeMonitorTarget(row.target)">{{ t('monitoring.actions.remove') }}</button>
        </div>
        <div v-if="row.risks.length" class="monitor-page__risks">
          <RouterLink
            v-for="risk in row.risks"
            :key="readId(risk)"
            class="monitor-page__risk-link"
            :to="readString(risk, ['certificateId']) ? `/certificates?certificateId=${encodeURIComponent(readString(risk, ['certificateId']))}` : '/monitors'"
          >
            {{ readString(risk, ['title', 'summary'], t('monitoring.fallback.unnamedEvent')) }}
          </RouterLink>
        </div>
      </article>
    </div>

    <GcModal v-model:open="addDialogOpen" :title="t('monitoring.dialog.title')">
      <div class="monitor-page__dialog">
        <p>{{ t('monitoring.dialog.description') }}</p>
        <label>
          {{ t('monitoring.dialog.selectAsset') }}
          <select v-model="selectedAssetId">
            <option value="" disabled>{{ t('monitoring.dialog.selectAsset') }}</option>
            <option v-for="asset in assetOptions" :key="readId(asset)" :value="readId(asset)">{{ assetLabel(asset) }}</option>
          </select>
        </label>
        <label>
          {{ t('monitoring.labels.probeInterval') }}
          <input v-model.number="selectedIntervalSeconds" type="number" min="60" max="86400">
        </label>
        <div class="monitor-page__dialog-actions">
          <button type="button" @click="addDialogOpen = false">{{ t('common.cancel') }}</button>
          <button class="monitor-page__primary" type="button" :disabled="!selectedAssetId" @click="addMonitorTarget">{{ t('common.save') }}</button>
        </div>
      </div>
    </GcModal>
  </section>
</template>

<style scoped>
.monitor-page {
  display: grid;
  gap: var(--gc-space-6);
  padding: var(--gc-space-6);
}

.monitor-page__header,
.monitor-page__row-title,
.monitor-page__row-actions,
.monitor-page__dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
}

.monitor-page__header {
  align-items: flex-start;
}

.monitor-page__eyebrow {
  margin: 0;
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.monitor-page h1,
.monitor-page h2,
.monitor-page p {
  margin: 0;
}

.monitor-page h1 {
  margin-top: var(--gc-space-2);
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xl);
}

.monitor-page h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.monitor-page p,
.monitor-page__summary,
.monitor-page__deep-summary,
.monitor-page__row-actions label {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.monitor-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
}

.monitor-page button,
.monitor-page select,
.monitor-page input {
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-field);
  color: var(--gc-color-text);
}

.monitor-page button {
  cursor: pointer;
}

.monitor-page button:disabled {
  opacity: var(--gc-opacity-disabled);
  cursor: not-allowed;
}

.monitor-page__primary {
  border-color: var(--gc-color-primary);
  background: var(--gc-gradient-primary) !important;
  color: var(--gc-color-text-inverse) !important;
}

.monitor-page__list {
  display: grid;
  gap: var(--gc-space-4);
}

.monitor-page__row {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-gradient-surface);
}

.monitor-page__row-title {
  justify-content: flex-start;
}

.monitor-page__row-title .gc-status-tag {
  margin-left: auto;
}

.monitor-page__summary,
.monitor-page__deep-summary,
.monitor-page__risks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-3);
}

.monitor-page__deep-summary span {
  padding: var(--gc-space-1) var(--gc-space-2);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-soft);
}

.monitor-page__deep-summary span[data-risk='danger'] {
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
}

.monitor-page__deep-summary span[data-risk='ok'] {
  background: var(--gc-color-success-soft);
  color: var(--gc-color-success);
}

.monitor-page__tls-link,
.monitor-page__risk-link {
  color: var(--gc-color-primary);
  text-decoration: none;
}

.monitor-page__risk-link {
  padding: var(--gc-space-1) var(--gc-space-2);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-warning-soft);
}

.monitor-page__row-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
}

.monitor-page__row-actions label {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
}

.monitor-page__row-actions input {
  width: calc(var(--gc-space-8) * 2);
}

.monitor-page__dialog {
  display: grid;
  gap: var(--gc-space-4);
}

.monitor-page__dialog label {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.monitor-page__dialog select,
.monitor-page__dialog input {
  width: 100%;
}

.monitor-page__dialog-actions {
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .monitor-page {
    padding: var(--gc-space-4);
  }

  .monitor-page__header,
  .monitor-page__row-title {
    align-items: stretch;
    flex-direction: column;
  }

  .monitor-page__row-title .gc-status-tag {
    margin-left: 0;
  }
}
</style>
