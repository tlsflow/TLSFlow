import { createModuleMetadata } from '../../placeholder-module.js';
import { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import { ProvidersDomainService } from '../domain/providers.domain-service.js';
import type { DiscoveryExecutionContext, RunDiscoveryInput } from '../dto/providers.dto.js';
import { InMemoryProvidersRepository, type ProvidersRepository } from '../repository/providers.repository.js';
import { DiscoveryService } from './discovery.service.js';
import { MockProvider } from './mock.provider.js';
import { ProviderRegistry } from './provider-registry.js';
import { NginxProvider } from '../nginx/nginx.provider.js';
import { ApacheProvider } from '../apache/apache.provider.js';
import { IISProvider } from '../windows/iis.provider.js';
import { TomcatProvider } from '../tomcat/tomcat.provider.js';
import { CustomProvider } from '../custom/custom.provider.js';

export interface ProvidersApplicationDependencies {
  assetsService?: AssetsApplicationService;
  repository?: ProvidersRepository;
  registry?: ProviderRegistry;
}

export class ProvidersApplicationService {
  private readonly registry: ProviderRegistry;
  private readonly repository: ProvidersRepository;
  private readonly assetsService: AssetsApplicationService;
  private readonly discoveryService: DiscoveryService;

  constructor(dependencies: ProvidersApplicationDependencies = {}, private readonly domain = new ProvidersDomainService()) {
    this.assetsService = dependencies.assetsService ?? new AssetsApplicationService();
    this.repository = dependencies.repository ?? new InMemoryProvidersRepository();
    this.registry = dependencies.registry ?? new ProviderRegistry([
      new MockProvider(this.domain),
      new NginxProvider(),
      new ApacheProvider(),
      new IISProvider(),
      new TomcatProvider(),
      new CustomProvider(),
    ], this.domain);
    this.discoveryService = new DiscoveryService(this.registry, this.assetsService, this.repository, this.domain);
  }

  getModuleMetadata() {
    return createModuleMetadata('providers', '/api/v1/providers', '018');
  }

  listProviders() {
    return this.registry.listItems();
  }

  runDiscovery(context: DiscoveryExecutionContext, input: RunDiscoveryInput) {
    return this.discoveryService.run(context, input);
  }

  listDiscoveryResults(tenantId: string, query: import('../../../common/pagination/pagination.js').PageQuery) {
    return this.repository.listDiscoveryResults(tenantId, query);
  }

  getDiscoveryResult(tenantId: string, resultId: string) {
    return this.repository.getDiscoveryResult(tenantId, resultId);
  }

  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  getAssetsService(): AssetsApplicationService {
    return this.assetsService;
  }
}
