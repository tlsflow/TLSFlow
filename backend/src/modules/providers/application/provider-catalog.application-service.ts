import { AppError } from '../../../common/errors/app-error.js';
import type { CloudAccountAsset, ProviderCapabilityPlugin, ProviderDefinition, ProviderOperationResult, ProviderTargetRef } from '../dto/providers.dto.js';
import { TrustedJsPluginExecutionService } from '../../plugins/runtime/trusted-js-plugin-execution.service.js';

export class ProviderCatalogApplicationService {
  constructor(private readonly trustedJs: TrustedJsPluginExecutionService) {}

  async listProviders(tenantId = 'SYSTEM'): Promise<ProviderDefinition[]> {
    return this.trustedJs.listProviders(tenantId);
  }

  async listCapabilities(
    tenantId = 'SYSTEM',
    filter: { providerKey?: string; frameworkType?: string; operationKey?: string } = {},
  ): Promise<ProviderCapabilityPlugin[]> {
    return this.trustedJs.listCapabilities(tenantId, filter);
  }

  async requireDefinition(providerKey: string): Promise<ProviderDefinition> {
    return this.trustedJs.requireProvider('SYSTEM', providerKey);
  }

  async testConnection(asset: CloudAccountAsset, requestId?: string) {
    return this.trustedJs.testConnection(asset, requestId);
  }

  async execute(input: {
    tenantId: string;
    asset: CloudAccountAsset;
    frameworkType: string;
    operationKey: string;
    target: ProviderTargetRef;
    requestId?: string;
    input?: Record<string, unknown>;
  }): Promise<ProviderOperationResult> {
    if (input.asset.tenantId !== input.tenantId) {
      throw new AppError('TENANT_SCOPE_DENIED', 'Provider Asset 不属于当前租户', { assetId: input.asset.id });
    }
    return this.trustedJs.execute(input);
  }
}
