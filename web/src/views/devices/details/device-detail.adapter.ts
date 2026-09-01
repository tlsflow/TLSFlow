import type {
  DeviceBoundCertificateView,
  DeviceCertificateView,
  DeviceDetailAdapter,
  DeviceDetailContext,
  DeviceDetailField,
  DeviceFrameworkView,
  DeviceDetailSection,
  DeviceLogView,
  DeviceSiteBindingView,
  DeviceSiteView,
} from './device-detail.model'
import { DEVICE_SITE_KIND_PATTERN, type DeviceSiteKind } from './device-detail.model'

export class DeviceDetailAdapterRegistry {
  private readonly adapters: DeviceDetailAdapter[]

  constructor(adapters: readonly DeviceDetailAdapter[] = []) {
    this.adapters = [...adapters].sort(compareAdapters)
  }

  register(adapter: DeviceDetailAdapter): DeviceDetailAdapterRegistry {
    return new DeviceDetailAdapterRegistry([...this.adapters.filter(item => item.key !== adapter.key), adapter])
  }

  resolve(detail: Readonly<Record<string, unknown>>): DeviceDetailAdapter {
    return this.adapters.find(adapter => adapter.supports(detail)) ?? genericDeviceDetailAdapter
  }

  buildContext(detail: Readonly<Record<string, unknown>>): DeviceDetailContext {
    return this.resolve(detail).buildContext(detail)
  }
}

export const genericDeviceDetailAdapter: DeviceDetailAdapter = {
  key: 'generic',
  priority: -1000,
  supports: () => true,
  buildContext: buildGenericContext,
}

export function buildGenericContext(detail: Readonly<Record<string, unknown>>): DeviceDetailContext {
  const informationSections = readList(detail.informationSections).map(readSection).filter(isDefined)
  const certificates = readList(detail.certificates).map(readCertificate).filter(isDefined)
  const sites = readList(detail.sites)
    .map(readSite)
    .filter(isDefined)
    .map(site => hydrateSiteBindingCertificates(site, certificates))
  return {
    detail,
    overviewSections: informationSections,
    frameworks: readList(detail.frameworks).map(readFramework).filter(isDefined),
    sites,
    certificates,
    logs: readList(detail.logs).map(readLog).filter(isDefined),
    resourceCounts: readResourceCounts(detail.resourceCounts),
    permissions: new Set(readList(detail.allowedActions).map(String)),
  }
}

function readResourceCounts(value: unknown): DeviceDetailContext['resourceCounts'] {
  const record = readRecord(value)
  return {
    frameworks: readNumber(record.frameworks) ?? 0,
    sites: readNumber(record.sites) ?? 0,
    certificates: readNumber(record.certificates) ?? 0,
    logs: readNumber(record.logs) ?? 0,
  }
}

function readFramework(value: unknown): DeviceFrameworkView | undefined {
  const record = readRecord(value)
  const id = readString(record.id) || readString(record.stableKey)
  const name = readString(record.displayName) || readString(record.name)
  const frameworkType = readString(record.frameworkType)
  if (!id || !name) return undefined
  // device.generic 是旧空快照的设备占位，不是可展示或可操作的 Web 框架。
  if (frameworkType === 'device.generic') return undefined
  const presentation = readRecord(record.presentation)
  return {
    id,
    name,
    type: readString(presentation.typeLabel) || frameworkType || readString(record.type) || undefined,
    version: readString(record.version) || undefined,
    status: readString(record.status) || undefined,
    metadata: readRecord(record.metadata),
  }
}

function compareAdapters(left: DeviceDetailAdapter, right: DeviceDetailAdapter): number {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.key.localeCompare(right.key)
}

function readSection(value: unknown): DeviceDetailSection | undefined {
  const record = readRecord(value)
  const key = readString(record.key)
  if (!key) return undefined
  return { key, fields: readList(record.fields).map(readField).filter(isDefined) }
}

function readField(value: unknown): DeviceDetailField | undefined {
  const record = readRecord(value)
  const key = readString(record.key)
  const valueType = readString(record.valueType) as DeviceDetailField['valueType']
  if (!key || !['TEXT', 'STATUS', 'DATETIME', 'BOOLEAN', 'NUMBER'].includes(valueType)) return undefined
  const fieldValue = record.value
  return {
    key,
    value: typeof fieldValue === 'string' || typeof fieldValue === 'number' || typeof fieldValue === 'boolean' || fieldValue === null ? fieldValue : null,
    valueType,
    copyable: record.copyable === true,
  }
}

function readSite(value: unknown): DeviceSiteView | undefined {
  const record = readRecord(value)
  const id = readString(record.id)
  const siteAssetId = readString(record.siteAssetId)
  const kind = readString(record.kind)
  const frameworkType = readString(record.frameworkType)
  const name = readString(record.name)
  if (!id || !siteAssetId || !name || !DEVICE_SITE_KIND_PATTERN.test(kind) || !DEVICE_SITE_KIND_PATTERN.test(frameworkType)) return undefined
  const endpoint = readRecord(record.endpoint)
  const presentation = readRecord(record.presentation)
  const groupKey = readString(presentation.groupKey)
  const groupLabelKey = readString(presentation.groupLabelKey)
  const typeLabelKey = readString(presentation.typeLabelKey)
  const groupLabel = readString(presentation.groupLabel)
  const typeLabel = readString(presentation.typeLabel)
  return {
    id,
    siteAssetId,
    frameworkInstanceId: readString(record.frameworkInstanceId) || undefined,
    managedTargetId: readString(record.managedTargetId) || undefined,
    kind: kind as DeviceSiteKind,
    frameworkType,
    name,
    status: readString(record.status) || undefined,
    endpoint: Object.keys(endpoint).length ? {
      address: readString(endpoint.address) || undefined,
      hostName: readString(endpoint.hostName) || undefined,
      port: readNumber(endpoint.port),
      protocol: readString(endpoint.protocol) || undefined,
    } : undefined,
    configPath: readString(record.configPath) || undefined,
    presentation: groupKey && groupLabelKey && typeLabelKey
      ? { groupKey, groupLabelKey, typeLabelKey, groupLabel: groupLabel || undefined, typeLabel: typeLabel || undefined }
      : undefined,
    bindings: readList(record.bindings).map(readBinding).filter(isDefined),
    metadata: readRecord(record.metadata),
  }
}

function readBinding(value: unknown): DeviceSiteBindingView | undefined {
  const record = readRecord(value)
  const id = readString(record.id)
  const bindingKey = readString(record.bindingKey)
  if (!id || !bindingKey) return undefined
  const replacement = readRecord(record.replacement)
  // 中文说明：旧版云投影可能只保留 metadata.remoteCertificate，没有生成标准 certificate 节点。
  // 先在适配层恢复证书事实，随后由 buildGenericContext 关联项目证书库版本。
  const certificate = readCertificate(record.certificate) ?? readCloudCertificate(readRecord(record.metadata))
  return {
    id,
    bindingKey,
    bindingType: readString(record.bindingType) || 'UNKNOWN',
    hostName: readString(record.hostName) || undefined,
    status: readString(record.status) || 'UNKNOWN',
    certificate,
    deploymentTarget: readRecord(record.deploymentTarget),
    metadata: readRecord(record.metadata),
    replacement: {
      allowed: replacement.allowed === true,
      managedTargetId: readString(replacement.managedTargetId) || undefined,
      reasonCode: readString(replacement.reasonCode) || undefined,
    },
  }
}

function readCloudCertificate(metadata: Readonly<Record<string, unknown>>): DeviceBoundCertificateView | undefined {
  const nested = readRecord(metadata.certificate ?? metadata.remoteCertificate)
  const pick = (...keys: string[]) => keys
    .map(key => nested[key] ?? metadata[key])
    .map(value => readString(value))
    .find(value => value.length > 0)
  const name = pick('name', 'certificateName', 'providerCertificateName', 'certName', 'CertificateName')
  const domain = pick('subject', 'Subject', 'certDomainName', 'domainName', 'domain', 'address')
  const issuer = pick('issuer', 'Issuer', 'certOrg')
  const notBefore = pick('notBefore', 'NotBefore', 'certStartTime')
  const notAfter = pick('notAfter', 'NotAfter', 'certExpireTime')
  const fingerprintSha256 = pick('fingerprintSha256', 'sha256Fingerprint', 'FingerprintSha256', 'Fingerprint')
  const providerId = pick('providerCertificateId', 'certId', 'CertId', 'certificateId', 'CertificateId')
  if (!name && !domain && !issuer && !notBefore && !notAfter && !fingerprintSha256 && !providerId) return undefined
  const subject = domain ? (domain.startsWith('CN=') ? domain : `CN=${domain}`) : undefined
  return {
    name,
    subject,
    issuer,
    notBefore,
    notAfter,
    fingerprintSha256,
    status: pick('status', 'remoteCertificateStatus', 'serverCertificateStatus') || undefined,
  }
}

function hydrateSiteBindingCertificates(site: DeviceSiteView, certificates: readonly DeviceCertificateView[]): DeviceSiteView {
  return {
    ...site,
    bindings: site.bindings.map(binding => {
      if (!binding.certificate) return binding
      const matched = certificates.find(candidate => certificatesMatch(binding.certificate!, candidate))
      if (!matched) return binding
      return {
        ...binding,
        certificate: {
          ...binding.certificate,
          id: matched.id,
          certificateAssetId: binding.certificate.certificateAssetId || matched.certificateAssetId,
          certificateVersionId: binding.certificate.certificateVersionId || matched.certificateVersionId,
        },
      }
    }),
  }
}

function certificatesMatch(left: DeviceBoundCertificateView, right: DeviceCertificateView): boolean {
  const leftFingerprint = normalizeFingerprint(left.fingerprintSha256)
  const rightFingerprint = normalizeFingerprint(right.fingerprintSha256)
  if (leftFingerprint && rightFingerprint) return leftFingerprint === rightFingerprint
  const leftName = certificateName(left)
  const rightName = certificateName(right)
  if (!leftName || !rightName || leftName !== rightName) return false
  return !left.notAfter || !right.notAfter || Date.parse(left.notAfter) === Date.parse(right.notAfter)
}

function certificateName(certificate: DeviceBoundCertificateView): string {
  // 中文说明：云厂商证书名称通常是内部资源名，证书库应按 CN/SAN 身份匹配。
  const value = certificate.subject || certificate.name || ''
  return value.replace(/^CN=/i, '').trim().toLowerCase()
}

function normalizeFingerprint(value?: string): string {
  return String(value ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase()
}

function readCertificate(value: unknown): DeviceCertificateView | undefined {
  const record = readRecord(value)
  const id = readString(record.id)
    || readString(record.certificateVersionId)
    || readString(record.fingerprintSha256)
    || readString(record.name)
    || readString(record.subject)
  if (!id) return undefined
  return {
    id,
    certificateAssetId: readString(record.certificateAssetId) || undefined,
    certificateVersionId: readString(record.certificateVersionId) || undefined,
    name: readString(record.name) || undefined,
    subject: readString(record.subject) || undefined,
    issuer: readString(record.issuer) || undefined,
    notBefore: readString(record.notBefore) || undefined,
    notAfter: readString(record.notAfter) || undefined,
    fingerprintSha256: readString(record.fingerprintSha256) || undefined,
    status: readString(record.status) || undefined,
  }
}

function readLog(value: unknown): DeviceLogView | undefined {
  const record = readRecord(value)
  const id = readString(record.id)
  const eventType = readString(record.eventType)
  const occurredAt = readString(record.occurredAt)
  if (!id || !eventType || !occurredAt) return undefined
  return {
    id,
    eventType,
    result: readString(record.result) || undefined,
    summary: readString(record.summary) || undefined,
    occurredAt,
    actorId: readString(record.actorId) || undefined,
    metadata: readRecord(record.metadata),
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value)
}

function readNumber(value: unknown): number | undefined {
  const result = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(result) ? result : undefined
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
