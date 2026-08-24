import { AppError } from '../../../common/errors/app-error.js';
import type { Provider } from './provider.interface.js';
import type { ProviderDescriptor, ProviderListItemDto } from '../dto/providers.dto.js';
import { ProvidersDomainService } from '../domain/providers.domain-service.js';

export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor(
    initialProviders: Provider[] = [],
    private readonly domain = new ProvidersDomainService(),
  ) {
    initialProviders.forEach((provider) => this.register(provider));
  }

  register(provider: Provider): void {
    const providerId = provider.getDescriptor().metadata.id;
    if (this.providers.has(providerId)) {
      throw new AppError('RESOURCE_ALREADY_EXISTS', 'provider 已存在', { providerId });
    }
    this.providers.set(providerId, provider);
  }

  list(): Provider[] {
    return [...this.providers.values()].sort((left, right) => {
      const leftMeta = left.getDescriptor().metadata;
      const rightMeta = right.getDescriptor().metadata;
      const leftPriority = leftMeta.priority ?? 1000;
      const rightPriority = rightMeta.priority ?? 1000;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return leftMeta.id.localeCompare(rightMeta.id);
    });
  }

  listDescriptors(): ProviderDescriptor[] {
    return this.list().map((provider) => provider.getDescriptor());
  }

  listItems(): ProviderListItemDto[] {
    return this.listDescriptors().map((descriptor) => this.domain.toProviderListItem(descriptor));
  }

  get(providerId: string): Provider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AppError('RESOURCE_NOT_FOUND', 'provider 不存在', { providerId });
    }
    return provider;
  }
}
