<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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

const versionOptions = [
  { value: 'latest', label: '最新稳定版' },
  { value: '1.2.0', label: '1.2.0' },
  { value: '1.1.0', label: '1.1.0' },
] as const

const platformOptions: Array<{ value: InstallPlatform; label: string; description: string }> = [
  {
    value: 'linux_go_systemd',
    label: 'Linux systemd',
    description: '适用于 Ubuntu、Debian、CentOS、Rocky、AlmaLinux 等 Linux 发行版。',
  },
  {
    value: 'windows_powershell_service',
    label: 'Windows Go Service',
    description: '适用于 Windows Server 与 Windows 10/11，安装后注册为系统服务。',
  },
]

const installCommand = computed(() => installSession.value?.installCommand ?? '')
const expiresAtMs = computed(() => (installSession.value?.expiresAt ? Date.parse(installSession.value.expiresAt) : 0))
const currentDetailTab = computed(() => detailData.value?.tabs.find((tab) => tab.key === activeDetailTab.value) ?? detailData.value?.tabs[0] ?? null)

const remainingSeconds = computed(() => {
  if (!expiresAtMs.value) return 0
  return Math.max(0, Math.floor((expiresAtMs.value - now.value) / 1000))
})

const remainingLabel = computed(() => {
  const seconds = remainingSeconds.value
  if (seconds <= 0) return '已过期'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}分 ${String(rest).padStart(2, '0')}秒`
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
  if (status === 'expired') return '已过期'
  if (status === 'expiring') return '即将过期'
  if (status === 'valid') return '有效'
  return '有效期未知'
}

function certificateRemainingLabel(certificate: BindingCertificateView | null): string {
  const remainingDays = certificateRemainingDays(certificate)
  if (remainingDays === null) return '有效期未知'
  if (remainingDays < 0) return `已过期 ${Math.abs(remainingDays)} 天`
  if (remainingDays === 0) return '今天到期'
  return `剩余 ${remainingDays} 天`
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
  return value === true ? '已安装' : '未安装'
}

function formatRunningStatus(value: unknown): string {
  return value === true ? '运行中' : '未运行'
}

function formatSiteMode(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'static_root') return '静态站点'
  if (normalized === 'reverse_proxy') return '反向代理'
  if (normalized === 'unknown') return '未识别'
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
  if (mode) parts.push(`权限模式：${mode}`)
  parts.push(`证书目录：${certWritable ? '可写' : '不可写'}`)
  parts.push(`私钥目录：${keyWritable ? '可写' : '不可写'}`)
  if (helperRequired) parts.push('需要 helper')
  return parts.join(' / ')
}

function buildLinuxSites(detail: Record<string, unknown>): LinuxSiteView[] {
  return readObjectList(readObjectValue(detail, ['Sites', 'sites'])).map((site, index) => ({
    name: normalizeText(readObjectValue(site, ['Name', 'name']), `站点 ${index + 1}`),
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
      { label: 'IP 地址', value: ipAddress, emphasis: true },
      { label: '系统类型', value: osType },
      { label: '系统架构', value: arch },
      { label: 'Agent 版本', value: version },
      { label: '操作系统版本', value: productName },
      { label: '补丁版本', value: patchVersion },
    ]
  }

  const linuxDistribution = readValue(data, ['agent.descriptor.linuxDistribution', 'descriptor.linuxDistribution', 'linuxDistribution'])
  const osVersion = readValue(data, ['agent.descriptor.osVersion', 'descriptor.osVersion', 'osVersion'])

  return [
    { label: 'IP 地址', value: ipAddress, emphasis: true },
    { label: '系统类型', value: osType },
    { label: '系统架构', value: arch },
    { label: 'Agent 版本', value: version },
    { label: 'Linux 发行版', value: linuxDistribution },
    { label: '操作系统版本', value: osVersion },
  ]
}

function formatHealthStatus(value: unknown): string {
  const status = normalizeText(value, '').toLowerCase()
  if (status === 'healthy') return '健康'
  if (status === 'degraded') return '降级'
  if (status === 'failed') return '失败'
  if (status === 'unknown') return '未知'
  return status ? status.toUpperCase() : EMPTY_TEXT
}

function formatBooleanText(value: unknown): string {
  if (value === true) return '是'
  if (value === false) return '否'
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
    { label: '健康状态', value: formatHealthStatus(readPath(data, 'health.status')), emphasis: true },
    { label: '已判定离线', value: formatBooleanText(readPath(data, 'health.offline')), emphasis: true },
    { label: '最近心跳', value: normalizeDateTime(readPath(data, 'health.lastHeartbeatAt') ?? readPath(data, 'latestHeartbeat.receivedAt')) },
    { label: '最近恢复时间', value: normalizeDateTime(readPath(data, 'health.lastRecoveryAt')) },
    { label: '最近上报时间', value: normalizeDateTime(readPath(data, 'health.lastTaskResultAt')), emphasis: true },
    { label: '异常摘要', value: buildHealthSummary(data) },
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
        name: normalizeText(readObjectValue(site, ['Name', 'name']), `站点 ${index + 1}`),
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
    title: 'IIS 概况',
    description: '这里展示宿主机上的 IIS 安装状态和版本信息。',
    fields: [
      { label: '安装状态', value: installed === true ? '已安装' : '未安装', emphasis: true },
      { label: 'IIS 版本', value: versionString },
      { label: '站点数量', value: String(sites.length), emphasis: true },
      { label: 'HTTPS 绑定', value: String(httpsBindings.length) },
      { label: '应用程序池', value: String(uniqueAppPools.size) },
      { label: '证书主题', value: String(uniqueCertificates.size) },
    ],
  }

  const siteSection: DetailSection = {
    title: 'IIS 站点',
    description: '这里展示 IIS 网站列表、站点路径、绑定端口以及证书主题名。',
    variant: 'iis-sites',
    fields: sites.length > 0
      ? sites.map((site) => ({
          label: site.name,
          value: site.physicalPath,
          meta: site,
        }))
      : [{ label: '站点列表', value: '未发现 IIS 站点' }],
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
    title: `${titlePrefix} 概况`,
    description: `这里展示宿主机上的 ${titlePrefix} 安装状态、运行状态和配置位置。`,
    fields: [
      { label: '安装状态', value: formatInstallStatus(readObjectValue(detail, ['Installed', 'installed'])), emphasis: true },
      { label: '运行状态', value: formatRunningStatus(readObjectValue(detail, ['Running', 'running'])), emphasis: true },
      { label: `${titlePrefix} 版本`, value: normalizeText(readObjectValue(detail, ['Version', 'version'])) },
      { label: '服务名称', value: serviceName },
      { label: '二进制路径', value: normalizeText(readObjectValue(detail, ['BinaryPath', 'binaryPath'])) },
      { label: '配置路径', value: normalizeText(readObjectValue(detail, ['ConfigPath', 'configPath'])) },
      { label: '站点数量', value: String(sites.length), emphasis: true },
      { label: 'HTTPS 监听', value: String(httpsBindings) },
      { label: '证书主题', value: String(uniqueCertificates) },
      ...(options.extraLabel
        ? [{ label: options.extraLabel, value: normalizeText(readObjectValue(detail, options.extraValueKeys ?? [])) }]
        : []),
    ],
  }

  const siteSection: DetailSection = {
    title: `${titlePrefix} 站点`,
    description: `这里展示 ${titlePrefix} 识别到的站点、根目录、域名、反向代理目标和证书文件路径。`,
    variant: 'linux-sites',
    fields: sites.length > 0
      ? sites.map((site) => ({
          label: site.name,
          value: site.sitePath,
          meta: site,
        }))
      : [{ label: '站点列表', value: `未发现 ${titlePrefix} 站点` }],
  }

  return [overview, siteSection]
}

function buildNginxSections(data: ApiRecord): DetailSection[] {
  return buildLinuxFrameworkSections('Nginx', readCapabilityRecord(data, 'linux.nginx.detail'), { extraLabel: '安装前缀', extraValueKeys: ['Prefix', 'prefix'] })
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
      title: 'Tomcat 概况',
      description: '这里展示宿主机上的 Tomcat 安装状态、运行状态和 Catalina 路径。',
      fields: [
        { label: '安装状态', value: formatInstallStatus(readObjectValue(detail, ['Installed', 'installed'])), emphasis: true },
        { label: '运行状态', value: formatRunningStatus(readObjectValue(detail, ['Running', 'running'])), emphasis: true },
        { label: 'Tomcat 版本', value: normalizeText(readObjectValue(detail, ['Version', 'version'])) },
        { label: '服务名称', value: normalizeText(readObjectValue(detail, ['Service', 'serviceName', 'service'])) },
        { label: 'Catalina Home', value: normalizeText(readObjectValue(detail, ['CatalinaHome', 'catalinaHome'])) },
        { label: 'Catalina Base', value: normalizeText(readObjectValue(detail, ['CatalinaBase', 'catalinaBase'])) },
        { label: '配置路径', value: normalizeText(readObjectValue(detail, ['ConfigPath', 'configPath'])) },
        { label: '连接器数量', value: String(connectors.length), emphasis: true },
        { label: 'TLS 连接器', value: String(httpsConnectors) },
        { label: '证书主题', value: String(uniqueCertificates) },
        { label: '应用数量', value: String(apps.length), emphasis: true },
      ],
    },
    {
      title: 'Tomcat 连接器',
      description: '这里展示 Tomcat Connector 的监听地址、协议、TLS 开关和证书路径。',
      variant: 'tomcat-connectors',
      fields: connectors.length > 0
        ? connectors.map((connector, index) => ({
            label: `${connector.protocol !== EMPTY_TEXT ? connector.protocol : 'Connector'}:${connector.port}`,
            value: connector.address,
            meta: { ...connector, index },
          }))
        : [{ label: '连接器列表', value: '未发现 Tomcat 连接器' }],
    },
    {
      title: 'Tomcat 应用',
      description: '这里展示 Tomcat Host/Context 中识别到的应用路径与部署目录。',
      variant: 'tomcat-apps',
      fields: apps.length > 0
        ? apps.map((app, index) => ({
            label: app.contextPath !== EMPTY_TEXT ? app.contextPath : `应用 ${index + 1}`,
            value: app.docBase,
            meta: app,
          }))
        : [{ label: '应用列表', value: '未发现 Tomcat 应用' }],
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
      title: '日志概览',
      description: '这里展示最近一次能力上报的时间点，便于判断当前详情页中的能力数据是否新鲜。',
      fields: [
        { label: '上次能力上报时间', value: lastCapabilityReportedAt },
      ],
    },
    {
      title: '运行日志',
      description: '这里展示手动重扫结果、心跳异常以及能力上报中断等持久化运行日志。',
      variant: 'runtime-logs',
      fields: logs.length > 0
        ? logs.map((log, index) => ({
            label: `${log.level.toUpperCase()} / ${log.taskType !== EMPTY_TEXT ? log.taskType : log.category}`,
            value: log.summary,
            meta: { ...log, index },
          }))
        : [{ label: '运行日志', value: '暂无运行日志' }],
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
        ? '当前 Agent 类型不支持手动重扫'
        : '当前 Agent 不可拉取任务，无法执行重扫')

  const tabs: DetailTab[] = [
    {
      key: 'overview',
      label: '概览',
      sections: [
        {
          title: '主要信息',
          description: '这里展示 Agent 的身份、角色和最近心跳。',
          fields: [
            { label: '主机名', value: hostname, emphasis: true },
            { label: 'Agent ID', value: agentId },
            { label: 'Agent Key', value: agentKey },
            { label: '角色', value: role },
            { label: '区域', value: zone },
            { label: '最近心跳', value: normalizeDateTime(lastHeartbeat) },
          ],
        },
        {
          title: '运行环境',
          description: '这里展示 Agent 上报的运行系统与版本信息。',
          fields: buildRuntimeFields(data, osType),
        },
        {
          title: '健康与恢复',
          description: '这里展示控制面对 Agent 的离线判断、最近恢复时间以及待补传结果等运行健康摘要。',
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
    label: '日志',
    sections: buildRuntimeLogSections(data),
  })

  return {
    id: agentId,
    title: hostname,
    subtitle: `${agentKey} / ${agentId}`,
    status,
    spotlightLabel: 'IP 地址',
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
    ? 'Agent IIS 站点'
    : ('keystorePath' in binding ? 'Agent Tomcat 连接器' : 'Agent Linux 站点')
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
      hostHeader: hostHeader || ('hostHeader' in binding ? '无 Host Header' : '无监听地址'),
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
    throw new Error('证书资产数据不完整，无法跳转详情。')
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
      certificateAssetError.value = '本项目中未找到对应证书资产。'
      return
    }
    openCertificateAssetModal(route, currentSelection.siteName, currentSelection.binding)
  } catch (cause) {
    certificateAssetError.value = cause instanceof Error ? cause.message : '查询证书资产失败。'
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
      throw new Error('后端没有返回安装命令。')
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
    installError.value = cause instanceof Error ? cause.message : '生成安装命令失败。'
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
      throw new Error('详情接口没有返回数据。')
    }
    detailData.value = buildAgentDetail(result.data, row)
  } catch (cause) {
    detailError.value = cause instanceof Error ? cause.message : '加载详情失败。'
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
    detailActionMessage.value = '已创建手动重扫任务，等待 Agent 拉取执行。'
  } catch (cause) {
    detailActionMessage.value = cause instanceof Error ? cause.message : '手动重扫发起失败。'
  } finally {
    detailActionPending.value = false
  }
}

const config: BusinessPageConfig = {
  title: 'Agent',
  description: '查看 Agent 列表，生成不同平台的安装命令，并在独立模态框中查看详情。',
  readPermission: 'agent.read',
  primaryPermission: 'agent.write',
  primaryActionLabel: '安装Agent',
  primaryAction: openInstallModal,
  moduleName: 'agents',
  resourceName: 'Agent',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: '主机名', candidates: ['descriptor.hostname', 'hostname', 'agentKey', 'id'] },
    { key: 'ipAddress', title: 'IP 地址', candidates: ['descriptor.ipAddress', 'ipAddress'] },
    { key: 'osType', title: '系统类型', candidates: ['descriptor.osType', 'osType', 'platform'] },
    { key: 'status', title: '在线状态', candidates: ['status', 'state'] },
    { key: 'version', title: '版本', candidates: ['descriptor.version', 'version'] },
    { key: 'lastSeenAt', title: '最近心跳', candidates: ['lastSeenAt', 'updatedAt', 'registeredAt'], kind: 'date' },
    { key: 'actions', title: '操作', candidates: [] },
  ],
  metrics: [
    { title: 'Agent 总数', description: '当前已注册到控制面的 Agent 数量。', status: 'ONLINE', risk: 'MEDIUM' },
    { title: '异常 Agent', description: '离线、失败或漂移状态的 Agent 需要优先处理。', status: 'OFFLINE', risk: 'HIGH' },
  ],
  emptyTitle: '暂无 Agent',
  emptyDescription: '点击右上角“安装Agent”，选择平台和版本后生成一次性安装命令。',
  load: loadAgentsPage,
  actions: [],
  rowActions: [
    {
      label: '详情',
      permission: 'agent.read',
      reloadAfterRun: false,
      run: openDetailModal,
    },
    {
      label: '禁用',
      permission: 'agent.write',
      danger: true,
      confirmText: 'DISABLE',
      riskText: '禁用后该 Agent 将停止接收新任务。',
      hidden: (row) => String(row.status).toUpperCase() === 'DISABLED',
      run: (row) => disableAgent(row.id),
    },
    {
      label: '启用',
      permission: 'agent.write',
      confirmText: 'ENABLE',
      riskText: '启用后该 Agent 将恢复为可调度状态。',
      hidden: (row) => String(row.status).toUpperCase() !== 'DISABLED',
      run: (row) => enableAgent(row.id),
    },
    {
      label: '删除',
      permission: 'agent.write',
      danger: true,
      confirmText: 'DELETE',
      riskText: '删除会直接移除 Agent 记录，这个操作不可逆。',
      run: (row) => deleteAgent(row.id),
    },
  ],
}
</script>

<template>
  <section class="agent-page">
    <BusinessResourcePage :config="config" />

    <GcModal
      v-model:open="detailModalOpen"
      title="Agent详情"
      description="展示 Agent 的主要信息、运行环境以及 IIS 站点数据。"
      size="lg"
      width="66vw"
    >
      <section class="agent-detail-modal">
        <p v-if="detailError" class="agent-detail-modal__error">{{ detailError }}</p>

        <div v-if="detailData" class="agent-detail-modal__hero">
          <div class="agent-detail-modal__hero-copy">
            <p class="agent-detail-modal__eyebrow">Agent 节点</p>
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

        <p v-if="detailLoading" class="agent-detail-modal__loading">详情加载中...</p>
        <p v-if="detailActionMessage" class="agent-detail-modal__loading">{{ detailActionMessage }}</p>

        <template v-if="detailData">
          <nav class="agent-detail-modal__tabs" aria-label="Agent详情标签页">
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
                        <p class="agent-detail-modal__site-path">路径：{{ (field.meta as IisSiteView).physicalPath }}</p>
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
                        <span>{{ binding.hostHeader && binding.hostHeader !== EMPTY_TEXT ? binding.hostHeader : '无 Host Header' }}</span>
                        <small>{{ binding.certificateSubject }}</small>
                        <em v-if="binding.certificateThumbprint !== EMPTY_TEXT">Thumbprint：{{ binding.certificateThumbprint }}</em>
                        <em v-if="binding.certificate">
                          {{ certificateRemainingLabel(binding.certificate) }} / 点击查看证书
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
                          <p class="agent-detail-modal__site-path">目录：{{ (field.meta as LinuxSiteView).sitePath }}</p>
                        </div>
                        <div class="agent-detail-modal__site-meta">
                          <span>{{ formatSiteMode((field.meta as LinuxSiteView).siteMode) }}</span>
                          <strong>{{ (field.meta as LinuxSiteView).serverNames.length }} 个域名</strong>
                        </div>
                      </header>
                      <div class="agent-detail-modal__linux-meta">
                        <p>
                          <strong>域名</strong>
                          <span>{{ (field.meta as LinuxSiteView).serverNames.length > 0 ? (field.meta as LinuxSiteView).serverNames.join(', ') : '未配置' }}</span>
                        </p>
                        <p>
                          <strong>代理目标</strong>
                          <span>{{ (field.meta as LinuxSiteView).proxyTargets.length > 0 ? (field.meta as LinuxSiteView).proxyTargets.join('\n') : '无' }}</span>
                        </p>
                        <p>
                          <strong>配置文件</strong>
                          <span>{{ (field.meta as LinuxSiteView).configFiles.length > 0 ? (field.meta as LinuxSiteView).configFiles.join('\n') : '未识别' }}</span>
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
                          <span>{{ binding.address !== EMPTY_TEXT ? binding.address : '默认地址' }}</span>
                          <small>{{ binding.certificateName }}</small>
                          <em>证书：{{ binding.certificatePath }}</em>
                          <em>私钥：{{ binding.certificateKeyPath }}</em>
                          <em v-if="binding.permissionSummary !== EMPTY_TEXT">{{ binding.permissionSummary }}</em>
                          <em v-if="binding.testCommand !== EMPTY_TEXT">测试命令：{{ binding.testCommand }}</em>
                          <em v-if="binding.reloadCommand !== EMPTY_TEXT">Reload 命令：{{ binding.reloadCommand }}</em>
                          <em v-if="binding.certificate">
                            {{ certificateRemainingLabel(binding.certificate) }} / 点击查看证书
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
                          <p class="agent-detail-modal__site-path">监听地址：{{ (field.meta as TomcatConnectorView).address }}</p>
                        </div>
                        <div class="agent-detail-modal__site-meta">
                          <span>{{ (field.meta as TomcatConnectorView).tls ? 'TLS' : 'PLAINTEXT' }}</span>
                          <strong>{{ (field.meta as TomcatConnectorView).port }}</strong>
                        </div>
                      </header>
                      <div class="agent-detail-modal__linux-meta">
                        <p>
                          <strong>证书主题</strong>
                          <span>{{ (field.meta as TomcatConnectorView).certificateName }}</span>
                        </p>
                        <p>
                          <strong>证书文件</strong>
                          <span>{{ (field.meta as TomcatConnectorView).certificatePath }}</span>
                        </p>
                        <p>
                          <strong>私钥 / Keystore</strong>
                          <span>{{
                            [
                              (field.meta as TomcatConnectorView).certificateKeyPath !== EMPTY_TEXT ? `私钥：${(field.meta as TomcatConnectorView).certificateKeyPath}` : '',
                              (field.meta as TomcatConnectorView).keystorePath !== EMPTY_TEXT ? `Keystore：${(field.meta as TomcatConnectorView).keystorePath}` : '',
                            ].filter(Boolean).join('\n') || EMPTY_TEXT
                          }}</span>
                        </p>
                        <button
                          v-if="(field.meta as TomcatConnectorView).certificate"
                          class="agent-detail-modal__binding-link"
                          type="button"
                          @click.stop="openBindingCertificate(field.label, field.meta as TomcatConnectorView)"
                        >
                          查看证书
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
                          <p class="agent-detail-modal__site-path">部署目录：{{ (field.meta as TomcatAppView).docBase }}</p>
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
                  <div class="agent-detail-modal__log-list" role="list" aria-label="运行日志列表">
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
                                <span>任务类型：{{ (field.meta as RuntimeLogView).taskType !== EMPTY_TEXT ? (field.meta as RuntimeLogView).taskType : (field.meta as RuntimeLogView).category }}</span>
                                <span>站点名称：{{ (field.meta as RuntimeLogView).siteName !== EMPTY_TEXT ? (field.meta as RuntimeLogView).siteName : '未提供' }}</span>
                              </p>
                            </div>
                            <div class="agent-detail-modal__log-meta">
                              <span>{{ (field.meta as RuntimeLogView).emittedAt }}</span>
                              <b>{{ (field.meta as RuntimeLogView).dryRun ? 'DRY_RUN' : 'TASK' }}</b>
                              <small>{{ isRuntimeLogExpanded((field.meta as RuntimeLogView).id) ? '收起' : '展开' }}</small>
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
          {{ detailActionPending ? '重扫提交中...' : '手动重扫' }}
        </button>
        <button class="gc-button" type="button" :disabled="detailLoading || detailActionPending" @click="closeDetailModal">关闭</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="certificateModalOpen"
      title="证书详情"
      description="展示当前站点绑定使用的证书关键信息。"
      size="lg"
      width="56vw"
    >
      <section v-if="selectedCertificate?.binding.certificate" class="agent-certificate-modal">
        <div class="agent-certificate-modal__hero">
          <div>
            <p class="agent-certificate-modal__eyebrow">站点绑定证书</p>
            <h3>{{ selectedCertificate.binding.certificate.subject }}</h3>
            <span>{{ selectedCertificate.siteName }} / {{ selectedCertificate.binding.protocol.toUpperCase() }}:{{ selectedCertificate.binding.port }}</span>
          </div>
          <div class="agent-certificate-modal__status">
            <small>证书状态</small>
            <strong>{{ certificateStatusLabel(selectedCertificate.binding.certificate) }}</strong>
            <span>{{ certificateRemainingLabel(selectedCertificate.binding.certificate) }}</span>
          </div>
        </div>

        <article class="agent-detail-modal__section">
          <header class="agent-detail-modal__section-head">
            <h3>证书概览</h3>
            <p>展示证书名称、颁发者、开始时间、到期时间和指纹等关键信息。</p>
          </header>
          <dl class="agent-detail-modal__grid">
            <div class="agent-detail-modal__item" data-emphasis="true">
              <dt>证书名称</dt>
              <dd>{{ selectedCertificate.binding.certificate.subject }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>颁发者</dt>
              <dd>{{ selectedCertificate.binding.certificate.issuer }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>证书仓库</dt>
              <dd>{{ selectedCertificate.binding.certificate.storeName }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>开始时间</dt>
              <dd>{{ selectedCertificate.binding.certificate.notBefore }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>到期时间</dt>
              <dd>{{ selectedCertificate.binding.certificate.notAfter }}</dd>
            </div>
            <div
              class="agent-detail-modal__item"
              :data-emphasis="certificateValidityStatus(selectedCertificate.binding.certificate) !== 'valid' ? 'true' : 'false'"
            >
              <dt>剩余天数</dt>
              <dd>{{ certificateRemainingLabel(selectedCertificate.binding.certificate) }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>证书指纹</dt>
              <dd>{{ selectedCertificate.binding.certificate.thumbprint }}</dd>
            </div>
            <div
              v-if="selectedCertificate.binding.certificate.fingerprintSha256 !== EMPTY_TEXT"
              class="agent-detail-modal__item"
            >
              <dt>SHA-256 指纹</dt>
              <dd>{{ selectedCertificate.binding.certificate.fingerprintSha256 }}</dd>
            </div>
            <div class="agent-detail-modal__item">
              <dt>{{ 'hostHeader' in selectedCertificate.binding ? 'Host Header' : '监听地址' }}</dt>
              <dd>{{
                'hostHeader' in selectedCertificate.binding
                  ? (selectedCertificate.binding.hostHeader !== EMPTY_TEXT ? selectedCertificate.binding.hostHeader : '无 Host Header')
                  : (selectedCertificate.binding.address !== EMPTY_TEXT ? selectedCertificate.binding.address : '默认地址')
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
          {{ certificateAssetPending ? '查询中...' : '查看本项目证书详情' }}
        </button>
        <button class="gc-button" type="button" @click="closeCertificateModal">关闭</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="certificateAssetDetailOpen"
      title="本项目证书详情"
      description="在当前 Agent 详情上下文中展示项目内证书资产详情和关联使用关系。"
      size="xxl"
    >
      <CertificateDetailPanel
        v-if="selectedCertificateAssetRoute"
        :asset-id="selectedCertificateAssetRoute.assetId"
        :version-id="selectedCertificateAssetRoute.versionId"
        :context-usages="certificateContextUsages"
      />
      <template #actions>
        <button class="gc-button" type="button" @click="closeCertificateAssetModal">关闭</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="installModalOpen"
      title="安装 Agent"
      description="选择平台与版本，生成一次性安装命令。安装码 10 分钟内有效，且只能使用一次。"
      size="lg"
      :close-on-backdrop="false"
      width="58vw"
    >
      <section class="agent-install-modal">
        <div class="agent-install-modal__field">
          <p class="agent-install-modal__label">平台</p>
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
          <label class="agent-install-modal__label" for="agent-version">版本</label>
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
            {{ installPending ? '生成中...' : '生成安装命令' }}
          </button>
        </div>

        <p v-if="installError" class="agent-install-modal__error">{{ installError }}</p>

        <div v-if="installSession" class="agent-install-modal__result">
          <dl class="agent-install-modal__meta">
            <div>
              <dt>平台</dt>
              <dd>{{ installSession.platform === 'linux_go_systemd' ? 'Linux systemd' : 'Windows Go Service' }}</dd>
            </div>
            <div>
              <dt>安装码</dt>
              <dd>{{ installSession.bootstrapTokenPreview }}</dd>
            </div>
            <div>
              <dt>区域</dt>
              <dd>{{ installSession.zone }}</dd>
            </div>
            <div>
              <dt>剩余有效期</dt>
              <dd><span :class="{ 'agent-install-modal__expired': isExpired }">{{ remainingLabel }}</span></dd>
            </div>
          </dl>

          <label class="agent-install-modal__field">
            <span class="agent-install-modal__label">安装命令</span>
            <textarea readonly :value="installCommand" rows="3" />
          </label>

          <p class="agent-install-modal__hint">同一个安装码一旦被请求 bootstrap 脚本，就会立刻失效，不能重复使用。</p>
          <p v-if="copiedText" class="agent-install-modal__copied">{{ copiedText === 'token' ? '安装码已复制' : '安装命令已复制' }}</p>
        </div>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="installPending" @click="closeInstallModal">关闭</button>
        <button v-if="installSession" class="gc-button" type="button" @click="copyToken">复制安装码</button>
        <button
          v-if="installSession"
          class="gc-button agent-install-modal__primary"
          type="button"
          :disabled="!installCommand"
          @click="copyInstallCommand"
        >
          复制安装命令
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
  background: linear-gradient(180deg, var(--gc-color-legacy-422006), var(--gc-color-legacy-7c2d12));
  border-color: var(--gc-color-legacy-rgb-251-191-36-a42p);
}

.agent-detail-modal__binding-chip[data-cert-status='expired'] {
  background: linear-gradient(180deg, var(--gc-color-legacy-3f0d16), var(--gc-color-legacy-7f1d1d));
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
  color: var(--gc-color-legacy-052e16);
  background: var(--gc-color-legacy-86efac);
}

.agent-detail-modal__cert-badge[data-status='expiring'] {
  color: var(--gc-color-warning);
  background: var(--gc-color-legacy-fcd34d);
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
