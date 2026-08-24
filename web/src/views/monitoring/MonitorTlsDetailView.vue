<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute } from 'vue-router'
import { ApiClientError } from '@/api/client'
import { listAssets } from '@/api/modules/assets.api'
import { listMonitorTargets } from '@/api/modules/monitors.api'
import {
  createTlsInspectorTarget,
  getLatestTlsInspection,
  listTlsInspectorTargets,
  runTlsInspection,
  type TlsInspectionSnapshot,
  type TlsInspectorTargetRecord,
} from '@/api/modules/tls-inspector.api'
import { GcEmptyState, GcPageToolbar, GcStatusTag, GcTabs } from '@/design-system/components'
import { formatMaybeLocalTime, getExpiryCountdown } from '@/utils/browser-local-time'

type RecordLike = Record<string, unknown>
type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

interface ReportMetric {
  readonly key: string
  readonly label: string
  readonly grade: string
  readonly tone: StatusTone
  readonly summary: string
}

interface ReportHighlight {
  readonly id: string
  readonly tone: StatusTone
  readonly title: string
  readonly description: string
}

interface ReportDetailItem {
  readonly label: string
  readonly value: string
  readonly tone?: StatusTone
}

interface TrustPathNodeView {
  readonly key: string
  readonly position: number
  readonly sourceLabel: string
  readonly subject: string
  readonly issuer: string
  readonly fingerprint: string
  readonly selfSigned: boolean
}

interface TrustPathView {
  readonly key: string
  readonly title: string
  readonly statusLabel: string
  readonly tone: StatusTone
  readonly boundaryNote: string
  readonly nodes: readonly TrustPathNodeView[]
}

interface CipherSuiteGroup {
  readonly protocol: string
  readonly supported: boolean
  readonly suites: readonly NonNullable<TlsInspectionSnapshot['cipherSuites']>[number][]
}

interface SimulationSummaryItem {
  readonly label: string
  readonly value: string
  readonly tone: StatusTone
}

interface SimulationFootnoteItem {
  readonly id: string
  readonly text: string
}

interface ProtocolDetailGroup {
  readonly key: string
  readonly title: string
  readonly items: readonly ReportDetailItem[]
}

const route = useRoute()
const { t } = useI18n()
const monitorTargetId = computed(() => String(route.params.id ?? ''))
const loading = ref(true)
const scanning = ref(false)
const error = ref('')
const monitorTarget = ref<RecordLike | null>(null)
const asset = ref<RecordLike | null>(null)
const inspectorTarget = ref<TlsInspectorTargetRecord | null>(null)
const snapshot = ref<TlsInspectionSnapshot | null>(null)
const activeTab = ref('overview')

const tabs = computed(() => [
  { value: 'overview', label: t('monitoring.tls.tabs.overview') },
  { value: 'basicInfo', label: t('monitoring.tls.tabs.basicInfo') },
  { value: 'trustPaths', label: t('monitoring.tls.tabs.trustPaths') },
  { value: 'protocols', label: t('monitoring.tls.tabs.protocols') },
  { value: 'simulations', label: t('monitoring.tls.tabs.simulations') },
  { value: 'protocolDetails', label: t('monitoring.tls.tabs.protocolDetails') },
])

const title = computed(() => assetLabel(asset.value))
const endpoint = computed(() => endpointLabel(asset.value))
const riskSummary = computed(() => snapshot.value?.riskSummary ?? null)
const certificate = computed(() => snapshot.value?.certificate ?? null)
const protocolLookup = computed(() => new Map((snapshot.value?.protocols ?? []).map((item) => [item.label, item])))

const metricCards = computed<ReportMetric[]>(() => {
  if (!snapshot.value) return []
  return [
    buildMetricCard('overall', computeOverallScore(snapshot.value)),
    buildMetricCard('certificate', computeCertificateScore(snapshot.value)),
    buildMetricCard('protocol', computeProtocolScore(snapshot.value)),
    buildMetricCard('keyExchange', computeKeyExchangeScore(snapshot.value)),
    buildMetricCard('cipherStrength', computeCipherStrengthScore(snapshot.value)),
  ]
})

const overallMetric = computed(() => metricCards.value[0] ?? buildMetricCard('overall', 0))
const overviewMetricCards = computed(() => metricCards.value.slice(1))

const summaryFacts = computed<ReportDetailItem[]>(() => {
  if (!snapshot.value) return []
  return [
    { label: t('monitoring.tls.labels.endpoint'), value: snapshot.value.summary.endpoint || endpoint.value },
    { label: t('monitoring.tls.labels.lastInspectedAt'), value: formatMaybeLocalTime(snapshot.value.finishedAt) },
    { label: t('monitoring.tls.labels.snapshotStatus'), value: snapshotStateLabel(snapshot.value.status) },
    { label: t('monitoring.tls.labels.implementationVersion'), value: snapshot.value.implementationVersion || t('monitoring.tls.values.unknown') },
    { label: t('monitoring.tls.labels.profileCatalogVersion'), value: snapshot.value.profileCatalogVersion || t('monitoring.tls.values.unknown') },
    { label: t('monitoring.tls.labels.trustCatalogVersion'), value: snapshot.value.trustCatalogVersion || t('monitoring.tls.values.unknown') },
  ]
})

const overviewFacts = computed(() => summaryFacts.value.slice(0, 3))

const trustPathSummary = computed(() => {
  const views = snapshot.value?.trustPaths ?? []
  return {
    total: views.length,
    trusted: views.filter((item) => item.status === 'trusted').length,
    issues: views.filter((item) => item.status !== 'trusted').length,
  }
})

const summaryHighlights = computed<ReportHighlight[]>(() => {
  if (!snapshot.value) return []
  const highlights: ReportHighlight[] = []
  const protocols = protocolLookup.value
  const hasSsl3 = Boolean(protocols.get('SSL 3.0')?.supported)
  const hasTls10 = Boolean(protocols.get('TLS 1.0')?.supported)
  const hasTls11 = Boolean(protocols.get('TLS 1.1')?.supported)
  const hasTls13 = Boolean(protocols.get('TLS 1.3')?.supported)
  const hasRc4 = snapshot.value.cipherSuites.some((item) => item.tags?.includes('rc4') || item.insecure)
  const hasWeakCipher = Boolean(riskSummary.value?.weakCipherDetected)
  const hstsRaw = snapshot.value.protocolDetails.hsts?.raw || t('monitoring.tls.values.none')

  if (hasSsl3) {
    highlights.push({
      id: 'ssl3',
      tone: 'danger',
      title: t('monitoring.tls.highlights.ssl3Title'),
      description: t('monitoring.tls.highlights.ssl3Description'),
    })
  }
  if (hasRc4) {
    highlights.push({
      id: 'rc4',
      tone: 'danger',
      title: t('monitoring.tls.highlights.rc4Title'),
      description: t('monitoring.tls.highlights.rc4Description'),
    })
  }
  if (hasTls10 || hasTls11) {
    highlights.push({
      id: 'legacy',
      tone: 'warning',
      title: t('monitoring.tls.highlights.legacyTitle'),
      description: t('monitoring.tls.highlights.legacyDescription'),
    })
  }
  if (!hasTls13) {
    highlights.push({
      id: 'tls13',
      tone: 'warning',
      title: t('monitoring.tls.highlights.tls13Title'),
      description: t('monitoring.tls.highlights.tls13Description'),
    })
  }
  if (!snapshot.value.protocolDetails.pqcSupported) {
    highlights.push({
      id: 'pqc',
      tone: 'info',
      title: t('monitoring.tls.highlights.pqcTitle'),
      description: t('monitoring.tls.highlights.pqcDescription'),
    })
  }
  if (riskSummary.value?.hstsTooShort) {
    highlights.push({
      id: 'hsts',
      tone: 'warning',
      title: t('monitoring.tls.highlights.hstsTitle'),
      description: t('monitoring.tls.highlights.hstsDescription', { policy: hstsRaw }),
    })
  }
  if (riskSummary.value?.trustPathIssueCount) {
    highlights.push({
      id: 'trust-path',
      tone: 'warning',
      title: t('monitoring.tls.highlights.trustPathTitle'),
      description: t('monitoring.tls.highlights.trustPathDescription', { count: riskSummary.value.trustPathIssueCount }),
    })
  }
  if (hasWeakCipher && !hasRc4) {
    highlights.push({
      id: 'weak-cipher',
      tone: 'warning',
      title: t('monitoring.tls.highlights.weakCipherTitle'),
      description: t('monitoring.tls.highlights.weakCipherDescription'),
    })
  }
  if (!highlights.length) {
    highlights.push({
      id: 'no-major-risk',
      tone: 'success',
      title: t('monitoring.tls.highlights.noMajorRiskTitle'),
      description: t('monitoring.tls.highlights.noMajorRiskDescription'),
    })
  }
  return highlights
})

const certificateOverview = computed<ReportDetailItem[]>(() => {
  const current = certificate.value
  if (!current) return []
  return [
    { label: t('monitoring.tls.labels.certificateSubject'), value: current.subject || t('monitoring.tls.values.none') },
    { label: t('monitoring.tls.labels.commonName'), value: current.commonName || t('monitoring.tls.values.none') },
    { label: t('monitoring.tls.labels.issuer'), value: current.issuer || t('monitoring.tls.values.none') },
    { label: t('monitoring.tls.labels.validFrom'), value: formatMaybeLocalTime(current.notBefore) },
    { label: t('monitoring.tls.labels.validUntil'), value: formatMaybeLocalTime(current.notAfter) },
    { label: t('monitoring.tls.labels.remainingValidity'), value: formatRemainingValidity(current.notAfter) },
    { label: t('monitoring.tls.labels.fingerprintSha256'), value: formatFingerprint(current.fingerprintSha256) },
    { label: t('monitoring.tls.labels.pinSha256'), value: current.pinSha256 || t('monitoring.tls.values.none') },
    { label: t('monitoring.tls.labels.serialNumber'), value: current.serialNumber || t('monitoring.tls.values.none') },
    { label: t('monitoring.tls.labels.signatureAlgorithm'), value: current.signatureAlgorithm || t('monitoring.tls.values.none') },
    { label: t('monitoring.tls.labels.keyAlgorithm'), value: current.keyAlgorithm || t('monitoring.tls.values.none') },
    { label: t('monitoring.tls.labels.keySize'), value: formatAnyValue(current.keySize) },
    { label: t('monitoring.tls.labels.altNames'), value: formatList(current.subjectAltNames) },
  ]
})

const certificateOverviewPrimary = computed(() => certificateOverview.value.slice(0, 6))
const certificateOverviewSecondary = computed(() => certificateOverview.value.slice(6))

const chainCertificates = computed(() => certificate.value?.chain ?? [])

const additionalCertificates = computed(() => chainCertificates.value.slice(1))

const trustPathViews = computed<TrustPathView[]>(() => (snapshot.value?.trustPaths ?? []).map((item, index) => ({
  key: `${item.view}-${index}`,
  title: `${item.viewLabel} | ${t('monitoring.tls.trustPaths.pathTitle', { index: index + 1, status: trustPathStatusLabel(item.status) })}`,
  statusLabel: trustPathStatusLabel(item.status),
  tone: trustPathTone(item.status),
  boundaryNote: item.errorMessage || item.boundaryNote || t('monitoring.tls.values.none'),
  nodes: (item.path ?? []).map((node, nodeIndex) => ({
    key: `${item.view}-${node.position}-${node.fingerprintSha256 ?? nodeIndex}`,
    position: node.position,
    sourceLabel: trustSourceLabel(node.source),
    subject: node.subject || t('monitoring.tls.values.none'),
    issuer: node.issuer || t('monitoring.tls.values.none'),
    fingerprint: formatFingerprint(node.fingerprintSha256),
    selfSigned: Boolean(node.selfSigned),
  })),
})))

const protocolSummaryRows = computed<ReportDetailItem[]>(() => (snapshot.value?.protocols ?? []).map((item) => ({
  label: item.label,
  value: item.supported
    ? formatNegotiatedResult(item.negotiatedProtocol, item.negotiatedCipherSuite)
    : item.errorMessage || t('monitoring.tls.values.notSupported'),
  tone: item.supported ? 'success' : legacyProtocolTone(item.label),
})))

const cipherSuiteGroups = computed<CipherSuiteGroup[]>(() => {
  const current = snapshot.value
  if (!current) return []
  const order = ['TLS 1.3', 'TLS 1.2', 'TLS 1.1', 'TLS 1.0', 'SSL 3.0']
  return order.map((protocol) => ({
    protocol,
    supported: Boolean(current.protocols.find((item) => item.label === protocol)?.supported),
    suites: current.cipherSuites.filter((item) => item.protocol === protocol),
  }))
})

const simulationSummary = computed<SimulationSummaryItem[]>(() => {
  const current = snapshot.value
  if (!current) return []
  const total = current.simulations.length
  const succeeded = current.simulations.filter((item) => item.status === 'succeeded').length
  const failed = current.simulations.filter((item) => item.status !== 'succeeded').length
  return [
    { label: t('monitoring.tls.labels.simulationProfiles'), value: String(total), tone: 'info' },
    { label: t('monitoring.tls.labels.simulationSucceeded'), value: String(succeeded), tone: succeeded === total ? 'success' : 'info' },
    { label: t('monitoring.tls.labels.simulationFailed'), value: String(failed), tone: failed > 0 ? 'warning' : 'success' },
  ]
})

const simulationRows = computed(() => (snapshot.value?.simulations ?? []).map((item) => ({
  ...item,
  statusLabel: item.status === 'succeeded' ? t('monitoring.tls.values.succeeded') : t('monitoring.tls.values.failed'),
  statusTone: simulationTone(item.status),
  reasonLabel: simulationReasonLabel(item.failureReason),
  protocolDisplay: item.protocolDisplay || item.protocol || t('monitoring.tls.values.none'),
  serverCertificateLabel: item.serverCertificate || t('monitoring.tls.values.unknown'),
  keyExchangeLabel: item.keyExchange || t('monitoring.tls.values.none'),
  explanationLabel: item.explanation || t('monitoring.tls.values.none'),
  clientMarkers: [
    ...(item.capabilityNotes ?? []),
    ...(item.reference ? ['R'] : []),
  ],
  resultFlags: item.resultFlags?.length
    ? item.resultFlags
    : item.forwardSecrecy === null || item.forwardSecrecy === undefined
      ? []
      : [item.forwardSecrecy ? 'FS' : 'No FS'],
})))

const simulationFootnotes = computed<SimulationFootnoteItem[]>(() => {
  const rows = snapshot.value?.simulations ?? []
  const footnotes: SimulationFootnoteItem[] = []
  if (rows.some((item) => item.capabilityNotes?.includes('No FS'))) {
    footnotes.push({ id: 'no-fs', text: t('monitoring.tls.report.simulationFootnoteNoFs') })
  }
  if (rows.some((item) => item.capabilityNotes?.includes('No SNI'))) {
    footnotes.push({ id: 'no-sni', text: t('monitoring.tls.report.simulationFootnoteNoSni') })
  }
  if (rows.some((item) => item.reference)) {
    footnotes.push({ id: 'reference', text: t('monitoring.tls.report.simulationFootnoteReference') })
  }
  footnotes.push({ id: 'defaults', text: t('monitoring.tls.report.simulationFootnoteDefaults') })
  footnotes.push({ id: 'trust', text: t('monitoring.tls.report.simulationFootnoteTrust') })
  return footnotes
})

const protocolDetailGroups = computed<ProtocolDetailGroup[]>(() => {
  const details = snapshot.value?.protocolDetails
  if (!details) return []
  return [
    {
      key: 'transport',
      title: t('monitoring.tls.groups.transport'),
      items: [
        { label: t('monitoring.tls.labels.secureRenegotiation'), value: formatYesNo(details.secureRenegotiation), tone: booleanTone(details.secureRenegotiation, 'success') },
        { label: t('monitoring.tls.labels.secureClientInitiatedRenegotiation'), value: t('monitoring.tls.values.no'), tone: 'success' },
        { label: t('monitoring.tls.labels.insecureClientRenegotiation'), value: formatYesNo(details.insecureClientRenegotiation), tone: booleanTone(details.insecureClientRenegotiation, 'danger') },
        { label: t('monitoring.tls.labels.compression'), value: formatYesNo(details.compression), tone: booleanTone(details.compression, 'danger') },
        { label: t('monitoring.tls.labels.forwardSecrecy'), value: formatYesNo(details.forwardSecrecy), tone: booleanTone(details.forwardSecrecy, 'success') },
        { label: t('monitoring.tls.labels.sessionTickets'), value: formatYesNo(details.sessionResumptionTickets), tone: booleanTone(details.sessionResumptionTickets, 'info') },
      ],
    },
    {
      key: 'http',
      title: t('monitoring.tls.groups.httpPolicy'),
      items: [
        { label: t('monitoring.tls.labels.alpn'), value: details.alpn || t('monitoring.tls.values.none') },
        { label: t('monitoring.tls.labels.npn'), value: formatYesNo(details.npn), tone: booleanTone(details.npn, 'muted') },
        { label: t('monitoring.tls.labels.ocsp'), value: formatYesNo(details.ocspStapling), tone: booleanTone(details.ocspStapling, 'info') },
        { label: t('monitoring.tls.labels.hsts'), value: details.hsts?.raw || t('monitoring.tls.values.none'), tone: riskSummary.value?.hstsTooShort ? 'warning' : details.hsts?.enabled ? 'success' : 'muted' },
        { label: t('monitoring.tls.labels.maxAge'), value: formatAnyValue(details.hsts?.maxAge) },
        { label: t('monitoring.tls.labels.hstsPreload'), value: formatYesNo(details.hsts?.preload), tone: booleanTone(details.hsts?.preload, 'info') },
        { label: t('monitoring.tls.labels.hstsIncludeSubdomains'), value: formatYesNo(details.hsts?.includeSubDomains), tone: booleanTone(details.hsts?.includeSubDomains, 'info') },
        { label: t('monitoring.tls.labels.httpStatus'), value: formatAnyValue(details.httpStatus) },
        { label: t('monitoring.tls.labels.httpProtocol'), value: details.httpProtocol || t('monitoring.tls.values.none') },
        { label: t('monitoring.tls.labels.serverHeader'), value: details.serverHeader || t('monitoring.tls.values.none') },
      ],
    },
    {
      key: 'key-exchange',
      title: t('monitoring.tls.groups.keyExchange'),
      items: [
        { label: t('monitoring.tls.labels.pqc'), value: formatYesNo(details.pqcSupported), tone: booleanTone(details.pqcSupported, 'info') },
        { label: t('monitoring.tls.labels.namedGroups'), value: formatList(details.supportedNamedGroups) },
      ],
    },
  ]
})

const boundaryNotes = computed(() => {
  const notes = [
    ...(snapshot.value?.riskSummary.boundaryNotes ?? []),
    ...(snapshot.value?.protocolDetails.boundaryNotes ?? []),
  ]
  return [...new Set(notes.filter((item) => item.trim()))]
})

const errorItems = computed(() => snapshot.value?.errors ?? [])

onMounted(() => {
  void loadDetail()
})

async function loadDetail() {
  loading.value = true
  error.value = ''
  try {
    const [monitorResult, assetResult] = await Promise.all([
      listMonitorTargets({ page: 1, pageSize: 200 }),
      listAssets({ page: 1, pageSize: 200, sort: 'updatedAt:desc' }),
    ])
    monitorTarget.value = (monitorResult.data?.items ?? []).find((item) => readString(item, ['id']) === monitorTargetId.value) ?? null
    const assetId = readString(monitorTarget.value, ['serviceAssetId', 'assetId'])
    asset.value = (assetResult.data?.items ?? []).find((item) => readString(item, ['id']) === assetId) ?? null
    if (!monitorTarget.value || !asset.value) {
      throw new Error(t('monitoring.tls.messages.loadFailed'))
    }

    await loadInspectorTarget(assetId)
  } catch (cause) {
    error.value = resolveInspectorError(cause, t('monitoring.tls.messages.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function loadInspectorTarget(assetId: string) {
  if (!asset.value) {
    throw new Error(t('monitoring.tls.messages.loadFailed'))
  }
  try {
    const targetResult = await listTlsInspectorTargets({ page: 1, pageSize: 200 })
    inspectorTarget.value = findInspectorTarget(targetResult.data?.items ?? [], assetId, asset.value) ?? null
    if (!inspectorTarget.value) {
      const created = await createTlsInspectorTarget(buildInspectorTargetPayload(asset.value, assetId))
      if (!created.data) throw new Error(t('monitoring.tls.messages.initFailed'))
      inspectorTarget.value = created.data
    }

    await loadLatestSnapshot()
    if (!snapshot.value) {
      await refreshInspection()
    }
  } catch (cause) {
    throw new Error(resolveInspectorError(cause, t('monitoring.tls.messages.inspectorUnavailable')))
  }
}

async function loadLatestSnapshot() {
  if (!inspectorTarget.value) return
  const latestResult = await getLatestTlsInspection(inspectorTarget.value.id).catch(() => null)
  snapshot.value = latestResult?.data ?? null
}

async function refreshInspection() {
  if (!inspectorTarget.value) return
  scanning.value = true
  error.value = ''
  try {
    const result = await runTlsInspection(inspectorTarget.value.id)
    if (!result.data) throw new Error(t('monitoring.tls.messages.scanFailed'))
    snapshot.value = result.data
  } catch (cause) {
    error.value = resolveInspectorError(cause, t('monitoring.tls.messages.scanFailed'))
  } finally {
    scanning.value = false
  }
}

function buildMetricCard(key: string, score: number): ReportMetric {
  const grade = toGrade(score)
  return {
    key,
    label: t(`monitoring.tls.metrics.${key}`),
    grade,
    tone: gradeTone(grade),
    summary: t(`monitoring.tls.metricSummaries.${gradeBucket(score)}`),
  }
}

function computeOverallScore(current: TlsInspectionSnapshot): number {
  let score = 100
  if (!current.riskSummary.tls13Supported) score -= 12
  if (current.riskSummary.legacyProtocolEnabled) score -= 22
  if (current.riskSummary.weakCipherDetected) score -= 24
  if (current.riskSummary.hstsTooShort) score -= 8
  score -= Math.min(current.riskSummary.trustPathIssueCount * 10, 30)
  score -= Math.min(current.riskSummary.simulationFailedCount * 2, 18)
  score -= Math.min((current.errors?.length ?? 0) * 3, 12)
  if (current.status === 'failed') score = Math.min(score, 45)
  if (current.status === 'partial') score = Math.min(score, 78)
  return clampScore(score)
}

function computeCertificateScore(current: TlsInspectionSnapshot): number {
  let score = 100
  if (!current.certificate) return 30
  score -= Math.min(current.riskSummary.trustPathIssueCount * 15, 45)
  const expiry = getExpiryCountdown(current.certificate.notAfter)
  if (expiry?.expired) score -= 40
  else if (expiry && expiry.days <= 30) score -= 20
  else if (expiry && expiry.days <= 90) score -= 8
  return clampScore(score)
}

function computeProtocolScore(current: TlsInspectionSnapshot): number {
  let score = 100
  if (!current.riskSummary.tls13Supported) score -= 20
  if (current.riskSummary.legacyProtocolEnabled) score -= 35
  if (protocolLookup.value.get('SSL 3.0')?.supported) score -= 20
  return clampScore(score)
}

function computeKeyExchangeScore(current: TlsInspectionSnapshot): number {
  let score = 100
  if (!current.protocolDetails.forwardSecrecy) score -= 28
  if (!(current.protocolDetails.supportedNamedGroups?.length ?? 0)) score -= 14
  if (!current.protocolDetails.pqcSupported) score -= 6
  if (current.riskSummary.simulationFailedCount > 0) score -= Math.min(current.riskSummary.simulationFailedCount * 2, 16)
  return clampScore(score)
}

function computeCipherStrengthScore(current: TlsInspectionSnapshot): number {
  let score = 100
  const insecureCount = current.cipherSuites.filter((item) => item.insecure).length
  const weakCount = current.cipherSuites.filter((item) => item.weak && !item.insecure).length
  score -= Math.min(insecureCount * 18, 36)
  score -= Math.min(weakCount * 8, 24)
  const maxStrength = Math.max(...current.cipherSuites.map((item) => item.strengthBits ?? 0), 0)
  if (current.cipherSuites.length && maxStrength < 128) score -= 15
  return clampScore(score)
}

function gradeTone(grade: string): StatusTone {
  if (grade.startsWith('A')) return 'success'
  if (grade === 'B') return 'info'
  if (grade === 'C') return 'warning'
  return 'danger'
}

function gradeBucket(score: number): string {
  if (score >= 90) return 'excellent'
  if (score >= 80) return 'good'
  if (score >= 70) return 'medium'
  return 'poor'
}

function toGrade(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 92) return 'A'
  if (score >= 85) return 'B'
  if (score >= 72) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function snapshotStateLabel(status: string) {
  return t(`monitoring.tls.states.${status}`, status)
}

function snapshotStateTone(status: string): StatusTone {
  if (status === 'succeeded') return 'success'
  if (status === 'partial') return 'warning'
  if (status === 'failed') return 'danger'
  return 'muted'
}

function trustPathStatusLabel(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'trusted') return t('monitoring.tls.values.trusted')
  if (normalized === 'untrusted') return t('monitoring.tls.values.untrusted')
  if (normalized === 'incomplete') return t('monitoring.tls.values.incomplete')
  if (normalized === 'unsupported') return t('monitoring.tls.values.unsupported')
  return status
}

function trustPathTone(status: string): StatusTone {
  const normalized = status.toLowerCase()
  if (normalized === 'trusted') return 'success'
  if (normalized === 'unsupported' || normalized === 'incomplete') return 'warning'
  if (normalized === 'untrusted') return 'danger'
  return 'muted'
}

function trustSourceLabel(source: string) {
  if (source === 'server') return t('monitoring.tls.values.sentByServer')
  if (source === 'trustStore') return t('monitoring.tls.values.inTrustStore')
  return source
}

function legacyProtocolTone(label: string): StatusTone {
  if (label === 'TLS 1.3' || label === 'TLS 1.2') return 'success'
  if (label === 'TLS 1.1' || label === 'TLS 1.0') return 'warning'
  if (label === 'SSL 3.0') return 'danger'
  return 'muted'
}

function simulationTone(status: string): StatusTone {
  return status === 'succeeded' ? 'success' : 'warning'
}

function simulationNoteLabel(item: NonNullable<TlsInspectionSnapshot['simulations']>[number]) {
  if (item.status === 'failed' && item.failureReason === 'sni_required') return t('monitoring.tls.values.noSni')
  if (item.forwardSecrecy === false) return t('monitoring.tls.values.noFs')
  if (item.forwardSecrecy) return t('monitoring.tls.values.fs')
  return t('monitoring.tls.values.none')
}

function booleanTone(value: boolean | null | undefined, preferredTrueTone: StatusTone): StatusTone | undefined {
  if (value === undefined || value === null) return undefined
  if (value) return preferredTrueTone
  return preferredTrueTone === 'danger' ? 'success' : preferredTrueTone === 'success' ? 'muted' : 'muted'
}

function simulationReasonLabel(reason: string | null | undefined) {
  if (!reason) return t('monitoring.tls.values.none')
  return t(`monitoring.tls.simulationReasons.${reason}`, reason)
}

function formatList(value: readonly string[] | undefined) {
  return value?.length ? value.join(', ') : t('monitoring.tls.values.none')
}

function formatYesNo(value: boolean | null | undefined) {
  if (value === undefined || value === null) return t('monitoring.tls.values.unknown')
  return value ? t('monitoring.tls.values.yes') : t('monitoring.tls.values.no')
}

function formatAnyValue(value: unknown) {
  if (value === undefined || value === null || value === '') return t('monitoring.tls.values.none')
  return String(value)
}

function formatNegotiatedResult(protocol: string | null | undefined, cipher: string | null | undefined) {
  const parts = [protocol, cipher].filter((item): item is string => Boolean(item?.trim()))
  return parts.length ? parts.join(' / ') : t('monitoring.tls.values.none')
}

function formatRemainingValidity(value: unknown) {
  const countdown = getExpiryCountdown(value)
  if (!countdown) return t('monitoring.tls.values.unknown')
  if (countdown.expired) return t('monitoring.tls.values.expiredDaysAgo', { days: countdown.days })
  if (countdown.days === 0) return t('monitoring.tls.values.expiresToday')
  return t('monitoring.tls.values.expiresInDays', { days: countdown.days })
}

function formatFingerprint(value: string | null | undefined) {
  if (!value) return t('monitoring.tls.values.none')
  const compact = value.replaceAll(':', '').trim()
  if (!compact) return t('monitoring.tls.values.none')
  return compact.match(/.{1,2}/g)?.join(':') ?? compact
}

function cipherSuiteFlags(item: NonNullable<TlsInspectionSnapshot['cipherSuites']>[number]) {
  const flags: string[] = []
  if (item.forwardSecrecy) flags.push('FS')
  if (item.insecure) flags.push('INSECURE')
  else if (item.weak) flags.push('WEAK')
  return flags.length ? flags.join(' / ') : t('monitoring.tls.values.none')
}

function assetLabel(record: RecordLike | null): string {
  return readString(record, ['displayName', 'name', 'address', 'host']) || t('monitoring.fallback.unknownAsset')
}

function endpointLabel(record: RecordLike | null): string {
  return readString(record, ['address', 'endpoint', 'url', 'host', 'hostname']) || t('monitoring.fallback.noEndpoint')
}

function parseEndpoint(value: string) {
  const source = value.includes('://') ? value : `https://${value}`
  try {
    const url = new URL(source)
    return {
      host: url.hostname,
      port: Number(url.port || 443),
      serverName: url.hostname,
    }
  } catch {
    return { host: value, port: 443, serverName: value }
  }
}

function findInspectorTarget(items: readonly TlsInspectorTargetRecord[], assetId: string, currentAsset: RecordLike) {
  const currentHost = parseEndpoint(endpointLabel(currentAsset)).host
  return items.find((item) => item.serviceAssetId === assetId)
    ?? items.find((item) => item.host === currentHost)
    ?? null
}

function buildInspectorTargetPayload(currentAsset: RecordLike, assetId: string) {
  const parsed = parseEndpoint(endpointLabel(currentAsset))
  return {
    serviceAssetId: assetId,
    host: parsed.host,
    port: parsed.port,
    serverName: parsed.serverName,
    intervalSeconds: Number(readValue(monitorTarget.value, ['intervalSeconds']) ?? 3600),
  }
}

function readValue(record: RecordLike | null | undefined, keys: readonly string[]): unknown {
  if (!record) return undefined
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key]
  }
  return undefined
}

function readString(record: RecordLike | null | undefined, keys: readonly string[]): string {
  const value = readValue(record, keys)
  return typeof value === 'string' ? value : value === undefined ? '' : String(value)
}

function resolveInspectorError(cause: unknown, fallbackMessage: string) {
  if (cause instanceof ApiClientError && cause.status >= 500) {
    return t('monitoring.tls.messages.inspectorUnavailable')
  }
  if (cause instanceof SyntaxError) {
    return t('monitoring.tls.messages.inspectorUnavailable')
  }
  if (cause instanceof Error && cause.message.trim()) {
    return cause.message
  }
  return fallbackMessage
}
</script>

<template>
  <section class="tls-report-page">
    <header class="tls-report-page__header">
      <div class="tls-report-page__header-copy">
        <span class="tls-report-page__sr-only">{{ t('monitoring.tls.detailTitle') }}</span>
        <div class="tls-report-page__headline">
          <h1>{{ title }}</h1>
        </div>
        <GcPageToolbar class="tls-report-page__toolbar">
          <template #actions>
            <RouterLink class="tls-action-button tls-action-button--secondary" to="/monitors/tls">
              {{ t('monitoring.tls.actions.back') }}
            </RouterLink>
            <button
              class="tls-action-button tls-action-button--primary"
              type="button"
              :disabled="loading || scanning"
              @click="refreshInspection"
            >
              {{ scanning ? t('monitoring.tls.actions.refreshing') : t('monitoring.tls.actions.refresh') }}
            </button>
          </template>
          <template #tabs>
            <GcTabs v-model="activeTab" :tabs="tabs" :aria-label="t('monitoring.tls.report.tabsAriaLabel')" />
          </template>
        </GcPageToolbar>
      </div>
    </header>

    <GcEmptyState
      v-if="error && !snapshot && !loading"
      :title="t('monitoring.tls.messages.loadFailed')"
      :description="error"
    />
    <div v-else-if="loading" class="tls-report-page__loading">{{ t('common.loading') }}</div>
    <template v-else-if="snapshot">
      <section v-if="activeTab === 'overview'" class="tls-section-stack">
        <section class="tls-overview-shell" :aria-label="t('monitoring.tls.report.summaryAriaLabel')">
          <article class="tls-grade-panel">
            <header class="tls-grade-panel__header">
              <div class="tls-grade-panel__heading">
                <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.overallRating') }}</p>
                <h2>{{ t('monitoring.tls.report.summaryTitle') }}</h2>
              </div>
              <GcStatusTag
                :status="snapshot.status.toUpperCase()"
                :label="snapshotStateLabel(snapshot.status)"
                :tone="snapshotStateTone(snapshot.status)"
              />
            </header>
            <div class="tls-grade-panel__body">
              <div class="tls-grade-panel__badge" :data-tone="overallMetric.tone">{{ overallMetric.grade }}</div>
              <div class="tls-grade-panel__copy">
                <strong>{{ t('monitoring.tls.metrics.overall') }}</strong>
                <p>{{ overallMetric.summary }}</p>
                <dl class="tls-inline-facts">
                  <div v-for="item in overviewFacts" :key="item.label" class="tls-inline-facts__item">
                    <dt>{{ item.label }}</dt>
                    <dd>{{ item.value }}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </article>

          <div class="tls-score-grid">
            <article
              v-for="metric in overviewMetricCards"
              :key="metric.key"
              class="tls-score-card"
              :data-tone="metric.tone"
            >
              <span>{{ metric.label }}</span>
              <strong>{{ metric.grade }}</strong>
              <p>{{ metric.summary }}</p>
            </article>
          </div>
        </section>

        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.executiveSummary') }}</p>
              <h2>{{ t('monitoring.tls.report.basicInfoTitle') }}</h2>
            </div>
            <GcStatusTag :status="snapshot.status.toUpperCase()" :label="snapshotStateLabel(snapshot.status)" :tone="snapshotStateTone(snapshot.status)" />
          </header>

          <div class="tls-report-grid tls-report-grid--facts">
            <dl class="tls-report-facts">
              <div v-for="item in summaryFacts" :key="item.label" class="tls-report-facts__row">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
          </div>
        </article>

        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.keyFindings') }}</p>
              <h2>{{ t('monitoring.tls.report.keyFindings') }}</h2>
            </div>
          </header>
          <div class="tls-highlights">
            <article v-for="item in summaryHighlights" :key="item.id" class="tls-highlight" :data-tone="item.tone">
              <strong>{{ item.title }}</strong>
              <p>{{ item.description }}</p>
            </article>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'basicInfo'" class="tls-section-stack">
        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.executiveSummary') }}</p>
              <h2>{{ t('monitoring.tls.report.basicInfoTitle') }}</h2>
            </div>
            <GcStatusTag :status="snapshot.status.toUpperCase()" :label="snapshotStateLabel(snapshot.status)" :tone="snapshotStateTone(snapshot.status)" />
          </header>

          <div class="tls-report-grid tls-report-grid--double">
            <dl class="tls-report-facts tls-report-facts--panel">
              <div v-for="item in summaryFacts" :key="item.label" class="tls-report-facts__row">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
            <div class="tls-basic-info-callout">
              <strong>{{ t('monitoring.tls.report.basicInfoHintTitle') }}</strong>
              <p>{{ t('monitoring.tls.report.basicInfoHintDescription') }}</p>
            </div>
          </div>
        </article>

        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.certificateTitle') }}</p>
              <h2>{{ t('monitoring.tls.report.certificateTitle') }}</h2>
            </div>
            <span class="tls-card-meta">{{ t('monitoring.tls.report.chainSummary', { count: chainCertificates.length }) }}</span>
          </header>
          <div class="tls-report-grid tls-report-grid--certificate">
            <section class="tls-certificate-panel">
              <h3>{{ t('monitoring.tls.report.primaryCertificateTitle') }}</h3>
              <div class="tls-report-grid tls-report-grid--double">
                <dl class="tls-report-facts tls-report-facts--panel">
                  <div v-for="item in certificateOverviewPrimary" :key="item.label" class="tls-report-facts__row">
                    <dt>{{ item.label }}</dt>
                    <dd>{{ item.value }}</dd>
                  </div>
                </dl>
                <dl class="tls-report-facts tls-report-facts--panel">
                  <div v-for="item in certificateOverviewSecondary" :key="item.label" class="tls-report-facts__row">
                    <dt>{{ item.label }}</dt>
                    <dd>{{ item.value }}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section class="tls-certificate-panel">
              <h3>{{ t('monitoring.tls.report.additionalCertificatesTitle') }}</h3>
              <p class="tls-subsection__summary">{{ t('monitoring.tls.report.chainHint') }}</p>
              <div v-if="additionalCertificates.length" class="tls-certificate-chain">
                <article v-for="(item, index) in additionalCertificates" :key="`${item.subject}-${index}`" class="tls-certificate-chain__item">
                  <div class="tls-certificate-chain__title">
                    <strong>{{ item.subject || t('monitoring.tls.values.none') }}</strong>
                    <span>{{ t('monitoring.tls.values.sentByServer') }}</span>
                  </div>
                  <dl class="tls-certificate-chain__facts">
                    <div>
                      <dt>{{ t('monitoring.tls.labels.issuer') }}</dt>
                      <dd>{{ item.issuer || t('monitoring.tls.values.none') }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('monitoring.tls.labels.validUntil') }}</dt>
                      <dd>{{ formatMaybeLocalTime(item.notAfter) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('monitoring.tls.labels.fingerprintSha256') }}</dt>
                      <dd>{{ formatFingerprint(item.fingerprintSha256) }}</dd>
                    </div>
                  </dl>
                </article>
              </div>
              <p v-else class="tls-report-empty">{{ t('monitoring.tls.empty.additionalCertificates') }}</p>
            </section>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'trustPaths'" class="tls-section-stack">
        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.tabs.trustPaths') }}</p>
              <h2>{{ t('monitoring.tls.tabs.trustPaths') }}</h2>
            </div>
          </header>
          <div class="tls-report-grid tls-report-grid--simulation">
            <article class="tls-simulation-stat" data-tone="info">
              <span>{{ t('monitoring.tls.labels.trustViewsTotal') }}</span>
              <strong>{{ trustPathSummary.total }}</strong>
            </article>
            <article class="tls-simulation-stat" data-tone="success">
              <span>{{ t('monitoring.tls.labels.trustViewsTrusted') }}</span>
              <strong>{{ trustPathSummary.trusted }}</strong>
            </article>
            <article class="tls-simulation-stat" :data-tone="trustPathSummary.issues > 0 ? 'warning' : 'success'">
              <span>{{ t('monitoring.tls.labels.trustViewsIssues') }}</span>
              <strong>{{ trustPathSummary.issues }}</strong>
            </article>
          </div>
          <div v-if="trustPathViews.length" class="tls-trust-paths">
            <article v-for="view in trustPathViews" :key="view.key" class="tls-trust-path">
              <header class="tls-trust-path__header">
                <div>
                  <h3>{{ view.title }}</h3>
                  <p>{{ view.boundaryNote }}</p>
                </div>
                <GcStatusTag :status="view.statusLabel" :label="view.statusLabel" :tone="view.tone" />
              </header>
              <ol v-if="view.nodes.length" class="tls-trust-path__nodes">
                <li v-for="node in view.nodes" :key="node.key" class="tls-trust-path__node">
                  <span class="tls-trust-path__position">{{ node.position }}</span>
                  <div class="tls-trust-path__node-body">
                    <div class="tls-trust-path__node-head">
                      <strong>{{ node.subject }}</strong>
                      <span>{{ node.sourceLabel }}</span>
                    </div>
                    <dl class="tls-trust-path__node-facts">
                      <div>
                        <dt>{{ t('monitoring.tls.labels.issuer') }}</dt>
                        <dd>{{ node.issuer }}</dd>
                      </div>
                      <div>
                        <dt>{{ t('monitoring.tls.labels.fingerprintSha256') }}</dt>
                        <dd>{{ node.fingerprint }}</dd>
                      </div>
                      <div v-if="node.selfSigned">
                        <dt>{{ t('monitoring.tls.labels.notes') }}</dt>
                        <dd>{{ t('monitoring.tls.values.selfSigned') }}</dd>
                      </div>
                    </dl>
                  </div>
                </li>
              </ol>
              <p v-else class="tls-report-empty">{{ t('monitoring.tls.empty.trustPaths') }}</p>
            </article>
          </div>
          <p v-else class="tls-report-empty">{{ t('monitoring.tls.empty.trustPaths') }}</p>
        </article>
      </section>

      <section v-else-if="activeTab === 'protocols'" class="tls-section-stack">
        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.protocolSupportTitle') }}</p>
              <h2>{{ t('monitoring.tls.report.protocolSupportTitle') }}</h2>
            </div>
          </header>
          <div class="tls-report-grid tls-report-grid--protocols">
            <article v-for="item in protocolSummaryRows" :key="item.label" class="tls-protocol-card" :data-tone="item.tone">
              <strong>{{ item.label }}</strong>
              <p>{{ item.value }}</p>
            </article>
          </div>
        </article>

        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.cipherSuitesTitle') }}</p>
              <h2>{{ t('monitoring.tls.report.cipherSuitesTitle') }}</h2>
            </div>
          </header>
          <div class="tls-cipher-groups">
            <section v-for="group in cipherSuiteGroups" :key="group.protocol" class="tls-cipher-group">
              <header class="tls-cipher-group__header">
                <div>
                  <h3>{{ group.protocol }}</h3>
                  <p>{{ group.supported ? t('monitoring.tls.values.supported') : t('monitoring.tls.values.notSupported') }}</p>
                </div>
              </header>
              <div v-if="group.suites.length" class="tls-table-wrap">
                <table class="tls-table">
                  <thead>
                    <tr>
                      <th>{{ t('monitoring.tls.labels.cipherSuite') }}</th>
                      <th>{{ t('monitoring.tls.labels.negotiatedName') }}</th>
                      <th>{{ t('monitoring.tls.labels.strength') }}</th>
                      <th>{{ t('monitoring.tls.labels.forwardSecrecy') }}</th>
                      <th>{{ t('monitoring.tls.labels.flags') }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="item in group.suites" :key="`${group.protocol}-${item.standardName}`">
                      <td>{{ item.standardName }}</td>
                      <td>{{ item.negotiatedName || t('monitoring.tls.values.none') }}</td>
                      <td>{{ formatAnyValue(item.strengthBits) }}</td>
                      <td>{{ formatYesNo(item.forwardSecrecy) }}</td>
                      <td>{{ cipherSuiteFlags(item) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="tls-report-empty">{{ t('monitoring.tls.empty.cipherSuites') }}</p>
            </section>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'simulations'" class="tls-section-stack">
        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.handshakeSimulationTitle') }}</p>
              <h2>{{ t('monitoring.tls.report.handshakeSimulationTitle') }}</h2>
            </div>
          </header>
          <div class="tls-report-grid tls-report-grid--simulation">
            <article v-for="item in simulationSummary" :key="item.label" class="tls-simulation-stat" :data-tone="item.tone">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
          <div v-if="snapshot.simulations.length" class="tls-table-wrap">
            <table class="tls-table">
              <thead>
                <tr>
                  <th>{{ t('monitoring.tls.labels.client') }}</th>
                  <th>{{ t('monitoring.tls.labels.protocol') }}</th>
                  <th>{{ t('monitoring.tls.labels.cipherSuite') }}</th>
                  <th>{{ t('monitoring.tls.labels.forwardSecrecy') }}</th>
                  <th>{{ t('monitoring.tls.labels.notes') }}</th>
                  <th>{{ t('monitoring.tls.labels.result') }}</th>
                  <th>{{ t('monitoring.tls.labels.reason') }}</th>
                  <th>{{ t('monitoring.tls.labels.boundary') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in simulationRows" :key="item.profileId">
                  <td>
                    <strong>{{ item.profileName }}</strong>
                    <div class="tls-table__subtle">{{ item.profileVersion }}</div>
                  </td>
                  <td>{{ item.protocol || t('monitoring.tls.values.none') }}</td>
                  <td>{{ item.cipherSuite || t('monitoring.tls.values.none') }}</td>
                  <td>{{ item.fsLabel }}</td>
                  <td>{{ item.noteLabel }}</td>
                  <td>
                    <GcStatusTag
                      :status="item.status.toUpperCase()"
                      :label="item.statusLabel"
                      :tone="item.statusTone"
                    />
                  </td>
                  <td>{{ item.reasonLabel }}</td>
                  <td>{{ item.boundaryNote }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="tls-report-empty">{{ t('monitoring.tls.empty.simulations') }}</p>
        </article>
      </section>

      <section v-else class="tls-section-stack">
        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.protocolDetailsTitle') }}</p>
              <h2>{{ t('monitoring.tls.report.protocolDetailsTitle') }}</h2>
            </div>
          </header>
          <div class="tls-report-grid tls-report-grid--detail-groups">
            <section v-for="group in protocolDetailGroups" :key="group.key" class="tls-detail-group">
              <h3>{{ group.title }}</h3>
              <dl class="tls-report-facts">
                <div v-for="item in group.items" :key="`${group.key}-${item.label}`" class="tls-report-facts__row">
                  <dt>{{ item.label }}</dt>
                  <dd class="tls-detail-group__value">
                    <span>{{ item.value }}</span>
                    <GcStatusTag v-if="item.tone" :status="item.value" :label="item.value" :tone="item.tone" />
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </article>

        <article class="tls-report-card">
          <header class="tls-report-card__header">
            <div>
              <p class="tls-report-card__eyebrow">{{ t('monitoring.tls.report.boundariesTitle') }}</p>
              <h2>{{ t('monitoring.tls.report.boundariesTitle') }}</h2>
            </div>
          </header>
          <div class="tls-report-grid tls-report-grid--double">
            <div class="tls-subsection">
              <h3>{{ t('monitoring.tls.report.boundariesTitle') }}</h3>
              <ul v-if="boundaryNotes.length" class="tls-note-list">
                <li v-for="item in boundaryNotes" :key="item">{{ item }}</li>
              </ul>
              <p v-else class="tls-report-empty">{{ t('monitoring.tls.empty.boundaries') }}</p>
            </div>
            <div class="tls-subsection">
              <h3>{{ t('monitoring.tls.report.errorsTitle') }}</h3>
              <ul v-if="errorItems.length" class="tls-note-list">
                <li v-for="item in errorItems" :key="`${item.code}-${item.message}`">
                  <strong>{{ item.code }}</strong>
                  <span>{{ item.message }}</span>
                </li>
              </ul>
              <p v-else class="tls-report-empty">{{ t('monitoring.tls.empty.errors') }}</p>
            </div>
          </div>
        </article>
      </section>
    </template>
  </section>
</template>

<style scoped>
.tls-report-page {
  display: grid;
  gap: var(--gc-space-6);
  padding: var(--gc-space-6);
}

.tls-report-page__header,
.tls-report-card__header,
.tls-trust-path__header,
.tls-cipher-group__header,
.tls-grade-panel__header,
.tls-report-page__headline,
.tls-certificate-chain__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
}

.tls-report-page__header-copy,
.tls-section-stack,
.tls-subsection,
.tls-detail-group,
.tls-trust-path,
.tls-highlight,
.tls-simulation-stat,
.tls-protocol-card,
.tls-certificate-chain__item,
.tls-report-card,
.tls-grade-panel,
.tls-score-card,
.tls-certificate-panel,
.tls-basic-info-callout {
  display: grid;
  gap: var(--gc-space-3);
}

.tls-report-card__eyebrow,
.tls-report-empty,
.tls-table__subtle,
.tls-trust-path__header p,
.tls-cipher-group__header p,
.tls-card-meta,
.tls-inline-facts dt,
.tls-basic-info-callout p,
.tls-certificate-chain__facts dt,
.tls-trust-path__node-facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.tls-report-page h1,
.tls-report-page h2,
.tls-report-page h3,
.tls-report-page p,
.tls-report-page ul,
.tls-report-page ol,
.tls-report-page dl {
  margin: 0;
}

.tls-report-page h1 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-xl);
}

.tls-report-page h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.tls-report-page h3 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-md);
}

.tls-report-page__header {
  padding: var(--gc-space-5);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-xl);
  background:
    linear-gradient(135deg, var(--gc-color-surface-solid), var(--gc-color-surface-subtle));
  box-shadow: var(--gc-shadow-sm);
}

.tls-report-page__header-copy {
  width: 100%;
}

.tls-report-page__headline { flex-wrap: wrap; }
.tls-report-page__toolbar { margin-top: var(--gc-space-4); }

.tls-action-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--gc-control-height-md);
  padding: 0 var(--gc-space-4);
  border-radius: 999rem;
  border: var(--gc-border-width-default) solid transparent;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease,
    box-shadow 160ms ease;
}

.tls-action-button:hover {
  transform: translateY(-0.0625rem);
}

.tls-action-button:disabled {
  opacity: var(--gc-opacity-disabled);
  cursor: not-allowed;
  transform: none;
}

.tls-action-button--primary {
  background: var(--gc-gradient-primary);
  color: var(--gc-color-text-inverse);
  box-shadow: var(--gc-shadow-primary);
}

.tls-action-button--secondary {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-primary-soft);
  color: var(--gc-color-primary);
}

.tls-overview-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: var(--gc-space-4);
}

.tls-report-card,
.tls-trust-path,
.tls-highlight,
.tls-simulation-stat,
.tls-protocol-card,
.tls-certificate-chain__item,
.tls-grade-panel,
.tls-score-card,
.tls-certificate-panel,
.tls-basic-info-callout {
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
  background:
    linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-subtle));
  box-shadow: var(--gc-shadow-sm);
}

.tls-grade-panel {
  align-content: start;
  border-color: var(--gc-color-primary-border);
  background:
    radial-gradient(circle at top left, var(--gc-color-primary-soft), transparent 45%),
    linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-hover));
}

.tls-grade-panel__heading,
.tls-grade-panel__copy {
  display: grid;
  gap: var(--gc-space-2);
}

.tls-grade-panel__body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--gc-space-4);
  align-items: center;
}

.tls-grade-panel__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 7.5rem;
  height: 7.5rem;
  border-radius: var(--gc-radius-xl);
  border: calc(var(--gc-border-width-default) * 2) solid var(--gc-color-border-strong);
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.tls-grade-panel__badge[data-tone='success'] {
  background: var(--gc-color-success-soft);
  color: var(--gc-color-success);
  border-color: var(--gc-color-success-border);
}

.tls-grade-panel__badge[data-tone='info'] {
  background: var(--gc-color-info-soft);
  color: var(--gc-color-info);
  border-color: var(--gc-color-info-border);
}

.tls-grade-panel__badge[data-tone='warning'] {
  background: var(--gc-color-warning-soft);
  color: var(--gc-color-warning);
  border-color: var(--gc-color-warning-border);
}

.tls-grade-panel__badge[data-tone='danger'] {
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
  border-color: var(--gc-color-danger-border);
}

.tls-grade-panel__copy strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.tls-grade-panel__copy p {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.tls-inline-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-3);
  margin-top: var(--gc-space-1);
}

.tls-inline-facts__item {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
}

.tls-inline-facts dd {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-sm);
  word-break: break-word;
}

.tls-score-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
}

.tls-score-card {
  align-content: start;
  min-height: 10rem;
}

.tls-score-card span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.tls-score-card strong {
  font-size: 2.5rem;
  line-height: 1;
}

.tls-score-card p {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.tls-score-card[data-tone='success'] strong { color: var(--gc-color-success); }
.tls-score-card[data-tone='info'] strong { color: var(--gc-color-info); }
.tls-score-card[data-tone='warning'] strong { color: var(--gc-color-warning); }
.tls-score-card[data-tone='danger'] strong { color: var(--gc-color-danger); }

.tls-report-grid {
  display: grid;
  gap: var(--gc-space-4);
}

.tls-report-grid--facts,
.tls-report-grid--protocols,
.tls-report-grid--simulation {
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
}

.tls-report-grid--double,
.tls-report-grid--detail-groups {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.tls-report-grid--certificate {
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.95fr);
}

.tls-highlights,
.tls-cipher-groups,
.tls-trust-paths {
  display: grid;
  gap: var(--gc-space-4);
}

.tls-highlights {
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
}

.tls-trust-path {
  border-color: var(--gc-color-primary-border);
  background:
    linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-hover));
}

.tls-trust-path__header {
  align-items: center;
}

.tls-highlight[data-tone='success'] {
  border-color: var(--gc-color-success-border);
  background: var(--gc-color-success-soft);
}

.tls-highlight[data-tone='info'] {
  border-color: var(--gc-color-info-border);
  background: var(--gc-color-info-soft);
}

.tls-highlight[data-tone='warning'] {
  border-color: var(--gc-color-warning-border);
  background: var(--gc-color-warning-soft);
}

.tls-highlight[data-tone='danger'] {
  border-color: var(--gc-color-danger-border);
  background: var(--gc-color-danger-soft);
}

.tls-report-facts {
  display: grid;
  gap: var(--gc-space-2);
}

.tls-report-facts--panel {
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
}

.tls-report-facts__row {
  display: grid;
  grid-template-columns: minmax(9rem, 11rem) minmax(0, 1fr);
  gap: var(--gc-space-3);
  padding-bottom: var(--gc-space-2);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.tls-report-facts__row:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.tls-report-facts dt {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.tls-report-facts dd {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  word-break: break-word;
}

.tls-detail-group__value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-2);
}

.tls-basic-info-callout {
  align-content: center;
  border-color: var(--gc-color-primary-border);
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 40%),
    linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-hover));
}

.tls-basic-info-callout strong {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.tls-card-meta {
  white-space: nowrap;
}

.tls-certificate-panel {
  align-content: start;
}

.tls-certificate-chain {
  display: grid;
  gap: var(--gc-space-3);
}

.tls-certificate-chain__title {
  align-items: flex-start;
}

.tls-certificate-chain__title span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.tls-certificate-chain__facts,
.tls-trust-path__node-facts {
  display: grid;
  gap: var(--gc-space-2);
}

.tls-certificate-chain__facts div,
.tls-trust-path__node-facts div {
  display: grid;
  gap: var(--gc-space-1);
}

.tls-certificate-chain__facts dd,
.tls-trust-path__node-facts dd {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  margin: 0;
  word-break: break-word;
}

.tls-subsection__summary {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.tls-trust-path__nodes {
  display: grid;
  gap: var(--gc-space-3);
  padding: 0 0 0 var(--gc-space-2);
  list-style: none;
  position: relative;
}

.tls-trust-path__nodes::before {
  content: '';
  position: absolute;
  left: 0.9375rem;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 0.125rem;
  background: linear-gradient(180deg, var(--gc-color-primary-border), var(--gc-color-border));
}

.tls-trust-path__node {
  display: grid;
  grid-template-columns: 2.5rem minmax(0, 1fr);
  gap: var(--gc-space-3);
  align-items: start;
}

.tls-trust-path__position {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background: var(--gc-color-primary-soft);
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.tls-trust-path__node-body {
  display: grid;
  gap: var(--gc-space-2);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}

.tls-trust-path__node-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  align-items: center;
}

.tls-trust-path__node-head span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.tls-table-wrap {
  overflow-x: auto;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
}

.tls-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--gc-color-surface-solid);
}

.tls-table th,
.tls-table td {
  padding: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  text-align: left;
  vertical-align: top;
  font-size: var(--gc-font-size-sm);
}

.tls-table th {
  background: var(--gc-color-surface-subtle);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.tls-table tbody tr:hover td {
  background: var(--gc-color-surface-hover);
}

.tls-table tbody tr:last-child td {
  border-bottom: 0;
}

.tls-simulation-stat[data-tone='success'] strong { color: var(--gc-color-success); }
.tls-simulation-stat[data-tone='info'] strong { color: var(--gc-color-info); }
.tls-simulation-stat[data-tone='warning'] strong { color: var(--gc-color-warning); }

.tls-note-list {
  display: grid;
  gap: var(--gc-space-2);
  padding-left: var(--gc-space-4);
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.tls-note-list li {
  display: grid;
  gap: var(--gc-space-1);
}

.tls-report-page__loading {
  color: var(--gc-color-text-muted);
}

.tls-report-page__sr-only {
  position: absolute;
  inline-size: var(--gc-space-hairline);
  block-size: var(--gc-space-hairline);
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 1024px) {
  .tls-overview-shell,
  .tls-score-grid,
  .tls-inline-facts,
  .tls-report-grid--certificate,
  .tls-report-grid--double,
  .tls-report-grid--detail-groups {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .tls-report-page {
    padding: var(--gc-space-4);
  }

  .tls-report-page__header,
  .tls-report-card__header,
  .tls-trust-path__header,
  .tls-cipher-group__header,
  .tls-grade-panel__header,
  .tls-report-page__headline,
  .tls-grade-panel__body,
  .tls-certificate-chain__title {
    flex-direction: column;
    align-items: stretch;
  }

  .tls-report-facts__row {
    grid-template-columns: 1fr;
  }

  .tls-grade-panel__badge {
    width: 6rem;
    height: 6rem;
    font-size: 2.5rem;
  }
}
</style>
