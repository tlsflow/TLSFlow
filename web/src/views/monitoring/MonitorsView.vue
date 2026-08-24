<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { listAssets } from '@/api/modules/assets.api'
import { listBindings } from '@/api/modules/bindings.api'
import { listCertificates, listCertificateVersions } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  createMonitorTarget,
  deleteMonitorTarget,
  listMonitorCertificateObservations,
  listMonitorProbeResults,
  listMonitorTargets,
  listRiskEvents,
  probeMonitorServiceAsset,
  scanMonitorRisks,
  updateMonitorTarget,
} from '@/api/modules/monitors.api'
import {
  getLatestTlsInspection,
  listTlsInspectorTargets,
  type TlsInspectionSnapshot,
  type TlsInspectorTargetRecord,
} from '@/api/modules/tls-inspector.api'
import { GcEmptyState, GcModal, GcStatusTag } from '@/design-system/components'
import MonitorTlsDetailView from './MonitorTlsDetailView.vue'
import { computeTlsInspectionRating, tlsRatingTone } from './monitor-tls-scoring'

type MonitorMetric = 'availability' | 'latency' | 'certificate' | 'certificateHistory'
type ProbeStatus = 'READY' | 'WARNING' | 'ERROR'
type TargetStatus = ProbeStatus | 'NONE'
type MonitorWarningReason = 'certificateNotApplied' | 'chainVerificationFailed'

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
  readonly chain?: ReadonlyArray<{
    readonly fingerprintSha256: string
    readonly subject?: string
    readonly issuer?: string
    readonly serialNumber?: string
    readonly notBefore?: string
    readonly notAfter?: string
    readonly isCa?: boolean
  }>
  readonly chainStatus?: 'valid' | 'incomplete' | 'invalid' | 'untrusted'
}

const storageKey = 'gcac.monitor.targets.v1'
const historyStorageKey = 'gcac.monitor.probe-history.v1'

const assets = ref<ApiRecord[]>([])
const risks = ref<ApiRecord[]>([])
const bindings = ref<ApiRecord[]>([])
const certificateAssets = ref<ApiRecord[]>([])
const certificateVersions = ref<ApiRecord[]>([])
const tlsInspectorTargets = ref<TlsInspectorTargetRecord[]>([])
const tlsInspectionsByTargetId = ref<Record<string, TlsInspectionSnapshot>>({})
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
const tlsDialogOpen = ref(false)
const tlsDialogTargetId = ref('')
const error = ref('')
const activeProbeIds = new Set<string>()
let refreshTimer: ReturnType<typeof setInterval> | undefined
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const shouldTeleportActions = ref(false)

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

const selectedTlsInspectorTarget = computed(() =>
  selectedTarget.value ? findTlsInspectorTarget(selectedTarget.value.assetId) : null,
)

const selectedTlsRating = computed(() => computeTlsInspectionRating(
  selectedTlsInspectorTarget.value ? tlsInspectionsByTargetId.value[selectedTlsInspectorTarget.value.id] : null,
))

const selectedTlsRatingTone = computed(() => tlsRatingTone(selectedTlsRating.value))

const monitorRows = computed(() =>
  monitorTargets.value.map((target) => {
    const asset = assetById(target.assetId)
    const assetRisks = risksForAsset(target.assetId)
    const probe = probeResults.value[target.assetId]
    const warningReasons = monitorWarningReasons(target.assetId, latestCertificateObservation(target.assetId))
    const status = statusFromProbeAndRisks(probe, assetRisks, warningReasons)
    const tlsInspectorTarget = findTlsInspectorTarget(target.assetId)
    const tlsRating = computeTlsInspectionRating(
      tlsInspectorTarget ? tlsInspectionsByTargetId.value[tlsInspectorTarget.id] : null,
    )
    return {
      target,
      title: assetLabel(asset),
      endpoint: endpointLabel(asset),
      status,
      statusLabel: probeStatusLabel(status),
      warningSummary: warningSummary(warningReasons),
      recentResults: recentProbeResults(target.assetId),
      tlsRating,
      tlsRatingTone: tlsRatingTone(tlsRating),
    }
  }),
)

onMounted(() => {
  shouldTeleportActions.value = Boolean(document.querySelector('#gc-shell-hero-actions'))
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

watch(
  () => [route.query.tlsModal, route.query.tlsTargetId],
  () => syncTlsDialogFromRoute(),
)

watch(tlsDialogOpen, (open) => {
  if (!open) void clearTlsDialogQuery()
})

async function refreshAll(options: { scanRisks?: boolean; silent?: boolean } = {}) {
  if (!options.silent) loading.value = true
  error.value = ''
  try {
    if (options.scanRisks) await scanMonitorRisks()
    const [targetResult, probeResult, assetResult, riskResult, bindingResult, certificateAssetResult, certificateVersionResult, tlsInspectorResult] = await Promise.all([
      listMonitorTargets({ page: 1, pageSize: 200, sort: 'createdAt:desc' }),
      listMonitorProbeResults({ page: 1, pageSize: 200 }),
      listAssets({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listRiskEvents({ page: 1, pageSize: 200, sort: 'lastDetectedAt:desc' }),
      listBindings({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listCertificates({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
      listCertificateVersions({ page: 1, pageSize: 200, sort: 'createdAt:desc' }),
      listTlsInspectorTargets({ page: 1, pageSize: 200 }).catch(() => null),
    ])
    monitorTargets.value = (targetResult.data?.items ?? [])
      .map(normalizeMonitorTargetRecord)
      .filter((target): target is MonitorTarget => Boolean(target))
    probeHistory.value = groupProbeResults(probeResult.data?.items ?? [])
    probeResults.value = latestProbeResultsFromHistory(probeHistory.value)
    trimProbeStateToTargets()
    assets.value = [...(assetResult.data?.items ?? [])]
    risks.value = [...(riskResult.data?.items ?? [])]
    bindings.value = [...(bindingResult.data?.items ?? [])]
    certificateAssets.value = [...(certificateAssetResult.data?.items ?? [])]
    certificateVersions.value = [...(certificateVersionResult.data?.items ?? [])]
    if (tlsInspectorResult) {
      tlsInspectorTargets.value = [...(tlsInspectorResult.data?.items ?? [])]
      await refreshTlsInspectionRatings(tlsInspectorTargets.value)
    }
    await refreshCertificateObservations()
    if (!monitorTargets.value.some((target) => target.id === selectedTargetId.value)) {
      selectedTargetId.value = monitorTargets.value[0]?.id ?? ''
    }
    syncTlsDialogFromRoute()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.loadFailed')
  } finally {
    if (!options.silent) loading.value = false
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
    if (!target) throw new Error(t('monitoring.errors.invalidTarget'))
    monitorTargets.value = [target, ...monitorTargets.value.filter((item) => item.id !== target.id)]
    selectedTargetId.value = target.id
    selectedAssetId.value = ''
    addDialogOpen.value = false
    void probeTarget(target)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.addFailed')
  }
}

function openAddDialog() {
  selectedAssetId.value = assetOptions.value[0] ? readId(assetOptions.value[0]) : ''
  selectedIntervalSeconds.value = 60
  addDialogOpen.value = true
}

async function openTlsDialog(targetId = selectedTarget.value?.id ?? '') {
  if (!targetId) return
  selectedTargetId.value = targetId
  tlsDialogTargetId.value = targetId
  tlsDialogOpen.value = true
  await router.replace({
    query: {
      ...route.query,
      tlsModal: '1',
      tlsTargetId: targetId,
    },
  })
}

function syncTlsDialogFromRoute() {
  if (readQueryValue(route.query.tlsModal) !== '1') {
    tlsDialogOpen.value = false
    return
  }

  const requestedTargetId = readQueryValue(route.query.tlsTargetId)
  const targetId = monitorTargets.value.some((target) => target.id === requestedTargetId)
    ? requestedTargetId
    : selectedTarget.value?.id ?? monitorTargets.value[0]?.id ?? ''
  if (!targetId) return

  selectedTargetId.value = targetId
  tlsDialogTargetId.value = targetId
  tlsDialogOpen.value = true
}

async function clearTlsDialogQuery() {
  if (!route.query.tlsModal && !route.query.tlsTargetId) return
  const query = { ...route.query }
  delete query.tlsModal
  delete query.tlsTargetId
  await router.replace({ query })
}

async function removeMonitorTarget(targetId: string) {
  const target = monitorTargets.value.find((item) => item.id === targetId)
  if (!target) return
  error.value = ''
  try {
    await deleteMonitorTarget(targetId)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.deleteFailed')
    return
  }
  monitorTargets.value = monitorTargets.value.filter((item) => item.id !== targetId)
  if (target?.assetId) {
    const nextProbeResults = { ...probeResults.value }
    delete nextProbeResults[target.assetId]
    probeResults.value = nextProbeResults
  }
  selectedTargetId.value = monitorTargets.value[0]?.id ?? ''
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
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('monitoring.errors.updateIntervalFailed')
  }
}

async function probeAllTargets(options: { silent?: boolean } = {}) {
  probing.value = true
  try {
    for (const target of monitorTargets.value) {
      await probeTarget(target)
    }
    await refreshAll({ scanRisks: true })
  } finally {
    probing.value = false
  }
}

async function probeTarget(target: MonitorTarget) {
  if (activeProbeIds.has(target.id)) return
  activeProbeIds.add(target.id)
  try {
    const result = await probeMonitorServiceAsset({
      monitorTargetId: target.id,
      serviceAssetId: target.assetId,
      timeoutMs: 10000,
    })
    const data = result.data ?? {}
    saveProbeResult(target.assetId, {
      status: readString(data, ['status'], 'WARNING') as ProbeStatus,
      latencyMs: readNumber(data.latencyMs),
      checkedAt: Date.parse(readString(data, ['checkedAt'], '')) || Date.now(),
      message: readString(data, ['message'], t('monitoring.probe.completed')),
      source: readString(data, ['source'], ''),
      httpStatus: readNumber(data.httpStatus),
      certificate: readObject(data.certificate),
    })
    await refreshProbeResults(target.assetId)
    await refreshCertificateObservations(target.assetId)
  } catch (cause) {
    saveProbeResult(target.assetId, {
      status: 'ERROR',
      checkedAt: Date.now(),
      message: cause instanceof Error ? cause.message : t('monitoring.errors.probeFailed'),
    })
  } finally {
    activeProbeIds.delete(target.id)
  }
}

async function refreshCertificateObservations(assetId?: string) {
  const result = await listMonitorCertificateObservations({
    page: 1,
    pageSize: 200,
    filters: assetId ? { serviceAssetId: assetId } : undefined,
  })
  const grouped = groupCertificateObservations(result.data?.items ?? [])
  certificateObservations.value = assetId
    ? { ...certificateObservations.value, [assetId]: grouped[assetId] ?? [] }
    : grouped
}

async function refreshProbeResults(assetId?: string) {
  const result = await listMonitorProbeResults({
    page: 1,
    pageSize: 200,
    filters: assetId ? { serviceAssetId: assetId } : undefined,
  })
  const grouped = groupProbeResults(result.data?.items ?? [])
  probeHistory.value = assetId
    ? { ...probeHistory.value, [assetId]: grouped[assetId] ?? [] }
    : grouped
  probeResults.value = latestProbeResultsFromHistory(probeHistory.value)
}

function saveProbeResult(assetId: string, result: ProbeResult) {
  probeResults.value = { ...probeResults.value, [assetId]: result }
  const history = [result, ...(probeHistory.value[assetId] ?? [])].slice(0, 20)
  probeHistory.value = { ...probeHistory.value, [assetId]: history }
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
  return certificate.subject || certificate.dnsNames?.[0] || t('monitoring.fallback.unknownCertificate')
}

function observedCertificateIssuer(certificate: CertificateObservation): string {
  return certificate.issuer || t('monitoring.fallback.unknownIssuer')
}

function observedCertificateExpiresAt(certificate: CertificateObservation): string {
  return formatLocalDateText(certificate.notAfter ?? '')
}

function observedCertificateChangedAt(certificate: CertificateObservation): string {
  return formatLocalTime(certificate.checkedAt)
}

function statusFromProbeAndRisks(
  probe: ProbeResult | undefined,
  assetRisks: ApiRecord[],
  warningReasons: readonly MonitorWarningReason[],
): TargetStatus {
  if (probe?.status === 'ERROR') return 'ERROR'
  if (warningReasons.length > 0) return 'WARNING'
  if (assetRisks.some(isActiveRisk)) return 'WARNING'
  return probe?.status ?? 'NONE'
}

function isActiveRisk(risk: ApiRecord): boolean {
  return ['OPEN', 'ACKED'].includes(readString(risk, ['status'], '').toUpperCase())
}

function monitorWarningReasons(assetId: string, observedCertificate: CertificateObservation | null): MonitorWarningReason[] {
  if (!observedCertificate) return []
  const reasons: MonitorWarningReason[] = []
  const latestFingerprints = latestCertificateFingerprintsForAsset(assetId)
  if (
    latestFingerprints.length > 0
    && !latestFingerprints.includes(normalizeFingerprint(observedCertificate.fingerprintSha256))
  ) {
    reasons.push('certificateNotApplied')
  }
  if (observedCertificate.verified === false || Boolean(observedCertificate.verificationError)) {
    reasons.push('chainVerificationFailed')
  }
  return reasons
}

function probeHistoryBlockStatus(
  row: { readonly status: TargetStatus; readonly recentResults: readonly ProbeResult[] },
  index: number,
): ProbeStatus | 'NONE' {
  const result = row.recentResults[index]
  if (!result) return 'NONE'
  if (index === 0 && row.status === 'WARNING' && result.status === 'READY') return 'WARNING'
  return result.status
}

function latestCertificateFingerprintsForAsset(assetId: string): string[] {
  const certificateAssetIds = new Set<string>()
  for (const binding of bindingsForAsset(assetId)) {
    for (const versionId of bindingCertificateVersionIds(binding)) {
      const version = certificateVersions.value.find((item) => readId(item) === versionId)
      const certificateAssetId = readString(version, ['certificateAssetId'], '')
      if (certificateAssetId) certificateAssetIds.add(certificateAssetId)
    }
  }
  return [...certificateAssetIds]
    .map(latestCertificateVersionForAsset)
    .map((version) => normalizeFingerprint(readString(version, ['fingerprintSha256'], '')))
    .filter(Boolean)
}

function bindingCertificateVersionIds(binding: ApiRecord): string[] {
  return [...new Set([
    readString(binding, ['certificateVersionId'], ''),
    readString(binding, ['targetCertificateVersionId'], ''),
    readString(binding, ['localCertificateVersionId'], ''),
  ].filter(Boolean))]
}

function latestCertificateVersionForAsset(certificateAssetId: string): ApiRecord | null {
  const certificateAsset = certificateAssets.value.find((item) => readId(item) === certificateAssetId)
  const currentVersionId = readString(certificateAsset, ['currentVersionId'], '')
  const currentVersion = certificateVersions.value.find((item) => readId(item) === currentVersionId)
  if (currentVersion) return currentVersion
  return certificateVersions.value
    .filter((item) => readString(item, ['certificateAssetId'], '') === certificateAssetId)
    .sort((left, right) => (readNumber(right.versionNo) ?? 0) - (readNumber(left.versionNo) ?? 0))[0] ?? null
}

function warningSummary(reasons: readonly MonitorWarningReason[]): string {
  return reasons.map((reason) => t(`monitoring.warnings.${reason}`)).join(' / ')
}

function recentProbeResults(assetId: string): ProbeResult[] {
  return (probeHistory.value[assetId] ?? []).slice(0, 10)
}

function latestCertificateObservation(assetId: string): CertificateObservation | null {
  return certificateObservations.value[assetId]?.[0] ?? null
}

function probeStatusLabel(status: TargetStatus): string {
  if (status === 'READY') return t('monitoring.status.ready')
  if (status === 'WARNING') return t('monitoring.status.warning')
  if (status === 'NONE') return t('monitoring.status.none')
  return t('monitoring.status.error')
}

function probeHistoryBlockLabel(result: ProbeResult | undefined, index: number): string {
  if (!result) return t('monitoring.probe.emptyHistoryBlock', { index: index + 1 })
  const latency = result.latencyMs === undefined ? t('monitoring.probe.latencyNotCollected') : `${result.latencyMs}ms`
  return `${formatLocalTime(result.checkedAt)} ${probeStatusLabel(result.status)} ${latency}`
}

function actualCertificateLabel(certificate: CertificateObservation | null): string {
  if (!certificate) return t('monitoring.fallback.notCollected')
  const subject = certificate.subject || certificate.dnsNames?.[0] || t('monitoring.certificate.actualCertificate')
  return `${subject} / ${formatLocalDateText(certificate.notAfter ?? '')}`
}

function shortFingerprint(value: string | undefined): string {
  const normalized = normalizeFingerprint(value ?? '')
  if (!normalized) return t('monitoring.fallback.noFingerprint')
  return `${normalized.slice(0, 12)}...${normalized.slice(-12)}`
}

function verificationLabel(certificate: CertificateObservation | null): string {
  if (!certificate) return t('monitoring.fallback.notCollected')
  if (certificate.verified) return t('monitoring.certificate.chainVerified')
  return certificate.verificationError
    ? t('monitoring.certificate.chainVerifyFailedWithReason', { reason: certificate.verificationError })
    : t('monitoring.certificate.chainUntrusted')
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
  return probeUrl(asset) || t('monitoring.fallback.noEndpoint')
}

function findTlsInspectorTarget(assetId: string): TlsInspectorTargetRecord | null {
  const directMatch = tlsInspectorTargets.value.find((target) => target.serviceAssetId === assetId)
  if (directMatch) return directMatch

  const host = endpointHost(assetById(assetId))
  if (!host) return null
  return tlsInspectorTargets.value.find((target) => target.host.toLowerCase() === host) ?? null
}

function handleTlsInspectionUpdated(snapshot: TlsInspectionSnapshot) {
  tlsInspectionsByTargetId.value = {
    ...tlsInspectionsByTargetId.value,
    [snapshot.targetId]: snapshot,
  }
  tlsInspectorTargets.value = tlsInspectorTargets.value.map((target) => (
    target.id === snapshot.targetId
      ? {
          ...target,
          latestSnapshotId: snapshot.id,
          latestStatus: snapshot.status,
          latestSummary: snapshot.summary,
          lastInspectedAt: snapshot.finishedAt,
        }
      : target
  ))
}

async function refreshTlsInspectionRatings(targets: readonly TlsInspectorTargetRecord[]) {
  const entries = await Promise.all(targets.map(async (target) => {
    const cached = tlsInspectionsByTargetId.value[target.id]
    if (cached && (!target.latestSnapshotId || cached.id === target.latestSnapshotId)) {
      return [target.id, cached] as const
    }

    const result = await getLatestTlsInspection(target.id).catch(() => null)
    const inspection = result?.data ?? cached
    return inspection ? [target.id, inspection] as const : null
  }))

  tlsInspectionsByTargetId.value = Object.fromEntries(
    entries.filter((entry): entry is readonly [string, TlsInspectionSnapshot] => Boolean(entry)),
  )
}

function endpointHost(asset: ApiRecord | null): string {
  const endpoint = endpointLabel(asset)
  if (!endpoint || endpoint === t('monitoring.fallback.noEndpoint')) return ''
  try {
    return new URL(endpoint).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function readQueryValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return typeof value === 'string' ? value : ''
}

function assetLabel(asset: ApiRecord | null): string {
  return readString(asset, ['displayName', 'address', 'domainName', 'name'], t('monitoring.fallback.unknownAsset'))
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

function formatLocalTime(value: number | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('monitoring.fallback.notCollected')
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
  if (source === 'control_plane') return t('monitoring.source.controlPlane')
  if (source === 'gateway') return 'Gateway'
  return t('designSystem.status.UNKNOWN')
}

function riskCertificateId(risk: ApiRecord): string {
  return readString(risk, ['certificateId', 'certificateAssetId'], '')
}

function riskOccurredAt(risk: ApiRecord): string {
  return formatLocalTime(readString(risk, ['firstDetectedAt', 'detectedAt'], ''))
}

function riskClosedAt(risk: ApiRecord): string {
  const resolvedAt = readString(risk, ['resolvedAt'], '')
  return resolvedAt ? formatLocalTime(resolvedAt) : t('monitoring.fallback.notClosed')
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

function groupProbeResults(items: readonly ApiRecord[]): Record<string, ProbeResult[]> {
  return items.reduce<Record<string, ProbeResult[]>>((acc, item) => {
    const assetId = readString(item, ['serviceAssetId'], '')
    const result = normalizeStoredProbeResult(item)
    if (!assetId || !result) return acc
    acc[assetId] = [...(acc[assetId] ?? []), result].slice(0, 20)
    return acc
  }, {})
}

function normalizeStoredProbeResult(item: ApiRecord): ProbeResult | null {
  const status = readString(item, ['status'], '')
  if (!isProbeStatus(status)) return null
  const checkedAt = Date.parse(readString(item, ['checkedAt'], '')) || readNumber(item.checkedAt) || Date.now()
  return {
    status,
    latencyMs: readNumber(item.latencyMs),
    checkedAt,
    message: readString(item, ['message'], t('monitoring.probe.completed')),
    source: readString(item, ['source'], ''),
    httpStatus: readNumber(item.httpStatus),
    certificate: readObject(item.certificate),
  }
}

function latestProbeResultsFromHistory(history: Record<string, ProbeResult[]>): Record<string, ProbeResult> {
  return Object.fromEntries(
    Object.entries(history)
      .map(([assetId, items]) => [assetId, items[0]] as const)
      .filter((entry): entry is readonly [string, ProbeResult] => Boolean(entry[1])),
  )
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
    chain: Array.isArray(readPath(item, 'chain')) ? readPath(item, 'chain') as CertificateObservation['chain'] : undefined,
    chainStatus: readString(item, ['chainStatus'], '') as CertificateObservation['chainStatus'],
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

function isProbeStatus(value: string): value is ProbeStatus {
  return value === 'READY' || value === 'WARNING' || value === 'ERROR'
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
    <Teleport to="#gc-shell-hero-actions" :disabled="!shouldTeleportActions">
      <div class="monitor-page__actions">
        <button class="gc-button" type="button" :disabled="loading" @click="() => refreshAll({ scanRisks: true })">
          {{ loading ? t('monitoring.actions.refreshing') : t('monitoring.actions.refresh') }}
        </button>
        <button class="gc-button gc-button--primary" type="button" :disabled="probing || monitorTargets.length === 0" @click="() => probeAllTargets()">
          {{ probing ? t('monitoring.actions.probing') : t('monitoring.actions.probe') }}
        </button>
        <button class="gc-button gc-button--primary" type="button" :disabled="loading" @click="openAddDialog">
          {{ t('monitoring.actions.add') }}
        </button>
      </div>
    </Teleport>

    <GcEmptyState v-if="error" :title="t('monitoring.errors.loadFailed')" :description="error" />

    <GcEmptyState
      v-else-if="!loading && monitorTargets.length === 0"
      :title="t('monitoring.empty.title')"
      :description="t('monitoring.empty.description')"
    />

    <section v-else class="monitor-page__workspace">
      <aside class="monitor-page__targets gc-card">
        <header class="monitor-page__section-head">
          <div>
            <strong>{{ t('monitoring.sections.targets') }}</strong>
            <span>{{ t('monitoring.targets.assetCount', { count: monitorRows.length }) }}</span>
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
          <div class="monitor-page__target-body">
            <strong>{{ row.title }}</strong>
            <span>{{ row.endpoint }}</span>
            <div class="monitor-page__probe-blocks" :aria-label="t('monitoring.probe.recentAria')">
              <i
                v-for="index in 10"
                :key="index"
                :data-status="probeHistoryBlockStatus(row, index - 1)"
                :title="probeHistoryBlockLabel(row.recentResults[index - 1], index - 1)"
              />
            </div>
          </div>
          <div class="monitor-page__target-indicators">
            <span
              class="monitor-page__target-tls-rating"
              :data-tone="row.tlsRatingTone"
              :aria-label="t('monitoring.tls.aria.rating', { rating: row.tlsRating })"
            >
              {{ row.tlsRating }}
            </span>
            <span
              class="monitor-page__target-status"
              :data-status="row.status"
              :title="row.warningSummary"
              :aria-label="row.warningSummary || row.statusLabel"
            >
              <b v-if="row.status === 'WARNING'" aria-hidden="true">!</b>
              {{ row.statusLabel }}
            </span>
          </div>
        </button>
      </aside>

      <section class="monitor-page__detail">
        <section class="monitor-page__summary gc-card">
          <div class="monitor-page__summary-title">
            <div>
              <span>{{ t('monitoring.labels.currentTarget') }}</span>
              <h2>{{ assetLabel(selectedAsset) }}</h2>
            </div>
            <div v-if="selectedTarget" class="monitor-page__target-actions">
              <label class="monitor-page__target-interval">
                <span>{{ t('monitoring.labels.probeInterval') }}</span>
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
                {{ t('monitoring.actions.remove') }}
              </button>
            </div>
          </div>
          <div class="monitor-page__kpi-grid">
            <article>
              <span>{{ t('monitoring.metrics.availability') }}</span>
              <strong>{{ selectedTarget ? (probeResults[selectedTarget.assetId]?.message ?? t('monitoring.probe.waiting')) : t('monitoring.fallback.notSelected') }}</strong>
            </article>
            <article>
              <span>{{ t('monitoring.metrics.latency') }}</span>
              <strong>{{ selectedTarget && probeResults[selectedTarget.assetId]?.latencyMs !== undefined ? `${probeResults[selectedTarget.assetId]?.latencyMs} ms` : t('monitoring.fallback.notCollected') }}</strong>
            </article>
            <article>
              <span>{{ t('monitoring.metrics.certificateStatus') }}</span>
              <strong>{{ actualCertificateLabel(selectedActualCertificate) }}</strong>
            </article>
            <article>
              <span>{{ t('monitoring.metrics.observedCertificateChanges') }}</span>
              <strong>{{ selectedObservedCertificateHistory.length }}</strong>
            </article>
            <article class="monitor-page__tls-kpi">
              <span>{{ t('monitoring.tls.metrics.entryRating') }}</span>
              <div class="monitor-page__tls-kpi-body">
                <strong class="monitor-page__tls-grade" :data-tone="selectedTlsRatingTone">{{ selectedTlsRating }}</strong>
                <button
                  class="gc-button monitor-page__tls-open"
                  type="button"
                  :disabled="!selectedTarget"
                  @click="openTlsDialog()"
                >
                  {{ t('monitoring.tls.actions.openDetail') }}
                </button>
              </div>
            </article>
          </div>
        </section>

        <section class="monitor-page__panels">
          <article class="monitor-page__panel gc-card">
            <header class="monitor-page__section-head">
              <div>
                <strong>{{ t('monitoring.sections.actualCertificate') }}</strong>
                <span>{{ t('monitoring.sections.actualCertificateHint') }}</span>
              </div>
            </header>
            <div v-if="!selectedActualCertificate" class="monitor-page__empty-line">{{ t('monitoring.empty.actualCertificate') }}</div>
            <dl v-else class="monitor-page__certificate-detail">
              <div>
                <dt>{{ t('monitoring.certificate.sha256Fingerprint') }}</dt>
                <dd :title="selectedActualCertificate.fingerprintSha256">{{ shortFingerprint(selectedActualCertificate.fingerprintSha256) }}</dd>
              </div>
              <div>
                <dt>{{ t('monitoring.certificate.subject') }}</dt>
                <dd>{{ selectedActualCertificate.subject || t('designSystem.status.UNKNOWN') }}</dd>
              </div>
              <div>
                <dt>{{ t('monitoring.certificate.issuer') }}</dt>
                <dd>{{ selectedActualCertificate.issuer || t('designSystem.status.UNKNOWN') }}</dd>
              </div>
              <div>
                <dt>{{ t('monitoring.certificate.serialNumber') }}</dt>
                <dd>{{ selectedActualCertificate.serialNumber || t('designSystem.status.UNKNOWN') }}</dd>
              </div>
              <div>
                <dt>{{ t('monitoring.certificate.validity') }}</dt>
                <dd>{{ t('monitoring.certificate.validityRange', { start: formatLocalDateText(selectedActualCertificate.notBefore ?? ''), end: formatLocalDateText(selectedActualCertificate.notAfter ?? '') }) }}</dd>
              </div>
              <div>
                <dt>{{ t('monitoring.certificate.chainVerification') }}</dt>
                <dd>{{ verificationLabel(selectedActualCertificate) }}</dd>
              </div>
              <div>
                <dt>SAN</dt>
                <dd>{{ selectedActualCertificate.dnsNames?.join(', ') || t('monitoring.fallback.notCollected') }}</dd>
              </div>
              <div>
                <dt>{{ t('monitoring.certificate.collectedAt') }}</dt>
                <dd>{{ formatLocalTime(selectedActualCertificate.checkedAt) }} / {{ sourceLabel(selectedActualCertificate.source) }}</dd>
              </div>
            </dl>
          </article>

          <article class="monitor-page__panel gc-card">
            <header class="monitor-page__section-head">
              <div>
                <strong>{{ t('monitoring.sections.observedCertificateHistory') }}</strong>
                <span>{{ t('monitoring.sections.observedCertificateHistoryHint') }}</span>
              </div>
            </header>
            <div v-if="selectedObservedCertificateHistory.length === 0" class="monitor-page__empty-line">{{ t('monitoring.empty.observedCertificateHistory') }}</div>
            <table v-else class="monitor-page__table">
              <thead>
                <tr>
                  <th>{{ t('monitoring.columns.certificateName') }}</th>
                  <th>{{ t('monitoring.columns.issuerName') }}</th>
                  <th>{{ t('monitoring.columns.expiresAt') }}</th>
                  <th>{{ t('monitoring.columns.changedAt') }}</th>
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
                <strong>{{ t('monitoring.sections.riskEvents') }}</strong>
                <span>{{ t('monitoring.sections.riskEventsHint') }}</span>
              </div>
            </header>
            <div v-if="selectedAssetRisks.length === 0" class="monitor-page__empty-line">{{ t('monitoring.empty.riskEvents') }}</div>
            <div v-else class="monitor-page__table-scroll">
              <table class="monitor-page__table monitor-page__risk-table">
                <thead>
                  <tr>
                    <th>{{ t('monitoring.columns.warningContent') }}</th>
                    <th>{{ t('monitoring.columns.occurredAt') }}</th>
                    <th>{{ t('monitoring.columns.currentStatus') }}</th>
                    <th>{{ t('monitoring.columns.closedAt') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="risk in selectedAssetRisks" :key="readId(risk)">
                    <td>
                      <RouterLink
                        v-if="riskCertificateId(risk)"
                        class="monitor-page__risk-link"
                        :to="{ path: '/certificates', query: { certificateId: riskCertificateId(risk) } }"
                      >
                        <strong>{{ readString(risk, ['title', 'name'], t('monitoring.fallback.unnamedEvent')) }}</strong>
                        <span>{{ readString(risk, ['summary', 'message'], t('monitoring.fallback.noSummary')) }}</span>
                      </RouterLink>
                      <div v-else class="monitor-page__risk-content">
                        <strong>{{ readString(risk, ['title', 'name'], t('monitoring.fallback.unnamedEvent')) }}</strong>
                        <span>{{ readString(risk, ['summary', 'message'], t('monitoring.fallback.noSummary')) }}</span>
                      </div>
                    </td>
                    <td>{{ riskOccurredAt(risk) }}</td>
                    <td><GcStatusTag :status="readString(risk, ['status'], 'OPEN')" /></td>
                    <td>{{ riskClosedAt(risk) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article class="monitor-page__panel monitor-page__panel--wide gc-card">
            <header class="monitor-page__section-head">
              <div>
                <strong>{{ t('monitoring.sections.probeHistory') }}</strong>
                <span>{{ t('monitoring.sections.probeHistoryHint') }}</span>
              </div>
            </header>
            <div v-if="selectedProbeHistory.length === 0" class="monitor-page__empty-line">{{ t('monitoring.empty.probeHistory') }}</div>
            <table v-else class="monitor-page__table">
              <thead>
                <tr>
                  <th>{{ t('monitoring.columns.time') }}</th>
                  <th>{{ t('monitoring.columns.source') }}</th>
                  <th>{{ t('monitoring.columns.status') }}</th>
                  <th>{{ t('monitoring.columns.latency') }}</th>
                  <th>{{ t('monitoring.columns.result') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in selectedProbeHistory" :key="`${item.checkedAt}-${item.message}`">
                  <td>{{ formatLocalTime(item.checkedAt) }}</td>
                  <td>{{ sourceLabel(item.source) }}</td>
                  <td>{{ item.status }}</td>
                  <td>{{ item.latencyMs === undefined ? t('monitoring.fallback.notCollected') : `${item.latencyMs} ms` }}</td>
                  <td>{{ item.message }}</td>
                </tr>
              </tbody>
            </table>
          </article>

        </section>
      </section>
    </section>

    <GcModal
      :open="tlsDialogOpen"
      :title="t('monitoring.tls.detailTitle')"
      size="xxl"
      width="calc(100vw - var(--gc-space-2))"
      max-height="calc(100vh - var(--gc-space-2))"
      edge-to-edge
      @update:open="tlsDialogOpen = $event"
    >
      <MonitorTlsDetailView
        v-if="tlsDialogTargetId"
        :key="tlsDialogTargetId"
        :monitor-target-id="tlsDialogTargetId"
        embedded
        @inspection-updated="handleTlsInspectionUpdated"
      />
    </GcModal>

    <GcModal
      v-model:open="addDialogOpen"
      :title="t('monitoring.dialog.title')"
      :description="t('monitoring.dialog.description')"
      size="md"
    >
      <div class="monitor-page__dialog-form">
        <label>
          <span>{{ t('monitoring.labels.applicationAsset') }}</span>
          <select v-model="selectedAssetId" :disabled="loading">
            <option value="">{{ loading ? t('monitoring.dialog.loadingAssets') : t('monitoring.dialog.selectAsset') }}</option>
            <option v-for="asset in assetOptions" :key="readId(asset)" :value="readId(asset)">
              {{ assetLabel(asset) }} / {{ endpointLabel(asset) }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ t('monitoring.labels.probeInterval') }}</span>
          <span class="monitor-page__dialog-number">
            <input v-model.number="selectedIntervalSeconds" type="number" min="10" step="10" />
            <b>s</b>
          </span>
        </label>
        <div v-if="assetOptions.length === 0 && !loading" class="monitor-page__empty-line">
          {{ t('monitoring.empty.noAddableAssets') }}
        </div>
        <p>{{ t('monitoring.dialog.defaultMetricsHint') }}</p>
      </div>
      <template #actions>
        <button class="gc-button" type="button" @click="addDialogOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="!selectedAssetId" @click="addMonitorTarget">
          {{ t('monitoring.actions.add') }}
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

.monitor-page__actions {
  display: flex;
  justify-content: flex-start;
  gap: var(--gc-space-2);
  flex-wrap: wrap;
}

.monitor-page__actions .gc-button {
  min-height: 36px;
  padding-inline: 14px;
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
  color: var(--gc-color-text);
  font-size: 15px;
}

.monitor-page__section-head span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.monitor-page__target {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: calc(var(--gc-space-8) * 3);
  border: 1px solid var(--gc-color-muted-bg);
  border-radius: 8px;
  padding: 12px;
  background: var(--gc-color-surface-solid);
  text-align: left;
  cursor: pointer;
}

.monitor-page__target.is-active {
  border-color: var(--gc-color-primary-strong);
  background: var(--gc-color-surface-selected);
}

.monitor-page__target-body {
  display: grid;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}

.monitor-page__target strong,
.monitor-page__target span {
  overflow-wrap: anywhere;
}

.monitor-page__target span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
}

.monitor-page__target small {
  color: var(--gc-color-muted);
  font-size: 11px;
  font-weight: 750;
}

.monitor-page__probe-blocks {
  display: grid;
  grid-template-columns: repeat(10, var(--gc-space-3));
  gap: 4px;
  width: max-content;
  margin-top: 4px;
}

.monitor-page__probe-blocks i {
  display: block;
  width: var(--gc-space-3);
  height: var(--gc-space-3);
  border-radius: 4px;
  background: var(--gc-color-muted-bg);
}

.monitor-page__probe-blocks i[data-status='READY'] {
  background: var(--gc-color-success);
}

.monitor-page__probe-blocks i[data-status='WARNING'] {
  background: var(--gc-color-warning);
}

.monitor-page__probe-blocks i[data-status='ERROR'] {
  background: var(--gc-color-danger);
}

.monitor-page__target-status {
  flex: 0 0 auto;
  min-width: 54px;
  min-height: 32px;
  align-self: flex-start;
  border-radius: 999px;
  padding: 4px 10px;
  text-align: center;
  font-size: 12px;
  font-weight: 850;
}

.monitor-page__target-indicators {
  display: grid;
  flex: 0 0 auto;
  width: calc(var(--gc-space-10) + var(--gc-space-4));
  justify-items: center;
  gap: var(--gc-space-2);
}

.monitor-page__target-status {
  display: inline-grid;
  place-items: center;
  align-self: auto;
}

.monitor-page__target-tls-rating,
.monitor-page__tls-grade {
  display: inline-grid;
  place-items: center;
  min-width: var(--gc-space-10);
  min-height: var(--gc-space-8);
  border-radius: var(--gc-radius-xl);
  padding-inline: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  font-size: var(--gc-font-size-md);
  font-weight: 850;
}

.monitor-page__target-tls-rating[data-tone='success'],
.monitor-page__tls-grade[data-tone='success'] {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.monitor-page__target-tls-rating[data-tone='info'],
.monitor-page__tls-grade[data-tone='info'] {
  color: var(--gc-color-info);
  background: var(--gc-color-info-bg);
}

.monitor-page__target-tls-rating[data-tone='warning'],
.monitor-page__tls-grade[data-tone='warning'] {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
}

.monitor-page__target-tls-rating[data-tone='danger'],
.monitor-page__tls-grade[data-tone='danger'] {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.monitor-page__target-status[data-status='READY'] {
  background: var(--gc-color-success-bg);
  color: var(--gc-color-success);
}

.monitor-page__target-status[data-status='WARNING'] {
  background: var(--gc-color-warning-bg);
  color: var(--gc-color-warning);
}

.monitor-page__target-status[data-status='ERROR'] {
  background: var(--gc-color-danger-bg);
  color: var(--gc-color-danger);
}

.monitor-page__target-status[data-status='NONE'] {
  background: var(--gc-color-info-bg);
  color: var(--gc-color-text-muted);
}

.monitor-page__dialog-form {
  display: grid;
  gap: 12px;
}

.monitor-page__dialog-form label {
  display: grid;
  gap: 8px;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 850;
}

.monitor-page__dialog-form select,
.monitor-page__dialog-form input {
  min-height: 40px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--gc-color-surface-solid);
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
  color: var(--gc-color-text-muted);
}

.monitor-page__dialog-form p {
  margin: 0;
  color: var(--gc-color-text-muted);
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
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 750;
}

.monitor-page__summary-title h2,
.monitor-page__summary-title p {
  margin: 0;
}

.monitor-page__summary-title h2 {
  color: var(--gc-color-text);
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
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 8px;
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 800;
}

.monitor-page__target-interval input {
  width: 76px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 6px;
  padding: 5px 8px;
  color: var(--gc-color-text);
  font: inherit;
}

.monitor-page__target-interval b {
  color: var(--gc-color-text-muted);
}

.monitor-page__kpi-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.monitor-page__kpi-grid article {
  display: grid;
  gap: 6px;
  min-height: 78px;
  border: 1px solid var(--gc-color-muted-bg);
  border-radius: 8px;
  padding: 12px;
  background: var(--gc-color-surface-subtle);
}

.monitor-page__kpi-grid span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 800;
}

.monitor-page__kpi-grid strong {
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.monitor-page__tls-kpi {
  align-content: start;
}

.monitor-page__tls-kpi-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  min-width: 0;
}

.monitor-page__tls-grade {
  justify-self: start;
  font-size: var(--gc-font-size-lg);
}

.monitor-page__tls-open {
  flex: 0 0 auto;
  min-height: var(--gc-space-10);
  border-color: var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  padding-inline: var(--gc-space-3);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
  color: var(--gc-color-text);
  font-weight: 800;
}

.monitor-page__tls-open:hover:not(:disabled) {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-selected);
  color: var(--gc-color-primary-strong);
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
  color: var(--gc-color-text-muted);
  font-size: 13px;
  font-weight: 700;
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
  border: 1px solid var(--gc-color-muted-bg);
  border-radius: 8px;
  padding: 10px;
  background: var(--gc-color-surface-solid);
}

.monitor-page__certificate-detail dt {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 850;
}

.monitor-page__certificate-detail dd {
  margin: 0;
  color: var(--gc-color-text);
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
  border-bottom: 1px solid var(--gc-color-muted-bg);
  padding: 9px 8px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.monitor-page__table th {
  color: var(--gc-color-text-muted);
  font-weight: 850;
}

.monitor-page__table-scroll {
  width: 100%;
  overflow-x: auto;
}

.monitor-page__risk-table {
  min-width: calc(var(--gc-space-10) * 18);
}

.monitor-page__risk-table th:first-child {
  width: 55%;
}

.monitor-page__risk-content,
.monitor-page__risk-link {
  display: grid;
  gap: var(--gc-space-1);
}

.monitor-page__risk-link {
  color: inherit;
  text-decoration: none;
}

.monitor-page__risk-link:hover strong {
  color: var(--gc-color-success);
}

.monitor-page__risk-content span,
.monitor-page__risk-link span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
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
  .monitor-page__section-head {
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
