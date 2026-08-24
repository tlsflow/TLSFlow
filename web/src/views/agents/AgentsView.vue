<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { readPath, type ViewRow } from '@/composables/useBusinessPage'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'
import CertificateDetailPanel from '@/views/certificates/CertificateDetailPanel.vue'
import {
  createLinuxGoInstallSession,
  createWindowsPowerShellInstallSession,
  deleteAgent,
  disableAgent,
  enableAgent,
  getAgentDetail,
  listAgents,
  requestAgentCapabilityRescan,
} from '@/api/modules/assets.api'
import { listCertificateVersions } from '@/api/modules/certificates.api'
import type { ApiPageResult, ApiRecord } from '@/api/modules/common'

type InstallPlatform = 'linux_go_systemd' | 'windows_powershell_service'

interface InstallSessionView {
  readonly platform: InstallPlatform
  readonly bootstrapTokenPreview: string
  readonly zone: string
  readonly expiresAt: string
  readonly installCommand: string
}

interface DetailField {
  readonly label: string
  readonly value: string
  readonly emphasis?: boolean
  readonly meta?: unknown
}

interface DetailSection {
  readonly title: string
  readonly description: string
  readonly fields: ReadonlyArray<DetailField>
  readonly variant?: 'default' | 'iis-sites' | 'linux-sites' | 'tomcat-connectors' | 'tomcat-apps' | 'runtime-logs'
}

interface DetailTab {
  readonly key: string
  readonly label: string
  readonly sections: ReadonlyArray<DetailSection>
}

interface BindingCertificateView {
  readonly subject: string
  readonly issuer: string
  readonly notBefore: string
  readonly notAfter: string
  readonly thumbprint: string
  readonly fingerprintSha256: string
  readonly storeName: string
  readonly notAfterAt: number | null
}

interface AgentDetailView {
  readonly id: string
  readonly title: string
  readonly subtitle: string
  readonly status: string
  readonly spotlightLabel: string
  readonly spotlightValue: string
  readonly tabs: ReadonlyArray<DetailTab>
  readonly canManualRescan: boolean
  readonly manualRescanDisabledReason: string
}

interface RuntimeLogView {
  readonly id: string
  readonly taskType: string
  readonly siteName: string
  readonly bindingInformation: string
  readonly dryRun: boolean
  readonly category: string
  readonly level: string
  readonly summary: string
  readonly emittedAt: string
  readonly detail: string
  readonly rawDetail: string
}

interface CapabilityItem {
  readonly capabilityKey?: string
  readonly value?: unknown
}

interface IisBindingView {
  readonly protocol: string
  readonly port: string
  readonly certificateSubject: string
  readonly certificateThumbprint: string
  readonly hostHeader: string
  readonly certificate: BindingCertificateView | null
}

interface IisSiteView {
  readonly name: string
  readonly physicalPath: string
  readonly appPool: string
  readonly state: string
  readonly bindings: ReadonlyArray<IisBindingView>
}

interface LinuxBindingView {
  readonly protocol: string
  readonly port: string
  readonly address: string
  readonly certificateName: string
  readonly certificatePath: string
  readonly certificateKeyPath: string
  readonly permissionSummary: string
  readonly testCommand: string
  readonly reloadCommand: string
  readonly certificate: BindingCertificateView | null
}

interface LinuxSiteView {
  readonly name: string
  readonly siteMode: string
  readonly sitePath: string
  readonly serverNames: ReadonlyArray<string>
  readonly proxyTargets: ReadonlyArray<string>
  readonly configFiles: ReadonlyArray<string>
  readonly bindings: ReadonlyArray<LinuxBindingView>
}

interface TomcatConnectorView {
  readonly protocol: string
  readonly port: string
  readonly address: string
  readonly tls: boolean
  readonly certificateName: string
  readonly certificatePath: string
  readonly certificateKeyPath: string
  readonly keystorePath: string
  readonly certificate: BindingCertificateView | null
}

interface TomcatAppView {
  readonly contextPath: string
  readonly docBase: string
  readonly appBase: string
}

type TomcatCertificateBindingView = TomcatConnectorView
type CertificateBindingView = IisBindingView | LinuxBindingView | TomcatCertificateBindingView

const EMPTY_TEXT = '—'
const CERTIFICATE_EXPIRING_DAYS = 30
const { t } = useI18n()

const installModalOpen = ref(false)
const detailModalOpen = ref(false)
const selectedPlatform = ref<InstallPlatform>('linux_go_systemd')
const selectedVersion = ref('latest')
const installSession = ref<InstallSessionView | null>(null)
const detailData = ref<AgentDetailView | null>(null)
const activeDetailTab = ref('overview')
const detailLoading = ref(false)
const detailError = ref('')
const detailActionPending = ref(false)
const detailActionMessage = ref('')
const certificateModalOpen = ref(false)
const selectedCertificate = ref<{ siteName: string; binding: CertificateBindingView } | null>(null)
const certificateAssetPending = ref(false)
const certificateAssetError = ref('')
const certificateAssetDetailOpen = ref(false)
const selectedCertificateAssetRoute = ref<{ assetId: string; versionId: string } | null>(null)
const certificateContextUsages = ref<ApiRecord[]>([])
const copiedText = ref<'token' | 'command' | null>(null)
const installPending = ref(false)
const installError = ref('')
const now = ref(Date.now())
const expandedRuntimeLogIds = ref<string[]>([])

const versionOptions = computed(() => [
  { value: 'latest', label: t('agents.install.versionLatest') },
  { value: '1.2.0', label: '1.2.0' },
  { value: '1.1.0', label: '1.1.0' },
] as const)

const platformOptions = computed<Array<{ value: InstallPlatform; label: string; description: string }>>(() => [
  {
    value: 'linux_go_systemd',
    label: 'Linux systemd',
    description: t('agents.install.platformLinuxDescription'),
  },
  {
    value: 'windows_powershell_service',
    label: 'Windows Go Service',
    description: t('agents.install.platformWindowsDescription'),
  },
])

const installCommand = computed(() => installSession.value?.installCommand ?? '')
const expiresAtMs = computed(() => (installSession.value?.expiresAt ? Date.parse(installSession.value.expiresAt) : 0))
const currentDetailTab = computed(() => detailData.value?.tabs.find((tab) => tab.key === activeDetailTab.value) ?? detailData.value?.tabs[0] ?? null)

const remainingSeconds = computed(() => {
  if (!expiresAtMs.value) return 0
  return Math.max(0, Math.floor((expiresAtMs.value - now.value) / 1000))
})

const remainingLabel = computed(() => {
  const seconds = remainingSeconds.value
  if (seconds <= 0) return t('agents.install.expired')
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return t('agents.install.remainingTime', { minutes, seconds: String(rest).padStart(2, '0') })
})

const isExpired = computed(() => remainingSeconds.value <= 0)

let countdownTimer: ReturnType<typeof setInterval> | null = null

function readValue(record: ApiRecord, candidates: readonly string[], fallback = EMPTY_TEXT): string {
  for (const path of candidates) {
    const value = readPath(record, path)
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  return fallback
}

function normalizeText(value: unknown, fallback = EMPTY_TEXT): string {
  if (value === undefined || value === null || value === '') return fallback
  if (Array.isArray(value)) {
    const values = value.map((item) => String(item ?? '').trim()).filter(Boolean)
    return values.length > 0 ? values.join('\n') : fallback
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function normalizeHex(value: string): string {
  return value.replaceAll(/[^0-9a-f]/gi, '').toUpperCase()
}

function normalizeCertificateName(value: string): string {
  const normalized = value.trim().replace(/^CN\s*=\s*/i, '')
  return normalized.toLowerCase()
}

function collectCertificateNames(certificate: BindingCertificateView): string[] {
  const candidates = certificate.subject
    .split(',')
    .map((item) => normalizeCertificateName(item))
    .filter(Boolean)

  const directName = normalizeCertificateName(certificate.subject)
  if (directName) candidates.unshift(directName)

  return Array.from(new Set(candidates))
}

function normalizeDateTime(value: unknown): string {
  const text = normalizeText(value)
  if (text === EMPTY_TEXT) return text
  return formatBrowserLocalTime(text, { includeSeconds: false }) || text
}

function parseDateTime(value: unknown): number | null {
  const text = normalizeText(value)
  if (text === EMPTY_TEXT) return null
  const parsed = Date.parse(text)
  return Number.isNaN(parsed) ? null : parsed
}

function certificateRemainingDays(certificate: BindingCertificateView | null): number | null {
  if (certificate?.notAfterAt === null || certificate?.notAfterAt === undefined) return null
  return Math.ceil((certificate.notAfterAt - now.value) / (24 * 60 * 60 * 1000))
}

function certificateValidityStatus(certificate: BindingCertificateView | null): 'valid' | 'expiring' | 'expired' | 'unknown' {
  const remainingDays = certificateRemainingDays(certificate)
  if (remainingDays === null) return 'unknown'
  if (remainingDays < 0) return 'expired'
  if (remainingDays <= CERTIFICATE_EXPIRING_DAYS) return 'expiring'
  return 'valid'
}

function certificateStatusLabel(certificate: BindingCertificateView | null): string {
  const status = certificateValidityStatus(certificate)
  if (status === 'expired') return t('agents.certificate.statusExpired')
  if (status === 'expiring') return t('agents.certificate.statusExpiring')
  if (status === 'valid') return t('agents.certificate.statusValid')
  return t('agents.certificate.statusUnknown')
}

function certificateRemainingLabel(certificate: BindingCertificateView | null): string {
  const remainingDays = certificateRemainingDays(certificate)
  if (remainingDays === null) return t('agents.certificate.statusUnknown')
  if (remainingDays < 0) return t('agents.certificate.expiredDays', { days: Math.abs(remainingDays) })
  if (remainingDays === 0) return t('agents.certificate.expiresToday')
  return t('agents.certificate.remainingDays', { days: remainingDays })
}

function firstNonEmptyValue(value: unknown, fallback = EMPTY_TEXT): string {
  const normalized = normalizeText(value, fallback)
  const firstLine = normalized.split('\n').map((item) => item.trim()).find(Boolean)
  return firstLine || fallback
}

function readCapabilityItems(data: ApiRecord): CapabilityItem[] {
  const snapshot = readPath(data, 'capabilitySnapshot.capabilities')
  if (Array.isArray(snapshot)) return snapshot as CapabilityItem[]

  const declarations = readPath(data, 'capabilities.declarations')
  return Array.isArray(declarations) ? (declarations as CapabilityItem[]) : []
}

function readCapabilityValue(data: ApiRecord, capabilityKey: string): unknown {
  return readCapabilityItems(data).find((item) => item.capabilityKey === capabilityKey)?.value
}

function readObjectValue(record: Record<string, unknown>, candidates: readonly string[]): unknown {
  for (const key of candidates) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return undefined
}

function readCapabilityRecord(data: ApiRecord, capabilityKey: string): Record<string, unknown> {
  const raw = readCapabilityValue(data, capabilityKey)
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function readObjectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : []
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item, ''))
      .filter((item) => item !== '')
  }
  const text = normalizeText(value, '')
  return text ? [text] : []
}

function normalizePortText(value: unknown): string {
  const text = normalizeText(value, '')
  return text || EMPTY_TEXT
}

function formatInstallStatus(value: unknown): string {
  return value === true ? t('agents.status.installed') : t('agents.status.notInstalled')
}

function formatRunningStatus(value: unknown): string {
  return value === true ? t('agents.status.running') : t('agents.status.notRunning')
}

function formatSiteMode(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'static_root') return t('agents.siteMode.staticRoot')
  if (normalized === 'reverse_proxy') return t('agents.siteMode.reverseProxy')
  if (normalized === 'unknown') return t('agents.common.unrecognized')
  return value || EMPTY_TEXT
}

function buildLinuxBindingView(binding: Record<string, unknown>): LinuxBindingView {
  const certificateName = normalizeText(readObjectValue(binding, ['CertificateName', 'certificateName']))
  const certificateValue = readObjectValue(binding, ['Certificate', 'certificate'])
  const certificateRecord = certificateValue && typeof certificateValue === 'object'
    ? certificateValue as Record<string, unknown>
    : null
  const permissionRecord = readObjectValue(binding, ['Permission', 'permission'])
  const permission = permissionRecord && typeof permissionRecord === 'object'
    ? permissionRecord as Record<string, unknown>
    : null
  return {
    protocol: normalizeText(readObjectValue(binding, ['Protocol', 'protocol'])),
    port: normalizePortText(readObjectValue(binding, ['Port', 'port'])),
    address: normalizeText(readObjectValue(binding, ['Address', 'address'])),
    certificateName,
    certificatePath: normalizeText(readObjectValue(binding, ['CertificatePath', 'certificatePath'])),
    certificateKeyPath: normalizeText(readObjectValue(binding, ['CertificateKeyPath', 'certificateKeyPath'])),
    permissionSummary: formatLinuxPermissionSummary(permission),
    testCommand: normalizeText(readObjectValue(binding, ['TestCommand', 'testCommand'])),
    reloadCommand: normalizeText(readObjectValue(binding, ['ReloadCommand', 'reloadCommand'])),
    certificate: certificateRecord
      ? {
          subject: normalizeText(readObjectValue(certificateRecord, ['Subject', 'subject']), certificateName),
          issuer: normalizeText(readObjectValue(certificateRecord, ['Issuer', 'issuer'])),
          notBefore: normalizeDateTime(readObjectValue(certificateRecord, ['NotBefore', 'notBefore'])),
          notAfter: normalizeDateTime(readObjectValue(certificateRecord, ['NotAfter', 'notAfter'])),
          thumbprint: normalizeText(readObjectValue(certificateRecord, ['Thumbprint', 'thumbprint'])),
          fingerprintSha256: normalizeText(readObjectValue(certificateRecord, ['FingerprintSHA256', 'fingerprintSha256'])),
          storeName: normalizeText(readObjectValue(certificateRecord, ['StoreName', 'storeName']), 'FILE_PATH'),
          notAfterAt: parseDateTime(readObjectValue(certificateRecord, ['NotAfter', 'notAfter'])),
        }
      : certificateName !== EMPTY_TEXT
        ? {
            subject: certificateName,
            issuer: EMPTY_TEXT,
            notBefore: EMPTY_TEXT,
            notAfter: EMPTY_TEXT,
            thumbprint: EMPTY_TEXT,
            fingerprintSha256: EMPTY_TEXT,
            storeName: 'FILE_PATH',
            notAfterAt: null,
          }
      : null,
  }
}

function formatLinuxPermissionSummary(permission: Record<string, unknown> | null): string {
  if (!permission) return EMPTY_TEXT
  const mode = normalizeText(readObjectValue(permission, ['privilegeMode']), '')
  const helperRequired = readObjectValue(permission, ['helperRequired']) === true
  const certWritable = readObjectValue(permission, ['certPath', 'parentDirWritable']) === true
  const keyWritable = readObjectValue(permission, ['keyPath', 'parentDirWritable']) === true
  const parts: string[] = []
  if (mode) parts.push(t('agents.linux.permissionMode', { mode }))
  parts.push(t('agents.linux.certDirectoryWritable', { status: certWritable ? t('agents.common.writable') : t('agents.common.notWritable') }))
  parts.push(t('agents.linux.keyDirectoryWritable', { status: keyWritable ? t('agents.common.writable') : t('agents.common.notWritable') }))
  if (helperRequired) parts.push(t('agents.linux.helperRequired'))
  return parts.join(' / ')
}

function buildLinuxSites(detail: Record<string, unknown>): LinuxSiteView[] {
  return readObjectList(readObjectValue(detail, ['Sites', 'sites'])).map((site, index) => ({
    name: normalizeText(readObjectValue(site, ['Name', 'name']), t('agents.site.fallbackName', { index: index + 1 })),
    siteMode: normalizeText(readObjectValue(site, ['SiteMode', 'siteMode'])),
    sitePath: normalizeText(readObjectValue(site, ['SitePath', 'sitePath'])),
    serverNames: normalizeStringList(readObjectValue(site, ['ServerNames', 'serverNames'])),
    proxyTargets: normalizeStringList(readObjectValue(site, ['ProxyTargets', 'proxyTargets'])),
    configFiles: normalizeStringList(readObjectValue(site, ['ConfigFiles', 'configFiles'])),
    bindings: readObjectList(readObjectValue(site, ['Listen', 'listen'])).map(buildLinuxBindingView),
  }))
}

function countHttpsBindings(bindings: readonly LinuxBindingView[]): number {
  return bindings.filter((binding) => binding.protocol.toLowerCase() === 'https').length
}

function countUniqueCertificates(bindings: readonly LinuxBindingView[]): number {
  return new Set(bindings.map((binding) => binding.certificateName).filter((value) => value !== EMPTY_TEXT)).size
}

function readWindowsInspect(data: ApiRecord): Record<string, unknown> {
  const raw = readCapabilityValue(data, 'windows.os.detail')
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function readIpFromCapability(data: ApiRecord): string {
  const adapters = readCapabilityValue(data, 'windows.network.adapters')
  if (!Array.isArray(adapters)) return EMPTY_TEXT

  for (const adapter of adapters) {
    if (!adapter || typeof adapter !== 'object') continue
    const ipv4 = (adapter as Record<string, unknown>).IPv4
    if (Array.isArray(ipv4) && ipv4.length > 0) {
      return String(ipv4[0])
    }
  }

  return EMPTY_TEXT
}

function resolveIpAddress(data: ApiRecord): string {
  const ipAddress = readValue(data, ['agent.descriptor.ipAddress', 'descriptor.ipAddress', 'ipAddress'])
  return ipAddress !== EMPTY_TEXT ? ipAddress : readIpFromCapability(data)
}

function normalizeAgentRecord(record: ApiRecord): ApiRecord {
  const hostname = readValue(record, ['descriptor.hostname', 'hostname', 'agentKey', 'id'])
  const ipAddress = resolveIpAddress(record)
  const osType = readValue(record, ['descriptor.osType', 'osType', 'platform'])
  return {
    ...record,
    name: hostname,
    hostname,
    ipAddress,
    osType,
  }
}

async function loadAgentsPage(): Promise<ApiPageResult> {
  const result = await listAgents({ page: 1, pageSize: 20, sort: 'updatedAt:desc' })
  const page = result.data
  if (!page) return result

  return {
    ...result,
    data: {
      ...page,
      items: page.items.map((item) => normalizeAgentRecord(item)),
    },
  }
}

function buildRuntimeFields(data: ApiRecord, osType: string): DetailField[] {
  const version = readValue(data, ['agent.descriptor.version', 'descriptor.version', 'version'])
  const arch = readValue(data, ['agent.descriptor.arch', 'descriptor.arch', 'arch'])
  const ipAddress = resolveIpAddress(data)

  if (osType.toUpperCase() === 'WINDOWS') {
    const windowsInspect = readWindowsInspect(data)
    const productNameValue = readObjectValue(windowsInspect, ['ProductName', 'productName'])
    const buildRevisionValue = readObjectValue(windowsInspect, ['BuildRevision', 'buildRevision', 'BuildNumber', 'buildNumber'])
    const productName = typeof productNameValue === 'string' && productNameValue.trim() !== ''
      ? productNameValue
      : readValue(data, ['agent.descriptor.osVersion', 'descriptor.osVersion', 'osVersion'])
    const patchVersion = normalizeText(buildRevisionValue)

    return [
      { label: t('agents.fields.ipAddress'), value: ipAddress, emphasis: true },
      { label: t('agents.fields.osType'), value: osType },
      { label: t('agents.fields.arch'), value: arch },
      { label: t('agents.fields.agentVersion'), value: version },
      { label: t('agents.fields.osVersion'), value: productName },
      { label: t('agents.fields.patchVersion'), value: patchVersion },
    ]
  }

  const linuxDistribution = readValue(data, ['agent.descriptor.linuxDistribution', 'descriptor.linuxDistribution', 'linuxDistribution'])
  const osVersion = readValue(data, ['agent.descriptor.osVersion', 'descriptor.osVersion', 'osVersion'])

  return [
    { label: t('agents.fields.ipAddress'), value: ipAddress, emphasis: true },
    { label: t('agents.fields.osType'), value: osType },
    { label: t('agents.fields.arch'), value: arch },
    { label: t('agents.fields.agentVersion'), value: version },
    { label: t('agents.fields.linuxDistribution'), value: linuxDistribution },
    { label: t('agents.fields.osVersion'), value: osVersion },
  ]
}

function formatHealthStatus(value: unknown): string {
  const status = normalizeText(value, '').toLowerCase()
  if (status === 'healthy') return t('agents.health.healthy')
  if (status === 'degraded') return t('agents.health.degraded')
  if (status === 'failed') return t('agents.health.failed')
  if (status === 'unknown') return t('agents.health.unknown')
  return status ? status.toUpperCase() : EMPTY_TEXT
}

function formatBooleanText(value: unknown): string {
  if (value === true) return t('agents.common.yes')
  if (value === false) return t('agents.common.no')
  return EMPTY_TEXT
}

function buildHealthSummary(data: ApiRecord): string {
  const offline = readPath(data, 'health.offline') === true
  const degradedReasons = normalizeText(readPath(data, 'health.degradedReasons'), '')
  const lastError = normalizeText(readPath(data, 'health.lastError'), '')
  const offlineEvidence = normalizeText(readPath(data, 'health.offlineEvidence'), '')

  if (offline && offlineEvidence) return offlineEvidence
  if (degradedReasons) return degradedReasons
  if (lastError) return lastError
  return EMPTY_TEXT
}

function buildHealthFields(data: ApiRecord): DetailField[] {
  return [
    { label: t('agents.fields.healthStatus'), value: formatHealthStatus(readPath(data, 'health.status')), emphasis: true },
    { label: t('agents.fields.offlineDetected'), value: formatBooleanText(readPath(data, 'health.offline')), emphasis: true },
    { label: t('agents.fields.lastHeartbeat'), value: normalizeDateTime(readPath(data, 'health.lastHeartbeatAt') ?? readPath(data, 'latestHeartbeat.receivedAt')) },
    { label: t('agents.fields.lastRecoveryAt'), value: normalizeDateTime(readPath(data, 'health.lastRecoveryAt')) },
    { label: t('agents.fields.lastReportAt'), value: normalizeDateTime(readPath(data, 'health.lastTaskResultAt')), emphasis: true },
    { label: t('agents.fields.healthSummary'), value: buildHealthSummary(data) },
  ]
}

function buildIisSites(data: ApiRecord): IisSiteView[] {
  const rawSites = readCapabilityValue(data, 'windows.iis.sites')
  if (!Array.isArray(rawSites)) return []

  return rawSites
    .filter((site): site is Record<string, unknown> => Boolean(site) && typeof site === 'object')
    .map((site, index) => {
      const bindingsValue = readObjectValue(site, ['Bindings', 'bindings'])
      const bindingsRaw = Array.isArray(bindingsValue) ? bindingsValue : []
      const bindings = bindingsRaw
        .filter((binding): binding is Record<string, unknown> => Boolean(binding) && typeof binding === 'object')
        .map((binding) => {
          const certificateValue = readObjectValue(binding, ['Certificate', 'certificate'])
          const certificate = certificateValue && typeof certificateValue === 'object'
            ? certificateValue as Record<string, unknown>
            : null
          return {
            protocol: normalizeText(readObjectValue(binding, ['Protocol', 'protocol'])),
            port: normalizeText(readObjectValue(binding, ['Port', 'port'])),
            hostHeader: normalizeText(readObjectValue(binding, ['HostHeader', 'hostHeader'])),
            certificateSubject: certificate ? normalizeText(readObjectValue(certificate, ['Subject', 'subject'])) : EMPTY_TEXT,
            certificateThumbprint: normalizeText(readObjectValue(binding, ['CertificateThumbprint', 'certificateThumbprint'])),
            certificate: certificate
              ? {
                  subject: normalizeText(readObjectValue(certificate, ['Subject', 'subject'])),
                  issuer: normalizeText(readObjectValue(certificate, ['Issuer', 'issuer'])),
                  notBefore: normalizeDateTime(readObjectValue(certificate, ['NotBefore', 'notBefore'])),
                  notAfter: normalizeDateTime(readObjectValue(certificate, ['NotAfter', 'notAfter'])),
                  thumbprint: normalizeText(readObjectValue(certificate, ['Thumbprint', 'thumbprint'])),
                  fingerprintSha256: normalizeText(readObjectValue(certificate, ['FingerprintSHA256', 'fingerprintSha256'])),
                  storeName: normalizeText(readObjectValue(certificate, ['StoreName', 'storeName'])),
                  notAfterAt: parseDateTime(readObjectValue(certificate, ['NotAfter', 'notAfter'])),
                }
              : null,
          }
        })

      return {
        name: normalizeText(readObjectValue(site, ['Name', 'name']), t('agents.site.fallbackName', { index: index + 1 })),
        physicalPath: normalizeText(readObjectValue(site, ['PhysicalPath', 'physicalPath'])),
        appPool: normalizeText(readObjectValue(site, ['AppPool', 'appPool'])),
        state: normalizeText(readObjectValue(site, ['State', 'state'])),
        bindings,
      }
    })
}

function buildIisSections(data: ApiRecord): DetailSection[] {
  const iisDetail = readCapabilityValue(data, 'windows.iis.detail')
  const iis = iisDetail && typeof iisDetail === 'object' ? iisDetail as Record<string, unknown> : {}
  const sites = buildIisSites(data)
  const installed = readObjectValue(iis, ['Installed', 'installed'])
  const versionString = normalizeText(readObjectValue(iis, ['VersionString', 'versionString']))
  const httpsBindings = sites.flatMap((site) => site.bindings).filter((binding) => binding.protocol.toLowerCase() === 'https')
  const uniqueAppPools = new Set(sites.map((site) => site.appPool).filter((value) => value !== EMPTY_TEXT))
  const uniqueCertificates = new Set(
    httpsBindings
      .map((binding) => binding.certificateSubject)
      .filter((value) => value !== EMPTY_TEXT),
  )

  const overview: DetailSection = {
    title: t('agents.sections.iisOverviewTitle'),
    description: t('agents.sections.iisOverviewDescription'),
    fields: [
      { label: t('agents.fields.installStatus'), value: installed === true ? t('agents.status.installed') : t('agents.status.notInstalled'), emphasis: true },
      { label: t('agents.fields.iisVersion'), value: versionString },
      { label: t('agents.fields.siteCount'), value: String(sites.length), emphasis: true },
      { label: t('agents.fields.httpsBinding'), value: String(httpsBindings.length) },
      { label: t('agents.fields.appPool'), value: String(uniqueAppPools.size) },
      { label: t('agents.fields.certificateSubject'), value: String(uniqueCertificates.size) },
    ],
  }

  const siteSection: DetailSection = {
    title: t('agents.sections.iisSitesTitle'),
    description: t('agents.sections.iisSitesDescription'),
    variant: 'iis-sites',
    fields: sites.length > 0
      ? sites.map((site) => ({
          label: site.name,
          value: site.physicalPath,
          meta: site,
        }))
      : [{ label: t('agents.fields.siteList'), value: t('agents.empty.noIisSites') }],
  }

  return [overview, siteSection]
}

function buildLinuxFrameworkSections(
  titlePrefix: string,
  detail: Record<string, unknown>,
  options: { extraLabel?: string; extraValueKeys?: readonly string[] } = {},
): DetailSection[] {
  const sites = buildLinuxSites(detail)
  const bindings = sites.flatMap((site) => site.bindings)
  const httpsBindings = countHttpsBindings(bindings)
  const uniqueCertificates = countUniqueCertificates(bindings)
  const serviceName = normalizeText(readObjectValue(detail, ['Service', 'serviceName', 'service']))
  const overview: DetailSection = {
    title: t('agents.sections.frameworkOverviewTitle', { name: titlePrefix }),
    description: t('agents.sections.frameworkOverviewDescription', { name: titlePrefix }),
    fields: [
      { label: t('agents.fields.installStatus'), value: formatInstallStatus(readObjectValue(detail, ['Installed', 'installed'])), emphasis: true },
      { label: t('agents.fields.runningStatus'), value: formatRunningStatus(readObjectValue(detail, ['Running', 'running'])), emphasis: true },
      { label: t('agents.fields.frameworkVersion', { name: titlePrefix }), value: normalizeText(readObjectValue(detail, ['Version', 'version'])) },
      { label: t('agents.fields.serviceName'), value: serviceName },
      { label: t('agents.fields.binaryPath'), value: normalizeText(readObjectValue(detail, ['BinaryPath', 'binaryPath'])) },
      { label: t('agents.fields.configPath'), value: normalizeText(readObjectValue(detail, ['ConfigPath', 'configPath'])) },
      { label: t('agents.fields.siteCount'), value: String(sites.length), emphasis: true },
      { label: t('agents.fields.httpsListen'), value: String(httpsBindings) },
      { label: t('agents.fields.certificateSubject'), value: String(uniqueCertificates) },
      ...(options.extraLabel
        ? [{ label: options.extraLabel, value: normalizeText(readObjectValue(detail, options.extraValueKeys ?? [])) }]
        : []),
    ],
  }

  const siteSection: DetailSection = {
    title: t('agents.sections.frameworkSitesTitle', { name: titlePrefix }),
    description: t('agents.sections.frameworkSitesDescription', { name: titlePrefix }),
    variant: 'linux-sites',
    fields: sites.length > 0
      ? sites.map((site) => ({
          label: site.name,
          value: site.sitePath,
          meta: site,
        }))
      : [{ label: t('agents.fields.siteList'), value: t('agents.empty.noFrameworkSites', { name: titlePrefix }) }],
  }

  return [overview, siteSection]
}

function buildNginxSections(data: ApiRecord): DetailSection[] {
  return buildLinuxFrameworkSections('Nginx', readCapabilityRecord(data, 'linux.nginx.detail'), { extraLabel: t('agents.fields.installPrefix'), extraValueKeys: ['Prefix', 'prefix'] })
}

function buildApacheSections(data: ApiRecord): DetailSection[] {
  return buildLinuxFrameworkSections('Apache', readCapabilityRecord(data, 'linux.apache.detail'), { extraLabel: 'ServerRoot', extraValueKeys: ['ServerRoot', 'serverRoot'] })
}

function buildTomcatConnectors(data: ApiRecord): TomcatConnectorView[] {
  const detail = readCapabilityRecord(data, 'linux.tomcat.detail')
  return readObjectList(readObjectValue(detail, ['Connectors', 'connectors'])).map((connector) => ({
    protocol: normalizeText(readObjectValue(connector, ['Protocol', 'protocol'])),
    port: normalizePortText(readObjectValue(connector, ['Port', 'port'])),
    address: normalizeText(readObjectValue(connector, ['Address', 'address'])),
    tls: readObjectValue(connector, ['TLS', 'tls']) === true,
    certificateName: normalizeText(readObjectValue(connector, ['CertificateName', 'certificateName'])),
    certificatePath: normalizeText(readObjectValue(connector, ['CertificatePath', 'certificatePath'])),
    certificateKeyPath: normalizeText(readObjectValue(connector, ['CertificateKeyPath', 'certificateKeyPath'])),
    keystorePath: normalizeText(readObjectValue(connector, ['KeystorePath', 'keystorePath'])),
    certificate: (() => {
      const certificateValue = readObjectValue(connector, ['Certificate', 'certificate'])
      const certificateRecord = certificateValue && typeof certificateValue === 'object'
        ? certificateValue as Record<string, unknown>
        : null
      if (certificateRecord) {
        return {
          subject: normalizeText(readObjectValue(certificateRecord, ['Subject', 'subject']), normalizeText(readObjectValue(connector, ['CertificateName', 'certificateName']))),
          issuer: normalizeText(readObjectValue(certificateRecord, ['Issuer', 'issuer'])),
          notBefore: normalizeDateTime(readObjectValue(certificateRecord, ['NotBefore', 'notBefore'])),
          notAfter: normalizeDateTime(readObjectValue(certificateRecord, ['NotAfter', 'notAfter'])),
          thumbprint: normalizeText(readObjectValue(certificateRecord, ['Thumbprint', 'thumbprint'])),
          fingerprintSha256: normalizeText(readObjectValue(certificateRecord, ['FingerprintSHA256', 'fingerprintSha256'])),
          storeName: normalizeText(readObjectValue(certificateRecord, ['StoreName', 'storeName']), normalizeText(readObjectValue(connector, ['KeystorePath', 'keystorePath']))),
          notAfterAt: parseDateTime(readObjectValue(certificateRecord, ['NotAfter', 'notAfter'])),
        }
      }
      return normalizeText(readObjectValue(connector, ['CertificateName', 'certificateName'])) !== EMPTY_TEXT
      ? {
          subject: normalizeText(readObjectValue(connector, ['CertificateName', 'certificateName'])),
          issuer: EMPTY_TEXT,
          notBefore: EMPTY_TEXT,
          notAfter: EMPTY_TEXT,
          thumbprint: EMPTY_TEXT,
          fingerprintSha256: EMPTY_TEXT,
          storeName: normalizeText(readObjectValue(connector, ['KeystorePath', 'keystorePath'])),
          notAfterAt: null,
        }
      : null
    })(),
  }))
}

function buildTomcatApps(data: ApiRecord): TomcatAppView[] {
  const detail = readCapabilityRecord(data, 'linux.tomcat.detail')
  return readObjectList(readObjectValue(detail, ['Apps', 'apps'])).map((app) => ({
    contextPath: normalizeText(readObjectValue(app, ['ContextPath', 'contextPath'])),
    docBase: normalizeText(readObjectValue(app, ['DocBase', 'docBase'])),
    appBase: normalizeText(readObjectValue(app, ['AppBase', 'appBase'])),
  }))
}

function buildTomcatSections(data: ApiRecord): DetailSection[] {
  const detail = readCapabilityRecord(data, 'linux.tomcat.detail')
  const connectors = buildTomcatConnectors(data)
  const apps = buildTomcatApps(data)
  const httpsConnectors = connectors.filter((connector) => connector.tls).length
  const uniqueCertificates = new Set(connectors.map((connector) => connector.certificateName).filter((value) => value !== EMPTY_TEXT)).size

  return [
    {
      title: t('agents.sections.tomcatOverviewTitle'),
      description: t('agents.sections.tomcatOverviewDescription'),
      fields: [
        { label: t('agents.fields.installStatus'), value: formatInstallStatus(readObjectValue(detail, ['Installed', 'installed'])), emphasis: true },
        { label: t('agents.fields.runningStatus'), value: formatRunningStatus(readObjectValue(detail, ['Running', 'running'])), emphasis: true },
        { label: t('agents.fields.tomcatVersion'), value: normalizeText(readObjectValue(detail, ['Version', 'version'])) },
        { label: t('agents.fields.serviceName'), value: normalizeText(readObjectValue(detail, ['Service', 'serviceName', 'service'])) },
        { label: 'Catalina Home', value: normalizeText(readObjectValue(detail, ['CatalinaHome', 'catalinaHome'])) },
        { label: 'Catalina Base', value: normalizeText(readObjectValue(detail, ['CatalinaBase', 'catalinaBase'])) },
        { label: t('agents.fields.configPath'), value: normalizeText(readObjectValue(detail, ['ConfigPath', 'configPath'])) },
        { label: t('agents.fields.connectorCount'), value: String(connectors.length), emphasis: true },
        { label: t('agents.fields.tlsConnector'), value: String(httpsConnectors) },
        { label: t('agents.fields.certificateSubject'), value: String(uniqueCertificates) },
        { label: t('agents.fields.appCount'), value: String(apps.length), emphasis: true },
      ],
    },
    {
      title: t('agents.sections.tomcatConnectorsTitle'),
      description: t('agents.sections.tomcatConnectorsDescription'),
      variant: 'tomcat-connectors',
      fields: connectors.length > 0
        ? connectors.map((connector, index) => ({
            label: `${connector.protocol !== EMPTY_TEXT ? connector.protocol : 'Connector'}:${connector.port}`,
            value: connector.address,
            meta: { ...connector, index },
          }))
        : [{ label: t('agents.fields.connectorList'), value: t('agents.empty.noTomcatConnectors') }],
    },
    {
      title: t('agents.sections.tomcatAppsTitle'),
      description: t('agents.sections.tomcatAppsDescription'),
      variant: 'tomcat-apps',
      fields: apps.length > 0
        ? apps.map((app, index) => ({
            label: app.contextPath !== EMPTY_TEXT ? app.contextPath : t('agents.app.fallbackName', { index: index + 1 }),
            value: app.docBase,
            meta: app,
          }))
        : [{ label: t('agents.fields.appList'), value: t('agents.empty.noTomcatApps') }],
    },
  ]
}

function buildRuntimeLogs(data: ApiRecord): RuntimeLogView[] {
  const recentTaskLogs = readPath(data, 'recentTaskLogs')
  if (Array.isArray(recentTaskLogs) && recentTaskLogs.length > 0) {
    return recentTaskLogs
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item, index) => {
        const taskType = normalizeText(readObjectValue(item, ['taskType']), 'unknown.task')
        const siteName = normalizeText(readObjectValue(item, ['siteName']), EMPTY_TEXT)
        const bindingInformation = normalizeText(readObjectValue(item, ['bindingInformation']), EMPTY_TEXT)
        const message = normalizeText(readObjectValue(item, ['message']), EMPTY_TEXT)
        return {
          id: normalizeText(readObjectValue(item, ['id']), `task-log-${index + 1}`),
          taskType,
          siteName,
          bindingInformation,
          dryRun: readObjectValue(item, ['dryRun']) === true,
          category: taskType,
          level: normalizeText(readObjectValue(item, ['level'])),
          summary: message,
          emittedAt: normalizeDateTime(readObjectValue(item, ['emittedAt'])),
          detail: message,
          rawDetail: JSON.stringify({
            taskId: normalizeText(readObjectValue(item, ['taskId']), ''),
            executionStepId: normalizeText(readObjectValue(item, ['executionStepId']), ''),
            taskType,
            siteName: siteName === EMPTY_TEXT ? undefined : siteName,
            bindingInformation: bindingInformation === EMPTY_TEXT ? undefined : bindingInformation,
            dryRun: readObjectValue(item, ['dryRun']) === true,
            message,
          }, null, 2),
        }
      })
  }

  const raw = readPath(data, 'runtimeLogs')
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item, index) => {
      const rawDetailValue = readObjectValue(item, ['detail'])
      const rawDetail = typeof rawDetailValue === 'string'
        ? rawDetailValue.trim()
        : (rawDetailValue && typeof rawDetailValue === 'object' ? JSON.stringify(rawDetailValue, null, 2) : '')

      return {
        id: `runtime-log-${index + 1}`,
        taskType: EMPTY_TEXT,
        siteName: EMPTY_TEXT,
        bindingInformation: EMPTY_TEXT,
        dryRun: false,
        category: normalizeText(readObjectValue(item, ['category'])),
        level: normalizeText(readObjectValue(item, ['level'])),
        summary: normalizeText(readObjectValue(item, ['summary'])),
        emittedAt: normalizeDateTime(readObjectValue(item, ['emittedAt'])),
        detail: rawDetail || EMPTY_TEXT,
        rawDetail,
      }
    })
}

function buildRuntimeLogSections(data: ApiRecord): DetailSection[] {
  const logs = buildRuntimeLogs(data)
  const lastCapabilityReportedAt = normalizeDateTime(readPath(data, 'capabilitySnapshot.reportedAt'))
  return [
    {
      title: t('agents.sections.logOverviewTitle'),
      description: t('agents.sections.logOverviewDescription'),
      fields: [
        { label: t('agents.fields.lastCapabilityReportAt'), value: lastCapabilityReportedAt },
      ],
    },
    {
      title: t('agents.sections.runtimeLogsTitle'),
      description: t('agents.sections.runtimeLogsDescription'),
      variant: 'runtime-logs',
      fields: logs.length > 0
        ? logs.map((log, index) => ({
            label: `${log.level.toUpperCase()} / ${log.taskType !== EMPTY_TEXT ? log.taskType : log.category}`,
            value: log.summary,
            meta: { ...log, index },
          }))
        : [{ label: t('agents.fields.runtimeLog'), value: t('agents.empty.noRuntimeLogs') }],
    },
  ]
}

function hasIisCapability(data: ApiRecord): boolean {
  const iisDetail = readCapabilityValue(data, 'windows.iis.detail')
  const iis = iisDetail && typeof iisDetail === 'object' ? iisDetail as Record<string, unknown> : {}
  const installedValue = readObjectValue(iis, ['Installed', 'installed'])
  const installed = installedValue === true || String(installedValue).toLowerCase() === 'true'
  return installed || buildIisSites(data).length > 0
}

function hasLinuxFrameworkCapability(data: ApiRecord, capabilityKey: string, collectionKeys: readonly string[]): boolean {
  const detail = readCapabilityRecord(data, capabilityKey)
  const installedValue = readObjectValue(detail, ['Installed', 'installed'])
  const installed = installedValue === true || String(installedValue).toLowerCase() === 'true'
  if (installed) return true
  return collectionKeys.some((key) => readObjectList(readObjectValue(detail, [key, key.toLowerCase()])).length > 0)
}

function buildAgentDetail(data: ApiRecord, fallbackRow?: ViewRow): AgentDetailView {
  const hostname = readValue(data, ['agent.descriptor.hostname', 'descriptor.hostname', 'hostname'], fallbackRow?.name ?? EMPTY_TEXT)
  const agentId = readValue(data, ['agent.id', 'id'])
  const agentKey = readValue(data, ['agent.agentKey', 'agentKey'], agentId)
  const status = readValue(data, ['agent.status', 'agent.state', 'status'], fallbackRow?.status ?? 'UNKNOWN')
  const osType = readValue(data, ['agent.descriptor.osType', 'descriptor.osType', 'osType', 'platform'])
  const role = readValue(data, ['agent.role', 'role', 'agentRole'])
  const zone = readValue(data, ['agent.zone', 'zone', 'zoneId'])
  const lastHeartbeat = readValue(data, ['latestHeartbeat.receivedAt', 'agent.gateway.lastHeartbeatAt', 'agent.updatedAt', 'updatedAt'])
  const canPullTasks = readPath(data, 'lifecycle.canPullTasks') === true
  const osTypeUpper = osType.toUpperCase()
  const canManualRescan = canPullTasks && ['WINDOWS', 'LINUX'].includes(osTypeUpper)
  const manualRescanDisabledReason = canManualRescan
    ? ''
    : (!['WINDOWS', 'LINUX'].includes(osTypeUpper)
        ? t('agents.detail.manualRescanUnsupportedType')
        : t('agents.detail.manualRescanCannotPullTasks'))

  const tabs: DetailTab[] = [
    {
      key: 'overview',
      label: t('agents.tabs.overview'),
      sections: [
        {
          title: t('agents.sections.mainInfoTitle'),
          description: t('agents.sections.mainInfoDescription'),
          fields: [
            { label: t('agents.fields.hostname'), value: hostname, emphasis: true },
            { label: 'Agent ID', value: agentId },
            { label: 'Agent Key', value: agentKey },
            { label: t('agents.fields.role'), value: role },
            { label: t('agents.fields.zone'), value: zone },
            { label: t('agents.fields.lastHeartbeat'), value: normalizeDateTime(lastHeartbeat) },
          ],
        },
        {
          title: t('agents.sections.runtimeTitle'),
          description: t('agents.sections.runtimeDescription'),
          fields: buildRuntimeFields(data, osType),
        },
        {
          title: t('agents.sections.healthTitle'),
          description: t('agents.sections.healthDescription'),
          fields: buildHealthFields(data),
        },
      ],
    },
  ]

  if (hasIisCapability(data)) {
    tabs.push({
      key: 'iis',
      label: 'IIS',
      sections: buildIisSections(data),
    })
  }

  if (hasLinuxFrameworkCapability(data, 'linux.nginx.detail', ['Sites'])) {
    tabs.push({
      key: 'nginx',
      label: 'Nginx',
      sections: buildNginxSections(data),
    })
  }

  if (hasLinuxFrameworkCapability(data, 'linux.apache.detail', ['Sites'])) {
    tabs.push({
      key: 'apache',
      label: 'Apache',
      sections: buildApacheSections(data),
    })
  }

  if (hasLinuxFrameworkCapability(data, 'linux.tomcat.detail', ['Connectors', 'Apps'])) {
    tabs.push({
      key: 'tomcat',
      label: 'Tomcat',
      sections: buildTomcatSections(data),
    })
  }

  tabs.push({
    key: 'logs',
    label: t('agents.tabs.logs'),
    sections: buildRuntimeLogSections(data),
  })

  return {
    id: agentId,
    title: hostname,
    subtitle: `${agentKey} / ${agentId}`,
    status,
    spotlightLabel: t('agents.fields.ipAddress'),
    spotlightValue: resolveIpAddress(data),
    tabs,
    canManualRescan,
    manualRescanDisabledReason,
  }
}

function ensureCountdown() {
  if (countdownTimer) return
  now.value = Date.now()
  countdownTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function stopCountdown() {
  if (!countdownTimer) return
  clearInterval(countdownTimer)
  countdownTimer = null
}

function isRuntimeLogExpanded(logId: string): boolean {
  return expandedRuntimeLogIds.value.includes(logId)
}

function toggleRuntimeLog(logId: string) {
  expandedRuntimeLogIds.value = isRuntimeLogExpanded(logId)
    ? expandedRuntimeLogIds.value.filter((item) => item !== logId)
    : [...expandedRuntimeLogIds.value, logId]
}

watch(
  () => installModalOpen.value && installSession.value !== null,
  (active) => {
    if (active) ensureCountdown()
    else stopCountdown()
  },
)

onBeforeUnmount(stopCountdown)

function openInstallModal() {
  installModalOpen.value = true
}

function closeInstallModal() {
  if (installPending.value) return
  installModalOpen.value = false
}

function closeDetailModal() {
  if (detailLoading.value || detailActionPending.value) return
  detailModalOpen.value = false
}

function openCertificateModal(siteName: string, binding: IisBindingView) {
  if (!binding.certificate) return
  selectedCertificate.value = { siteName, binding }
  certificateAssetError.value = ''
  certificateModalOpen.value = true
}

function closeCertificateModal() {
  certificateModalOpen.value = false
  selectedCertificate.value = null
  certificateAssetPending.value = false
  certificateAssetError.value = ''
}

function buildCertificateContextUsage(siteName: string, binding: CertificateBindingView): ApiRecord {
  const endpointLabel = `${binding.protocol.toUpperCase()}:${binding.port}`
  const hostHeader = 'hostHeader' in binding && binding.hostHeader !== EMPTY_TEXT
    ? binding.hostHeader
    : ('address' in binding && binding.address !== EMPTY_TEXT ? binding.address : '')
  const domainName = hostHeader || binding.certificate?.subject || siteName
  const resourceType = 'hostHeader' in binding
    ? t('agents.certificateUsage.iisSite')
    : ('keystorePath' in binding ? t('agents.certificateUsage.tomcatConnector') : t('agents.certificateUsage.linuxSite'))
  const bindingType = 'hostHeader' in binding
    ? 'WINDOWS_CERT_STORE'
    : 'FILE_PATH'
  return {
    id: `agent-cert:${siteName}:${binding.protocol}:${binding.port}:${hostHeader || 'no-host-header'}`,
    resourceId: `agent-cert:${siteName}`,
    resourceName: `${siteName} / ${endpointLabel}`,
    targetName: siteName,
    domainName,
    bindingType,
    resourceType,
    status: 'ACTIVE',
    metadata: {
      source: 'agent_context',
      siteName,
      protocol: binding.protocol,
      port: binding.port,
      hostHeader: hostHeader || ('hostHeader' in binding ? t('agents.common.noHostHeader') : t('agents.common.noListenAddress')),
      certificatePath: 'certificatePath' in binding ? binding.certificatePath : EMPTY_TEXT,
      certificateKeyPath: 'certificateKeyPath' in binding ? binding.certificateKeyPath : EMPTY_TEXT,
      keystorePath: 'keystorePath' in binding ? binding.keystorePath : EMPTY_TEXT,
      certificateSubject: binding.certificate?.subject ?? EMPTY_TEXT,
    },
  }
}

function openCertificateAssetModal(route: { assetId: string; versionId: string }, siteName: string, binding: CertificateBindingView) {
  selectedCertificateAssetRoute.value = route
  certificateContextUsages.value = [buildCertificateContextUsage(siteName, binding)]
  certificateAssetDetailOpen.value = true
}

function closeCertificateAssetModal() {
  certificateAssetDetailOpen.value = false
  selectedCertificateAssetRoute.value = null
  certificateContextUsages.value = []
}

async function resolveCertificateAssetRoute(certificate: BindingCertificateView): Promise<{ assetId: string; versionId: string } | null> {
  const normalizedThumbprint = normalizeHex(certificate.thumbprint)
  const normalizedSha256 = normalizeHex(certificate.fingerprintSha256)
  const certificateFingerprint = normalizedSha256 || (normalizedThumbprint.length === 64 ? normalizedThumbprint : '')
  if (!certificateFingerprint) return null
  const result = await listCertificateVersions({
    page: 1,
    pageSize: 20,
    keyword: certificateFingerprint,
  })
  const items = Array.isArray(result.data?.items) ? result.data.items : []
  const matched = items.find((item) => {
    const versionId = normalizeText(readPath(item, 'id'), '')
    const assetId = normalizeText(readPath(item, 'certificateAssetId'), '')
    if (!versionId || versionId === EMPTY_TEXT || !assetId || assetId === EMPTY_TEXT) return false

    const fingerprintSha256 = normalizeHex(normalizeText(readPath(item, 'fingerprintSha256'), ''))
    return fingerprintSha256 === certificateFingerprint
  }) as ApiRecord | undefined

  if (!matched) return null

  const assetId = normalizeText(readPath(matched, 'certificateAssetId'), '')
  const versionId = normalizeText(readPath(matched, 'id'), '')
  if (assetId === EMPTY_TEXT || versionId === EMPTY_TEXT) {
    throw new Error(t('agents.errors.certificateAssetIncomplete'))
  }

  return { assetId, versionId }
}

async function openCertificateAssetDetail() {
  const currentSelection = selectedCertificate.value
  const certificate = currentSelection?.binding.certificate
  if (!currentSelection || !certificate || certificateAssetPending.value) return

  certificateAssetPending.value = true
  certificateAssetError.value = ''

  try {
    const route = await resolveCertificateAssetRoute(certificate)
    if (!route) {
      certificateAssetError.value = t('agents.errors.certificateAssetNotFound')
      return
    }
    openCertificateAssetModal(route, currentSelection.siteName, currentSelection.binding)
  } catch (cause) {
    certificateAssetError.value = cause instanceof Error ? cause.message : t('agents.errors.certificateAssetQueryFailed')
  } finally {
    certificateAssetPending.value = false
  }
}

async function openBindingCertificate(siteName: string, binding: CertificateBindingView) {
  if (!binding.certificate || certificateAssetPending.value) return

  certificateAssetError.value = ''
  selectedCertificate.value = { siteName, binding }
  certificateModalOpen.value = true
}

async function generateInstallCommand() {
  installPending.value = true
  installError.value = ''

  try {
    const result = selectedPlatform.value === 'linux_go_systemd'
      ? await createLinuxGoInstallSession({ zone: 'default', version: selectedVersion.value })
      : await createWindowsPowerShellInstallSession({
          zone: 'default',
          startAfterInstall: true,
          version: selectedVersion.value,
        })

    const data = result.data
    if (!data || typeof data.installCommand !== 'string') {
      throw new Error(t('agents.errors.installCommandMissing'))
    }

    const rawBootstrapUrl = typeof data.bootstrapUrl === 'string' ? data.bootstrapUrl : ''
    const bootstrapUrl = rewriteInstallUrlWithBrowserOrigin(rawBootstrapUrl)

    installSession.value = {
      platform: selectedPlatform.value,
      bootstrapTokenPreview: typeof data.bootstrapTokenPreview === 'string' ? data.bootstrapTokenPreview : '',
      zone: typeof data.zone === 'string' ? data.zone : 'default',
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
      installCommand: buildInstallCommand(selectedPlatform.value, bootstrapUrl, data.installCommand),
    }
    copiedText.value = null
    ensureCountdown()
  } catch (cause) {
    installError.value = cause instanceof Error ? cause.message : t('agents.errors.generateInstallCommandFailed')
  } finally {
    installPending.value = false
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 回退到 document.execCommand，兼容旧环境。
    }
  }

  try {
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
  } catch {
    return false
  }
}

async function copyToken() {
  const token = installSession.value?.bootstrapTokenPreview
  if (!token) return
  if (await copyToClipboard(token)) copiedText.value = 'token'
}

async function copyInstallCommand() {
  if (!installCommand.value) return
  if (await copyToClipboard(installCommand.value)) copiedText.value = 'command'
}

function rewriteInstallUrlWithBrowserOrigin(rawUrl: string): string {
  if (!rawUrl) return ''
  if (typeof window === 'undefined' || !window.location?.origin) return rawUrl

  try {
    const parsed = new URL(rawUrl, window.location.origin)
    return `${window.location.origin}${parsed.pathname}${parsed.search}`
  } catch {
    return rawUrl
  }
}

function buildInstallCommand(platform: InstallPlatform, bootstrapUrl: string, fallbackCommand: string): string {
  if (!bootstrapUrl) return fallbackCommand
  if (platform === 'linux_go_systemd') {
    return `curl -fsSL '${bootstrapUrl}' | sudo bash`
  }
  return `irm '${bootstrapUrl}' | iex`
}

async function openDetailModal(row: ViewRow) {
  detailModalOpen.value = true
  detailLoading.value = true
  detailActionPending.value = false
  detailActionMessage.value = ''
  detailError.value = ''
  expandedRuntimeLogIds.value = []
  activeDetailTab.value = 'overview'
  detailData.value = buildAgentDetail(row.raw, row)

  try {
    const result = await getAgentDetail(row.id)
    if (!result.data) {
      throw new Error(t('agents.errors.detailDataMissing'))
    }
    detailData.value = buildAgentDetail(result.data, row)
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : t('agents.errors.loadDetailFailed')
  } finally {
    detailLoading.value = false
  }
}

async function triggerManualRescan() {
  if (!detailData.value || detailActionPending.value || !detailData.value.canManualRescan) return
  detailActionPending.value = true
  detailActionMessage.value = ''
  try {
    await requestAgentCapabilityRescan(detailData.value.id)
    detailActionMessage.value = t('agents.detail.manualRescanCreated')
  } catch (cause) {
    detailActionMessage.value = cause instanceof Error ? cause.message : t('agents.errors.manualRescanFailed')
  } finally {
    detailActionPending.value = false
  }
}

const config = computed<BusinessPageConfig>(() => ({
  title: 'Agent',
  description: t('agents.page.description'),
  readPermission: 'agent.read',
  primaryPermission: 'agent.write',
  primaryActionLabel: t('agents.page.installAgent'),
  primaryAction: openInstallModal,
  moduleName: 'agents',
  resourceName: 'Agent',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: t('agents.columns.hostname'), candidates: ['descriptor.hostname', 'hostname', 'agentKey', 'id'] },
    { key: 'ipAddress', title: t('agents.columns.ipAddress'), candidates: ['descriptor.ipAddress', 'ipAddress'] },
    { key: 'osType', title: t('agents.columns.osType'), candidates: ['descriptor.osType', 'osType', 'platform'] },
    { key: 'status', title: t('agents.columns.onlineStatus'), candidates: ['status', 'state'] },
    { key: 'version', title: t('agents.columns.version'), candidates: ['descriptor.version', 'version'] },
    { key: 'lastSeenAt', title: t('agents.columns.lastHeartbeat'), candidates: ['lastSeenAt', 'updatedAt', 'registeredAt'], kind: 'date' },
    { key: 'actions', title: t('agents.columns.actions'), candidates: [] },
  ],
  metrics: [
    { title: t('agents.metrics.totalTitle'), description: t('agents.metrics.totalDescription'), status: 'ONLINE', risk: 'MEDIUM' },
    { title: t('agents.metrics.abnormalTitle'), description: t('agents.metrics.abnormalDescription'), status: 'OFFLINE', risk: 'HIGH' },
  ],
  emptyTitle: t('agents.empty.title'),
  emptyDescription: t('agents.empty.description'),
  load: loadAgentsPage,
  actions: [],
  rowActions: [
    {
      label: t('agents.actions.detail'),
      permission: 'agent.read',
      reloadAfterRun: false,
      run: openDetailModal,
    },
    {
      label: t('agents.actions.disable'),
      permission: 'agent.write',
      danger: true,
      confirmText: 'DISABLE',
      riskText: t('agents.actions.disableRisk'),
      hidden: (row) => String(row.status).toUpperCase() === 'DISABLED',
      run: (row) => disableAgent(row.id),
    },
    {
      label: t('agents.actions.enable'),
      permission: 'agent.write',
      confirmText: 'ENABLE',
      riskText: t('agents.actions.enableRisk'),
      hidden: (row) => String(row.status).toUpperCase() !== 'DISABLED',
      run: (row) => enableAgent(row.id),
    },
    {
      label: t('agents.actions.delete'),
      permission: 'agent.write',
      danger: true,
      confirmText: 'DELETE',
      riskText: t('agents.actions.deleteRisk'),
      run: (row) => deleteAgent(row.id),
    },
  ],
}))
</script>

<template>
  <section class="agent-page">
    <BusinessResourcePage :config="config" />

    <GcModal
      v-model:open="detailModalOpen"
      :title="t('agents.detail.modalTitle')"
      :description="t('agents.detail.modalDescription')"
      size="lg"
      width="66vw"
    >
      <section class="agent-detail-modal">
        <p v-if="detailError" class="agent-detail-modal__error">{{ detailError }}</p>

        <div v-if="detailData" class="agent-detail-modal__hero">
          <div class="agent-detail-modal__hero-copy">
            <p class="agent-detail-modal__eyebrow">{{ t('agents.detail.nodeEyebrow') }}</p>
            <h2>{{ detailData.title }}</h2>
            <span>{{ detailData.subtitle }}</span>
          </div>
          <div class="agent-detail-modal__hero-side">
            <GcStatusTag :status="detailData.status" />
            <div class="agent-detail-modal__spotlight">
              <small>{{ detailData.spotlightLabel }}</small>
              <strong>{{ detailData.spotlightValue }}</strong>
            </div>
          </div>
        </div>

        <p v-if="detailLoading" class="agent-detail-modal__loading">{{ t('agents.detail.loading') }}</p>
        <p v-if="detailActionMessage" class="agent-detail-modal__loading">{{ detailActionMessage }}</p>

        <template v-if="detailData">
          <nav class="agent-detail-modal__tabs" :aria-label="t('agents.detail.tabsAriaLabel')">
            <button
              v-for="tab in detailData.tabs"
              :key="tab.key"
              class="agent-detail-modal__tab"
              :data-active="activeDetailTab === tab.key"
              type="button"
              @click="activeDetailTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </nav>

          <div v-if="currentDetailTab" class="agent-detail-modal__sections">
            <article
              v-for="section in currentDetailTab.sections"
              :key="`${currentDetailTab.key}-${section.title}`"
              class="agent-detail-modal__section"
            >
              <header class="agent-detail-modal__section-head">
                <h3>{{ section.title }}</h3>
                <p>{{ section.description }}</p>
              </header>

              <dl class="agent-detail-modal__grid">
                <template v-if="section.variant === 'iis-sites'">
                  <article
                    v-for="field in section.fields"
                    :key="`${section.title}-${field.label}`"
                    class="agent-detail-modal__site-card"
                  >
                    <template v-if="field.meta && typeof field.meta === 'object'">
                    <header class="agent-detail-modal__site-head">
                      <div>
                        <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                        <p class="agent-detail-modal__site-path">{{ t('agents.labels.path', { value: (field.meta as IisSiteView).physicalPath }) }}</p>
                      </div>
                      <div class="agent-detail-modal__site-meta">
                        <span>{{ (field.meta as IisSiteView).state }}</span>
                        <strong>{{ (field.meta as IisSiteView).appPool }}</strong>
                      </div>
                    </header>
                    <div class="agent-detail-modal__site-bindings">
                      <div
                        v-for="binding in (field.meta as IisSiteView).bindings"
                        :key="`${field.label}-${binding.protocol}-${binding.port}-${binding.hostHeader}`"
                        class="agent-detail-modal__binding-chip"
                        :data-clickable="binding.certificate ? 'true' : 'false'"
                        :data-cert-status="certificateValidityStatus(binding.certificate)"
                        role="button"
                        tabindex="0"
                        @click="openBindingCertificate(field.label, binding)"
                        @keydown.enter="openBindingCertificate(field.label, binding)"
                        @keydown.space.prevent="openBindingCertificate(field.label, binding)"
                      >
                        <div class="agent-detail-modal__binding-topline">
                          <strong>{{ String(binding.protocol).toUpperCase() }}:{{ binding.port }}</strong>
                          <span
                            v-if="binding.certificate"
                            class="agent-detail-modal__cert-badge"
                            :data-status="certificateValidityStatus(binding.certificate)"
                          >
                            {{ certificateStatusLabel(binding.certificate) }}
                          </span>
                        </div>
                        <span>{{ binding.hostHeader && binding.hostHeader !== EMPTY_TEXT ? binding.hostHeader : t('agents.common.noHostHeader') }}</span>
                        <small>{{ binding.certificateSubject }}</small>
                        <em v-if="binding.certificateThumbprint !== EMPTY_TEXT">{{ t('agents.labels.thumbprint', { value: binding.certificateThumbprint }) }}</em>
                        <em v-if="binding.certificate">
                          {{ t('agents.certificate.remainingWithViewAction', { remaining: certificateRemainingLabel(binding.certificate) }) }}
                        </em>
                      </div>
                    </div>
                    </template>
                    <template v-else>
                      <header class="agent-detail-modal__site-head">
                        <div>
                          <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                          <p class="agent-detail-modal__site-path">{{ field.value }}</p>
                        </div>
                      </header>
                    </template>
                  </article>
                </template>
                <template v-else-if="section.variant === 'linux-sites'">
                  <article
                    v-for="field in section.fields"
                    :key="`${section.title}-${field.label}`"
                    class="agent-detail-modal__site-card"
                  >
                    <template v-if="field.meta && typeof field.meta === 'object'">
                      <header class="agent-detail-modal__site-head">
                        <div>
                          <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                          <p class="agent-detail-modal__site-path">{{ t('agents.labels.directory', { value: (field.meta as LinuxSiteView).sitePath }) }}</p>
                        </div>
                        <div class="agent-detail-modal__site-meta">
                          <span>{{ formatSiteMode((field.meta as LinuxSiteView).siteMode) }}</span>
                          <strong>{{ t('agents.site.domainCount', { count: (field.meta as LinuxSiteView).serverNames.length }) }}</strong>
                        </div>
                      </header>
                      <div class="agent-detail-modal__linux-meta">
                        <p>
                          <strong>{{ t('agents.fields.domain') }}</strong>
                          <span>{{ (field.meta as LinuxSiteView).serverNames.length > 0 ? (field.meta as LinuxSiteView).serverNames.join(', ') : t('agents.common.notConfigured') }}</span>
                        </p>
                        <p>
                          <strong>{{ t('agents.fields.proxyTarget') }}</strong>
                          <span>{{ (field.meta as LinuxSiteView).proxyTargets.length > 0 ? (field.meta as LinuxSiteView).proxyTargets.join('\n') : t('agents.common.none') }}</span>
                        </p>
                        <p>
                          <strong>{{ t('agents.fields.configFile') }}</strong>
                          <span>{{ (field.meta as LinuxSiteView).configFiles.length > 0 ? (field.meta as LinuxSiteView).configFiles.join('\n') : t('agents.common.unrecognized') }}</span>
                        </p>
                      </div>
                      <div class="agent-detail-modal__site-bindings">
                        <div
                          v-for="binding in (field.meta as LinuxSiteView).bindings"
                          :key="`${field.label}-${binding.protocol}-${binding.port}-${binding.address}`"
                          class="agent-detail-modal__binding-chip"
                          :data-clickable="binding.certificate ? 'true' : 'false'"
                          :data-cert-status="binding.certificate ? certificateValidityStatus(binding.certificate) : 'unknown'"
                          role="button"
                          tabindex="0"
                          @click="openBindingCertificate(field.label, binding)"
                          @keydown.enter="openBindingCertificate(field.label, binding)"
                          @keydown.space.prevent="openBindingCertificate(field.label, binding)"
                        >
                          <div class="agent-detail-modal__binding-topline">
                            <strong>{{ String(binding.protocol).toUpperCase() }}:{{ binding.port }}</strong>
                            <span
                              v-if="binding.certificate"
                              class="agent-detail-modal__cert-badge"
                              :data-status="certificateValidityStatus(binding.certificate)"
                            >
                              {{ certificateStatusLabel(binding.certificate) }}
                            </span>
                          </div>
                          <span>{{ binding.address !== EMPTY_TEXT ? binding.address : t('agents.common.defaultAddress') }}</span>
                          <small>{{ binding.certificateName }}</small>
                          <em>{{ t('agents.labels.certificatePath', { value: binding.certificatePath }) }}</em>
                          <em>{{ t('agents.labels.privateKeyPath', { value: binding.certificateKeyPath }) }}</em>
                          <em v-if="binding.permissionSummary !== EMPTY_TEXT">{{ binding.permissionSummary }}</em>
                          <em v-if="binding.testCommand !== EMPTY_TEXT">{{ t('agents.labels.testCommand', { value: binding.testCommand }) }}</em>
                          <em v-if="binding.reloadCommand !== EMPTY_TEXT">{{ t('agents.labels.reloadCommand', { value: binding.reloadCommand }) }}</em>
                          <em v-if="binding.certificate">
                            {{ t('agents.certificate.remainingWithViewAction', { remaining: certificateRemainingLabel(binding.certificate) }) }}
                          </em>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <header class="agent-detail-modal__site-head">
                        <div>
                          <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                          <p class="agent-detail-modal__site-path">{{ field.value }}</p>
                        </div>
                      </header>
                    </template>
                  </article>
                </template>
                <template v-else-if="section.variant === 'tomcat-connectors'">
                  <article
                    v-for="field in section.fields"
                    :key="`${section.title}-${field.label}`"
                    class="agent-detail-modal__site-card"
                    :data-clickable="field.meta && typeof field.meta === 'object' && (field.meta as TomcatConnectorView).certificate ? 'true' : 'false'"
                    @click="field.meta && typeof field.meta === 'object' && (field.meta as TomcatConnectorView).certificate ? openBindingCertificate(field.label, field.meta as TomcatConnectorView) : undefined"
                    @keydown.enter="field.meta && typeof field.meta === 'object' && (field.meta as TomcatConnectorView).certificate ? openBindingCertificate(field.label, field.meta as TomcatConnectorView) : undefined"
                    @keydown.space.prevent="field.meta && typeof field.meta === 'object' && (field.meta as TomcatConnectorView).certificate ? openBindingCertificate(field.label, field.meta as TomcatConnectorView) : undefined"
                    :tabindex="field.meta && typeof field.meta === 'object' && (field.meta as TomcatConnectorView).certificate ? 0 : -1"
                  >
                    <template v-if="field.meta && typeof field.meta === 'object'">
                      <header class="agent-detail-modal__site-head">
                        <div class="agent-detail-modal__site-head-main">
                          <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                          <p class="agent-detail-modal__site-path">{{ t('agents.labels.listenAddress', { value: (field.meta as TomcatConnectorView).address }) }}</p>
                        </div>
                        <div class="agent-detail-modal__site-meta">
                          <span>{{ (field.meta as TomcatConnectorView).tls ? 'TLS' : 'PLAINTEXT' }}</span>
                          <strong>{{ (field.meta as TomcatConnectorView).port }}</strong>
                        </div>
                      </header>
                      <div class="agent-detail-modal__linux-meta">
                        <p>
                          <strong>{{ t('agents.fields.certificateSubject') }}</strong>
                          <span>{{ (field.meta as TomcatConnectorView).certificateName }}</span>
                        </p>
                        <p>
                          <strong>{{ t('agents.fields.certificateFile') }}</strong>
                          <span>{{ (field.meta as TomcatConnectorView).certificatePath }}</span>
                        </p>
                        <p>
                          <strong>{{ t('agents.fields.privateKeyOrKeystore') }}</strong>
                          <span>{{
                            [
                              (field.meta as TomcatConnectorView).certificateKeyPath !== EMPTY_TEXT ? t('agents.labels.privateKeyPath', { value: (field.meta as TomcatConnectorView).certificateKeyPath }) : '',
                              (field.meta as TomcatConnectorView).keystorePath !== EMPTY_TEXT ? t('agents.labels.keystorePath', { value: (field.meta as TomcatConnectorView).keystorePath }) : '',
                            ].filter(Boolean).join('\n') || EMPTY_TEXT
                          }}</span>
                        </p>
                        <button
                          v-if="(field.meta as TomcatConnectorView).certificate"
                          class="agent-detail-modal__binding-link"
                          type="button"
                          @click.stop="openBindingCertificate(field.label, field.meta as TomcatConnectorView)"
                        >
                          {{ t('agents.certificate.view') }}
                        </button>
                      </div>
                    </template>
                    <template v-else>
                      <header class="agent-detail-modal__site-head">
                        <div>
                          <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                          <p class="agent-detail-modal__site-path">{{ field.value }}</p>
                        </div>
                      </header>
                    </template>
                  </article>
                </template>
                <template v-else-if="section.variant === 'tomcat-apps'">
                  <article
                    v-for="field in section.fields"
                    :key="`${section.title}-${field.label}`"
                    class="agent-detail-modal__site-card"
                  >
                    <template v-if="field.meta && typeof field.meta === 'object'">
                      <header class="agent-detail-modal__site-head">
                        <div>
                          <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                          <p class="agent-detail-modal__site-path">{{ t('agents.labels.deployDirectory', { value: (field.meta as TomcatAppView).docBase }) }}</p>
                        </div>
                        <div class="agent-detail-modal__site-meta">
                          <span>AppBase</span>
                          <strong>{{ (field.meta as TomcatAppView).appBase }}</strong>
                        </div>
                      </header>
                    </template>
                    <template v-else>
                      <header class="agent-detail-modal__site-head">
                        <div>
                          <p class="agent-detail-modal__site-name">{{ field.label }}</p>
                          <p class="agent-detail-modal__site-path">{{ field.value }}</p>
                        </div>
                      </header>
                    </template>
                  </article>
                </template>
                <template v-else-if="section.variant === 'runtime-logs'">
                  <div class="agent-detail-modal__log-list" role="list" :aria-label="t('agents.logs.listAriaLabel')">
                    <article
                      v-for="field in section.fields"
                      :key="`${section.title}-${field.label}`"
                      class="agent-detail-modal__log-item"
                      role="listitem"
                    >
                      <template v-if="field.meta && typeof field.meta === 'object'">
                        <button
                          class="agent-detail-modal__log-toggle"
                          type="button"
                          :aria-expanded="isRuntimeLogExpanded((field.meta as RuntimeLogView).id) ? 'true' : 'false'"
                          @click="toggleRuntimeLog((field.meta as RuntimeLogView).id)"
                        >
                          <header class="agent-detail-modal__log-head">
                            <div class="agent-detail-modal__log-main">
                              <strong>{{ field.label }}</strong>
                              <p>{{ field.value }}</p>
                              <p class="agent-detail-modal__log-subline">
                                <span>{{ t('agents.labels.taskType', { value: (field.meta as RuntimeLogView).taskType !== EMPTY_TEXT ? (field.meta as RuntimeLogView).taskType : (field.meta as RuntimeLogView).category }) }}</span>
                                <span>{{ t('agents.labels.siteName', { value: (field.meta as RuntimeLogView).siteName !== EMPTY_TEXT ? (field.meta as RuntimeLogView).siteName : t('agents.common.notProvided') }) }}</span>
                              </p>
                            </div>
                            <div class="agent-detail-modal__log-meta">
                              <span>{{ (field.meta as RuntimeLogView).emittedAt }}</span>
                              <b>{{ (field.meta as RuntimeLogView).dryRun ? 'DRY_RUN' : 'TASK' }}</b>
                              <small>{{ isRuntimeLogExpanded((field.meta as RuntimeLogView).id) ? t('agents.logs.collapse') : t('agents.logs.expand') }}</small>
                            </div>
                          </header>
                        </button>
                        <pre
                          v-if="(field.meta as RuntimeLogView).rawDetail && isRuntimeLogExpanded((field.meta as RuntimeLogView).id)"
                          class="agent-detail-modal__log-detail"
                        ><code>{{ (field.meta as RuntimeLogView).rawDetail }}</code></pre>
                      </template>
                      <template v-else>
                        <header class="agent-detail-modal__log-head">
                          <div class="agent-detail-modal__log-main">
                            <strong>{{ field.label }}</strong>
                            <p>{{ field.value }}</p>
                          </div>
                        </header>
                      </template>
                    </article>
                  </div>
                </template>
                <template v-else>
                  <div
                    v-for="field in section.fields"
                    :key="`${section.title}-${field.label}`"
                    class="agent-detail-modal__item"
                    :data-emphasis="field.emphasis ? 'true' : 'false'"
                  >
                    <dt>{{ field.label }}</dt>
                    <dd>{{ field.value }}</dd>
                  </div>
                </template>
              </dl>
            </article>
          </div>
        </template>
      </section>

      <template #actions>
        <button
          class="gc-button"
          data-variant="secondary"
          type="button"
          :disabled="detailLoading || detailActionPending || !detailData?.canManualRescan"
          :title="detailData?.manualRescanDisabledReason || ''"
          @click="triggerManualRescan"
        >
          {{ detailActionPending ? t('agents.detail.manualRescanSubmitting') : t('agents.detail.manualRescan') }}
        </button>
        <button class="gc-button" type="button" :disabled="detailLoading || detailActionPending" @click="closeDetailModal">{{ t('agents.actions.close') }}</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="certificateModalOpen"
      :title="t('agents.certificate.modalTitle')"
      :description="t('agents.certificate.modalDescription')"
      size="lg"
      width="56vw"
    >
      <section v-if="selectedCertificate?.binding.certificate" class="agent-certificate-modal">
        <div class="agent-certificate-modal__hero">
          <div>
            <p class="agent-certificate-modal__eyebrow">{{ t('agents.certificate.boundCertificate') }}</p>
            <h3>{{ selectedCertificate.binding.certificate.subject }}</h3>
            <span>{{ selectedCertificate.siteName }} / {{ selectedCertificate.binding.protocol.toUpperCase() }}:{{ selectedCertificate.binding.port }}</span>
          </div>
          <div class="agent-certificate-modal__status">
            <small>{{ t('agents.certificate.statusLabel') }}</small>
            <strong>{{ certificateStatusLabel(selectedCertificate.binding.certificate) }}</strong>
            <span>{{ certificateRemainingLabel(selectedCertificate.binding.certificate) }}</span>
          </div>
        </div>

        <article class="agent-detail-modal__section">
          <header class="agent-detail-modal__section-head">
            <h3>{{ t('agents.certificate.overviewTitle') }}</h3>
            <p>{{ t('agents.certificate.overviewDescription') }}</p>
          </header>
          <dl class="agent-detail-modal__grid">
            <div class="agent-detail-modal__item" data-emphasis="true">
              <dt>{{ t('agents.fields.certificateName') }}</dt>
              <dd>{{ selectedCertificate.binding.certificate.subject }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>{{ t('agents.fields.issuer') }}</dt>
              <dd>{{ selectedCertificate.binding.certificate.issuer }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>{{ t('agents.fields.certificateStore') }}</dt>
              <dd>{{ selectedCertificate.binding.certificate.storeName }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>{{ t('agents.fields.notBefore') }}</dt>
              <dd>{{ selectedCertificate.binding.certificate.notBefore }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>{{ t('agents.fields.notAfter') }}</dt>
              <dd>{{ selectedCertificate.binding.certificate.notAfter }}</dd>
            </div>
            <div
              class="agent-detail-modal__item"
              :data-emphasis="certificateValidityStatus(selectedCertificate.binding.certificate) !== 'valid' ? 'true' : 'false'"
            >
              <dt>{{ t('agents.fields.remainingDays') }}</dt>
              <dd>{{ certificateRemainingLabel(selectedCertificate.binding.certificate) }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>{{ t('agents.fields.certificateThumbprint') }}</dt>
              <dd>{{ selectedCertificate.binding.certificate.thumbprint }}</dd>
            </div>
            <div
              v-if="selectedCertificate.binding.certificate.fingerprintSha256 !== EMPTY_TEXT"
              class="agent-detail-modal__item"
            >
              <dt>{{ t('agents.fields.sha256Fingerprint') }}</dt>
              <dd>{{ selectedCertificate.binding.certificate.fingerprintSha256 }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>{{ 'hostHeader' in selectedCertificate.binding ? 'Host Header' : t('agents.fields.listenAddress') }}</dt>
              <dd>{{
                'hostHeader' in selectedCertificate.binding
                  ? (selectedCertificate.binding.hostHeader !== EMPTY_TEXT ? selectedCertificate.binding.hostHeader : t('agents.common.noHostHeader'))
                  : (selectedCertificate.binding.address !== EMPTY_TEXT ? selectedCertificate.binding.address : t('agents.common.defaultAddress'))
              }}</dd>
            </div>
          </dl>
        </article>
        <p v-if="certificateAssetError" class="agent-certificate-modal__error">{{ certificateAssetError }}</p>
      </section>

      <template #actions>
        <button
          class="gc-button"
          data-variant="secondary"
          type="button"
          :disabled="certificateAssetPending || !selectedCertificate?.binding.certificate"
          @click="openCertificateAssetDetail"
        >
          {{ certificateAssetPending ? t('agents.certificate.querying') : t('agents.certificate.viewProjectDetail') }}
        </button>
        <button class="gc-button" type="button" @click="closeCertificateModal">{{ t('agents.actions.close') }}</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="certificateAssetDetailOpen"
      :title="t('agents.certificate.projectDetailTitle')"
      :description="t('agents.certificate.projectDetailDescription')"
      size="xxl"
    >
      <CertificateDetailPanel
        v-if="selectedCertificateAssetRoute"
        :asset-id="selectedCertificateAssetRoute.assetId"
        :version-id="selectedCertificateAssetRoute.versionId"
        :context-usages="certificateContextUsages"
      />
      <template #actions>
        <button class="gc-button" type="button" @click="closeCertificateAssetModal">{{ t('agents.actions.close') }}</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="installModalOpen"
      :title="t('agents.install.modalTitle')"
      :description="t('agents.install.modalDescription')"
      size="lg"
      :close-on-backdrop="false"
      width="58vw"
    >
      <section class="agent-install-modal">
        <div class="agent-install-modal__field">
          <p class="agent-install-modal__label">{{ t('agents.install.platform') }}</p>
          <div class="agent-install-modal__platforms">
            <button
              v-for="option in platformOptions"
              :key="option.value"
              class="agent-install-modal__platform"
              :data-active="selectedPlatform === option.value"
              type="button"
              @click="selectedPlatform = option.value"
            >
              <strong>{{ option.label }}</strong>
              <span>{{ option.description }}</span>
            </button>
          </div>
        </div>

        <div class="agent-install-modal__field">
          <label class="agent-install-modal__label" for="agent-version">{{ t('agents.install.version') }}</label>
          <select id="agent-version" v-model="selectedVersion">
            <option v-for="option in versionOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>

        <div class="agent-install-modal__actions-top">
          <button
            class="gc-button agent-install-modal__primary"
            type="button"
            :disabled="installPending"
            @click="generateInstallCommand"
          >
            {{ installPending ? t('agents.install.generating') : t('agents.install.generateCommand') }}
          </button>
        </div>

        <p v-if="installError" class="agent-install-modal__error">{{ installError }}</p>

        <div v-if="installSession" class="agent-install-modal__result">
          <dl class="agent-install-modal__meta">
            <div>
              <dt>{{ t('agents.install.platform') }}</dt>
              <dd>{{ installSession.platform === 'linux_go_systemd' ? 'Linux systemd' : 'Windows Go Service' }}</dd>
            </div>
            <div>
              <dt>{{ t('agents.install.bootstrapToken') }}</dt>
              <dd>{{ installSession.bootstrapTokenPreview }}</dd>
            </div>
            <div>
              <dt>{{ t('agents.install.zone') }}</dt>
              <dd>{{ installSession.zone }}</dd>
            </div>
            <div>
              <dt>{{ t('agents.install.remainingValidity') }}</dt>
              <dd><span :class="{ 'agent-install-modal__expired': isExpired }">{{ remainingLabel }}</span></dd>
            </div>
          </dl>

          <label class="agent-install-modal__field">
            <span class="agent-install-modal__label">{{ t('agents.install.command') }}</span>
            <textarea readonly :value="installCommand" rows="3" />
          </label>

          <p class="agent-install-modal__hint">{{ t('agents.install.singleUseHint') }}</p>
          <p v-if="copiedText" class="agent-install-modal__copied">{{ copiedText === 'token' ? t('agents.install.tokenCopied') : t('agents.install.commandCopied') }}</p>
        </div>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="installPending" @click="closeInstallModal">{{ t('agents.actions.close') }}</button>
        <button v-if="installSession" class="gc-button" type="button" @click="copyToken">{{ t('agents.install.copyToken') }}</button>
        <button
          v-if="installSession"
          class="gc-button agent-install-modal__primary"
          type="button"
          :disabled="!installCommand"
          @click="copyInstallCommand"
        >
          {{ t('agents.install.copyCommand') }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.agent-page :deep(.gc-tag) {
  font-size: 11px;
}

.agent-detail-modal,
.agent-install-modal {
  display: grid;
  gap: 12px;
}

.agent-detail-modal__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%),
    linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.agent-detail-modal__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.agent-detail-modal__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.agent-detail-modal__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 24px;
  line-height: 1.06;
  letter-spacing: -0.05em;
  overflow-wrap: anywhere;
}

.agent-detail-modal__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.agent-detail-modal__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.agent-detail-modal__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.agent-detail-modal__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-detail-modal__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
  letter-spacing: -0.03em;
  overflow-wrap: anywhere;
}

.agent-detail-modal__tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.agent-detail-modal__tab {
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 999px;
  padding: 8px 14px;
  background: var(--gc-color-surface-solid);
  color: var(--gc-color-text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.agent-detail-modal__tab[data-active='true'] {
  border-color: var(--gc-color-focus);
  box-shadow: 0 0 0 3px var(--gc-color-focus-ring);
  background: linear-gradient(135deg, var(--gc-color-surface-selected), var(--gc-color-surface-solid));
  color: var(--gc-color-text);
}

.agent-detail-modal__sections {
  display: grid;
  gap: 10px;
}

.agent-detail-modal__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised));
}

.agent-detail-modal__section-head {
  display: grid;
  gap: 4px;
}

.agent-detail-modal__section-head h3,
.agent-detail-modal__section-head p {
  margin: 0;
}

.agent-detail-modal__section-head h3 {
  color: var(--gc-color-text);
  font-size: 15px;
  letter-spacing: -0.03em;
}

.agent-detail-modal__section-head p {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.agent-detail-modal__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.agent-detail-modal__item {
  display: grid;
  gap: 5px;
  min-height: 70px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
  border: 1px solid var(--gc-color-border-muted);
}

.agent-detail-modal__item[data-emphasis='true'] {
  background: linear-gradient(135deg, var(--gc-color-surface-selected), var(--gc-color-surface-solid));
  border-color: var(--gc-color-primary-border);
}

.agent-detail-modal__item dt {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.agent-detail-modal__item dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 13px;
  line-height: 1.35;
  font-weight: 800;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
  white-space: pre-line;
}

.agent-detail-modal__site-card {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--gc-color-border-muted);
  background: linear-gradient(180deg, var(--gc-color-surface-hover), var(--gc-color-surface-solid));
}

.agent-detail-modal__site-card[data-clickable='true'] {
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}

.agent-detail-modal__site-card[data-clickable='true']:hover,
.agent-detail-modal__site-card[data-clickable='true']:focus-visible {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px var(--gc-color-border);
  border-color: var(--gc-color-primary-border-strong);
  outline: none;
}

.agent-detail-modal__site-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: start;
}

.agent-detail-modal__site-head-main {
  min-width: 0;
  display: grid;
}

.agent-detail-modal__site-name,
.agent-detail-modal__site-path {
  margin: 0;
}

.agent-detail-modal__site-name {
  color: var(--gc-color-text);
  font-size: 16px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.agent-detail-modal__site-path {
  margin-top: 4px;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.agent-detail-modal__site-meta {
  display: grid;
  gap: 4px;
  justify-items: end;
  text-align: right;
  min-width: 0;
  flex-shrink: 0;
}

.agent-detail-modal__site-meta span {
  color: var(--gc-color-primary-strong);
  font-size: 11px;
  font-weight: 800;
  overflow-wrap: anywhere;
  white-space: nowrap;
}

.agent-detail-modal__site-meta strong {
  color: var(--gc-color-text);
  font-size: 12px;
  overflow-wrap: anywhere;
  text-align: right;
  white-space: nowrap;
}

.agent-detail-modal__site-bindings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.agent-detail-modal__linux-meta {
  display: grid;
  gap: 8px;
}

.agent-detail-modal__linux-meta p {
  display: grid;
  gap: 4px;
  margin: 0;
}

.agent-detail-modal__linux-meta strong {
  color: var(--gc-color-muted);
  font-size: 11px;
  font-weight: 800;
}

.agent-detail-modal__linux-meta span {
  color: var(--gc-color-text);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.agent-detail-modal__log-list {
  display: grid;
  gap: 10px;
  grid-column: 1 / -1;
}

.agent-detail-modal__log-item {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--gc-color-border-muted);
  background: linear-gradient(180deg, var(--gc-color-surface-hover), var(--gc-color-surface-solid));
}

.agent-detail-modal__log-toggle {
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.agent-detail-modal__log-toggle:focus-visible {
  outline: 2px solid var(--gc-color-focus);
  outline-offset: 4px;
  border-radius: 12px;
}

.agent-detail-modal__log-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.agent-detail-modal__log-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.agent-detail-modal__log-main strong,
.agent-detail-modal__log-main p {
  margin: 0;
}

.agent-detail-modal__log-main strong {
  color: var(--gc-color-text);
  font-size: 14px;
  font-weight: 900;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.agent-detail-modal__log-main p {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.agent-detail-modal__log-subline {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.agent-detail-modal__log-meta {
  display: grid;
  gap: 4px;
  justify-items: end;
  min-width: 140px;
  text-align: right;
}

.agent-detail-modal__log-meta span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.agent-detail-modal__log-meta b {
  color: var(--gc-color-primary-strong);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.agent-detail-modal__log-meta small {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 800;
}

.agent-detail-modal__log-detail {
  margin: 0;
  overflow: auto;
  border-radius: 12px;
  padding: 12px;
  background: var(--gc-color-text);
  color: var(--gc-color-muted-bg);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agent-detail-modal__log-detail code {
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
}

.agent-detail-modal__binding-chip {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
  border: 1px solid transparent;
}

.agent-detail-modal__binding-chip[data-clickable='true'] {
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

.agent-detail-modal__binding-chip[data-clickable='true']:hover,
.agent-detail-modal__binding-chip[data-clickable='true']:focus-visible {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px var(--gc-color-border-strong);
  background: linear-gradient(180deg, var(--gc-color-text), var(--gc-color-primary-strong));
  outline: none;
}

.agent-detail-modal__binding-chip[data-cert-status='expiring'] {
  background: linear-gradient(180deg, var(--gc-color-warning-bg), var(--gc-color-warning));
  border-color: var(--gc-color-warning-border);
}

.agent-detail-modal__binding-chip[data-cert-status='expired'] {
  background: linear-gradient(180deg, var(--gc-color-danger-bg), var(--gc-color-danger));
  border-color: var(--gc-color-danger-border);
}

.agent-detail-modal__binding-topline {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 8px;
}

.agent-detail-modal__cert-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

.agent-detail-modal__cert-badge[data-status='valid'] {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.agent-detail-modal__cert-badge[data-status='expiring'] {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
}

.agent-detail-modal__cert-badge[data-status='expired'] {
  color: var(--gc-color-danger-soft);
  background: var(--gc-color-danger);
}

.agent-detail-modal__cert-badge[data-status='unknown'] {
  color: var(--gc-color-muted-bg);
  background: var(--gc-color-muted-bg);
}

.agent-detail-modal__binding-chip strong,
.agent-detail-modal__binding-chip span,
.agent-detail-modal__binding-chip small,
.agent-detail-modal__binding-chip em {
  overflow-wrap: anywhere;
}

.agent-detail-modal__binding-chip strong {
  font-size: 13px;
}

.agent-detail-modal__binding-chip span {
  color: var(--gc-color-surface-field);
  font-size: 11px;
  font-weight: 700;
}

.agent-detail-modal__binding-chip small {
  color: var(--gc-color-primary-border);
  font-size: 11px;
  line-height: 1.4;
}

.agent-detail-modal__binding-chip em {
  color: var(--gc-color-surface-subtle);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.agent-detail-modal__binding-link {
  justify-self: start;
  margin-top: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--gc-color-primary-border-strong);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.agent-detail-modal__binding-link:hover,
.agent-detail-modal__binding-link:focus-visible {
  color: var(--gc-color-info-border);
  outline: none;
  text-decoration: underline;
}

.agent-certificate-modal {
  display: grid;
  gap: 12px;
}

.agent-certificate-modal__hero {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 30%),
    linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.agent-certificate-modal__hero h3,
.agent-certificate-modal__hero p,
.agent-certificate-modal__hero span {
  margin: 0;
}

.agent-certificate-modal__hero h3 {
  color: var(--gc-color-text);
  font-size: 24px;
  line-height: 1.08;
  letter-spacing: -0.05em;
  overflow-wrap: anywhere;
}

.agent-certificate-modal__hero span {
  display: block;
  margin-top: 6px;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.agent-certificate-modal__eyebrow {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.agent-certificate-modal__status {
  display: grid;
  gap: 4px;
  min-width: 180px;
  align-content: start;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.agent-certificate-modal__status small {
  color: var(--gc-color-text-inverse-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-certificate-modal__status strong {
  font-size: 14px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.agent-certificate-modal__status span {
  color: var(--gc-color-surface-field);
  font-size: 11px;
  font-weight: 700;
}

.agent-certificate-modal__error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--gc-color-danger-border);
  background: var(--gc-color-danger-soft);
  color: var(--gc-color-danger);
  font-size: 12px;
  font-weight: 700;
}

.agent-detail-modal__loading,
.agent-detail-modal__error,
.agent-install-modal__error {
  margin: 0;
  border-radius: 12px;
  padding: 9px 11px;
  font-size: 12px;
  font-weight: 700;
}

.agent-detail-modal__loading {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-subtle);
}

.agent-detail-modal__error,
.agent-install-modal__error {
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
}

.agent-install-modal__field {
  display: grid;
  gap: 8px;
}

.agent-install-modal__label {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-install-modal__platforms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 10px;
}

.agent-install-modal__platform {
  display: grid;
  gap: 4px;
  text-align: left;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--gc-color-surface-solid);
  cursor: pointer;
}

.agent-install-modal__platform[data-active='true'] {
  border-color: var(--gc-color-focus);
  box-shadow: 0 0 0 3px var(--gc-color-focus-ring);
  background: linear-gradient(135deg, var(--gc-color-surface-selected), var(--gc-color-surface-solid));
}

.agent-install-modal__platform strong {
  color: var(--gc-color-text);
  font-size: 13px;
}

.agent-install-modal__platform span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  line-height: 1.45;
  font-weight: 650;
}

.agent-install-modal__field select,
.agent-install-modal__field textarea {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 10px;
  padding: 8px 10px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  font-size: 12px;
}

.agent-install-modal__field textarea {
  resize: vertical;
  min-height: 82px;
}

.agent-install-modal__actions-top {
  display: flex;
  justify-content: flex-start;
}

.agent-install-modal__primary {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-primary);
  color: var(--gc-color-surface-solid);
}

.agent-install-modal__primary:hover:not(:disabled),
.agent-install-modal__primary:focus-visible:not(:disabled) {
  border-color: var(--gc-color-primary-hover);
  background: var(--gc-color-primary-hover);
  color: var(--gc-color-surface-solid);
}

.agent-install-modal__result {
  display: grid;
  gap: 12px;
}

.agent-install-modal__meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.agent-install-modal__meta div {
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 9px 11px;
  background: var(--gc-color-surface-raised);
}

.agent-install-modal__meta dt {
  margin-bottom: 4px;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
}

.agent-install-modal__meta dd {
  margin: 0;
  font-size: 12px;
  font-weight: 750;
  overflow-wrap: anywhere;
}

.agent-install-modal__expired {
  color: var(--gc-color-danger);
}

.agent-install-modal__hint,
.agent-install-modal__copied {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 1100px) {
  .agent-detail-modal__hero {
    display: grid;
    grid-template-columns: 1fr;
  }

  .agent-detail-modal__hero-side {
    justify-items: start;
  }

  .agent-certificate-modal__hero {
    display: grid;
    grid-template-columns: 1fr;
  }

  .agent-detail-modal__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .agent-detail-modal__log-head {
    flex-direction: column;
  }

  .agent-detail-modal__log-meta {
    justify-items: start;
    min-width: 0;
    text-align: left;
  }
}

@media (max-width: 760px) {
  .agent-detail-modal__grid,
  .agent-install-modal__meta {
    grid-template-columns: 1fr;
  }

  .agent-detail-modal__hero,
  .agent-detail-modal__section {
    padding: 12px;
  }

  .agent-detail-modal__hero-copy h2 {
    font-size: 20px;
  }
}
</style>
