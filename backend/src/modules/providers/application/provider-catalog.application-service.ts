import { AppError } from '../../../common/errors/app-error.js';
import type {
  CloudAccountAsset,
  ProviderCapabilityPlugin,
  ProviderDefinition,
  ProviderOperationResult,
} from '../dto/providers.dto.js';
import {
  ProviderExtensionRegistry,
  type ProviderContext,
  type ProviderTargetRef,
} from '../domain/provider-extension.js';

export class ProviderCatalogApplicationService {
  constructor(private readonly registry: ProviderExtensionRegistry) {}

  listProviders(): ProviderDefinition[] {
    return this.registry.listDefinitions();
  }

  listCapabilities(filter: { providerKey?: string; frameworkType?: string; operationKey?: string } = {}): ProviderCapabilityPlugin[] {
    return this.registry.listCapabilities(filter);
  }

  async testConnection(asset: CloudAccountAsset, requestId?: string) {
    return this.registry.testConnection({ tenantId: asset.tenantId, asset, requestId });
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
    return this.registry.execute(
      input.asset.providerKey,
      input.frameworkType,
      input.operationKey,
      { tenantId: input.tenantId, asset: input.asset, requestId: input.requestId },
      input.target,
      input.input ?? {},
    );
  }
}
