import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { EffectiveBindingResolver, type ResolveEffectiveBindingRequest } from './application/effective-binding.resolver.js';
import { DEPLOYMENT_INPUT_CONTRACT_API_VERSION, type DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import { emptyInputBindingsV1, type InputBindingsV1 } from './dto/input-bindings.dto.js';

const resolver = new EffectiveBindingResolver();

test('EffectiveBindingResolver 按四层顺序逐字段覆盖', () => {
  const deviceOnly = requestFixture();
  deviceOnly.targetOverride = undefined;
  deviceOnly.assetOverride = undefined;
  deviceOnly.executionOverride = undefined;
  const target = requestFixture({ target: bindings({ variables: { retries: 2 }, connections: { management: { port: 8443 } } }) });
  target.assetOverride = undefined;
  target.executionOverride = undefined;
  const asset = requestFixture({ asset: bindings({ variables: { retries: 3 }, connections: { management: { host: 'asset.example.com' } } }) });
  asset.executionOverride = undefined;
  const execution = requestFixture({ execution: bindings({ variables: { retries: 4 }, connections: { management: { port: 9443 } } }) });
  const cases = [
    { name: '无覆盖', request: deviceOnly, expectedHost: 'device.example.com', expectedPort: 443, expectedLayer: 'DEVICE' },
    { name: 'Target 覆盖', request: target, expectedHost: 'device.example.com', expectedPort: 8443, expectedLayer: 'MANAGED_TARGET' },
    { name: 'Asset 覆盖', request: asset, expectedHost: 'asset.example.com', expectedPort: 8443, expectedLayer: 'APPLICATION_ASSET' },
    { name: 'Execution 覆盖', request: execution, expectedHost: 'asset.example.com', expectedPort: 9443, expectedLayer: 'EXECUTION' },
  ] as const;

  for (const item of cases) {
    const resolved = resolver.resolve(item.request);
    assert.equal(resolved.inputBindings.variables.retries, item.request.executionOverride?.inputBindings.variables.retries ?? item.request.assetOverride?.inputBindings.variables.retries ?? item.request.targetOverride?.inputBindings.variables.retries ?? 1, item.name);
    assert.equal(resolved.inputBindings.connections.management.host, item.expectedHost, item.name);
    assert.equal(resolved.inputBindings.connections.management.port, item.expectedPort, item.name);
    assert.equal(resolved.provenance['variables.retries'], item.expectedLayer, item.name);
  }
});

test('空对象不清空父级，Connection 嵌套字段独立继承', () => {
  const request = requestFixture();
  request.targetOverride!.inputBindings.connections.management = { port: 8443, tls: {} };
  request.assetOverride!.inputBindings.connections.management = { host: 'asset.example.com', tls: { verifyPeer: false } };
  request.executionOverride!.inputBindings.connections.management = { hostKey: {} };

  const resolved = resolver.resolve(request);

  assert.deepEqual(resolved.inputBindings.connections.management, {
    host: 'asset.example.com',
    port: 8443,
    tls: { verifyPeer: false, serverName: 'device.example.com' },
  });
  assert.equal(resolved.provenance['connections.management.tls.verifyPeer'], 'APPLICATION_ASSET');
  assert.equal(resolved.provenance['connections.management.tls.serverName'], 'DEVICE');
});

test('最高层切换 PluginVersion 后不继承旧版本同名字段', () => {
  const request = requestFixture();
  request.assetOverride = layer('plugin-version-2', bindings({ variables: { retries: 9 } }));
  request.executionOverride = undefined;

  const resolved = resolver.resolve(request);

  assert.equal(resolved.pluginVersionId, 'plugin-version-2');
  assert.deepEqual(resolved.inputBindings.variables, { retries: 9 });
  assert.deepEqual(resolved.inputBindings.connections, {});
  assert.deepEqual(resolved.inheritedLayers, ['APPLICATION_ASSET']);
});

test('Execution Override 必须与最终 PluginVersion 完全一致', () => {
  const request = requestFixture();
  request.executionOverride = layer('plugin-version-2', bindings({ variables: { retries: 5 } }));

  assertValidationIssues(request, ['INPUT_BINDING_VERSION_MISMATCH:pluginVersionId']);
});

test('一次拒绝未声明 Slot、未声明 Connection 字段和 fixed 覆盖', () => {
  const request = requestFixture();
  request.assetOverride!.inputBindings.variables = { fixedName: 'forbidden', unknownVariable: true };
  request.assetOverride!.inputBindings.connections.management = { unexpected: true } as never;
  request.assetOverride!.inputBindings.credentials = { unknownCredential: { credentialId: 'credential-2' } };

  assertValidationIssues(request, [
    'INPUT_BINDING_FIXED_OVERRIDE_FORBIDDEN:variables.fixedName',
    'INPUT_BINDING_SLOT_UNDECLARED:variables.unknownVariable',
    'INPUT_BINDING_FIELD_UNDECLARED:connections.management.unexpected',
    'INPUT_BINDING_SLOT_UNDECLARED:credentials.unknownCredential',
  ]);
});

function requestFixture(overrides: { target?: InputBindingsV1; asset?: InputBindingsV1; execution?: InputBindingsV1 } = {}): ResolveEffectiveBindingRequest {
  return {
    contract: contractFixture(),
    deviceDefault: layer('plugin-version-1', bindings({
      variables: { retries: 1 },
      connections: { management: { host: 'device.example.com', port: 443, tls: { verifyPeer: true, serverName: 'device.example.com' } } },
      credentials: { managementCredential: { credentialId: 'credential-1' } },
    })),
    targetOverride: layer('plugin-version-1', overrides.target ?? bindings({ connections: { management: { port: 8443 } } })),
    assetOverride: layer('plugin-version-1', overrides.asset ?? bindings({ connections: { management: { host: 'asset.example.com' } } })),
    executionOverride: layer('plugin-version-1', overrides.execution ?? bindings({ connections: { management: { port: 9443 } } })),
  };
}

function contractFixture(): DeploymentInputContractV1 {
  const bindingField = {
    type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding',
  } as const;
  return {
    apiVersion: DEPLOYMENT_INPUT_CONTRACT_API_VERSION,
    variables: {
      retries: { type: 'number', required: false, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: 1 },
      fixedName: { type: 'string', required: true, configurationMode: 'runtime', source: { kind: 'asset', path: 'application.name' }, lifecycle: 'pre_execution', bindingPolicy: 'fixed' },
    },
    connections: {
      management: {
        transport: 'http',
        host: bindingField,
        port: { ...bindingField, type: 'number' },
        tls: {
          verifyPeer: { ...bindingField, type: 'boolean' },
          serverName: bindingField,
        },
      },
    },
    credentials: {
      managementCredential: { allowedKinds: ['USERNAME_PASSWORD'], required: true, configurationMode: 'required', lifecycle: 'pre_execution' },
    },
    artifacts: {},
  };
}

function bindings(overrides: Partial<Omit<InputBindingsV1, 'apiVersion'>> = {}): InputBindingsV1 {
  return { ...emptyInputBindingsV1(), ...overrides };
}

function layer(pluginVersionId: string, inputBindings: InputBindingsV1) {
  return { pluginVersionId, inputBindings };
}

function assertValidationIssues(request: ResolveEffectiveBindingRequest, expected: string[]): void {
  assert.throws(
    () => resolver.resolve(request),
    (error) => {
      assert.equal(error instanceof AppError, true);
      const issues = (error as AppError).details as { issues: Array<{ code: string; path: string }> };
      assert.deepEqual(issues.issues.map((item) => `${item.code}:${item.path}`), expected);
      return true;
    },
  );
}
