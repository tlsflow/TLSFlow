import assert from 'node:assert/strict';
import test from 'node:test';
import { DeploymentInputProjectionService } from './application/deployment-input-projection.service.js';
import type { DeploymentInputContractV1 } from './dto/deployment-input-contract.dto.js';
import type { ResolvedDeploymentInputV1 } from './dto/resolved-deployment-input.dto.js';
import { emptyInputBindingsV1 } from './dto/input-bindings.dto.js';

test('Projection 只根据 Contract 和 Resolver 输出生成统一分组', () => {
  const contract = fixtureContract();
  const resolved = fixtureResolved();
  const projection = new DeploymentInputProjectionService().project({ contract, resolvedInput: resolved, effectiveBinding: fixtureEffectiveBinding() });
  assert.deepEqual(projection.requiredVariables.map((item) => item.slot), ['requiredValue']);
  assert.deepEqual(projection.advancedVariables.map((item) => item.slot), ['assetRequiredValue', 'advancedValue']);
  assert.equal(projection.connections[0]?.fields.host.type, 'string');
  assert.equal(projection.connections[0]?.fields.host.slot, 'host');
  assert.equal(projection.connections[0]?.fields.host.value, 'host');
  assert.equal(projection.credentials[0]?.selectedCredentialId, 'cred-1');
  assert.equal(projection.artifacts[0]?.outputs.privateKey.sensitive, true);
  assert.deepEqual(projection.artifacts[0]?.binding, { certificateFormatId: 'format-1', outputBindings: { privateKey: 'privateKeyPem' } });
  assert.equal(projection.requiredVariables[0]?.value, 'configured');
  assert.deepEqual(projection.fixedValues, [
    { slot: 'fixedValue', value: 'asset-value', source: { kind: 'asset', path: 'application.name' } },
    { slot: 'assetRequiredValue', value: 'asset-required-value', source: { kind: 'asset', path: 'application.address' } },
  ]);
  assert.equal(projection.advancedVariables[0]?.value, 'asset-required-value');
  assert.equal(projection.saveable, true);
});

test('Projection 不返回凭据 Secret 或敏感 Artifact 内容', () => {
  const projection = new DeploymentInputProjectionService().project({ contract: fixtureContract(), resolvedInput: fixtureResolved(), effectiveBinding: fixtureEffectiveBinding() });
  const text = JSON.stringify(projection);
  assert.equal(text.includes('secret://'), false);
  assert.equal(text.includes('PRIVATE KEY'), false);
});

function fixtureContract(): DeploymentInputContractV1 {
  const field = { type: 'string' as const, required: true, configurationMode: 'required' as const, source: { kind: 'binding' as const }, lifecycle: 'pre_execution' as const, bindingPolicy: 'required_binding' as const };
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: {
      fixedValue: { ...field, configurationMode: 'runtime', source: { kind: 'asset', path: 'application.name' }, bindingPolicy: 'fixed' },
      assetRequiredValue: { ...field, source: { kind: 'asset', path: 'application.address' }, bindingPolicy: 'fixed' },
      requiredValue: field,
      advancedValue: { ...field, configurationMode: 'advanced', bindingPolicy: 'default_overridable', source: { kind: 'default' }, default: 'default-value' },
    },
    connections: { management: { transport: 'http', host: field, port: { ...field, type: 'number' }, credentialSlot: 'managementCredential' } },
    credentials: { managementCredential: { allowedKinds: ['USERNAME_PASSWORD'], required: true, configurationMode: 'required', lifecycle: 'pre_execution' } },
    artifacts: { certificate: { kind: 'certificate', required: true, configurationMode: 'required', lifecycle: 'pre_execution', artifactContract: { outputs: { privateKey: { role: 'private_key', required: true, sensitive: true } } } } },
  };
}

function fixtureEffectiveBinding() {
  const inputBindings = emptyInputBindingsV1();
  inputBindings.variables.requiredValue = 'configured';
  inputBindings.connections.management = { host: 'device.example.com', port: 443 };
  inputBindings.credentials.managementCredential = { credentialId: 'cred-1' };
  inputBindings.artifacts.certificate = { certificateFormatId: 'format-1', outputBindings: { privateKey: 'privateKeyPem' } };
  return { inputBindings, provenance: {} };
}

function fixtureResolved(): ResolvedDeploymentInputV1 {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1', contractVersion: 'gcac.deployment-input/v1', assetContext: {} as never,
    variables: { fixedValue: 'asset-value', assetRequiredValue: 'asset-required-value', requiredValue: 'configured', advancedValue: 'advanced' }, connections: { management: { transport: 'http', host: 'host', port: 443 } },
    credentials: { managementCredential: { credentialId: 'cred-1', credentialVersionId: '1', kind: 'USERNAME_PASSWORD' } }, artifacts: { certificate: { outputs: { privateKey: { ref: 'artifact://private-key' } } } },
    provenance: {}, sensitivePaths: ['credentials.managementCredential', 'artifacts.certificate.outputs.privateKey'], issues: [], executable: true, resolvedSha256: 'hash',
  };
}
