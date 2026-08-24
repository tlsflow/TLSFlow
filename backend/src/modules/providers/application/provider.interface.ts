import type {
  DeploymentDraftBundle,
  DiscoveryExecutionContext,
  DiscoveryResult,
  ProviderDescriptor,
} from '../dto/providers.dto.js';

export interface Provider {
  getDescriptor(): ProviderDescriptor;
  discover(context: DiscoveryExecutionContext, input: { source: DiscoveryResult['source']; scope: Record<string, string>; payload: Record<string, unknown> }): Promise<DiscoveryResult> | DiscoveryResult;
  toDeploymentDraft(result: DiscoveryResult): DeploymentDraftBundle;
}
