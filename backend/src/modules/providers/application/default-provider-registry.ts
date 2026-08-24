import type { ProviderExtension } from '../domain/provider-extension.js';
import { ProviderExtensionRegistry } from '../domain/provider-extension.js';
import type { ProviderCapabilityPlugin, ProviderDefinition } from '../dto/providers.dto.js';
import { AliyunProviderExtension, HuaweiProviderExtension, TencentProviderExtension, VolcengineProviderExtension } from '../runtime/cloud-provider-extensions.js';
import {
  CredentialProfileProviderCredentialResolver,
  FetchProviderTransport,
  type ProviderCredentialResolver,
} from '../runtime/provider-runtime.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';

const providerDefinitions: ProviderDefinition[] = [
  definition('cloud.aliyun', 'aliyun', 'V4', ['cloud.aliyun.cdn', 'cloud.aliyun.alb', 'cloud.aliyun.clb']),
  definition('cloud.tencent', 'tencent', 'V4', ['cloud.tencent.cdn', 'cloud.tencent.clb']),
  definition('cloud.huawei', 'huawei', 'HMAC', ['cloud.huawei.cdn', 'cloud.huawei.elb']),
  definition('cloud.volcengine', 'volcengine', 'HMAC', ['cloud.volcengine.cdn', 'cloud.volcengine.alb', 'cloud.volcengine.clb']),
];

const capabilities: ProviderCapabilityPlugin[] = providerDefinitions.flatMap((provider) =>
  provider.supportedProducts.flatMap((frameworkType) => [
    capability(provider.providerKey, frameworkType, 'certificate.discover', 'provider.capabilities.cdnDiscover', 'MANUAL_REQUIRED'),
    capability(provider.providerKey, frameworkType, 'certificate.deploy', 'provider.capabilities.cdnDeploy', 'MANUAL_REQUIRED'),
    capability(provider.providerKey, frameworkType, 'certificate.verify', 'provider.capabilities.cdnVerify', 'UNSUPPORTED'),
    capability(provider.providerKey, frameworkType, 'certificate.rollback', 'provider.capabilities.cdnRollback', 'MANUAL_REQUIRED'),
  ]),
);

export function createDefaultProviderRegistry(extensions: ProviderExtension[] = []): ProviderExtensionRegistry {
  const registry = new ProviderExtensionRegistry();
  for (const definition of providerDefinitions) registry.registerDefinition(definition);
  for (const capabilityItem of capabilities) registry.registerCapability(capabilityItem);
  for (const extension of extensions) registry.registerExtension(extension);
  return registry;
}

export function createTrustedProviderExtensions(
  secrets: SecretService,
  options: {
    credentialResolver?: ProviderCredentialResolver;
    credentialProfileRepository: CredentialsRepository;
    transport?: FetchProviderTransport;
  },
): ProviderExtension[] {
  const resolver = options.credentialResolver
    ?? new CredentialProfileProviderCredentialResolver(options.credentialProfileRepository, secrets);
  const transport = options.transport ?? new FetchProviderTransport();
  return [
    new AliyunProviderExtension(resolver, transport),
    new TencentProviderExtension(resolver, transport),
    new HuaweiProviderExtension(resolver, transport),
    new VolcengineProviderExtension(resolver, transport),
  ];
}

export function listDefaultProviderDefinitions(): ProviderDefinition[] {
  return structuredClone(providerDefinitions);
}

export function listDefaultProviderCapabilities(): ProviderCapabilityPlugin[] {
  return structuredClone(capabilities);
}

function definition(providerKey: string, extensionKey: string, signerType: ProviderDefinition['signerType'], supportedProducts: string[]): ProviderDefinition {
  return {
    providerKey,
    displayNameKey: `provider.${extensionKey}.name`,
    capabilityPluginId: `gcac.provider.${extensionKey}`,
    providerExtensionKey: `gcac.provider-extension.${extensionKey}`,
    providerExtensionVersion: '1.0.0',
    supportedProducts,
    supportedOperations: ['provider.connection.test', 'provider.discovery', 'certificate.discover', 'certificate.deploy', 'certificate.verify', 'certificate.rollback', 'certificate.upload', 'certificate.binding.apply', 'certificate.binding.verify', 'certificate.binding.restore'],
    credentialSchemaId: `gcac.${extensionKey}.credential/v1`,
    scopeSchemaId: `gcac.${extensionKey}.scope/v1`,
    executionLocations: ['CONTROL_PLANE', 'GATEWAY'],
    signerType,
    contractVersion: 'gcac.provider-contract/v1',
  };
}

function capability(
  providerKey: string,
  frameworkType: string,
  operationKey: string,
  displayNameKey: string,
  rollbackMode: ProviderCapabilityPlugin['rollbackMode'],
): ProviderCapabilityPlugin {
  return {
    capabilityPluginId: `gcac.provider.${providerKey.split('.').at(-1)}`,
    version: '1.0.0',
    providerKey,
    frameworkType,
    operationKey,
    displayNameKey,
    inputSchemaId: `gcac.${operationKey.replaceAll('.', '-')}-input/v1`,
    outputSchemaId: `gcac.${operationKey.replaceAll('.', '-')}-result/v1`,
    executionLocations: ['CONTROL_PLANE', 'GATEWAY'],
    rollbackMode,
    requiredPermissions: operationKey.includes('deploy') || operationKey.includes('rollback')
      ? ['certificate.deploy']
      : ['certificate.read'],
    enabled: true,
  };
}
