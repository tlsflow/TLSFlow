import assert from 'node:assert/strict';
import test from 'node:test';
import { computeAgentFactDigest, type AgentFactEnvelopeV1 } from '../../agents/security/agent-security.contract.js';
import { PluginFactPipelineService, type PluginFactRunner } from './plugin-fact-pipeline.service.js';

test('Fact Pipeline 校验事实、标准对象并生成固定 Atomic Plan', async () => {
  const fact = factEnvelope();
  const planDigest = 'a'.repeat(64);
  const runner: PluginFactRunner = {
    async execute(input) {
      assert.equal(input.input.factEnvelope.digest, fact.digest);
      assert.equal(input.writeEffect, false);
      return {
        protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute_result', requestId: 'request-1', sentAt: new Date().toISOString(),
        pluginVersionId: 'plugin-version-1', tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1',
        success: true, status: 'SUCCESS', summary: { planDigest, operationResults: [{ operationId: 'discover-1', operationType: 'application.discover', input: {} }] },
        normalizedObjects: [{ apiVersion: 'gcac.application/v1', kind: 'Application', stableKey: 'web.nginx:agent-1:/etc/nginx.conf', pluginId: 'web.nginx', pluginVersionId: 'plugin-version-1', tenantId: 'tenant-1' }], warnings: [],
      };
    },
  };
  const result = await new PluginFactPipelineService(runner).execute({
    tenantId: 'tenant-1', agentId: 'agent-1', hostId: 'host-1', executionId: 'execution-1', executionStepId: 'step-1',
    pluginId: 'web.nginx', pluginVersion: '1.0.0', pluginVersionId: 'plugin-version-1', workflowVersionId: 'workflow-version-1', capability: 'application.discover',
    packageHash: `sha256:${'b'.repeat(64)}`, manifestHash: `sha256:${'c'.repeat(64)}`, resourceHash: `sha256:${'d'.repeat(64)}`,
    planDigest, grantRefs: ['grant-1'], hostPermissions: ['artifact.read'], idempotencyKey: 'idempotency-1', deadlineAt: new Date(Date.now() + 10_000).toISOString(), factEnvelope: fact,
  });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.normalizedObjects[0]?.apiVersion, 'gcac.application/v1');
  assert.equal(result.atomicPlan?.workflowVersionId, 'workflow-version-1');
  assert.equal(result.atomicPlan?.planDigest, planDigest);
  assert.match(result.atomicPlan?.atomicPlanDigest ?? '', /^[a-f0-9]{64}$/);
});

test('Fact Pipeline 拒绝产品判断、跨租户事实和任意命令计划', async () => {
  const base = factEnvelope();
  const invalidFact = { ...base, facts: [{ kind: 'process', pid: 1, executablePath: '/usr/bin/nginx', detectedProduct: 'nginx' }] } as unknown as AgentFactEnvelopeV1;
  invalidFact.digest = computeAgentFactDigest(invalidFact);
  const runner: PluginFactRunner = {
    async execute() {
      return {
        protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute_result', requestId: 'request-2', sentAt: new Date().toISOString(),
        pluginVersionId: 'plugin-version-1', tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1', success: true, status: 'SUCCESS',
        summary: { operationResults: [{ operationId: 'op-1', operationType: 'powershell.exec', input: {} }] }, normalizedObjects: [{ apiVersion: 'gcac.application/v1', kind: 'Application', stableKey: 'app:1' }], warnings: [],
      };
    },
  };
  const service = new PluginFactPipelineService(runner);
  await assert.rejects(() => service.execute({ ...validInput(), factEnvelope: invalidFact }), /事实|产品|字段/);
  const crossTenant = { ...base, tenantId: 'tenant-2' } as AgentFactEnvelopeV1;
  crossTenant.digest = computeAgentFactDigest(crossTenant);
  await assert.rejects(() => service.execute({ ...validInput(), factEnvelope: crossTenant }), /租户/);
  await assert.rejects(() => service.execute({ ...validInput(), factEnvelope: base }), /powershell|命令|脚本/);
});

test('写入或失败结果不会被 Fact Pipeline 伪装成成功对象', async () => {
  const fact = factEnvelope();
  const runner: PluginFactRunner = {
    async execute(input) {
      assert.equal(input.writeEffect, false);
      return {
        protocolVersion: 'gcac.plugin-runner/v1', messageType: 'execute_result', requestId: 'request-3', sentAt: new Date().toISOString(),
        pluginVersionId: 'plugin-version-1', tenantId: 'tenant-1', executionId: 'execution-1', executionStepId: 'step-1', success: false, status: 'UNKNOWN',
        summary: {}, normalizedObjects: [], warnings: [], error: { code: 'PLUGIN_OPERATION_UNKNOWN_STATE', message: '结果不确定', retryable: false, mayBeUnknown: true, secretRedacted: true },
      };
    },
  };
  const result = await new PluginFactPipelineService(runner).execute({ ...validInput(), factEnvelope: fact });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.atomicPlan, undefined);
  assert.equal(result.normalizedObjects.length, 0);
});

function validInput() {
  return {
    tenantId: 'tenant-1', agentId: 'agent-1', hostId: 'host-1', executionId: 'execution-1', executionStepId: 'step-1',
    pluginId: 'web.nginx', pluginVersion: '1.0.0', pluginVersionId: 'plugin-version-1', workflowVersionId: 'workflow-version-1', capability: 'application.discover',
    packageHash: `sha256:${'b'.repeat(64)}`, manifestHash: `sha256:${'c'.repeat(64)}`, resourceHash: `sha256:${'d'.repeat(64)}`,
    planDigest: 'a'.repeat(64), grantRefs: ['grant-1'], hostPermissions: ['artifact.read'], idempotencyKey: 'idempotency-1', deadlineAt: new Date(Date.now() + 10_000).toISOString(),
  };
}

function factEnvelope(): AgentFactEnvelopeV1 {
  const value = {
    contractVersion: 'gcac.agent-security/v1' as const, factId: 'fact-1', agentId: 'agent-1', tenantId: 'tenant-1', collectedAt: '2026-08-11T00:00:00.000Z', ttlSeconds: 300,
    source: 'linux' as const, facts: [{ kind: 'process' as const, pid: 1, executablePath: '/usr/bin/gcac-agent' }], digest: '', warnings: [],
  };
  value.digest = computeAgentFactDigest(value);
  return value;
}
