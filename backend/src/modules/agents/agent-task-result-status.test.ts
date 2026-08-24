import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentsApplicationService } from './application/agents.application-service.js';
import type { AgentRegistration, AgentTaskEnvelope } from './schema/agents.schema.js';
import { computeAgentExecutionReceiptDigest, computeAgentPlanDigest, type AgentExecutionReceiptV1, type AgentPlanV1 } from './security/agent-security.contract.js';

const now = '2026-08-09T00:00:00.000Z';

function fullAgentRegistration(task: AgentTaskEnvelope): AgentRegistration {
  return {
    id: task.agentId,
    tenantId: task.tenantId,
    agentKey: task.agentId,
    descriptor: {
      agentKey: task.agentId,
      hostname: 'result-status-agent',
      version: '1.0.0',
      osType: 'LINUX',
      labels: [],
    },
    role: 'full_agent',
    status: 'ONLINE',
    registeredAt: now,
    updatedAt: now,
    version: 1,
  };
}

test('Agent 任务结果拒绝 success 与 UNKNOWN 矛盾的提交', async () => {
  const task = createTask();
  let updateCount = 0;
  const repository = {
    getRegistration: async () => fullAgentRegistration(task),
    getTask: async () => task,
    updateTask: async () => {
      updateCount += 1;
      return task;
    },
  };
  const service = new AgentsApplicationService(repository as never);

  await assert.rejects(
    service.submitResult('tenant-result-status', {
      agentId: task.agentId,
      taskId: task.id,
      leaseId: task.leaseId!,
      success: true,
      status: 'UNKNOWN',
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'VALIDATION_FAILED',
  );
  assert.equal(updateCount, 0);
});

test('Agent 任务写操作结果 UNKNOWN 会保留不明状态', async () => {
  const task = createTask();
  let updated: AgentTaskEnvelope | undefined;
  const repository = {
    getRegistration: async () => fullAgentRegistration(task),
    getTask: async () => updated ?? task,
    updateTask: async (_taskId: string, patch: Partial<AgentTaskEnvelope>) => {
      updated = { ...task, ...patch };
      return updated;
    },
  };
  const service = new AgentsApplicationService(repository as never);

  await service.submitResult('tenant-result-status', {
    agentId: task.agentId,
    taskId: task.id,
    leaseId: task.leaseId!,
    success: false,
    status: 'UNKNOWN',
    errorCode: 'AGENT_CONNECTION_LOST',
    detail: { receipt: createReceipt(task, 'UNKNOWN') },
  });

  assert.equal(updated?.status, 'failed');
  assert.equal(updated?.result?.status, 'UNKNOWN');
  assert.equal(updated?.result?.success, false);
});

test('Agent v2 计划尚未进入执行器时允许无 Receipt 的确定性失败', async () => {
  const task = createTask();
  let updated: AgentTaskEnvelope | undefined;
  const repository = {
    getRegistration: async () => fullAgentRegistration(task),
    getTask: async () => updated ?? task,
    updateTask: async (_taskId: string, patch: Partial<AgentTaskEnvelope>) => {
      updated = { ...task, ...patch };
      return updated;
    },
  };
  const service = new AgentsApplicationService(repository as never);

  await service.submitResult('tenant-result-status', {
    agentId: task.agentId,
    taskId: task.id,
    leaseId: task.leaseId!,
    success: false,
    errorCode: 'AGENT_V2_AUTHORIZATION_DENIED',
    errorMessage: 'Agent v2 队列载荷校验失败',
  });

  assert.equal(updated?.status, 'failed');
  assert.equal(updated?.result?.success, false);
  assert.equal(updated?.result?.status, 'FAILED');
});

test('Agent v2 队列拒绝摘要被篡改的 Receipt，不能把伪造结果写入任务', async () => {
  const task = createTask();
  let updateCount = 0;
  const repository = {
    getRegistration: async () => fullAgentRegistration(task),
    getTask: async () => task,
    updateTask: async () => {
      updateCount += 1;
      return task;
    },
  };
  const service = new AgentsApplicationService(repository as never);
  const receipt = createReceipt(task, 'SUCCESS');
  receipt.digest = 'a'.repeat(64);

  await assert.rejects(
    service.submitResult('tenant-result-status', {
      agentId: task.agentId,
      taskId: task.id,
      leaseId: task.leaseId!,
      success: true,
      status: 'SUCCESS',
      detail: { receipt },
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'VALIDATION_FAILED',
  );
  assert.equal(updateCount, 0);
});

test('UNKNOWN 终态拒绝迟到成功 Receipt，不能改写未知写操作', async () => {
  const task = createTask();
  task.status = 'failed';
  task.result = {
    success: false,
    status: 'UNKNOWN',
    detail: { receipt: createReceipt(task, 'UNKNOWN') },
  };
  const repository = { getRegistration: async () => fullAgentRegistration(task), getTask: async () => task };
  const service = new AgentsApplicationService(repository as never);

  await assert.rejects(
    service.submitResult('tenant-result-status', {
      agentId: task.agentId,
      taskId: task.id,
      leaseId: task.leaseId!,
      success: true,
      status: 'SUCCESS',
      detail: { receipt: createReceipt(task, 'SUCCESS') },
    }),
    (error: unknown) => (error as { errorCode?: string }).errorCode === 'RESOURCE_VERSION_CONFLICT'
      && (error as { details?: { reason?: string } }).details?.reason === 'AGENT_V2_LATE_RECEIPT_REJECTED',
  );
});

function createTask(): AgentTaskEnvelope {
  const plan = createPlan();
  return {
    id: 'task-result-status',
    tenantId: 'tenant-result-status',
    agentId: 'agent-result-status',
    executionRunId: 'run-result-status',
    executionStepId: 'step-result-status',
    idempotencyKey: 'idem-result-status',
    payload: {
      actionType: 'agent.plan.execute',
      plan,
      token: {
        tokenVersion: 'gcac.agent-security/v1',
        tokenId: plan.tokenId,
        agentId: plan.agentId,
        tenantId: plan.tenantId,
        pluginId: plan.pluginId,
        pluginVersionId: plan.pluginVersionId,
        capability: plan.capability,
        actions: ['filesystem.atomic_replace'],
        allowedPaths: ['/var/lib/gcac'],
        allowedServices: [],
        artifactDigests: [],
        policyRef: 'policy-result-status',
        policyVersion: 'v1',
        issuedAt: '2026-08-08T23:55:00.000Z',
        expiresAt: '2026-08-09T00:10:00.000Z',
        nonce: plan.nonce,
        planDigest: plan.planDigest,
        authorityKeyId: 'authority-result-status',
        signature: 'test-signature',
      },
      policyDecision: {
        decisionVersion: 'gcac.agent-security/v1',
        decisionId: plan.policyDecisionId,
        allowed: true,
        agentId: plan.agentId,
        tenantId: plan.tenantId,
        pluginId: plan.pluginId,
        pluginVersionId: plan.pluginVersionId,
        capability: plan.capability,
        actions: ['filesystem.atomic_replace'],
        allowedPaths: ['/var/lib/gcac'],
        allowedServices: [],
        artifactDigests: [],
        policyRef: 'policy-result-status',
        policyVersion: 'v1',
        planDigest: plan.planDigest,
        tokenId: plan.tokenId,
        nonce: plan.nonce,
        issuedAt: '2026-08-08T23:55:00.000Z',
        validUntil: '2026-08-09T00:10:00.000Z',
        authorityKeyId: 'authority-result-status',
        revocationRef: 'revocation-result-status',
        signature: 'test-signature',
      },
    },
    status: 'acked',
    leaseId: 'lease-result-status',
    ackedAt: now,
    createdAt: now,
    updatedAt: now,
    requestId: 'request_result_status',
  };
}

function createPlan(): AgentPlanV1 {
  const plan: AgentPlanV1 = {
    planVersion: 'gcac.agent-security/v1',
    planId: 'plan-result-status',
    agentId: 'agent-result-status',
    tenantId: 'tenant-result-status',
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-result-status',
    capability: 'filesystem.atomic_replace',
    operations: [{
      operationId: 'operation-result-status',
      operationType: 'filesystem.atomic_replace',
      stage: 'execute',
      input: { path: '/var/lib/gcac/config.json' },
      dependsOn: [],
      idempotencyKey: 'operation-result-status',
      timeoutSeconds: 30,
    }],
    planDigest: '',
    tokenId: 'token-result-status',
    policyDecisionId: 'decision-result-status',
    nonce: 'nonce-result-status',
    expiresAt: '2026-08-09T00:10:00.000Z',
    writeEffect: true,
  };
  return { ...plan, planDigest: computeAgentPlanDigest(plan) };
}

function createReceipt(task: AgentTaskEnvelope, status: AgentExecutionReceiptV1['status']): AgentExecutionReceiptV1 {
  const plan = task.payload.plan as AgentPlanV1;
  const receipt: AgentExecutionReceiptV1 = {
    receiptVersion: 'gcac.agent-security/v1',
    operationId: plan.operations[0]!.operationId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    agentId: task.agentId,
    tenantId: task.tenantId,
    tokenId: plan.tokenId,
    status,
    startedAt: '2026-08-09T00:00:00.000Z',
    completedAt: '2026-08-09T00:00:01.000Z',
    operationResults: [{ status: status.toLowerCase() }],
    nonceConsumed: true,
    ...(status === 'UNKNOWN' ? { unknownReason: '连接在写操作后中断' } : {}),
    digest: '',
  };
  return { ...receipt, digest: computeAgentExecutionReceiptDigest(receipt) };
}
