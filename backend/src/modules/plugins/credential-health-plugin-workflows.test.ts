import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import jsonata from 'jsonata';

const packages = [
  {
    id: 'device.citrix.netscaler-adc',
    directory: './builtin-plugins/citrix-adc/',
    version: '2.0.22',
    protocol: 'NITRO',
    credentialKind: 'USERNAME_PASSWORD',
    rejectedReason: 'PASSWORD_INVALID',
    validInput: { statusCode: 200, nitroErrorCode: 0 },
    rejectedInput: { statusCode: 401, nitroErrorCode: 444 },
    unreachableInput: { statusCode: 503, nitroErrorCode: 0 },
  },
  {
    id: 'device.chaitin-safeline-waf',
    directory: './builtin-plugins/device-chaitin-safeline-waf/',
    version: '0.1.13',
    protocol: 'SAFELINE_OPEN_API',
    credentialKind: 'API_KEY',
    rejectedReason: 'TOKEN_REJECTED',
    validInput: { statusCode: 200 },
    rejectedInput: { statusCode: 403 },
    unreachableInput: { statusCode: 503 },
  },
  {
    id: 'device.nginx-proxy-manager',
    directory: './builtin-plugins/device-nginx-proxy-manager/',
    version: '0.1.12',
    protocol: 'NPM_API',
    credentialKind: 'USERNAME_PASSWORD',
    rejectedReason: 'PASSWORD_INVALID',
    validInput: { statusCode: 200, token: 'fixture-token' },
    rejectedInput: { statusCode: 401 },
    unreachableInput: { statusCode: 503 },
  },
] as const;

function readJson(directory: string, path: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`${directory}${path}`, import.meta.url), 'utf8')) as Record<string, any>;
}

for (const plugin of packages) {
  test(`${plugin.id} 声明标准凭据健康合同和只读 Workflow`, () => {
    const manifest = readJson(plugin.directory, 'manifest.json');
    const contract = readJson(plugin.directory, 'action-contracts/credential-health-check.json');
    const workflow = readJson(plugin.directory, 'workflows/credential-health-check.json');
    assert.equal(manifest.version, plugin.version);
    assert.ok(manifest.capabilities.some((item: Record<string, unknown>) => item.key === 'credential.health-check'));
    assert.equal(manifest.resources.actionContracts['credential.health-check.v1'], 'action-contracts/credential-health-check.json');
    assert.equal(manifest.resources.workflows['credential.health-check'], 'workflows/credential-health-check.json');
    assert.equal(contract.capability, 'credential.health-check');
    assert.equal(contract.actionId, 'credential.health-check.v1');
    assert.equal(contract.writeEffect, false);
    assert.deepEqual(contract.inputSchema.properties.credential.properties.secretRef.pattern, '^secret://[A-Za-z0-9._:/#-]{1,512}$');
    assert.deepEqual(contract.outputSchema.properties.status.enum, ['VALID', 'ERROR', 'UNREACHABLE']);
    assert.equal(workflow.metadata.version, plugin.version);
    assert.equal(workflow.inputContract.credentials.credential.allowedKinds[0], plugin.credentialKind);
    assert.equal(workflow.steps[0].stage, 'prepare');
    assert.equal(workflow.steps.at(-1).stage, 'verify');
    assert.equal(workflow.steps[0].request?.failOnNon2xx, false);
    if (plugin.id === 'device.nginx-proxy-manager') {
      assert.equal(workflow.steps[0].request?.url, '/api/tokens');
      const connectionTest = readJson(plugin.directory, 'workflows/connection-test.json');
      assert.equal(connectionTest.steps[0].request?.url, '/');
    }
    assert.equal(workflow.steps.some((step: Record<string, any>) => step.request?.method === 'POST' && step.request?.bodyType === 'json'), false);
    assert.equal(workflow.steps.some((step: Record<string, any>) => step.type === 'http' && step.request?.writeEffect === true), false);
  });

  test(`${plugin.id} Fixture 结果可归一化为有效、凭据错误和远端服务异常`, async () => {
    const workflow = readJson(plugin.directory, 'workflows/credential-health-check.json');
    const transform = workflow.steps.find((step: Record<string, any>) => step.name === 'classifyAuthentication');
    const expression = transform?.transform?.outputs?.credentialHealth?.expression;
    assert.equal(typeof expression, 'string');
    const valid = await jsonata(expression).evaluate(plugin.validInput);
    const rejected = await jsonata(expression).evaluate(plugin.rejectedInput);
    assert.equal(valid.apiVersion, 'gcac.credential-health-result/v1');
    assert.equal(valid.status, 'VALID');
    assert.equal(valid.evidence.protocol, plugin.protocol);
    assert.equal(rejected.status, 'ERROR');
    assert.equal(rejected.reasonCode, plugin.rejectedReason);
    assert.equal(rejected.evidence.protocol, plugin.protocol);
    const unreachable = await jsonata(expression).evaluate(plugin.unreachableInput);
    assert.equal(unreachable.status, 'UNREACHABLE');
    assert.equal(unreachable.reasonCode, 'REMOTE_SERVICE_ERROR');
    assert.equal(unreachable.evidence.protocol, plugin.protocol);
    if (plugin.id === 'device.nginx-proxy-manager') {
      const emptyToken = await jsonata(expression).evaluate({ statusCode: 200, token: '' });
      assert.equal(emptyToken.status, 'ERROR');
      assert.equal(emptyToken.reasonCode, 'CHECK_RESULT_INVALID');
    }
  });
}
