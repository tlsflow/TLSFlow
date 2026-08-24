import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentInputBindingSaveService } from './application/deployment-input-binding-save.service.js';
import { DEPLOYMENT_ASSET_CONTEXT_API_VERSION, type DeploymentAssetContextV1 } from './dto/deployment-asset-context.dto.js';
import { DEPLOYMENT_INPUT_CONTRACT_API_VERSION, type DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import { emptyInputBindingsV1 } from './dto/input-bindings.dto.js';

const service = new DeploymentInputBindingSaveService();
const field = { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' } as const;
const contract: DeploymentInputContractV1 = {
  apiVersion: DEPLOYMENT_INPUT_CONTRACT_API_VERSION,
  variables: {
    targetName: field,
    fixedName: { ...field, configurationMode: 'runtime', source: { kind: 'asset', path: 'application.serverName' }, bindingPolicy: 'fixed' },
  },
  connections: { management: { transport: 'http', host: field, port: { ...field, type: 'number' } } },
  credentials: { management: { allowedKinds: ['USERNAME_PASSWORD'], required: true, configurationMode: 'required', lifecycle: 'pre_execution' } },
  artifacts: {},
};
const assetContext: DeploymentAssetContextV1 = { apiVersion: DEPLOYMENT_ASSET_CONTEXT_API_VERSION, application: { id: 'asset-1', address: 'app.example.com', serverName: 'app.example.com', port: 443, protocol: 'HTTPS' }, deployment: { targets: [{ name: 'app.example.com', serverName: 'app.example.com', port: 443, sni: true, metadata: {} }], certificateResourceName: 'certificate-app' } };

test('同版本保存只持久化资产覆盖并继承 Device/Target 字段', () => {
  const submitted = emptyInputBindingsV1();
  submitted.variables.targetName = 'asset-target';
  submitted.connections.management = { host: 'asset.example.com' };
  const result = service.validate({
    pluginVersionId: 'version-1', contract, assetContext,
    deviceDefault: { pluginVersionId: 'version-1', inputBindings: bindings({ connections: { management: { host: 'device.example.com', port: 443 } }, credentials: { management: { credentialId: 'credential-1' } } }) },
    targetOverride: { pluginVersionId: 'version-1', inputBindings: bindings({ connections: { management: { port: 8443 } } }) },
    submitted,
  });
  assert.equal(result.saveable, true);
  assert.deepEqual(result.assetOverride.variables, { targetName: 'asset-target' });
  assert.deepEqual(result.assetOverride.connections, { management: { host: 'asset.example.com' } });
  assert.equal(result.resolved.connections.management?.port, 8443);
  assert.equal(result.resolved.provenance['connections.management.port']?.bindingLayer, 'MANAGED_TARGET');
});

test('不同版本不继承父级并一次返回缺失和非法覆盖问题', () => {
  const submitted = bindings({ variables: { fixedName: 'forbidden', unknown: true } });
  const result = service.validate({
    pluginVersionId: 'version-2', contract, assetContext,
    deviceDefault: { pluginVersionId: 'version-1', inputBindings: bindings({ connections: { management: { host: 'device.example.com', port: 443 } }, credentials: { management: { credentialId: 'credential-1' } } }) },
    submitted,
  });
  assert.equal(result.saveable, false);
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set(['DEPLOYMENT_INPUT_OVERRIDE_FORBIDDEN', 'DEPLOYMENT_INPUT_SLOT_UNDECLARED', 'DEPLOYMENT_INPUT_REQUIRED', 'DEPLOYMENT_CONNECTION_REQUIRED', 'DEPLOYMENT_CREDENTIAL_REQUIRED']));
  assert.deepEqual(result.assetOverride, emptyInputBindingsV1());
});

test('保存时清理历史资产覆盖层中的旧协议字段', () => {
  const submitted = emptyInputBindingsV1();
  submitted.variables.targetName = 'asset-target';
  submitted.connections.management = { port: 8443 };
  const result = service.validate({
    pluginVersionId: 'version-1', contract, assetContext,
    deviceDefault: { pluginVersionId: 'version-1', inputBindings: bindings({
      connections: { management: { host: 'device.example.com', port: 443 } },
      credentials: { management: { credentialId: 'credential-1' } },
    }) },
    currentAssetOverride: { pluginVersionId: 'version-1', inputBindings: bindings({
      variables: { deviceHost: '10.0.0.1', fixedName: 'old-fixed' },
      connections: { management: { 'connection.address': '10.0.0.1', host: 'old.example.com', port: 443 } as never },
      credentials: { management: { credentialId: 'credential-2' } },
    }) },
    submitted,
  });
  assert.equal(result.saveable, true);
  assert.deepEqual(result.assetOverride.variables, { targetName: 'asset-target' });
  assert.deepEqual(result.assetOverride.connections, { management: { host: 'old.example.com', port: 8443 } });
  assert.deepEqual(result.assetOverride.credentials, { management: { credentialId: 'credential-2' } });
  assert.equal(result.resolved.connections.management?.host, 'old.example.com');
  assert.equal(result.resolved.connections.management?.port, 8443);
});

test('历史资产覆盖层缺少 inputBindings 时按空绑定处理并返回校验问题', () => {
  const result = service.validate({
    pluginVersionId: 'version-1',
    contract,
    assetContext,
    deviceDefault: { pluginVersionId: 'version-1', inputBindings: bindings({
      connections: { management: { host: 'device.example.com', port: 443 } },
      credentials: { management: { credentialId: 'credential-1' } },
    }) },
    currentAssetOverride: { pluginVersionId: 'version-1', inputBindings: undefined } as never,
    submitted: emptyInputBindingsV1(),
  });

  assert.equal(result.saveable, false);
  assert.ok(result.issues.some((issue) => issue.code === 'DEPLOYMENT_INPUT_REQUIRED'));
  assert.deepEqual(result.assetOverride, emptyInputBindingsV1());
});

test('请求缺少 pluginVersionId 且没有当前覆盖层时不发生未定义解引用', () => {
  const result = service.validate({
    pluginVersionId: undefined as never,
    contract,
    assetContext,
    submitted: emptyInputBindingsV1(),
  });

  assert.equal(result.saveable, false);
  assert.ok(result.issues.some((issue) => issue.code === 'DEPLOYMENT_INPUT_REQUIRED'));
  assert.deepEqual(result.assetOverride, emptyInputBindingsV1());
});

function bindings(overrides: Partial<ReturnType<typeof emptyInputBindingsV1>>): ReturnType<typeof emptyInputBindingsV1> {
  return { ...emptyInputBindingsV1(), ...overrides };
}
