import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
import { createDefaultProviderRegistry } from '../application/default-provider-registry.js';
import { ProviderExtensionRegistry } from './provider-extension.js';

test('默认 Provider 注册表只暴露声明式能力，不伪造已安装 Extension', () => {
  const registry = createDefaultProviderRegistry();
  assert.equal(registry.listDefinitions().length, 4);
  assert.equal(registry.listCapabilities({ providerKey: 'cloud.aliyun', frameworkType: 'cloud.aliyun.cdn' }).length, 4);
  assert.throws(
    () => registry.requireExtension('cloud.aliyun'),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PROVIDER_EXTENSION_UNAVAILABLE',
  );
});

test('Provider Extension 必须和定义中的版本绑定', () => {
  const registry = new ProviderExtensionRegistry();
  registry.registerDefinition({
    providerKey: 'cloud.test',
    displayNameKey: 'provider.test.name',
    capabilityPluginId: 'gcac.provider.test',
    providerExtensionKey: 'gcac.provider-extension.test',
    providerExtensionVersion: '1.0.0',
    supportedProducts: ['cloud.test.cdn'],
    supportedOperations: ['certificate.deploy'],
    credentialSchemaId: 'test.credential/v1',
    scopeSchemaId: 'test.scope/v1',
    executionLocations: ['CONTROL_PLANE'],
    signerType: 'CUSTOM',
    contractVersion: 'gcac.provider-contract/v1',
  });
  assert.throws(
    () => registry.registerExtension({
      descriptor: {
        extensionKey: 'gcac.provider-extension.test',
        providerKey: 'cloud.test',
        version: '2.0.0',
        signerType: 'CUSTOM',
        supportedFrameworkTypes: ['cloud.test.cdn'],
        supportedOperations: ['certificate.deploy'],
        trusted: true,
      },
      testConnection: async () => ({ reachable: true }),
      discover: async () => ({}),
      execute: async () => ({
        operationId: 'op_test',
        providerKey: 'cloud.test',
        operationKey: 'certificate.deploy',
        status: 'SUCCESS',
      }),
    }),
    (error: unknown) => error instanceof AppError && error.errorCode === 'PROVIDER_EXTENSION_UNAVAILABLE',
  );
});
