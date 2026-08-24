import type { ApiRecord } from '@/api/modules/common'

export interface CurrentAssetCertificateState {
  readonly version: ApiRecord | null
  readonly versionId: string
  readonly notAfter: string
  readonly notAfterTime: number
}

export function enrichDeploymentPlanRecord(
  plan: ApiRecord,
  versions: readonly ApiRecord[],
  assets: readonly ApiRecord[],
  assetDetails: ReadonlyMap<string, ApiRecord>,
  latestCertificateObservationsByAssetId: ReadonlyMap<string, ApiRecord> = new Map(),
): ApiRecord {
  const effectivePlanVersion = resolveLatestDeployableVersionForPlan(readString(plan, ['certificateVersionId']), versions)
    ?? resolveEffectivePlannedCertificateVersion(plan, versions)
  const currentAssetState = resolveCurrentAssetCertificateState(plan, versions, assets, assetDetails, latestCertificateObservationsByAssetId)
  const planNotAfter = parseCertificateNotAfter(effectivePlanVersion)
  const currentNotAfter = currentAssetState.notAfterTime
  const needsUpdate = Number.isFinite(planNotAfter) && Number.isFinite(currentNotAfter)
    ? currentNotAfter < planNotAfter
    : undefined

  return {
    ...plan,
    updateNeeded: needsUpdate === undefined
      ? 'UNKNOWN'
      : (needsUpdate ? 'UPDATE_REQUIRED' : 'UP_TO_DATE'),
    effectivePlanCertificateVersionId: readString(effectivePlanVersion, ['id', 'certificateVersionId']),
    effectivePlanCertificateNotAfter: readString(effectivePlanVersion, ['notAfter', 'validTo', 'expiresAt']),
    currentAssetCertificateVersionId: currentAssetState.versionId,
    currentAssetCertificateNotAfter: currentAssetState.notAfter,
    currentAssetCertificateExpiresAt: currentAssetState.notAfter,
    currentAssetCertificate: {
      expiresAt: currentAssetState.notAfter,
      versionId: currentAssetState.versionId,
    },
    needsUpdate,
  }
}

export function resolveCurrentAssetCertificateState(
  plan: ApiRecord,
  versions: readonly ApiRecord[],
  assets: readonly ApiRecord[],
  assetDetails: ReadonlyMap<string, ApiRecord>,
  latestCertificateObservationsByAssetId: ReadonlyMap<string, ApiRecord> = new Map(),
): CurrentAssetCertificateState {
  const emptyState: CurrentAssetCertificateState = {
    version: null,
    versionId: '',
    notAfter: '',
    notAfterTime: Number.NaN,
  }
  const applicationAssetId = resolveApplicationAssetIdForPlan(plan, assets)
  if (!applicationAssetId) return emptyState
  const observed = latestCertificateObservationsByAssetId.get(applicationAssetId)
  const observedNotAfter = readString(observed, ['notAfter'])
  const observedNotAfterTime = Date.parse(observedNotAfter)
  if (Number.isFinite(observedNotAfterTime)) {
    return {
      version: null,
      versionId: '',
      notAfter: observedNotAfter,
      notAfterTime: observedNotAfterTime,
    }
  }
  const asset = assets.find((item) => readString(item, ['id']) === applicationAssetId) ?? null
  const metadataNotAfter = readString(asset, ['metadata.currentCertificate.notAfter', 'metadata.currentCertificateNotAfter'])
  const metadataNotAfterTime = Date.parse(metadataNotAfter)
  if (Number.isFinite(metadataNotAfterTime)) {
    return {
      version: null,
      versionId: '',
      notAfter: metadataNotAfter,
      notAfterTime: metadataNotAfterTime,
    }
  }
  const assetDetail = assetDetails.get(applicationAssetId)
  if (!assetDetail) return emptyState
  const target = Array.isArray(plan.targets) ? (plan.targets[0] as ApiRecord | undefined) : undefined
  const certificateBindingId = readString(target, ['certificateBindingId'])
  const binding = resolveCurrentCertificateBinding(assetDetail, certificateBindingId)
  const snapshot = resolveCurrentCertificateSnapshot(assetDetail, binding)
  const observedVersion = resolveObservedCertificateVersion(binding, snapshot, versions)
  if (observedVersion) return toCurrentState(observedVersion)

  const currentCertificateVersionId = readString(binding, ['certificateVersionId'])
  if (currentCertificateVersionId) {
    const currentVersion = versions.find((item) => readString(item, ['id', 'certificateVersionId']) === currentCertificateVersionId) ?? null
    if (currentVersion) return toCurrentState(currentVersion)
  }
  if (!snapshot) return emptyState
  const snapshotNotAfter = readString(snapshot, ['metadata.detail.verify.notAfter'])
  const snapshotNotAfterTime = Date.parse(snapshotNotAfter)
  return {
    version: null,
    versionId: '',
    notAfter: snapshotNotAfter,
    notAfterTime: Number.isFinite(snapshotNotAfterTime) ? snapshotNotAfterTime : Number.NaN,
  }
}

function toCurrentState(version: ApiRecord): CurrentAssetCertificateState {
  return {
    version,
    versionId: readString(version, ['id', 'certificateVersionId']),
    notAfter: readString(version, ['notAfter', 'validTo', 'expiresAt']),
    notAfterTime: parseCertificateNotAfter(version),
  }
}

function resolveObservedCertificateVersion(
  binding: ApiRecord | null,
  snapshot: ApiRecord | null,
  versions: readonly ApiRecord[],
): ApiRecord | null {
  const snapshotVersionId = readString(snapshot, ['certificateVersionId'])
  if (snapshotVersionId) {
    const matched = versions.find((item) => readString(item, ['id', 'certificateVersionId']) === snapshotVersionId)
    if (matched) return matched
  }

  const fingerprints = [
    readString(binding, ['observedFingerprintSha256']),
    readString(snapshot, ['fingerprintSha256']),
    readString(snapshot, ['metadata.detail.verify.remoteCertificateSha256']),
    readString(snapshot, ['metadata.detail.installedCertificateSha256']),
    readString(snapshot, ['metadata.detail.installResult.targetCertificateSha256']),
    readString(snapshot, ['metadata.detail.targetCertificateSha256']),
  ]
    .map((value) => normalizeHexString(value))
    .filter(Boolean)

  for (const fingerprint of fingerprints) {
    const matched = versions.find((item) => normalizeHexString(readString(item, ['fingerprintSha256'])) === fingerprint)
    if (matched) return matched
  }
  return null
}

function resolveEffectivePlannedCertificateVersion(plan: ApiRecord, versions: readonly ApiRecord[]): ApiRecord | null {
  const plannedCertificateVersionId = readString(plan, ['certificateVersionId'])
  const selectionMode = readString(plan, ['selectionMode'], 'EXPLICIT')
  if (!plannedCertificateVersionId) return null
  if (selectionMode !== 'LATEST_AUTO') {
    return versions.find((item) => readString(item, ['id', 'certificateVersionId']) === plannedCertificateVersionId) ?? null
  }
  return resolveLatestDeployableVersionForPlan(plannedCertificateVersionId, versions)
    ?? (versions.find((item) => readString(item, ['id', 'certificateVersionId']) === plannedCertificateVersionId) ?? null)
}

function resolveCurrentCertificateBinding(assetDetail: ApiRecord, certificateBindingId: string): ApiRecord | null {
  const bindings = Array.isArray(readPath(assetDetail, 'targetBindingDetail.certificateBindings'))
    ? readPath(assetDetail, 'targetBindingDetail.certificateBindings') as ApiRecord[]
    : []
  return bindings.find((item) => certificateBindingId && readString(item, ['id']) === certificateBindingId) ?? bindings[0] ?? null
}

function resolveCurrentCertificateSnapshot(assetDetail: ApiRecord, binding: ApiRecord | null): ApiRecord | null {
  const bindingId = readString(binding, ['id'])
  const currentThumbprint = normalizeHexString(readString(binding, ['storeThumbprint']))
    || normalizeHexString(readString(assetDetail, [
      'targetBinding.metadata.currentThumbprint',
      'targetBindingDetail.metadata.currentThumbprint',
      'targetBindingDetail.siteAsset.metadata.currentThumbprint',
    ]))
  const snapshots = (Array.isArray(assetDetail.targetSnapshots) ? assetDetail.targetSnapshots as ApiRecord[] : [])
    .filter((item) => !bindingId || readString(item, ['certificateBindingId']) === bindingId)
    .sort((left, right) => {
      const rightCapturedAt = Date.parse(readString(right, ['capturedAt', 'createdAt', 'updatedAt']))
      const leftCapturedAt = Date.parse(readString(left, ['capturedAt', 'createdAt', 'updatedAt']))
      if (Number.isFinite(rightCapturedAt) && Number.isFinite(leftCapturedAt) && rightCapturedAt !== leftCapturedAt) {
        return rightCapturedAt - leftCapturedAt
      }
      return readString(right, ['id']).localeCompare(readString(left, ['id']))
    })
  if (currentThumbprint) {
    const matchedByThumbprint = snapshots.find((item) => resolveSnapshotThumbprints(item).includes(currentThumbprint))
    if (matchedByThumbprint) return matchedByThumbprint
  }
  return snapshots.find((item) => Boolean(readString(item, ['certificateVersionId', 'fingerprintSha256', 'metadata.detail.verify.notAfter']))) ?? null
}

function resolveSnapshotThumbprints(snapshot: ApiRecord): string[] {
  return [
    readString(snapshot, ['storeThumbprint']),
    readString(snapshot, ['metadata.detail.verify.remoteThumbprint']),
    readString(snapshot, ['metadata.detail.newThumbprint']),
    readString(snapshot, ['metadata.detail.installResult.newThumbprint']),
  ]
    .map((value) => normalizeHexString(value))
    .filter(Boolean)
}

function normalizeHexString(value: string): string {
  return value.replace(/[^0-9a-f]/gi, '').toUpperCase()
}

export function resolveApplicationAssetIdForPlan(plan: ApiRecord, assets: readonly ApiRecord[]): string {
  const directApplicationAssetId = readString(Array.isArray(plan.targets) ? plan.targets[0] as ApiRecord | undefined : undefined, [
    'applicationAssetId',
    'serviceAssetId',
    'strategyPayload.workflowRequest.applicationAssetId',
    'strategyPayload.applicationAssetId',
  ])
  if (directApplicationAssetId) return directApplicationAssetId
  return readString(resolveApplicationAssetRecordForPlan(plan, assets), ['id'])
}

function resolveApplicationAssetRecordForPlan(plan: ApiRecord, assets: readonly ApiRecord[]): ApiRecord | null {
  const targets = Array.isArray(plan.targets) ? plan.targets as ApiRecord[] : []
  const target = targets[0]
  if (!target) return null
  const executionTargetId = readString(target, ['executionTargetId', 'managedTargetId'])
  const applicationAssetId = readString(target, [
    'applicationAssetId',
    'serviceAssetId',
    'strategyPayload.workflowRequest.applicationAssetId',
    'strategyPayload.applicationAssetId',
  ])
  return assets.find((item) => {
    if (applicationAssetId && readString(item, ['id']) === applicationAssetId) return true
    if (executionTargetId && readString(item, ['targetBinding.managedTargetId']) === executionTargetId) return true
    return false
  }) ?? null
}

function parseCertificateNotAfter(version: ApiRecord | null): number {
  const notAfter = Date.parse(readString(version, ['notAfter', 'validTo', 'expiresAt']))
  return Number.isFinite(notAfter) ? notAfter : Number.NaN
}

function resolveLatestDeployableVersionForPlan(
  currentCertificateVersionId: string,
  versions: readonly ApiRecord[],
): ApiRecord | null {
  if (!currentCertificateVersionId) return null
  const currentVersion = versions.find((item) => readString(item, ['id', 'certificateVersionId']) === currentCertificateVersionId)
  const certificateAssetId = readString(currentVersion, ['certificateAssetId', 'certificateId'])
  if (!certificateAssetId) return null
  return [...versions]
    .filter((item) => readString(item, ['certificateAssetId', 'certificateId']) === certificateAssetId)
    .filter((item) => isDeployableCertificateVersion(item))
    .sort((left, right) => {
      const rightNotAfter = Date.parse(readString(right, ['notAfter', 'validTo', 'expiresAt']))
      const leftNotAfter = Date.parse(readString(left, ['notAfter', 'validTo', 'expiresAt']))
      if (Number.isFinite(rightNotAfter) && Number.isFinite(leftNotAfter) && rightNotAfter !== leftNotAfter) return rightNotAfter - leftNotAfter

      const rightCreatedAt = Date.parse(readString(right, ['createdAt', 'issuedAt']))
      const leftCreatedAt = Date.parse(readString(left, ['createdAt', 'issuedAt']))
      if (Number.isFinite(rightCreatedAt) && Number.isFinite(leftCreatedAt) && rightCreatedAt !== leftCreatedAt) return rightCreatedAt - leftCreatedAt

      return readString(right, ['id', 'certificateVersionId']).localeCompare(readString(left, ['id', 'certificateVersionId']))
    })[0] ?? null
}

function isDeployableCertificateVersion(item: ApiRecord): boolean {
  const notAfter = Date.parse(readString(item, ['notAfter', 'validTo', 'expiresAt']))
  return readString(item, ['status']).toLowerCase() === 'active'
    && readBoolean(item, ['deployable'])
    && Number.isFinite(notAfter)
    && notAfter > Date.now()
}

function readPath(record: ApiRecord | null | undefined, path: string): unknown {
  if (!record) return undefined
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[segment]
  }, record)
}

function readString(record: ApiRecord | null | undefined, candidates: readonly string[], fallback = ''): string {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (value === undefined || value === null || value === '') continue
    return String(value)
  }
  return fallback
}

function readBoolean(record: ApiRecord | null | undefined, candidates: readonly string[]): boolean {
  for (const candidate of candidates) {
    const value = readPath(record, candidate)
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      if (value === 'true') return true
      if (value === 'false') return false
    }
  }
  return false
}
