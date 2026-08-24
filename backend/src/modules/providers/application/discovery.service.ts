import { AppError } from '../../../common/errors/app-error.js';
import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import { ProvidersDomainService } from '../domain/providers.domain-service.js';
import type { DiscoveryExecutionContext, DiscoveryResultRecordDto, RunDiscoveryInput } from '../dto/providers.dto.js';
import type { ProvidersRepository } from '../repository/providers.repository.js';
import { ProviderRegistry } from './provider-registry.js';
import { ProviderSelector } from './provider-selector.js';

export class DiscoveryService {
  private readonly selector: ProviderSelector;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly assetsService: AssetsApplicationService,
    private readonly repository: ProvidersRepository,
    private readonly domain = new ProvidersDomainService(),
  ) {
    this.selector = new ProviderSelector(registry);
  }

  async run(context: DiscoveryExecutionContext, input: RunDiscoveryInput): Promise<DiscoveryResultRecordDto> {
    if (!context.tenantId) {
      throw new AppError('VALIDATION_FAILED', 'tenantId 不能为空', { field: 'tenantId' });
    }

    const normalizedInput = this.domain.normalizeRunInput(input);
    const provider = this.selector.select({ providerId: normalizedInput.providerId });
    if (!provider) {
      throw new AppError('RESOURCE_NOT_FOUND', 'provider 不存在', { providerId: normalizedInput.providerId });
    }

    const discovered = await provider.discover(context, {
      source: normalizedInput.source,
      scope: normalizedInput.scope,
      payload: normalizedInput.payload,
    });
    const normalizedResult = this.domain.normalizeDiscoveryResult(discovered);
    this.domain.assertNoSensitiveFields(normalizedResult);
    const draftBundle = provider.toDeploymentDraft(normalizedResult);
    const normalizedHash = this.domain.buildNormalizedHash(normalizedResult);
    const snapshotPayload = this.domain.buildSnapshotPayload(normalizedResult, draftBundle);
    const snapshot = this.assetsService.upsertDiscoverySnapshot(context.tenantId, {
      normalizedHash,
      source: normalizedResult.source,
      normalizedPayload: snapshotPayload,
      rawPayload: normalizedResult.rawPayload,
    });
    const record = this.domain.createResultRecord(context, normalizedHash, snapshot.id, normalizedResult, draftBundle);
    return this.repository.createDiscoveryResult(record);
  }
}
