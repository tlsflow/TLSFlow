import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '../../common/errors/app-error.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import { UnifiedAgentPlanCompilerService } from '../plugins/application/unified-agent-plan-compiler.service.js';
import { AgentExecutorAdapter, TrustedJsExecutorAdapter } from './application/executors.js';

const now = '2026-08-09T00:00:00.000Z';

test('AgentExecutorAdapter 将完整 Agent v2 授权材料接线到 plan.execute', async () => {
  let enqueuedPayload: Record<string, unknown> | undefined;
  let compilerInput: { v2Request?: Record<string, unknown> } | undefined;
  const materials = v2Materials();
  const agents = agentsProbe(
    async (_tenantId, input) => {
      enqueuedPayload = input.payload;
      return createTaskEnvelope('task_v2_fixture', input.payload ?? {});
    },
    async () => ({ task: createTaskEnvelope('task_v2_fixture', {}), success: true, detail: { mode: 'agent_v2_execute' } }),
  );
  const compiler = {
    compile: async (input: { v2Request?: Record<string, unknown> }) => {
      compilerInput = input;
      return {
        actionType: 'agent.plan.execute' as const,
        actionSchemaVersion: '1.0' as const,
        ...materials,
      };
    },
  };

  const result = await new AgentExecutorAdapter(agents, undefined, compiler as never).executeStep(createStep({
    ...v2RequestSnapshot(materials),
    actionType: 'agent.plan.execute',
  }));

  assert.equal(result.success, true);
  assert.deepEqual(compilerInput?.v2Request, {
    actionType: 'agent.plan.execute',
    plan: materials.plan,
    token: materials.token,
    policyDecision: materials.policyDecision,
  });
  assert.equal(enqueuedPayload?.actionType, 'agent.plan.execute');
  assert.deepEqual(enqueuedPayload?.plan, materials.plan);
  assert.deepEqual(enqueuedPayload?.token, materials.token);
  assert.deepEqual(enqueuedPayload?.policyDecision, materials.policyDecision);
});

test('AgentExecutorAdapter 将 agent.plan.validate 送入同一 Agent v2 compiler 主链', async () => {
  let enqueuedPayload: Record<string, unknown> | undefined;
  let compilerActionType: unknown;
  const materials = v2Materials('agent.plan.validate');
  const agents = agentsProbe(
    async (_tenantId, input) => {
      enqueuedPayload = input.payload;
      return createTaskEnvelope('task_v2_validate_fixture', input.payload ?? {});
    },
    async () => ({ task: createTaskEnvelope('task_v2_validate_fixture', {}), success: true, detail: { mode: 'agent_v2_validate' } }),
  );
  const compiler = {
    compile: async (input: { v2Request?: Record<string, unknown> }) => {
      compilerActionType = input.v2Request?.actionType;
      return {
        actionType: 'agent.plan.validate' as const,
        actionSchemaVersion: '1.0' as const,
        ...materials,
      };
    },
  };

  const result = await new AgentExecutorAdapter(agents, undefined, compiler as never).executeStep(createStep({
    ...v2RequestSnapshot(materials),
    actionType: 'agent.plan.validate',
  }));

  assert.equal(result.success, true);
  assert.equal(compilerActionType, 'agent.plan.validate');
  assert.equal(enqueuedPayload?.actionType, 'agent.plan.validate');
  assert.deepEqual(enqueuedPayload?.plan, materials.plan);
  assert.deepEqual(enqueuedPayload?.token, materials.token);
  assert.deepEqual(enqueuedPayload?.policyDecision, materials.policyDecision);
});

test('AgentExecutorAdapter 的 dry-run 将计划执行收敛为只读 plan.validate', async () => {
  let compilerActionType: unknown;
  let enqueuedPayload: Record<string, unknown> | undefined;
  const materials = v2Materials('agent.plan.validate');
  const agents = agentsProbe(
    async (_tenantId, input) => {
      enqueuedPayload = input.payload;
      return createTaskEnvelope('task_v2_preflight_fixture', input.payload ?? {});
    },
    async () => ({ task: createTaskEnvelope('task_v2_preflight_fixture', {}), success: true, detail: { validated: true } }),
  );
  const compiler = {
    compile: async (input: { v2Request?: Record<string, unknown> }) => {
      compilerActionType = input.v2Request?.actionType;
      return {
        actionType: 'agent.plan.validate' as const,
        actionSchemaVersion: '1.0' as const,
        ...materials,
      };
    },
  };

  const result = await new AgentExecutorAdapter(agents, undefined, compiler as never).executeStep(createStep({
    ...v2RequestSnapshot(materials),
    actionType: 'agent.plan.execute',
  }, { dryRun: true, runType: 'dry_run' }));

  assert.equal(result.success, true);
  assert.equal(compilerActionType, 'agent.plan.validate');
  assert.equal(enqueuedPayload?.actionType, 'agent.plan.validate');
});

test('AgentExecutorAdapter 缺少完整 Policy/Token 时失败关闭且不入队', async () => {
  let enqueueCount = 0;
  const agents = agentsProbe(
    async () => {
      enqueueCount += 1;
      return createTaskEnvelope('task_should_not_exist', {});
    },
    async () => ({ task: createTaskEnvelope('task_should_not_exist', {}), success: true, detail: {} }),
  );

  await assert.rejects(
    new AgentExecutorAdapter(agents, undefined, new UnifiedAgentPlanCompilerService({} as never)).executeStep(createStep({
      actionType: 'agent.plan.execute',
      actionSchemaVersion: '1.0',
      pluginBindingId: 'binding_v2_fixture',
      pluginRuntimeCapability: { pluginVersionId: 'plugin-version-v2-fixture' },
      resolvedDeploymentInput: resolvedDeploymentInput(),
    })),
    (error: unknown) => error instanceof AppError && error.errorCode === 'AGENT_AUTHORIZATION_UNAVAILABLE',
  );
  assert.equal(enqueueCount, 0);
});

test('AgentExecutorAdapter 不从旧 type 字段猜测动作，也不静默 fallback', async () => {
  let enqueueCount = 0;
  const agents = agentsProbe(
    async () => {
      enqueueCount += 1;
      return createTaskEnvelope('task_should_not_exist', {});
    },
    async () => ({ task: createTaskEnvelope('task_should_not_exist', {}), success: true, detail: {} }),
  );

  const result = await new AgentExecutorAdapter(agents).executeStep(createStep({ type: 'legacy.agent.action' }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'AGENT_ACTION_UNREGISTERED');
  assert.equal(enqueueCount, 0);
});

test('AgentExecutorAdapter 将 UNKNOWN 直连结果保持为异步等待', async () => {
  let enqueueCount = 0;
  const agents = agentsProbe(
    async (_tenantId, input) => {
      enqueueCount += 1;
      return createTaskEnvelope('task_unknown_fixture', input.payload ?? {});
    },
    async () => ({
      task: createTaskEnvelope('task_unknown_fixture', {}),
      success: false,
      asyncPending: true,
      errorCode: 'AGENT_CONNECTION_LOST',
      detail: { executionStatus: 'UNKNOWN' },
    }),
  );

  const result = await new AgentExecutorAdapter(agents).executeStep(createStep({ actionType: 'agent.fact.collect' }));

  assert.equal(result.success, true);
  assert.equal(result.asyncPending, true);
  assert.equal(result.errorCode, 'AGENT_CONNECTION_LOST');
  assert.equal(enqueueCount, 1);
});

test('Trusted JS 旧 Provider 产品操作入口失败关闭', async () => {
  const adapter = new TrustedJsExecutorAdapter({
    executeByAssetId: async () => ({
      operationId: 'operation_runner_fixture',
      providerKey: 'cloud.fixture',
      operationKey: 'certificate.deploy',
      status: 'SUCCESS',
      resultSummary: { checkpoint: { id: 'checkpoint_fixture' } },
      providerOperation: { legacy: true },
    }),
  } as never);

  const result = await adapter.executeStep(createStep({
    trustedJsRequest: {
      cloudAccountAssetId: 'cloud-account-fixture',
      frameworkType: 'cloud.fixture.cdn',
      target: { resourceId: 'target_v2_fixture' },
    },
  }));

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'PLUGIN_CAPABILITY_EXECUTION_FAILED');
  assert.equal(result.detail?.executionMode, 'trusted_js_fail_closed');
});

function agentsProbe(
  enqueueDirectTask: AgentsApplicationService['enqueueDirectTask'],
  executeTaskDirect: AgentsApplicationService['executeTaskDirect'],
): AgentsApplicationService {
  return { enqueueDirectTask, executeTaskDirect } as unknown as AgentsApplicationService;
}

function createTaskEnvelope(id: string, payload: Record<string, unknown>): AgentTaskEnvelope {
  return {
    id,
    tenantId: 'tenant_v2_fixture',
    agentId: 'agent_v2_fixture',
    executionRunId: 'run_v2_fixture',
    executionStepId: 'step_v2_fixture',
    idempotencyKey: `idempotency:${id}`,
    payload,
    status: 'acked',
    leaseId: `direct:${id}`,
    ackedAt: now,
    createdAt: now,
    updatedAt: now,
    requestId: `request:${id}`,
  };
}

function createStep(snapshot: Record<string, unknown>, options: { dryRun?: boolean; runType?: 'apply' | 'dry_run' | 'rollback' } = {}) {
  return {
    step: {
      id: 'step_v2_fixture',
      tenantId: 'tenant_v2_fixture',
      executionRunId: 'run_v2_fixture',
      deploymentPlanTargetId: 'target_v2_fixture',
      stepNo: 1,
      stepType: 'INSTALL' as const,
      name: 'Agent v2 执行接线',
      dependsOn: [],
      idempotent: true,
      attemptCount: 1,
      maxAttempts: 1,
      inputSnapshot: { executorType: 'AGENT', agentId: 'agent_v2_fixture', ...snapshot },
      status: 'PENDING' as const,
      createdAt: now,
      updatedAt: now,
      createdBy: 'agent-v2-test',
      version: 1,
    },
    runType: options.runType ?? 'apply',
    dryRun: options.dryRun ?? false,
  } as never;
}

function v2RequestSnapshot(materials: ReturnType<typeof v2Materials>): Record<string, unknown> {
  return {
    actionSchemaVersion: '1.0',
    pluginBindingId: 'binding_v2_fixture',
    pluginRuntimeCapability: { pluginVersionId: 'plugin-version-v2-fixture' },
    resolvedDeploymentInput: resolvedDeploymentInput(),
    plan: materials.plan,
    token: materials.token,
    policyDecision: materials.policyDecision,
  };
}

function v2Materials(actionType: 'agent.plan.validate' | 'agent.plan.execute' = 'agent.plan.execute') {
  const plan = {
    planVersion: 'gcac.agent-security/v1',
    planId: 'plan_v2_fixture',
    agentId: 'agent_v2_fixture',
    tenantId: 'tenant_v2_fixture',
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-v2-fixture',
    capability: 'certificate.deploy',
    operations: [],
    planDigest: 'a'.repeat(64),
    tokenId: 'token_v2_fixture',
    policyDecisionId: 'decision_v2_fixture',
    nonce: 'nonce_v2_fixture',
    expiresAt: now,
    writeEffect: true,
  };
  const token = {
    tokenVersion: 'gcac.agent-security/v1',
    tokenId: 'token_v2_fixture',
    agentId: 'agent_v2_fixture',
    tenantId: 'tenant_v2_fixture',
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-v2-fixture',
    capability: 'certificate.deploy',
    actions: [actionType],
    allowedPaths: ['/etc/nginx'],
    allowedServices: ['nginx'],
    artifactDigests: ['b'.repeat(64)],
    policyRef: 'policy_v2_fixture',
    policyVersion: '1',
    issuedAt: now,
    expiresAt: now,
    nonce: 'nonce_v2_fixture',
    planDigest: 'a'.repeat(64),
    authorityKeyId: 'authority-key-v2-fixture',
    signature: 'token-signature-v2-fixture',
  };
  const policyDecision = {
    decisionVersion: 'gcac.agent-security/v1',
    decisionId: 'decision_v2_fixture',
    allowed: true,
    agentId: 'agent_v2_fixture',
    tenantId: 'tenant_v2_fixture',
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-v2-fixture',
    capability: 'certificate.deploy',
    actions: [actionType],
    allowedPaths: ['/etc/nginx'],
    allowedServices: ['nginx'],
    artifactDigests: ['b'.repeat(64)],
    policyRef: 'policy_v2_fixture',
    policyVersion: '1',
    planDigest: 'a'.repeat(64),
    tokenId: 'token_v2_fixture',
    nonce: 'nonce_v2_fixture',
    issuedAt: now,
    validUntil: now,
    authorityKeyId: 'authority-key-v2-fixture',
    revocationRef: 'revocation-v2-fixture',
    signature: 'policy-signature-v2-fixture',
  };
  return { plan, token, policyDecision };
}

function resolvedDeploymentInput(): Record<string, unknown> {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_v2_fixture', address: 'fixture.example.com', serverName: 'fixture.example.com', port: 443, protocol: 'HTTPS' },
      host: { id: 'host_v2_fixture', osType: 'LINUX' },
      target: { id: 'target_v2_fixture', type: 'tls.binding', key: 'fixture', metadata: {} },
      deployment: { targets: [], certificateResourceName: 'certificate-v2-fixture' },
    },
    variables: {},
    connections: {},
    credentials: {},
    artifacts: {},
    provenance: {},
    sensitivePaths: [],
    issues: [],
    executable: true,
    resolvedSha256: 'c'.repeat(64),
  };
}
