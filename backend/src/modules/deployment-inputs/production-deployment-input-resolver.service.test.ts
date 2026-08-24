import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { ProductionDeploymentInputResolverService } from './application/production-deployment-input-resolver.service.js';
import type { DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import { emptyInputBindingsV1 } from './dto/input-bindings.dto.js';
import { readResolvedDeploymentInputV1 } from './schema/resolved-deployment-input.schema.js';

const contract: DeploymentInputContractV1 = {
  apiVersion: 'gcac.deployment-input/v1',
  variables: {
    serverName: {
      type: 'string', required: true, configurationMode: 'advanced', source: { kind: 'asset', path: 'application.serverName' },
      lifecycle: 'pre_execution', bindingPolicy: 'fixed',
    },
  },
  connections: {},
  credentials: {
    management: { allowedKinds: ['USERNAME_PASSWORD'], required: true, configurationMode: 'required', lifecycle: 'pre_execution' },
  },
  artifacts: {
    certificate: {
      kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution',
      artifactContract: { outputs: { privateKey: { role: 'private_key', required: true, sensitive: true } } },
    },
  },
};

test('生产解析服务让计划预检与执行得到相同解析摘要', () => {
  const service = new ProductionDeploymentInputResolverService();
  const inputBindings = emptyInputBindingsV1();
  inputBindings.credentials.management = { credentialId: 'credential-1' };
  inputBindings.artifacts.certificate = { certificateFormatId: 'format-1', outputBindings: { privateKey: 'privateKeyPem' } };
  const common = {
    contract,
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1' as const,
      application: { id: 'asset-1', address: 'example.com', serverName: 'example.com', port: 443, protocol: 'HTTPS' },
      deployment: { targets: [], certificateResourceName: 'certificate-example' },
    },
    bindingLayers: { assetOverride: { pluginVersionId: 'plugin-version-1', inputBindings } },
    credentialSnapshots: {
      management: { credentialId: 'credential-1', credentialVersionId: '1', kind: 'USERNAME_PASSWORD' as const, secretRefs: { password: 'secret://password/1#v1' } },
    },
    artifactSnapshots: {
      certificate: { artifactId: 'certificate-version-1:format-1', outputs: { privateKey: { content: 'PRIVATE_KEY' } } },
    },
  };

  const preflight = service.resolve({ phase: 'preflight', ...common });
  const execute = service.resolve({ phase: 'execute', ...common });

  assert.equal(preflight.resolvedSha256, execute.resolvedSha256);
  assert.deepEqual(preflight.variables, { serverName: 'example.com' });
  assert.deepEqual(preflight.sensitivePaths, ['artifacts.certificate.outputs.privateKey', 'credentials.management']);
});

test('生产解析服务在进入 Runtime 前聚合并抛出统一输入问题', () => {
  const inputBindings = emptyInputBindingsV1();
  assert.throws(
    () => new ProductionDeploymentInputResolverService().resolve({
      phase: 'preflight',
      contract,
      assetContext: {
        apiVersion: 'gcac.deployment-asset-context/v1',
        application: { id: 'asset-1', address: 'example.com', serverName: 'example.com', port: 443, protocol: 'HTTPS' },
        deployment: { targets: [], certificateResourceName: 'certificate-example' },
      },
      bindingLayers: { assetOverride: { pluginVersionId: 'plugin-version-1', inputBindings } },
    }),
    (error: unknown) => {
      if (!(error instanceof AppError) || !error.details || typeof error.details !== 'object') return false;
      const details = error.details as { code?: unknown; issues?: unknown };
      return details.code === 'DEPLOYMENT_INPUT_INVALID'
        && Array.isArray(details.issues)
        && details.issues.length === 2;
    },
  );
});

test('标准与历史 Runtime 共用读取器并拒绝缺少 Contract 版本的旧快照', () => {
  const service = new ProductionDeploymentInputResolverService();
  const inputBindings = emptyInputBindingsV1();
  const resolved = service.resolve({
    phase: 'configure',
    contract: { ...contract, credentials: {}, artifacts: {} },
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset-1', address: 'example.com', serverName: 'example.com', port: 443, protocol: 'HTTPS' },
      deployment: { targets: [], certificateResourceName: 'certificate-example' },
    },
    bindingLayers: { assetOverride: { pluginVersionId: 'plugin-version-1', inputBindings } },
  });
  assert.equal(readResolvedDeploymentInputV1(resolved), resolved);
  const { contractVersion: _contractVersion, ...legacySnapshot } = resolved;
  assert.equal(readResolvedDeploymentInputV1(legacySnapshot), undefined);
});
