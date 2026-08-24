import type { ApiRecord } from '@/api/modules/common'

export function isDeployableCertificateVersion(item: ApiRecord, now = Date.now()): boolean {
  const notAfter = Date.parse(readString(item, ['notAfter', 'validTo', 'expiresAt']))
  return readString(item, ['status']).toLowerCase() === 'active'
    && readBoolean(item, ['deployable'])
    && Number.isFinite(notAfter)
    && notAfter > now
}

export function sortDeployableCertificateVersions(items: readonly ApiRecord[], now = Date.now()): ApiRecord[] {
  return items
    .filter((item) => isDeployableCertificateVersion(item, now))
    .sort((left, right) => {
      const rightNotAfter = Date.parse(readString(right, ['notAfter', 'validTo', 'expiresAt']))
      const leftNotAfter = Date.parse(readString(left, ['notAfter', 'validTo', 'expiresAt']))
      if (rightNotAfter !== leftNotAfter) return rightNotAfter - leftNotAfter

      const rightCreatedAt = Date.parse(readString(right, ['createdAt', 'issuedAt']))
      const leftCreatedAt = Date.parse(readString(left, ['createdAt', 'issuedAt']))
      if (Number.isFinite(rightCreatedAt) && Number.isFinite(leftCreatedAt) && rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt

      return readString(right, ['id', 'certificateVersionId']).localeCompare(readString(left, ['id', 'certificateVersionId']))
    })
}

export function selectLatestDeployableCertificateVersion(
  versions: readonly ApiRecord[],
  certificateAssetId: string,
  now = Date.now(),
): ApiRecord | null {
  if (!certificateAssetId) return null
  return sortDeployableCertificateVersions(
    versions.filter((item) => readString(item, ['certificateAssetId', 'certificateId']) === certificateAssetId),
    now,
  )[0] ?? null
}

function readPath(record: ApiRecord | null | undefined, path: string): unknown {
  if (!record) return undefined
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function readString(record: ApiRecord | null | undefined, candidates: readonly string[]): string {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value === undefined || value === null || value === '') continue
    return String(value)
  }
  return ''
}

function readBoolean(record: ApiRecord | null | undefined, candidates: readonly string[]): boolean {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (typeof value === 'boolean') return value
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return false
}
