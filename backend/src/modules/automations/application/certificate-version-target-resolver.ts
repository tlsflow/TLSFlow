import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AutomationPreviewTargetDto } from '../dto/automations.dto.js';
import type { AutomationTargetResolver, AutomationTargetResolverInput } from './automation-target-resolver.registry.js';
import type { AutomationTargetAccessPort } from './automation-target-selector.js';

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

    const bindings = (await this.bindings.listCertificateBindings(input.tenantId, { page: 1, pageSize: 5000, filter: {} } as PageQuery)).items;
    const targets: AutomationPreviewTargetDto[] = [];
    for (const binding of bindings) {
      if (binding.deletedAt) continue;
      const bindingVersionId = binding.targetCertificateVersionId ?? binding.certificateVersionId;
      if (!bindingVersionId) {
        targets.push({
          target: {
            certificateId: asset.id,
            certificateName: asset.name,
            certificateVersionId: version.id,
            eventId: input.triggerContext?.eventId,
            eventType: input.triggerContext?.eventType,
            sourceType: input.triggerContext?.sourceType,
            bindingId: binding.id,
            assetId: binding.serviceAssetId,
            tags: [...asset.tags],
          },
          executable: false,
          excludedReason: 'binding_missing',
        });
        continue;
      }
      const bindingVersion = await this.certificates.getVersion(bindingVersionId, input.tenantId);
      if (!bindingVersion || bindingVersion.certificateAssetId !== asset.id) continue;

      const serviceAsset = binding.serviceAssetId ? await this.assets.getServiceAsset(input.tenantId, binding.serviceAssetId) : undefined;
      const host = serviceAsset?.hostId ? await this.assets.getHost(input.tenantId, serviceAsset.hostId) : undefined;
      const target = {
        certificateId: asset.id,
        certificateName: asset.name,
        certificateVersionId: version.id,
        eventId: input.triggerContext?.eventId,
        eventType: input.triggerContext?.eventType,
        sourceType: input.triggerContext?.sourceType,
        bindingId: binding.id,
        assetId: serviceAsset?.id,
        assetName: serviceAsset?.displayName ?? serviceAsset?.address,
        environment: serviceAsset?.environment,
        ownerId: host?.ownerId,
        tags: [...asset.tags],
      };
      let excludedReason: AutomationPreviewTargetDto['excludedReason'];
      if (!await this.access.canReadTarget({ tenantId: input.tenantId, actorId: input.actorId, bindingId: binding.id, assetId: serviceAsset?.id })) excludedReason = 'permission_denied';
      else if (!version.deployable) excludedReason = 'version_not_deployable';
      else if (binding.status !== 'MANAGED') excludedReason = 'binding_not_managed';
      else if (!serviceAsset) excludedReason = 'asset_missing_deployment_capability';
      else if (input.guardrails.allowedEnvironments?.length && (!serviceAsset.environment || !input.guardrails.allowedEnvironments.includes(serviceAsset.environment))) excludedReason = 'environment_not_allowed';
      targets.push({ target, executable: !excludedReason, excludedReason });
    }
    return targets;
  }
}
