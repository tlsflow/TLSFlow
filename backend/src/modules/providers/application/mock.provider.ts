import { ProvidersDomainService } from '../domain/providers.domain-service.js';
import type { Provider } from './provider.interface.js';
import type {
  DeploymentDraftBundle,
  DiscoveryExecutionContext,
  DiscoveryResult,
  ProviderDescriptor,
} from '../dto/providers.dto.js';

export class MockProvider implements Provider {
  constructor(private readonly domain = new ProvidersDomainService()) {}

  getDescriptor(): ProviderDescriptor {
    return {
      metadata: {
        id: 'mock-provider',
        type: 'CUSTOM',
        displayName: 'Mock Provider',
        description: '用于 spec018 基础链路验证的 Provider',
        version: '0.1.0',
        capabilities: ['DISCOVERY', 'STEP_DRAFT_MAPPING', 'SNAPSHOT_PERSISTENCE'],
        supportedDiscoverySources: ['MANUAL', 'AGENT', 'SSH', 'GATEWAY'],
        supportedStages: ['HOST', 'SERVICE', 'ENDPOINT', 'BINDING'],
        tags: ['mock', 'spec018'],
        priority: 1,
      },
      matchRules: {
        providerType: 'CUSTOM',
        serviceNames: ['mock-web'],
        configPathPatterns: ['/mock/'],
        endpointProtocols: ['HTTPS'],
        hostnamePatterns: ['mock'],
        tags: ['mock'],
      },
    };
  }

  discover(_context: DiscoveryExecutionContext, input: { source: DiscoveryResult['source']; scope: Record<string, string>; payload: Record<string, unknown> }): DiscoveryResult {
    const suffix = String(input.scope.hostname ?? 'mock-host');
    return {
      providerId: 'mock-provider',
      providerType: 'CUSTOM',
      source: input.source,
      discoveredAt: new Date().toISOString(),
      scope: input.scope,
      hosts: [{
        key: `host:${suffix}`,
        hostname: `${suffix}.example.com`,
        displayName: 'Mock 主机',
        primaryIp: '10.10.0.10',
        ipAddresses: ['10.10.0.10'],
        osType: 'LINUX',
        osName: 'Debian',
        osVersion: '12',
        environment: 'prod',
        zoneId: 'zone-mock',
        tags: ['mock', 'edge'],
        rawFacts: { discoveryMethod: input.source },
      }],
      services: [{
        key: `service:${suffix}`,
        hostKey: `host:${suffix}`,
        providerType: 'CUSTOM',
        serviceName: 'mock-web',
        displayName: 'Mock Web',
        versionText: '1.0.0',
        installPath: '/opt/mock',
        configPath: '/mock/server.conf',
        runtimeUser: 'mock',
        status: 'ACTIVE',
        rawFacts: { payloadEcho: input.payload.echo ?? null },
      }],
      endpoints: [{
        key: `endpoint:${suffix}:443`,
        serviceKey: `service:${suffix}`,
        protocol: 'HTTPS',
        hostName: `${suffix}.example.com`,
        listenIp: '10.10.0.10',
        port: 443,
        pathHint: '/',
        status: 'ACTIVE',
        rawFacts: {},
      }],
      bindings: [{
        key: `binding:${suffix}`,
        endpointKey: `endpoint:${suffix}:443`,
        bindingType: 'FILE_PATH',
        domainName: `${suffix}.example.com`,
        certificateRef: 'cert://mock/current',
        privateKeyRef: 'key://mock/current',
        configPath: '/mock/server.conf',
        rawFacts: {},
      }],
      rawPayload: { echo: input.payload.echo ?? null },
    };
  }

  toDeploymentDraft(result: DiscoveryResult): DeploymentDraftBundle {
    return this.domain.buildDraftBundle(result);
  }
}
