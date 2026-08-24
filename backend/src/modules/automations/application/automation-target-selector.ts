import { createHash } from 'node:crypto';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { AutomationGuardrailsDto, AutomationPreviewDto, AutomationPreviewTargetDto, AutomationTargetSelectorDto } from '../dto/automations.dto.js';

export interface AutomationTargetAccessPort {
  canReadTarget(input: { tenantId: string; actorId: string; bindingId: string; assetId?: string }): Promise<boolean>;
}

export class AllowAllAutomationTargetAccess implements AutomationTargetAccessPort {
  async canReadTarget(): Promise<boolean> { return true; }
}

export class AutomationTargetSelector {
  constructor(
    private readonly certificates: CertificatesRepository,
    private readonly bindings: BindingsRepository,
    private readonly assets: AssetsRepository,
    private readonly access: AutomationTargetAccessPort = new AllowAllAutomationTargetAccess(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async preview(input: {
    tenantId: string; actorId: string; automationId: string; automationVersion: number; configurationChecksum: string;
    selector: AutomationTargetSelectorDto; guardrails: AutomationGuardrailsDto; page?: number; pageSize?: number;
  }): Promise<AutomationPreviewDto> {
    const query: PageQuery = { page: 1, pageSize: 5000, filter: {} };
    const bindings = (await this.bindings.listCertificateBindings(input.tenantId, query)).items;
    const matched: AutomationPreviewTargetDto[] = [];
    for (const binding of bindings) {
      if (binding.deletedAt || !this.matchesBinding(binding, input.selector)) continue;
      const currentVersionId = binding.targetCertificateVersionId ?? binding.certificateVersionId;
      const currentVersion = currentVersionId ? await this.certificates.getVersion(currentVersionId, input.tenantId) : undefined;
      const certificate = currentVersion ? await this.certificates.getAsset(currentVersion.certificateAssetId, input.tenantId) : undefined;
      if (!certificate || !this.matchesCertificate(certificate, currentVersion?.notAfter, input.selector)) continue;
      const version = await this.resolveTargetVersion(input.tenantId, certificate.id, currentVersion, input.selector);
      const serviceAsset = binding.serviceAssetId ? await this.assets.getServiceAsset(input.tenantId, binding.serviceAssetId) : undefined;
      const environment = serviceAsset?.environment;
      if (input.selector.environments?.length && (!environment || !input.selector.environments.includes(environment))) continue;
      const host = serviceAsset?.hostId ? await this.assets.getHost(input.tenantId, serviceAsset.hostId) : undefined;
      if (input.selector.ownerIds?.length && (!host?.ownerId || !input.selector.ownerIds.includes(host.ownerId))) continue;
      const target = {
        certificateId: certificate.id, certificateName: certificate.name, certificateVersionId: version?.id,
        bindingId: binding.id, assetId: serviceAsset?.id, assetName: serviceAsset?.displayName ?? serviceAsset?.address,
        environment, ownerId: host?.ownerId, tags: [...certificate.tags],
      };
      let excludedReason: AutomationPreviewTargetDto['excludedReason'];
      if (!await this.access.canReadTarget({ tenantId: input.tenantId, actorId: input.actorId, bindingId: binding.id, assetId: serviceAsset?.id })) excludedReason = 'permission_denied';
      else if (!version) excludedReason = 'missing_version';
      else if (!version.deployable) excludedReason = 'version_not_deployable';
      else if (binding.status !== 'MANAGED') excludedReason = 'binding_not_managed';
      else if (input.guardrails.allowedEnvironments?.length && (!environment || !input.guardrails.allowedEnvironments.includes(environment))) excludedReason = 'environment_not_allowed';
      matched.push({ target, executable: !excludedReason, excludedReason });
    }
    const limited = matched.slice(0, input.guardrails.maxTargetsPerRun);
    const excludedReasons: Record<string, number> = {};
    for (const item of limited) if (item.excludedReason) excludedReasons[item.excludedReason] = (excludedReasons[item.excludedReason] ?? 0) + 1;
    const page = input.page ?? 1;
    const pageSize = Math.min(input.pageSize ?? 50, 200);
    const start = (page - 1) * pageSize;
    return {
      previewId: createHash('sha256').update(JSON.stringify({ automationId: input.automationId, version: input.automationVersion, checksum: input.configurationChecksum, targets: limited.map((item) => item.target) })).digest('hex'),
      automationId: input.automationId, automationVersion: input.automationVersion, configurationChecksum: input.configurationChecksum,
      totalMatched: limited.length, executableCount: limited.filter((item) => item.executable).length,
      excludedCount: limited.filter((item) => !item.executable).length, excludedReasons, page, pageSize, items: limited.slice(start, start + pageSize),
    };
  }

  private matchesBinding(binding: { id: string; serviceAssetId?: string }, selector: AutomationTargetSelectorDto): boolean {
    if (selector.bindingIds?.length && !selector.bindingIds.includes(binding.id)) return false;
    if (selector.assetIds?.length && (!binding.serviceAssetId || !selector.assetIds.includes(binding.serviceAssetId))) return false;
    return true;
  }

  private matchesCertificate(certificate: { id: string; status: string; tags: string[]; primaryDomain?: string; sans?: string[] }, notAfter: string | undefined, selector: AutomationTargetSelectorDto): boolean {
    if (selector.certificateIds?.length && !selector.certificateIds.includes(certificate.id)) return false;
    if (selector.certificateDomains?.length) {
      const domains = new Set([certificate.primaryDomain, ...(certificate.sans ?? [])].filter(Boolean).map((domain) => normalizeDomain(domain as string)));
      if (!selector.certificateDomains.some((domain) => domains.has(normalizeDomain(domain)))) return false;
    }
    if (selector.statuses?.length && !selector.statuses.includes(certificate.status)) return false;
    if (selector.tags?.length) {
      const matched = selector.tags.filter((tag) => certificate.tags.includes(tag)).length;
      if (selector.tagMatch === 'any' ? matched === 0 : matched !== selector.tags.length) return false;
    }
    if (selector.expiresWithinDays !== undefined) {
      if (!notAfter) return false;
      const deadline = this.clock().getTime() + selector.expiresWithinDays * 86_400_000;
      if (new Date(notAfter).getTime() > deadline) return false;
    }
    return true;
  }

  private async resolveTargetVersion(tenantId: string, certificateAssetId: string, currentVersion: { id: string; certificateAssetId: string; notAfter?: string; deployable?: boolean } | undefined, selector: AutomationTargetSelectorDto) {
    if (selector.certificateVersionSelection !== 'latest' && selector.certificateVersionSelection !== 'specific') return currentVersion;
    const versions = await this.certificates.listVersionsByAsset(certificateAssetId, tenantId);
    if (selector.certificateVersionSelection === 'specific') {
      return versions.find((version) => selector.certificateVersionIds?.includes(version.id));
    }
    return versions.slice().sort((left, right) => right.versionNo - left.versionNo)[0];
  }
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '');
}
