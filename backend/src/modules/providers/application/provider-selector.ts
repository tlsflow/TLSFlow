import type { Provider } from './provider.interface.js';
import { ProviderRegistry } from './provider-registry.js';
import type { DiscoveryResult } from '../dto/providers.dto.js';

export interface ProviderSelectionInput {
  providerId?: string;
  providerType?: DiscoveryResult['providerType'];
  serviceName?: string;
  configPath?: string;
  protocol?: string;
  hostname?: string;
  tags?: string[];
}

export class ProviderSelector {
  constructor(private readonly registry: ProviderRegistry) {}

  select(input: ProviderSelectionInput): Provider | undefined {
    if (input.providerId) {
      return this.registry.get(input.providerId);
    }

    const providers = this.registry.list();
    return providers.find((provider) => matches(provider, input));
  }
}

function matches(provider: Provider, input: ProviderSelectionInput): boolean {
  const descriptor = provider.getDescriptor();
  const rules = descriptor.matchRules;
  const serviceName = input.serviceName?.toLowerCase();
  const configPath = input.configPath;
  const protocol = input.protocol;
  const hostname = input.hostname;

  if (input.providerType && rules.providerType !== input.providerType) return false;
  if (serviceName && rules.serviceNames?.length && !rules.serviceNames.some((item) => item === serviceName)) return false;
  if (configPath && rules.configPathPatterns?.length && !rules.configPathPatterns.some((item) => configPath.includes(item))) return false;
  if (protocol && rules.endpointProtocols?.length && !rules.endpointProtocols.includes(protocol)) return false;
  if (hostname && rules.hostnamePatterns?.length && !rules.hostnamePatterns.some((item) => hostname.includes(item))) return false;
  if (input.tags?.length && rules.tags?.length) {
    const lowerTags = input.tags.map((tag) => tag.toLowerCase());
    if (!rules.tags.some((tag) => lowerTags.includes(tag.toLowerCase()))) return false;
  }
  return true;
}
