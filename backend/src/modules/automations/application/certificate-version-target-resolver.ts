import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { ServiceAssetDetailDto } from '../../assets/dto/assets.dto.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AutomationPreviewTargetDto } from '../dto/automations.dto.js';
import type { AutomationTargetAccessPort, AutomationTargetResolver, AutomationTargetResolverInput } from './automation-target-resolver.registry.js';

export class CertificateVersionTargetResolver implements AutomationTargetResolver {
  readonly type = 'certificate_version_targets' as const;

  constructor(
    private readonly certificates: CertificatesRepository,
    private readonly bindings: BindingsRepository,
    private readonly assets: AssetsRepository,
    private readonly access: AutomationTargetAccessPort,
  ) {}

  validate(): void {}

  async resolve(input: AutomationTargetResolverInput): Promise<AutomationPreviewTargetDto[]> {
    const certificateVersionId = input.triggerContext?.certificateVersionId;
    if (!certificateVersionId) return [];
    const version = await this.certificates.getVersion(certificateVersionId, input.tenantId);
    if (!version) {
      return [{
        target: {
          certificateId: input.triggerContext?.certificateAssetId ?? 'missing_certificate_asset',
          certificateName: 'missing_certificate_version',
          certificateVersionId,
          eventId: input.triggerContext?.eventId,
          eventType: input.triggerContext?.eventType,
          sourceType: input.triggerContext?.sourceType,
          tags: input.triggerContext?.tags ?? [],
        },
        executable: false,
        excludedReason: 'missing_version',
      }];
    }
    const asset = await this.certificates.getAsset(version.certificateAssetId, input.tenantId);
    if (!asset) {
      return [{
        target: {
          certificateId: version.certificateAssetId,
          certificateName: 'missing_certificate_asset',
          certificateVersionId: version.id,
          eventId: input.triggerContext?.eventId,
          eventType: input.triggerContext?.eventType,
          sourceType: input.triggerContext?.sourceType,
          tags: input.triggerContext?.tags ?? [],
        },
        executable: false,
        excludedReason: 'missing_version',
      }];
    }
    if (input.triggerContext?.sourceType === 'external_api' && input.triggerContext.domains?.length) {
      const configuredDomains = new Set(input.triggerContext.domains.map(normalizeDomain));
      if (!configuredDomains.has(normalizeDomain(asset.primaryDomain))) {
        throw new AppError('VALIDATION_FAILED', '证书版本不属于自动化预设域名', {
          certificateVersionId,
          primaryDomain: asset.primaryDomain,
          configuredDomains: [...configuredDomains],
        });
      }
    }

    const requestedSelectedAssetIds = input.resolver.type === 'certificate_version_targets'
      ? [...new Set(input.resolver.assetIds ?? [])]
      : [];
    const hasExplicitSelection = requestedSelectedAssetIds.length > 0;
    const selectedAssetIds: string[] = [];
    for (const assetId of requestedSelectedAssetIds) {
      // 先确认应用资产仍在当前清单中，再建立 ManagedTarget 关联，避免残留关联把已删除资产带回影响分析。
      if (await this.assets.getServiceAsset(input.tenantId, assetId)) selectedAssetIds.push(assetId);
    }
    const selectedManagedTargetIds = new Map<string, string>();
    for (const assetId of selectedAssetIds) {
      const target = await this.assets.getApplicationAssetTargetByApplicationAssetId?.(input.tenantId, assetId);
      if (target?.managedTargetId) selectedManagedTargetIds.set(target.managedTargetId, assetId);
    }

    const bindings = (await this.bindings.listCertificateBindings(input.tenantId, { page: 1, pageSize: 5000, filter: {} } as PageQuery)).items
      .filter((binding) => {
        if (binding.deletedAt) return false;
        if (!hasExplicitSelection) return true;
        if (binding.serviceAssetId && selectedAssetIds.includes(binding.serviceAssetId)) return true;
        if (binding.managedTargetId && selectedManagedTargetIds.has(binding.managedTargetId)) return true;
        return false;
      });
    const targets: AutomationPreviewTargetDto[] = [];
    const bindingAssetIds = new Set<string>();
    for (const binding of bindings) {
      if (binding.serviceAssetId) bindingAssetIds.add(binding.serviceAssetId);
      const selectedAssetId = binding.managedTargetId ? selectedManagedTargetIds.get(binding.managedTargetId) : undefined;
      if (selectedAssetId) bindingAssetIds.add(selectedAssetId);
    }

    if (hasExplicitSelection) {
      for (const assetId of selectedAssetIds.filter((id) => !bindingAssetIds.has(id))) {
        const serviceAsset = await this.assets.getServiceAssetDetail(input.tenantId, assetId)
          ?? await this.assets.getServiceAsset(input.tenantId, assetId);
        // 已删除或不存在的应用资产不再属于当前清单，不能把历史 ID 伪装成新的缺少绑定目标。
        if (!serviceAsset) continue;
        const currentCertificateState = await resolveCurrentCertificateState({
          detail: serviceAsset,
          certificates: this.certificates,
          tenantId: input.tenantId,
        });
        const certificateVersionImpact = compareCertificateExpiry(version.notAfter, currentCertificateState.notAfter);
        targets.push({
          target: {
            certificateId: asset.id,
            certificateName: asset.name,
            certificateVersionId: version.id,
            ...(currentCertificateState.versionId ? { currentCertificateVersionId: currentCertificateState.versionId } : {}),
            ...(currentCertificateState.notAfter ? { currentCertificateNotAfter: currentCertificateState.notAfter } : {}),
            targetCertificateNotAfter: version.notAfter,
            certificateVersionImpact,
            eventId: input.triggerContext?.eventId,
            eventType: input.triggerContext?.eventType,
            sourceType: input.triggerContext?.sourceType,
            assetId,
            assetName: serviceAsset?.displayName ?? serviceAsset?.address,
            environment: serviceAsset?.environment,
            tags: [...asset.tags],
          },
          executable: false,
          excludedReason: certificateVersionImpact === 'same' ? 'certificate_already_up_to_date' : 'binding_missing',
        });
      }
    }

    for (const binding of bindings) {
      const bindingVersionId = resolveCurrentCertificateVersionId(binding);
      if (!bindingVersionId) {
        const resolvedAssetId = binding.serviceAssetId ?? (binding.managedTargetId ? selectedManagedTargetIds.get(binding.managedTargetId) : undefined);
        const serviceAsset = resolvedAssetId
          ? (await this.assets.getServiceAssetDetail(input.tenantId, resolvedAssetId)
            ?? await this.assets.getServiceAsset(input.tenantId, resolvedAssetId))
          : undefined;
        const currentCertificateState = await resolveCurrentCertificateState({
          detail: serviceAsset,
          binding,
          certificates: this.certificates,
          tenantId: input.tenantId,
        });
        const host = serviceAsset?.hostId ? await this.assets.getHost(input.tenantId, serviceAsset.hostId) : undefined;
        const certificateVersionImpact = compareCertificateExpiry(version.notAfter, currentCertificateState.notAfter);
        const target = {
          certificateId: asset.id,
          certificateName: asset.name,
          certificateVersionId: version.id,
          ...(currentCertificateState.versionId ? { currentCertificateVersionId: currentCertificateState.versionId } : {}),
          ...(currentCertificateState.notAfter ? { currentCertificateNotAfter: currentCertificateState.notAfter } : {}),
          targetCertificateNotAfter: version.notAfter,
          certificateVersionImpact,
          eventId: input.triggerContext?.eventId,
          eventType: input.triggerContext?.eventType,
          sourceType: input.triggerContext?.sourceType,
          bindingId: binding.id,
          assetId: resolvedAssetId,
          assetName: serviceAsset?.displayName ?? serviceAsset?.address,
          environment: serviceAsset?.environment,
          ownerId: host?.ownerId,
          tags: [...asset.tags],
        };
        let excludedReason: AutomationPreviewTargetDto['excludedReason'];
        if (!currentCertificateState.notAfter) excludedReason = 'binding_missing';
        else if (certificateVersionImpact === 'same') excludedReason = 'certificate_already_up_to_date';
        else if (!await this.access.canReadTarget({ tenantId: input.tenantId, actorId: input.actorId, bindingId: binding.id, assetId: resolvedAssetId ?? serviceAsset?.id })) excludedReason = 'permission_denied';
        else if (!version.deployable) excludedReason = 'version_not_deployable';
        else if (binding.status !== 'MANAGED') excludedReason = 'binding_not_managed';
        else if (!serviceAsset) excludedReason = 'asset_missing_deployment_capability';
        else if (input.guardrails.allowedEnvironments?.length && (!serviceAsset.environment || !input.guardrails.allowedEnvironments.includes(serviceAsset.environment))) excludedReason = 'environment_not_allowed';
        else if (certificateVersionImpact === 'downgrade' && !input.allowCertificateDowngrade) excludedReason = 'certificate_version_downgrade';
        targets.push({
          target,
          executable: !excludedReason,
          excludedReason,
        });
        continue;
      }
      const bindingVersion = await this.certificates.getVersion(bindingVersionId, input.tenantId);
      if (!bindingVersion) {
        const resolvedAssetId = binding.serviceAssetId ?? (binding.managedTargetId ? selectedManagedTargetIds.get(binding.managedTargetId) : undefined);
        const serviceAsset = resolvedAssetId
          ? (await this.assets.getServiceAssetDetail(input.tenantId, resolvedAssetId)
            ?? await this.assets.getServiceAsset(input.tenantId, resolvedAssetId))
          : undefined;
        const currentCertificateState = await resolveCurrentCertificateState({
          detail: serviceAsset,
          binding,
          certificates: this.certificates,
          tenantId: input.tenantId,
        });
        const host = serviceAsset?.hostId ? await this.assets.getHost(input.tenantId, serviceAsset.hostId) : undefined;
        const certificateVersionImpact = compareCertificateExpiry(version.notAfter, currentCertificateState.notAfter);
        const target = {
          certificateId: asset.id,
          certificateName: asset.name,
          certificateVersionId: version.id,
          ...(currentCertificateState.versionId ? { currentCertificateVersionId: currentCertificateState.versionId } : {}),
          ...(currentCertificateState.notAfter ? { currentCertificateNotAfter: currentCertificateState.notAfter } : {}),
          targetCertificateNotAfter: version.notAfter,
          certificateVersionImpact,
          eventId: input.triggerContext?.eventId,
          eventType: input.triggerContext?.eventType,
          sourceType: input.triggerContext?.sourceType,
          bindingId: binding.id,
          assetId: resolvedAssetId,
          assetName: serviceAsset?.displayName ?? serviceAsset?.address,
          environment: serviceAsset?.environment,
          ownerId: host?.ownerId,
          tags: [...asset.tags],
        };
        let excludedReason: AutomationPreviewTargetDto['excludedReason'];
        if (!currentCertificateState.notAfter) excludedReason = 'missing_version';
        else if (certificateVersionImpact === 'same') excludedReason = 'certificate_already_up_to_date';
        else if (!await this.access.canReadTarget({ tenantId: input.tenantId, actorId: input.actorId, bindingId: binding.id, assetId: resolvedAssetId ?? serviceAsset?.id })) excludedReason = 'permission_denied';
        else if (!version.deployable) excludedReason = 'version_not_deployable';
        else if (binding.status !== 'MANAGED') excludedReason = 'binding_not_managed';
        else if (!serviceAsset) excludedReason = 'asset_missing_deployment_capability';
        else if (input.guardrails.allowedEnvironments?.length && (!serviceAsset.environment || !input.guardrails.allowedEnvironments.includes(serviceAsset.environment))) excludedReason = 'environment_not_allowed';
        else if (certificateVersionImpact === 'downgrade' && !input.allowCertificateDowngrade) excludedReason = 'certificate_version_downgrade';
        targets.push({
          target,
          executable: !excludedReason,
          excludedReason,
        });
        continue;
      }
      if (!hasExplicitSelection && bindingVersion.certificateAssetId !== asset.id) continue;

      const resolvedAssetId = binding.serviceAssetId ?? (binding.managedTargetId ? selectedManagedTargetIds.get(binding.managedTargetId) : undefined);
      const serviceAsset = resolvedAssetId
        ? (await this.assets.getServiceAssetDetail(input.tenantId, resolvedAssetId)
          ?? await this.assets.getServiceAsset(input.tenantId, resolvedAssetId))
        : undefined;
      const currentCertificateState = await resolveCurrentCertificateState({
        detail: serviceAsset,
        binding,
        certificates: this.certificates,
        tenantId: input.tenantId,
      });
      const host = serviceAsset?.hostId ? await this.assets.getHost(input.tenantId, serviceAsset.hostId) : undefined;
      const certificateVersionImpact = compareCertificateExpiry(version.notAfter, currentCertificateState.notAfter ?? bindingVersion.notAfter);
      const target = {
        certificateId: asset.id,
        certificateName: asset.name,
        certificateVersionId: version.id,
        currentCertificateVersionId: currentCertificateState.versionId ?? bindingVersion.id,
        currentCertificateNotAfter: currentCertificateState.notAfter ?? bindingVersion.notAfter,
        targetCertificateNotAfter: version.notAfter,
        certificateVersionImpact,
        eventId: input.triggerContext?.eventId,
        eventType: input.triggerContext?.eventType,
        sourceType: input.triggerContext?.sourceType,
        bindingId: binding.id,
        assetId: resolvedAssetId ?? serviceAsset?.id,
        assetName: serviceAsset?.displayName ?? serviceAsset?.address,
        environment: serviceAsset?.environment,
        ownerId: host?.ownerId,
        tags: [...asset.tags],
      };
      let excludedReason: AutomationPreviewTargetDto['excludedReason'];
      if (certificateVersionImpact === 'same') excludedReason = 'certificate_already_up_to_date';
      else if (!await this.access.canReadTarget({ tenantId: input.tenantId, actorId: input.actorId, bindingId: binding.id, assetId: resolvedAssetId ?? serviceAsset?.id })) excludedReason = 'permission_denied';
      else if (!version.deployable) excludedReason = 'version_not_deployable';
      else if (binding.status !== 'MANAGED') excludedReason = 'binding_not_managed';
      else if (!serviceAsset) excludedReason = 'asset_missing_deployment_capability';
      else if (input.guardrails.allowedEnvironments?.length && (!serviceAsset.environment || !input.guardrails.allowedEnvironments.includes(serviceAsset.environment))) excludedReason = 'environment_not_allowed';
      else if (certificateVersionImpact === 'downgrade' && !input.allowCertificateDowngrade) excludedReason = 'certificate_version_downgrade';
      targets.push({ target, executable: !excludedReason, excludedReason });
    }
    return dedupeTargets(targets);
  }
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, '');
}

function dedupeTargets(items: AutomationPreviewTargetDto[]): AutomationPreviewTargetDto[] {
  const deduped = new Map<string, AutomationPreviewTargetDto>();
  for (const item of items) {
    const key = dedupeKey(item);
    const existing = deduped.get(key);
    if (!existing || priorityOf(item) > priorityOf(existing)) {
      deduped.set(key, item);
    }
  }
  return [...deduped.values()];
}

function dedupeKey(item: AutomationPreviewTargetDto): string {
  if (item.target.assetId) return `asset:${item.target.assetId}`;
  if (item.target.bindingId) return `binding:${item.target.bindingId}`;
  return [
    'fallback',
    item.target.assetName ?? item.target.certificateName,
    item.target.currentCertificateNotAfter ?? '',
    item.target.targetCertificateNotAfter ?? '',
  ].join(':');
}

function priorityOf(item: AutomationPreviewTargetDto): number {
  let score = 0;
  if (item.executable) score += 100;
  if (item.target.currentCertificateNotAfter) score += 40;
  if (item.target.currentCertificateVersionId) score += 20;
  if (item.target.bindingId) score += 10;
  if (item.excludedReason === 'certificate_already_up_to_date') score += 5;
  if (item.excludedReason === 'binding_missing') score -= 30;
  if (item.excludedReason === 'missing_version') score -= 20;
  return score;
}

function resolveCurrentCertificateVersionId(binding: {
  localCertificateVersionId?: string;
  certificateVersionId?: string;
  targetCertificateVersionId?: string;
}): string | undefined {
  return [
    binding.localCertificateVersionId,
    binding.certificateVersionId,
    binding.targetCertificateVersionId,
  ].find((id): id is string => typeof id === 'string' && id.length > 0);
}

function compareCertificateExpiry(targetNotAfter: string | undefined, currentNotAfter: string | undefined): 'upgrade' | 'same' | 'downgrade' | 'missing_current' {
  const targetTime = parseCertificateTime(targetNotAfter);
  const currentTime = parseCertificateTime(currentNotAfter);
  if (targetTime === undefined || currentTime === undefined) return 'missing_current';
  if (targetTime > currentTime) return 'upgrade';
  if (targetTime < currentTime) return 'downgrade';
  return 'same';
}

function parseCertificateTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

async function resolveCurrentCertificateState(input: {
  detail?: ServiceAssetDetailDto;
  binding?: CertificateBindingDto;
  certificates: CertificatesRepository;
  tenantId: string;
}): Promise<{ versionId?: string; notAfter?: string }> {
  const detail = input.detail;
  if (!detail) return {};

  const metadataNotAfter = readStringByPaths(detail.metadata, [
    'currentCertificate.notAfter',
    'currentCertificateNotAfter',
  ]);
  if (parseCertificateTime(metadataNotAfter) !== undefined) {
    return { notAfter: metadataNotAfter };
  }

  const binding = resolveCurrentCertificateBinding(detail, input.binding);
  const snapshot = resolveCurrentCertificateSnapshot(detail, binding);
  const observedVersion = await resolveObservedCertificateVersion(binding, snapshot, input.certificates, input.tenantId);
  if (observedVersion) {
    return {
      versionId: observedVersion.id,
      notAfter: observedVersion.notAfter,
    };
  }

  const currentCertificateVersionId = readStringByPaths(binding, ['certificateVersionId']);
  if (currentCertificateVersionId) {
    const currentVersion = await input.certificates.getVersion(currentCertificateVersionId, input.tenantId);
    if (currentVersion) {
      return {
        versionId: currentVersion.id,
        notAfter: currentVersion.notAfter,
      };
    }
  }

  const snapshotNotAfter = readStringByPaths(snapshot, ['metadata.detail.verify.notAfter']);
  if (parseCertificateTime(snapshotNotAfter) !== undefined) {
    return { notAfter: snapshotNotAfter };
  }
  return {};
}

function resolveCurrentCertificateBinding(
  detail: ServiceAssetDetailDto,
  binding?: CertificateBindingDto,
): Record<string, unknown> | undefined {
  const bindings = Array.isArray(detail.targetBindingDetail?.certificateBindings)
    ? detail.targetBindingDetail.certificateBindings as unknown as Record<string, unknown>[]
    : [];
  return bindings.find((item) => readStringByPaths(item, ['id']) === binding?.id) ?? bindings[0];
}

function resolveCurrentCertificateSnapshot(
  detail: ServiceAssetDetailDto,
  binding?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const bindingId = readStringByPaths(binding, ['id']);
  const currentThumbprint = normalizeHexString(readStringByPaths(binding, ['storeThumbprint']))
    || normalizeHexString(readStringByPaths(detail, [
      'targetBinding.metadata.currentThumbprint',
      'targetBindingDetail.metadata.currentThumbprint',
      'targetBindingDetail.siteAsset.metadata.currentThumbprint',
    ]));
  const snapshots = (Array.isArray(detail.targetSnapshots) ? detail.targetSnapshots as unknown as Record<string, unknown>[] : [])
    .filter((item) => !bindingId || readStringByPaths(item, ['certificateBindingId']) === bindingId)
    .sort((left, right) => compareDesc(readStringByPaths(right, ['capturedAt', 'createdAt', 'updatedAt']), readStringByPaths(left, ['capturedAt', 'createdAt', 'updatedAt'])));
  if (currentThumbprint) {
    const matched = snapshots.find((item) => resolveSnapshotThumbprints(item).includes(currentThumbprint));
    if (matched) return matched;
  }
  return snapshots.find((item) => Boolean(readStringByPaths(item, [
    'certificateVersionId',
    'fingerprintSha256',
    'metadata.detail.verify.notAfter',
  ])));
}

async function resolveObservedCertificateVersion(
  binding: Record<string, unknown> | undefined,
  snapshot: Record<string, unknown> | undefined,
  certificates: CertificatesRepository,
  tenantId: string,
) {
  const snapshotVersionId = readStringByPaths(snapshot, ['certificateVersionId']);
  if (snapshotVersionId) {
    const matched = await certificates.getVersion(snapshotVersionId, tenantId);
    if (matched) return matched;
  }

  const fingerprints = [
    readStringByPaths(binding, ['observedFingerprintSha256']),
    readStringByPaths(snapshot, ['fingerprintSha256']),
    readStringByPaths(snapshot, ['metadata.detail.verify.remoteCertificateSha256']),
    readStringByPaths(snapshot, ['metadata.detail.installedCertificateSha256']),
    readStringByPaths(snapshot, ['metadata.detail.installResult.targetCertificateSha256']),
    readStringByPaths(snapshot, ['metadata.detail.targetCertificateSha256']),
  ]
    .map((value) => normalizeHexString(value))
    .filter((value): value is string => Boolean(value));

  for (const fingerprint of fingerprints) {
    const matched = await certificates.getVersionByFingerprint(fingerprint, tenantId);
    if (matched) return matched;
  }
  return undefined;
}

function resolveSnapshotThumbprints(snapshot: Record<string, unknown>): string[] {
  return [
    readStringByPaths(snapshot, ['storeThumbprint']),
    readStringByPaths(snapshot, ['metadata.detail.verify.remoteThumbprint']),
    readStringByPaths(snapshot, ['metadata.detail.newThumbprint']),
    readStringByPaths(snapshot, ['metadata.detail.installResult.newThumbprint']),
  ]
    .map((value) => normalizeHexString(value))
    .filter((value): value is string => Boolean(value));
}

function readStringByPaths(record: unknown, candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    const value = readPath(record, candidate);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readPath(record: unknown, path: string): unknown {
  if (!record || typeof record !== 'object') return undefined;
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, record);
}

function normalizeHexString(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[^0-9a-f]/giu, '').toUpperCase();
  return normalized || undefined;
}

function compareDesc(left: string | undefined, right: string | undefined): number {
  const leftTime = parseCertificateTime(left) ?? 0;
  const rightTime = parseCertificateTime(right) ?? 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left ?? '').localeCompare(String(right ?? ''));
}
