import type { Provider } from './provider.interface.js';
import { ProviderSdk } from './provider-sdk.js';
import type { DeploymentDraftBundle, DiscoveryResult } from '../dto/providers.dto.js';

export class ProviderPlanRunner {
  constructor(private readonly sdk = new ProviderSdk()) {}

  plan(provider: Provider, result: DiscoveryResult): DeploymentDraftBundle {
    const normalized = provider.toDeploymentDraft(result);
    this.sdk.assertDraftBundle(normalized);
    return normalized;
  }
}
