// @ts-nocheck
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DeploymentPlansRepository } from '../deployment-plans/repository/deployment-plans.repository.js';
import { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { PgAgentsRepository } from '../agents/repository/agents.repository.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { ExecutionsApplicationService } from './application/executions.application-service.js';
import { ExecutionDetailStreamService } from './application/execution-detail-stream.service.js';
import { ExecutionResultSyncService } from './application/execution-result-sync.service.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from './application/executors.js';
import { createDefaultExecutorRegistry, ExecutorRegistry, GatewayRouteExecutorAdapter, WorkflowExecutorAdapter } from './application/executors.js';
import { ExecutionsRepository } from './repository/executions.repository.js';
import { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import { testDeploymentInputSnapshotsRepository, testTaskEnqueuer, withTestAgentV2ExecutionAuthorization, withTestDeploymentInputSnapshot } from './deployment-input-runtime-snapshot.test-fixture.js';
import { computeAgentExecutionReceiptDigest, computeAgentPlanDigest, type AgentCapabilityTokenV1, type AgentExecutionReceiptV1, type AgentPlanV1, type PolicyAuthorityDecisionV1 } from '../agents/security/agent-security.contract.js';
import { createDurableGatewayTaskRepositories } from '../gateway-agents/gateway-task.repository.js';
import { GatewayTaskService } from '../gateway-agents/gateway-task.service.js';

function createService(dependencies: Record<string, unknown> = {}) {
  return new ExecutionsApplicationService({
    deploymentPlansRepository: new DeploymentPlansRepository(),
    deploymentInputSnapshots: testDeploymentInputSnapshotsRepository as any,
    stageIntervalMs: 0,
    tasks: testTaskEnqueuer(),
    executionGrants: { create: async () => ({ id: 'execution-grant-scheduler-fixture' }) },
    ...dependencies,
  });
}

async function createRun(service: ExecutionsApplicationService, input: {
  idempotencyKey: string;
  targetIds?: string[];
  concurrencyLimit?: number;
  stepMaxAttempts?: number;
  failurePolicy?: 'stop' | 'continue' | 'rollback';
  retry?: { maxAttempts: number; backoffSeconds: number };
  executorType?: string;
  allowMockExecutor?: boolean;
  mockResults?: Map<string, 'success' | 'fail'>;
  agentPayloads?: Map<string, Record<string, unknown>>;
  gatewayRoutes?: Map<string, Record<string, unknown>>;
}) {
  const targetIds = input.targetIds ?? ['target_a', 'target_b'];
  const agentPayloads = new Map(targetIds.map((targetId) => [
    targetId,
    withTestDeploymentInputSnapshot('plan_1', targetId, input.agentPayloads?.get(targetId)),
  ]));
  return service.createApplyRun({
    deploymentPlanId: 'plan_1',
    deploymentPlanTargetIds: targetIds,
    type: 'apply',
    idempotencyKey: input.idempotencyKey,
    actorId: 'tester',
    tenantId: 'tenant_1',
    executorTypeByTargetId: new Map(targetIds.map((targetId) => [targetId, input.executorType ?? 'AGENT'] as const)),
    mockResultByTargetId: input.mockResults,
    concurrencyLimit: input.concurrencyLimit,
    stepMaxAttempts: input.stepMaxAttempts,
    failurePolicy: input.failurePolicy,
    retry: input.retry,
    allowMockExecutor: input.allowMockExecutor,
    agentPayloadByTargetId: agentPayloads,
    gatewayRouteByTargetId: input.gatewayRoutes,
  });
}

describe('统一任务控制面', () => {
  it('Dry-run 和部署运行创建后立即入列，并使用 runId 关联执行运行', async () => {
    const previous = process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
    process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = 'true';
    const queued: Array<Record<string, unknown>> = [];
    const service = createService({
      tasks: {
        async enqueue(input: Record<string, unknown>) {
          queued.push(input);
          return { id: `task-${queued.length}` };
        },
      },
    });

    try {
      const deployed = await createRun(service, {
        idempotencyKey: 'unified-task-deploy',
        targetIds: ['target_deploy'],
      });
      const dryRun = await service.createDryRun({
        deploymentPlanId: 'plan_1',
        deploymentPlanTargetIds: ['target_dry_run'],
        type: 'dry_run',
        idempotencyKey: 'unified-task-dry-run',
        actorId: 'tester',
        tenantId: 'tenant_1',
        executorTypeByTargetId: new Map([['target_dry_run', 'AGENT']]),
        agentPayloadByTargetId: new Map([
          ['target_dry_run', withTestDeploymentInputSnapshot('plan_1', 'target_dry_run')],
        ]),
      });

      assert.equal(deployed.jobId, 'task-1');
      assert.equal(deployed.run.externalRunId, 'task-1');
      assert.equal(dryRun.jobId, 'task-2');
      assert.equal(dryRun.run.externalRunId, 'task-2');
      assert.deepEqual(queued.map((task) => task.taskType), ['CERTIFICATE_DEPLOY', 'CERTIFICATE_DRY_RUN']);
      assert.equal((queued[0]?.payload as Record<string, unknown>).runId, deployed.run.id);
      assert.equal((queued[1]?.payload as Record<string, unknown>).runId, dryRun.run.id);
      assert.equal('executionRunId' in ((queued[1]?.payload as Record<string, unknown>) ?? {}), false);
    } finally {
      if (previous === undefined) delete process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED;
      else process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED = previous;
    }
  });
});

describe('Agent v2 证书计划阶段边界', () => {
  it('完整 Agent Plan 只在 INSTALL 阶段发送一次，避免 BACKUP/RELOAD 重复下发 Artifact', async () => {
    const service = createService();
    const targetId = 'target_monolithic_agent_plan';
    const payload = withTestAgentV2ExecutionAuthorization('plan_1', targetId, {
      pluginRuntimeCapability: { runtime: 'AGENT_V2', capabilityKey: 'certificate.deploy' },
      certificateVerification: {
        capabilityKey: 'certificate.verify',
        schemaVersion: '1.0',
        connectHost: '127.0.0.1',
        serverName: 'example.test',
        port: 443,
        expectedFingerprintSha256: 'b'.repeat(64),
      },
    });
    const created = await createRun(service, {
      idempotencyKey: 'idem_monolithic_agent_plan',
      targetIds: [targetId],
      executorType: 'AGENT',
      agentPayloads: new Map([[targetId, payload]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    assert.deepEqual(steps.map((step) => step.inputSnapshot.executorType), [
      'PLATFORM_STAGE',
      'PLATFORM_STAGE',
      'AGENT',
      'PLATFORM_STAGE',
      'CONTROL_PLANE_TLS',
    ]);

    const calls: string[] = [];
    const tracking = new TrackingExecutor(async (input) => {
      calls.push(`${input.step.stepType}:${input.step.inputSnapshot.executorType}`);
      return { success: true };
    });
    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(tracking));
    assert.equal(result.success, true);
    assert.deepEqual(calls, [
      'DISCOVER:PLATFORM_STAGE',
      'BACKUP:PLATFORM_STAGE',
      'INSTALL:AGENT',
      'RELOAD:PLATFORM_STAGE',
      'VERIFY:CONTROL_PLANE_TLS',
    ]);
  });
});

function resolvedGatewayDeploymentInput(): Record<string, unknown> {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_gateway_enqueue', address: 'gateway-fixture.example.com', serverName: 'gateway-fixture.example.com', port: 443, protocol: 'HTTPS' },
      host: { id: 'host_gateway_enqueue', osType: 'LINUX' },
      target: { id: 'target_gateway_enqueue', type: 'tls.binding', key: 'gateway-fixture', metadata: {} },
      deployment: { targets: [], certificateResourceName: 'certificate-gateway-fixture' },
    },
    variables: {},
    connections: {},
    credentials: {},
    artifacts: {},
    provenance: {},
    sensitivePaths: [],
    issues: [],
    executable: true,
    resolvedSha256: 'f'.repeat(64),
  };
}

class TrackingExecutor implements Executor {
  readonly timeline: string[] = [];
  private runningCount = 0;
  maxRunningCount = 0;

  constructor(private readonly handler: (input: StepExecutionInput) => Promise<StepExecutionResult>, readonly type = 'AGENT') {}

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    this.runningCount += 1;
    this.maxRunningCount = Math.max(this.maxRunningCount, this.runningCount);
    this.timeline.push(`start:${input.step.name}`);
    try {
      const result = await this.handler(input);
      this.timeline.push(`end:${input.step.name}:${result.success ? 'success' : result.errorCode ?? 'failed'}`);
      return result;
    } finally {
      this.runningCount -= 1;
    }
  }
}

function createTrackingRegistry(executor: TrackingExecutor): ExecutorRegistry {
  const alias = (type: string): Executor => ({
    type,
    executeStep: (input) => executor.executeStep(input),
  });
  return ExecutorRegistry.forTests([
    executor,
    alias('PLATFORM_STAGE'),
    alias('CONTROL_PLANE_TLS'),
  ]);
}

function requiredStringVariable() {
  return {
    type: 'string',
    required: true,
    configurationMode: 'required',
    source: { kind: 'binding' },
    lifecycle: 'pre_execution',
    bindingPolicy: 'required_binding',
  };
}

function workflowInputContract(options: { credential?: boolean } = {}) {
  const requiredField = (type: 'string' | 'number') => ({
    type,
    required: true,
    configurationMode: 'required',
    source: { kind: 'binding' },
    lifecycle: 'pre_execution',
    bindingPolicy: 'required_binding',
  });
  return {
    apiVersion: 'gcac.deployment-input/v1',
    variables: { deviceHost: requiredStringVariable() },
    connections: options.credential
      ? {
          management: { transport: 'http', host: requiredField('string'), port: requiredField('number') },
          targetSsh: {
            transport: 'ssh',
            host: requiredField('string'),
            port: requiredField('number'),
            username: requiredField('string'),
            credentialSlot: 'credential',
            hostKey: { policy: 'strict' },
          },
        }
      : {},
    credentials: options.credential
      ? {
          credential: {
            allowedKinds: ['USERNAME_PASSWORD', 'SSH_KEY'],
            required: true,
            configurationMode: 'required',
            lifecycle: 'pre_execution',
          },
        }
      : {},
    artifacts: {},
  };
}

function resolvedWorkflowInput() {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_runtime', address: 'edge-runtime.example.com', serverName: 'edge-runtime.example.com', port: 443, protocol: 'https' },
      deployment: { targets: [], certificateResourceName: 'certificate-runtime' },
    },
    variables: { deviceHost: 'edge-runtime.example.com' },
    connections: {
      management: { transport: 'http', host: 'edge-runtime.example.com', port: 443, tls: { verifyPeer: true } },
      targetSsh: {
        transport: 'ssh',
        host: 'edge-runtime.example.com',
        port: 22,
        username: 'deploy',
        credentialSlot: 'credential',
        hostKey: { policy: 'strict', expectedFingerprint: 'aabbccddeeff0011' },
      },
    },
    credentials: {
      credential: {
        credentialId: 'cred_runtime',
        kind: 'USERNAME_PASSWORD',
        username: 'deploy',
        secretRefs: { password: 'secret://password/cred_runtime#current' },
      },
    },
    artifacts: {},
    provenance: {},
    sensitivePaths: ['credentials.credential'],
    issues: [],
    executable: true,
    resolvedSha256: 'runtime-dispatch-resolved-input',
  };
}

describe('ExecutionsApplicationService 调度与恢复', () => {
  it('执行器进度会先持久化到运行中步骤，再通过 SSE 逐次发布', async () => {
    const detailStream = new ExecutionDetailStreamService();
    const service = createService({
      detailStream,
    });
    const created = await createRun(service, {
      idempotencyKey: 'idem_realtime_progress',
      targetIds: ['target_realtime'],
      concurrencyLimit: 1,
    });
    const stepEvents: Array<{ status: string; inputSnapshot: Record<string, unknown> }> = [];
    const unsubscribe = detailStream.subscribe(created.run.id, (event) => {
      if (event.type === 'step') {
        stepEvents.push({
          status: event.step.status,
          inputSnapshot: structuredClone(event.step.inputSnapshot),
        });
      }
    });
    let checkedPersistedProgress = false;
    const executor = new TrackingExecutor(async (input) => {
      if (!checkedPersistedProgress) {
        await input.reportProgress?.({
          workflowProgress: {
            status: 'running',
            totalSteps: 2,
            completedSteps: 0,
            steps: [
              { name: 'login', status: 'running' },
              { name: 'install', status: 'queued' },
            ],
          },
        });
        const persisted = await service.getStep(input.step.id, 'tenant_1');
        assert.equal(persisted.status, 'RUNNING');
        assert.equal(persisted.inputSnapshot.resultDetail.workflowProgress.steps[0].status, 'running');
        checkedPersistedProgress = true;
      }
      return { success: true, detail: { completed: true } };
    });

    try {
      const result = await service.runDispatchedExecution(
        created.run.id,
        'tester',
        'tenant_1',
        createTrackingRegistry(executor),
      );
      assert.equal(result.success, true, JSON.stringify(result));
    } finally {
      unsubscribe();
    }

    assert.equal(checkedPersistedProgress, true);
    const progressEventIndex = stepEvents.findIndex((event) => {
      const resultDetail = event.inputSnapshot.resultDetail as Record<string, unknown> | undefined;
      return resultDetail?.workflowProgress !== undefined;
    });
    const successEventIndex = stepEvents.findIndex((event) => event.status === 'SUCCESS');
    assert.notEqual(progressEventIndex, -1);
    assert.notEqual(successEventIndex, -1);
    assert.equal(progressEventIndex < successEventIndex, true);
  });

  // 历史 GatewayTask fixture 仅保留作迁移参考，不再作为可执行测试路径。
  it.skip('历史 GatewayTask 路径已停用：不再通过 Agent v2 控制面队列下发路由任务', async () => {
    let capturedPayload: Record<string, unknown> | undefined;
    const agents = {
      enqueueTask: async (_tenantId: string, input: { payload?: Record<string, unknown> }) => {
        capturedPayload = input.payload;
        return { id: 'agtask_gateway_queued', status: 'queued' };
      },
    } as unknown as AgentsApplicationService;
    const planBase = {
      planVersion: 'gcac.agent-security/v1' as const,
      planId: 'plan_gateway_enqueue',
      agentId: 'host_gateway_enqueue',
      tenantId: 'tenant_1',
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-gateway-fixture',
      capability: 'filesystem.atomic_replace',
      operations: [{
        operationId: 'operation-gateway-enqueue',
        operationType: 'filesystem.atomic_replace' as const,
        stage: 'execute' as const,
        input: { path: '/var/lib/gcac/config.json' },
        dependsOn: [],
        idempotencyKey: 'idem-operation-gateway-enqueue',
        timeoutSeconds: 30,
      }],
      planDigest: '',
      tokenId: 'token-gateway-fixture',
      policyDecisionId: 'decision-gateway-fixture',
      nonce: 'nonce-gateway-fixture',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      writeEffect: true,
    } satisfies AgentPlanV1;
    const plan = { ...planBase, planDigest: computeAgentPlanDigest(planBase) };
    const token = {
      tokenVersion: 'gcac.agent-security/v1' as const,
      tokenId: 'token-gateway-fixture',
      agentId: 'host_gateway_enqueue',
      tenantId: 'tenant_1',
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-gateway-fixture',
      capability: 'filesystem.atomic_replace',
      actions: ['filesystem.atomic_replace'],
      allowedPaths: ['/var/lib/gcac'],
      allowedServices: [],
      artifactDigests: [],
      policyRef: 'policy-gateway-fixture',
      policyVersion: '1',
      issuedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: plan.expiresAt,
      nonce: plan.nonce,
      planDigest: plan.planDigest,
      authorityKeyId: 'authority-gateway-fixture',
      signature: 'signature-gateway-fixture',
    } satisfies AgentCapabilityTokenV1;
    const policyDecision = {
      decisionVersion: 'gcac.agent-security/v1' as const,
      decisionId: plan.policyDecisionId,
      allowed: true,
      agentId: token.agentId,
      tenantId: token.tenantId,
      pluginId: token.pluginId,
      pluginVersionId: token.pluginVersionId,
      capability: token.capability,
      actions: token.actions,
      allowedPaths: token.allowedPaths,
      allowedServices: token.allowedServices,
      artifactDigests: token.artifactDigests,
      policyRef: token.policyRef,
      policyVersion: token.policyVersion,
      planDigest: plan.planDigest,
      tokenId: token.tokenId,
      nonce: token.nonce,
      issuedAt: token.issuedAt,
      validUntil: token.expiresAt,
      authorityKeyId: token.authorityKeyId,
      revocationRef: 'revocation-gateway-fixture',
      signature: 'decision-signature-gateway-fixture',
    } satisfies PolicyAuthorityDecisionV1;
    const compiler = {
      compile: async () => ({
        actionType: 'agent.plan.execute' as const,
        actionSchemaVersion: '1.0' as const,
        plan,
        token,
        policyDecision,
      }),
    };
    const gatewayDb = new PgliteDatabase();
    try {
      await runMigrations(gatewayDb);
      const gatewayTasks = new GatewayTaskService({ repositories: await createDurableGatewayTaskRepositories(gatewayDb) });
      const executor = new GatewayRouteExecutorAdapter({ agents, gatewayTasks, agentPlanCompiler: compiler as never });
      const result = await executor.executeStep({
      runType: 'apply',
      dryRun: false,
      step: {
        id: 'step_gateway_enqueue',
        tenantId: 'tenant_1',
        executionRunId: 'run_gateway_enqueue',
        deploymentPlanTargetId: 'target_gateway_enqueue',
        stepType: 'INSTALL',
        attemptCount: 0,
        inputSnapshot: {
          deploymentPlanId: 'plan_gateway_enqueue',
          actionType: 'agent.plan.execute',
          pluginId: 'web.nginx',
          pluginVersion: '1.0.0',
          pluginVersionId: 'plugin-version-gateway-fixture',
          capability: 'web.nginx.deploy',
          packageSha256: `sha256:${'a'.repeat(64)}`,
          manifestSha256: `sha256:${'b'.repeat(64)}`,
          resourceHash: `sha256:${'c'.repeat(64)}`,
          pluginRuntimeCapability: { pluginBindingId: 'binding-gateway-fixture', pluginVersionId: plan.pluginVersionId },
          resolvedDeploymentInput: resolvedGatewayDeploymentInput(),
          plan,
          executionAuthorization: {
            grantId: 'execution-grant-gateway-fixture',
            policyRef: token.policyRef,
            policyVersion: token.policyVersion,
            actions: token.actions,
            allowedPaths: token.allowedPaths,
            allowedServices: token.allowedServices,
            artifactDigests: token.artifactDigests,
            lifetimeSeconds: 300,
          },
          gatewayRoute: {
            gatewayId: 'gw_exec_01',
            agentId: 'agt_gateway_exec_01',
            zoneId: 'zone_prod',
            adapter: 'forward.agent_task',
            delegatedTargetId: 'host_gateway_enqueue',
          },
        },
      } as any,
    });

      assert.equal(result.success, true);
      assert.equal(result.detail?.mode, 'gateway_v2_control_plane_queue');
      assert.equal(capturedPayload?.actionType, 'agent.plan.execute');
      assert.equal((capturedPayload?.token as { tokenId?: string } | undefined)?.tokenId, 'token-gateway-fixture');
      assert.equal((capturedPayload?.policyDecision as { decisionId?: string } | undefined)?.decisionId, 'decision-gateway-fixture');
      assert.equal((capturedPayload?.plan as { planId?: string } | undefined)?.planId, 'plan_gateway_enqueue');
      assert.equal(capturedPayload?.type, undefined);
      const gatewayTask = capturedPayload?.gatewayTask as { delegatedTargetId: string; forwardingGrant?: { status: string; taskType: string } };
      assert.equal(gatewayTask.delegatedTargetId, 'host_gateway_enqueue');
      assert.equal(gatewayTask.forwardingGrant?.status, 'active');
      assert.equal(gatewayTask.forwardingGrant?.taskType, 'gateway.forward.agent_task');
    } finally {
      await gatewayDb.close();
    }
  });

  it.skip('历史 Gateway Agent 结果回写路径已停用', async () => {
    const db = new PgliteDatabase();
    try {
      await runMigrations(db);
      const repository = new ExecutionsRepository(db);
      const resultSync = new ExecutionResultSyncService(repository, {} as any, {} as any);
      const agents = new AgentsApplicationService(new PgAgentsRepository(db), undefined, undefined, undefined, undefined, resultSync);
      const now = new Date().toISOString();
      const run = await repository.createRun({
        id: 'run_gateway_result_sync',
        tenantId: 'tenant_gateway_result_sync',
        deploymentPlanId: 'plan_gateway_result_sync',
        runNo: 1,
        type: 'apply',
        idempotencyKey: 'idem_gateway_result_sync',
        requestHash: 'hash_gateway_result_sync',
        status: 'RUNNING',
        concurrencyLimit: 1,
        summary: {},
        createdAt: now,
        updatedAt: now,
        createdBy: 'tester',
        version: 1,
      });
      const step = await repository.createStep({
        id: 'step_gateway_result_sync',
        tenantId: run.tenantId,
        executionRunId: run.id,
        deploymentPlanTargetId: 'target_gateway_result_sync',
        stepNo: 1,
        stepType: 'INSTALL',
        name: 'Gateway routed install',
        dependsOn: [],
        idempotent: true,
        attemptCount: 1,
        maxAttempts: 1,
        inputSnapshot: { executorType: 'GATEWAY_FORWARD' },
        status: 'RUNNING',
        createdAt: now,
        updatedAt: now,
        createdBy: 'tester',
        version: 1,
      });
      const gateway = await agents.register(run.tenantId, {
        agentKey: 'gateway.result.sync.01',
        hostname: 'gateway-result-sync-01',
        version: '1.0.0',
        osType: 'linux',
        role: 'gateway',
        zoneIds: ['zone_prod'],
        adapters: ['forward.agent_task'],
        capabilities: ['gateway.forward.agent_task'],
      }, 'req_gateway_result_sync_register');
      const expiresAt = new Date(Date.now() + 300_000).toISOString();
      const planBase = {
        planVersion: 'gcac.agent-security/v1' as const,
        planId: 'plan_gateway_result_sync',
        agentId: gateway.id,
        tenantId: run.tenantId,
        pluginId: 'web.nginx',
        pluginVersionId: 'plugin-version-gateway-result-sync',
        capability: 'filesystem.atomic_replace',
        operations: [{
          operationId: 'operation-gateway-result-sync',
          operationType: 'filesystem.atomic_replace' as const,
          stage: 'execute' as const,
          input: { path: '/var/lib/gcac/config.json' },
          dependsOn: [],
          idempotencyKey: 'idem-operation-gateway-result-sync',
          timeoutSeconds: 30,
        }],
        planDigest: '',
        tokenId: 'token-gateway-result-sync',
        policyDecisionId: 'decision-gateway-result-sync',
        nonce: 'nonce-gateway-result-sync',
        expiresAt,
        writeEffect: true,
      } satisfies AgentPlanV1;
      const plan = { ...planBase, planDigest: computeAgentPlanDigest(planBase) };
      const token = {
        tokenVersion: 'gcac.agent-security/v1' as const,
        tokenId: plan.tokenId,
        agentId: gateway.id,
        tenantId: run.tenantId,
        pluginId: plan.pluginId,
        pluginVersionId: plan.pluginVersionId,
        capability: plan.capability,
        actions: [plan.capability],
        allowedPaths: ['/var/lib/gcac'],
        allowedServices: [],
        artifactDigests: [],
        policyRef: 'policy-gateway-result-sync',
        policyVersion: '1',
        issuedAt: new Date(Date.now() - 1_000).toISOString(),
        expiresAt,
        nonce: plan.nonce,
        planDigest: plan.planDigest,
        authorityKeyId: 'authority-gateway-result-sync',
        signature: 'token-signature-gateway-result-sync',
      } satisfies AgentCapabilityTokenV1;
      const policyDecision = {
        decisionVersion: 'gcac.agent-security/v1' as const,
        decisionId: plan.policyDecisionId,
        allowed: true,
        agentId: token.agentId,
        tenantId: token.tenantId,
        pluginId: token.pluginId,
        pluginVersionId: token.pluginVersionId,
        capability: token.capability,
        actions: token.actions,
        allowedPaths: token.allowedPaths,
        allowedServices: token.allowedServices,
        artifactDigests: token.artifactDigests,
        policyRef: token.policyRef,
        policyVersion: token.policyVersion,
        planDigest: plan.planDigest,
        tokenId: token.tokenId,
        nonce: token.nonce,
        issuedAt: token.issuedAt,
        validUntil: token.expiresAt,
        authorityKeyId: token.authorityKeyId,
        revocationRef: 'revocation-gateway-result-sync',
        signature: 'decision-signature-gateway-result-sync',
      } satisfies PolicyAuthorityDecisionV1;
      const receiptBase = {
        receiptVersion: 'gcac.agent-security/v1' as const,
        operationId: plan.operations[0]!.operationId,
        planId: plan.planId,
        planDigest: plan.planDigest,
        agentId: gateway.id,
        tenantId: run.tenantId,
        tokenId: token.tokenId,
        status: 'SUCCESS' as const,
        startedAt: new Date(Date.now() - 500).toISOString(),
        completedAt: new Date().toISOString(),
        operationResults: [{ status: 'success' }],
        nonceConsumed: true,
        digest: '',
      } satisfies AgentExecutionReceiptV1;
      const receipt = { ...receiptBase, digest: computeAgentExecutionReceiptDigest(receiptBase) };
      const task = await agents.enqueueTask(run.tenantId, {
        agentId: gateway.id,
        executionRunId: run.id,
        executionStepId: step.id,
        idempotencyKey: 'gateway-result-sync-task',
        payload: {
          actionType: 'agent.plan.execute',
          actionSchemaVersion: '1.0',
          gatewayTaskId: 'gateway_task_result_sync',
          token,
          policyDecision,
          plan,
        },
      }, 'req_gateway_result_sync_enqueue');
      await agents.ackTask(run.tenantId, { agentId: gateway.id, taskId: task.id, leaseId: 'lease_gateway_result_sync' });
      await agents.submitResult(run.tenantId, {
        agentId: gateway.id,
        taskId: task.id,
        leaseId: 'lease_gateway_result_sync',
        success: true,
        detail: {
          mode: 'gateway_agent_process',
          gatewayTaskId: 'gateway_task_result_sync',
          delegatedTargetId: 'target_gateway_result_sync',
          receipt,
        },
      });

      const updatedStep = await repository.getStepOrThrow(step.id, run.tenantId);
      const updatedRun = await repository.getRunOrThrow(run.id, run.tenantId);
      assert.equal(updatedStep.status, 'SUCCESS');
      assert.equal(updatedRun.status, 'SUCCESS');
      assert.equal(updatedStep.inputSnapshot.resultDetail.gatewayTaskId, 'gateway_task_result_sync');
    } finally {
      await db.close();
    }
  });

  it.skip('历史 Gateway agentTaskId 结果账本路径已停用', async () => {
    let application: ExecutionsApplicationService | undefined;
    let lookedUpTaskId = '';
    const resultSync = {
      applyAgentTaskResult: async (input: { executionStepId: string; tenantId: string }) => {
        const step = await application!.getStep(input.executionStepId, input.tenantId);
        await application!.updateStepForTest(input.executionStepId, {
          status: 'SUCCESS',
          inputSnapshot: { ...step.inputSnapshot, resultDetail: { mode: 'gateway_agent_process', executionStatus: 'SUCCESS' } },
          finishedAt: new Date().toISOString(),
        }, input.tenantId);
      },
    };
    application = createService({
      agentTasks: {
        getTask: async (_tenantId: string, taskId: string) => {
          lookedUpTaskId = taskId;
          return {
            id: taskId,
            status: 'succeeded',
            result: { success: true, status: 'SUCCESS', detail: { mode: 'gateway_agent_process' } },
          };
        },
      },
      resultSync: resultSync as never,
    });
    const created = await createRun(application, {
      idempotencyKey: 'idem_gateway_agent_task_poll',
      targetIds: ['target_gateway_agent_task_poll'],
    });
    const steps = (await application.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id }))
      .sort((left, right) => left.stepNo - right.stepNo);
    const install = steps.find((step) => step.stepType === 'INSTALL');
    assert.ok(install);
    await application.updateRunForTest(created.run.id, { status: 'RUNNING' }, 'tenant_1');
    for (const step of steps) {
      if (step.id === install!.id) continue;
      await application.updateStepForTest(step.id, { status: 'SUCCESS', finishedAt: new Date().toISOString() }, 'tenant_1');
    }
    await application.updateStepForTest(install!.id, {
      status: 'RUNNING',
      inputSnapshot: {
        ...install!.inputSnapshot,
        executorType: 'GATEWAY_FORWARD',
        dispatchDetail: { mode: 'gateway_v2_control_plane_queue', agentTaskId: 'agent-task-gateway-poll' },
      },
    }, 'tenant_1');

    const result = await application.runDispatchedExecution(created.run.id, 'task-worker', 'tenant_1');

    assert.equal(result.success, true);
    assert.equal(lookedUpTaskId, 'agent-task-gateway-poll');
    assert.equal((await application.getStep(install!.id, 'tenant_1')).status, 'SUCCESS');
    assert.equal((await application.getRun(created.run.id, 'tenant_1')).status, 'SUCCESS');
  });

  it('WORKFLOW 执行目标生成统一五阶段，dry-run 可预览，apply 失败关闭', async () => {
    const service = createService();
    const workflows = new WorkflowTemplatesApplicationService();
    const workflow = await workflows.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'workflow-shell-dry-run' },
        inputContract: workflowInputContract(),
        steps: [{ name: 'wait', type: 'wait', seconds: 1 }],
      },
    });
    await workflows.publishVersion(workflow.version.id);
    const targetId = 'target_workflow_shell';
    const created = await service.createApplyRun({
      deploymentPlanId: 'plan_workflow_shell',
      deploymentPlanTargetIds: [targetId],
      type: 'dry_run',
      idempotencyKey: 'idem_workflow_shell_dry_run',
      actorId: 'tester',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'WORKFLOW']]),
      agentPayloadByTargetId: new Map([[targetId, withTestDeploymentInputSnapshot('plan_workflow_shell', targetId, {
        workflowRequest: {
          workflowId: workflow.template.id,
          workflowVersionId: workflow.version.id,
          runner: 'CONTROL_PLANE',
          variableBindings: { deviceHost: 'workflow-shell.example.com' },
          credentialRefs: { ssh: 'secret://ssh/workflow' },
        },
      })]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    const workflowStep = steps.find((step) => step.stepType === 'INSTALL');
    assert.ok(workflowStep);
    assert.equal(workflowStep.inputSnapshot.executorType, 'WORKFLOW');
    assert.equal(workflowStep.inputSnapshot.operation, 'install');

    const dryRunResult = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', new ExecutorRegistry([
      new WorkflowExecutorAdapter({ workflows }),
      { type: 'CONTROL_PLANE_TLS', executeStep: async () => ({ success: true }) },
    ]));
    assert.equal(dryRunResult.success, true);
    const dryRunStep = await service.getStep(workflowStep.id, 'tenant_1');
    assert.equal(dryRunStep.status, 'SUCCESS');
    assert.equal(dryRunStep.inputSnapshot.resultDetail.mode, 'workflow_plan');
    assert.equal(dryRunStep.inputSnapshot.resultDetail.workflowRequest.credentialRefs, undefined);
    assert.equal(JSON.stringify(dryRunStep.inputSnapshot.resultDetail).includes('secret://ssh/workflow'), false);
    assert.equal(dryRunStep.inputSnapshot.resultDetail.dryRunSummary.passed, 1);
    assert.equal(dryRunStep.inputSnapshot.resultDetail.dryRunChecks[0].key, 'workflow_step_1_wait');
    assert.equal(dryRunStep.inputSnapshot.resultDetail.dryRunChecks[0].status, 'passed');

    const apply = await service.createApplyRun({
      deploymentPlanId: 'plan_workflow_shell',
      deploymentPlanTargetIds: [targetId],
      type: 'apply',
      idempotencyKey: 'idem_workflow_shell_apply',
      actorId: 'tester',
      tenantId: 'tenant_1',
      executorTypeByTargetId: new Map([[targetId, 'WORKFLOW']]),
      agentPayloadByTargetId: new Map([[targetId, withTestDeploymentInputSnapshot('plan_workflow_shell', targetId, {
        workflowRequest: {
          workflowId: 'wf_1',
          workflowVersionId: 'wfv_1',
          runner: 'CONTROL_PLANE',
        },
      })]]),
    });
    const applyResult = await service.runDispatchedExecution(apply.run.id, 'tester', 'tenant_1', createDefaultExecutorRegistry());
    assert.equal(applyResult.success, false);
    const applyStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: apply.run.id }))
      .find((step) => step.stepType === 'INSTALL');
    assert.ok(applyStep);
    assert.equal(applyStep.lastErrorCode, 'RESOURCE_NOT_FOUND');
  });

  it('WORKFLOW apply 通过工作流运行时分发 HTTP 和 SSH 子步骤', async () => {
    const workflows = new WorkflowTemplatesApplicationService();
    const created = await workflows.createTemplate({
      content: {
        apiVersion: 'gcac.workflow/v1',
        kind: 'CurlSshWorkflow',
        metadata: { name: 'runtime-dispatch' },
        inputContract: workflowInputContract({ credential: true }),
        steps: [
          {
            name: 'upload',
            type: 'http',
            request: {
              method: 'PUT',
              connectionRef: 'management',
              url: 'https://{{variables.deviceHost}}/api/cert',
              body: { ok: true },
            },
            assert: [{ type: 'statusCode', equals: 200 }],
          },
          {
            name: 'reload',
            type: 'ssh',
            ssh: {
              connectionRef: 'targetSsh',
              program: 'systemctl',
              args: ['cert'],
              argumentTemplate: 'systemctl.reload',
            },
            assert: [{ type: 'contains', value: 'ok' }],
          },
          {
            name: 'verifyHttp',
            type: 'http',
            request: {
              method: 'GET',
              connectionRef: 'management',
              url: 'https://{{variables.deviceHost}}/api/cert/status',
            },
            assert: [{ type: 'statusCode', equals: 200 }],
          },
          {
            name: 'verifyReload',
            type: 'ssh',
            ssh: {
              connectionRef: 'targetSsh',
              program: 'systemctl',
              args: ['cert'],
              argumentTemplate: 'systemctl.restart',
            },
            assert: [{ type: 'contains', value: 'ok' }],
          },
        ],
      },
    });
    await workflows.publishVersion(created.version.id);
    const calls: string[] = [];
    const curlIdempotencyKeys: string[] = [];
    const sshIdempotencyKeys: string[] = [];
    const adapter = new WorkflowExecutorAdapter({
      workflows,
      curlExecutor: {
        type: 'CURL',
        async executeStep(input: StepExecutionInput) {
          calls.push(`curl:${input.step.inputSnapshot.curlRequest.template.method}`);
          curlIdempotencyKeys.push(input.step.inputSnapshot.curlRequest.idempotencyKey);
          return { success: true, detail: { response: { statusCode: 200, headers: {}, bodyJson: { success: true }, bodyText: '{"success":true}' }, logs: ['curl:ok'] } };
        },
      },
      sshExecutor: {
        type: 'SSH',
        async executeStep(input: StepExecutionInput) {
          const sshRequest = input.step.inputSnapshot.sshRequest as Record<string, unknown>;
          calls.push(`ssh:${sshRequest.argumentTemplate}:${(sshRequest.args as string[]).join(' ')}`);
          sshIdempotencyKeys.push(input.step.inputSnapshot.sshRequest.idempotencyKey);
          return { success: true, detail: { exitCode: 0, stdout: 'reload ok', logs: ['ssh:ok'] } };
        },
      },
    });

    const result = await adapter.executeStep({
      dryRun: false,
      runType: 'apply',
      step: {
        id: 'stp_workflow_runtime',
        tenantId: 'tenant_1',
        executionRunId: 'run_workflow_runtime',
        deploymentPlanTargetId: 'target_workflow_runtime',
        stepNo: 1,
        stepType: 'CUSTOM',
        name: 'workflow runtime',
        attemptCount: 0,
        maxAttempts: 1,
        inputSnapshot: {
          workflowRequest: {
            workflowId: created.template.id,
            workflowVersionId: created.version.id,
            runner: 'CONTROL_PLANE',
          },
          resolvedDeploymentInput: resolvedWorkflowInput(),
        },
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(calls, ['curl:PUT', 'ssh:systemctl.reload:cert', 'curl:GET', 'ssh:systemctl.restart:cert']);
    assert.equal(curlIdempotencyKeys.length, 2);
    assert.notEqual(curlIdempotencyKeys[0], curlIdempotencyKeys[1]);
    assert.match(curlIdempotencyKeys[0]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-curl:upload:1$/);
    assert.match(curlIdempotencyKeys[1]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-curl:verifyHttp:1$/);
    assert.equal(sshIdempotencyKeys.length, 2);
    assert.notEqual(sshIdempotencyKeys[0], sshIdempotencyKeys[1]);
    assert.match(sshIdempotencyKeys[0]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-ssh:reload:1$/);
    assert.match(sshIdempotencyKeys[1]!, /^run_workflow_runtime:stp_workflow_runtime:workflow-ssh:verifyReload:1$/);
    assert.equal(result.detail.workflowRun.status, 'success');
  });

  it('按 dependsOn 形成 DAG 调度，不满足依赖的步骤不会先跑', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_dag', targetIds: ['target_a', 'target_b'], concurrencyLimit: 2 });
    const steps = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id })).sort((left, right) => left.stepNo - right.stepNo);

    const stepByName = new Map(steps.map((step) => [step.name, step] as const));
    await service.updateStepForTest(stepByName.get('BACKUP target_b')!.id, { dependsOn: [stepByName.get('VERIFY target_a')!.stepNo] }, 'tenant_1');
    await service.updateStepForTest(stepByName.get('INSTALL target_b')!.id, { dependsOn: [stepByName.get('BACKUP target_b')!.stepNo] }, 'tenant_1');
    await service.updateStepForTest(stepByName.get('RELOAD target_b')!.id, { dependsOn: [stepByName.get('INSTALL target_b')!.stepNo] }, 'tenant_1');
    await service.updateStepForTest(stepByName.get('VERIFY target_b')!.id, { dependsOn: [stepByName.get('RELOAD target_b')!.stepNo] }, 'tenant_1');

    const executor = new TrackingExecutor(async () => ({ success: true }));
    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));

    assert.equal(result.success, true);
    const startEvents = executor.timeline.filter((item) => item.startsWith('start:'));
    const indexOf = (name: string) => startEvents.indexOf(`start:${name}`);
    assert.equal(indexOf('BACKUP target_b') > indexOf('VERIFY target_a'), true);
    assert.equal(indexOf('INSTALL target_b') > indexOf('BACKUP target_b'), true);
  });

  it('并发限制生效，同一时刻运行中的步骤不会超过窗口', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_concurrency', concurrencyLimit: 2 });
    const executor = new TrackingExecutor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { success: true };
    });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));

    assert.equal(result.success, true);
    assert.equal(executor.maxRunningCount, 2);
  });

  it('FailurePolicyEngine 会把 transient 失败自动重试，把 unsafe/timeout/cancelled 正确分类', async () => {
    const service = createService();
    const transientRun = await createRun(service, { idempotencyKey: 'idem_transient', targetIds: ['target_a'], stepMaxAttempts: 2 });
    const transientStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: transientRun.run.id })).sort((left, right) => left.stepNo - right.stepNo)[0];
    let transientCalls = 0;
    const transientExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== transientStep.id) return { success: true };
      transientCalls += 1;
      if (transientCalls === 1) return { success: false, errorCode: 'SSH_TEMP_ERROR', errorMessage: 'temporary network glitch' };
      return { success: true };
    });
    const transientResult = await service.runDispatchedExecution(transientRun.run.id, 'tester', 'tenant_1', createTrackingRegistry(transientExecutor));
    assert.equal(transientResult.success, true);
    assert.equal(transientCalls, 2);

    const unsafeRun = await createRun(service, { idempotencyKey: 'idem_unsafe', targetIds: ['target_b'], stepMaxAttempts: 3 });
    const unsafeStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: unsafeRun.run.id })).sort((left, right) => left.stepNo - right.stepNo)[0];
    const unsafeExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== unsafeStep.id) return { success: true };
      return { success: false, errorCode: 'UNSAFE_REMOTE_STATE', errorMessage: 'unsafe to retry' };
    });
    const unsafeResult = await service.runDispatchedExecution(unsafeRun.run.id, 'tester', 'tenant_1', createTrackingRegistry(unsafeExecutor));
    const unsafeStored = await service.getStep(unsafeStep.id, 'tenant_1');
    assert.equal(unsafeResult.success, false);
    assert.equal(unsafeStored.lastFailureCategory, 'unsafe');
    assert.equal(unsafeStored.attemptCount, 1);

    const timeoutRun = await createRun(service, { idempotencyKey: 'idem_timeout', targetIds: ['target_c'], stepMaxAttempts: 1 });
    const timeoutStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: timeoutRun.run.id })).sort((left, right) => left.stepNo - right.stepNo)[0];
    const timeoutExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== timeoutStep.id) return { success: true };
      return { success: false, errorCode: 'STEP_TIMEOUT', errorMessage: 'timeout waiting remote ack' };
    });
    await service.runDispatchedExecution(timeoutRun.run.id, 'tester', 'tenant_1', createTrackingRegistry(timeoutExecutor));
    assert.equal((await service.getStep(timeoutStep.id, 'tenant_1')).lastFailureCategory, 'timeout');

    const cancelledRun = await createRun(service, { idempotencyKey: 'idem_cancelled', targetIds: ['target_d'], stepMaxAttempts: 1 });
    const cancelledStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: cancelledRun.run.id })).sort((left, right) => left.stepNo - right.stepNo)[0];
    const cancelledExecutor = new TrackingExecutor(async (input) => {
      if (input.step.id !== cancelledStep.id) return { success: true };
      return { success: false, errorCode: 'RUN_CANCELLED', errorMessage: 'cancelled by operator' };
    });
    await service.runDispatchedExecution(cancelledRun.run.id, 'tester', 'tenant_1', createTrackingRegistry(cancelledExecutor));
    assert.equal((await service.getStep(cancelledStep.id, 'tenant_1')).lastFailureCategory, 'cancelled');
  });

  it('取消与 Agent v2 写操作竞态时落账 UNKNOWN，且不会把运行完成为成功', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_cancel_write_unknown',
      targetIds: ['target_cancel_write_unknown'],
      agentPayloads: new Map([['target_cancel_write_unknown', {
        actionType: 'agent.plan.execute',
        writeEffect: true,
        pluginRuntimeCapability: {
          pluginId: 'web.agent.plan',
          pluginVersionId: 'plugin-version-cancel-fixture',
          capabilityKey: 'filesystem.atomic_replace',
        },
        plan: {
          planId: 'agent-plan-cancel-fixture',
          pluginId: 'web.agent.plan',
          pluginVersionId: 'plugin-version-cancel-fixture',
          capability: 'filesystem.atomic_replace',
          planDigest: 'e'.repeat(64),
          writeEffect: true,
        },
        executionAuthorization: {
          planId: 'plan_1',
          actions: ['agent.plan.execute'],
          lifetimeSeconds: 300,
        },
      }]]),
    });
    const steps = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id })).sort((left, right) => left.stepNo - right.stepNo);
    await service.updateRunForTest(created.run.id, { status: 'RUNNING' }, 'tenant_1');
    await service.updateStepForTest(steps[0].id, { status: 'RUNNING' }, 'tenant_1');

    await service.cancelRun(created.run.id, 'canceller', 'tenant_1');

    const cancelledStep = await service.getStep(steps[0].id, 'tenant_1');
    const cancelledRun = await service.getRun(created.run.id, 'tenant_1');
    assert.equal(cancelledRun.status, 'CANCELLED');
    assert.equal(cancelledStep.status, 'RUNNING');
    assert.equal(cancelledStep.inputSnapshot.resultDetail.executionStatus, 'UNKNOWN');
    assert.equal(cancelledRun.summary.executionStatus, 'UNKNOWN');
  });

  it('失败步骤完整保存四类输入问题并脱敏敏感详情', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_input_issue_details', targetIds: ['target_input_issue'], stepMaxAttempts: 1 });
    const failedStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id })).find((step) => step.stepType === 'INSTALL');
    assert.ok(failedStep);
    const issues = ['VARIABLE', 'CONNECTION', 'CREDENTIAL', 'ARTIFACT'].map((category) => ({
      category,
      code: `DEPLOYMENT_INPUT_${category}_MISSING`,
      slot: category.toLowerCase(),
      path: `${category.toLowerCase()}s.slot`,
      bindingLayer: 'DEVICE',
      messageKey: `deploymentInputs.issues.${category}`,
    }));
    const executor = new TrackingExecutor(async (input) => input.step.id === failedStep.id
      ? {
          success: false,
          errorCode: 'VALIDATION_FAILED',
          errorMessage: '部署输入校验失败',
          detail: { issues, password: 'plain-password', token: 'plain-token', privateKeyPem: 'plain-private-key', pfxBase64: 'plain-pfx' },
        }
      : { success: true });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));
    const stored = await service.getStep(failedStep.id, 'tenant_1');

    assert.equal(result.success, false);
    assert.deepEqual(stored.lastErrorDetails.issues, issues);
    assert.equal(JSON.stringify(stored.lastErrorDetails).includes('plain-password'), false);
    assert.equal(JSON.stringify(stored.lastErrorDetails).includes('plain-token'), false);
    assert.equal(JSON.stringify(stored.lastErrorDetails).includes('plain-private-key'), false);
    assert.equal(JSON.stringify(stored.lastErrorDetails).includes('plain-pfx'), false);
  });

  it('恢复 worker 会恢复 queued/dispatched/running run，但不会自动重跑不可幂等步骤', async () => {
    const service = createService();
    const queued = await createRun(service, { idempotencyKey: 'idem_recover_queued', targetIds: ['target_a'] });
    const dispatched = await createRun(service, { idempotencyKey: 'idem_recover_dispatched', targetIds: ['target_b'] });
    const running = await createRun(service, { idempotencyKey: 'idem_recover_running', targetIds: ['target_c'] });

    const runningSteps = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: running.run.id })).sort((left, right) => left.stepNo - right.stepNo);
    await service.updateRunForTest(running.run.id, { status: 'RUNNING', errorCode: undefined, errorMessage: undefined }, 'tenant_1');
    await service.updateStepForTest(runningSteps[0].id, { status: 'RUNNING', idempotent: false, startedAt: new Date().toISOString() }, 'tenant_1');
    await service.updateStepForTest(runningSteps[1].id, { status: 'PENDING' }, 'tenant_1');

    const executor = new TrackingExecutor(async () => ({ success: true }));
    const recovered = await service.recoverRunsForTest('recovery_bot', 'tenant_1', createTrackingRegistry(executor));

    assert.equal(recovered.length, 3);
    const recoveredRunning = recovered.find((item) => item.run.id === running.run.id);
    assert.ok(recoveredRunning);
    assert.deepEqual(recoveredRunning?.result.skippedStepIds.length, 1);
    assert.equal((await service.getStep(runningSteps[0].id, 'tenant_1')).status, 'SKIPPED');
    assert.equal((await service.getRun(queued.run.id, 'tenant_1')).status, 'SUCCESS');
    assert.equal((await service.getRun(dispatched.run.id, 'tenant_1')).status, 'SUCCESS');
  });

  it('同一 step 不会被重复执行', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_dedup', targetIds: ['target_a'], concurrencyLimit: 1 });
    const firstStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id })).sort((left, right) => left.stepNo - right.stepNo)[0];
    let calls = 0;
    const executor = new TrackingExecutor(async (input) => {
      if (input.step.id === firstStep.id) {
        calls += 1;
      }
      return { success: true };
    });

    await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));

    assert.equal(calls, 1);
  });

  it('重复唤醒已进入失败终态的运行时返回已有结果，不抛出非法状态错误', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_terminal_wakeup', targetIds: ['target_terminal'] });
    await service.updateRunForTest(created.run.id, {
      status: 'FAILED',
      errorCode: 'TLS_VERIFY_FINGERPRINT_MISMATCH',
      errorMessage: '宿主证书验证发现远端 TLS 证书与目标证书不一致',
    }, 'tenant_1');

    const result = await service.runDispatchedExecution(created.run.id, 'task-worker', 'tenant_1');

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'TLS_VERIFY_FINGERPRINT_MISMATCH');
    assert.equal(result.errorMessage, '宿主证书验证发现远端 TLS 证书与目标证书不一致');
  });

  it('未知 executor 被拒绝，不再静默 fallback 到 MockExecutor', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_unknown_executor', targetIds: ['target_x'], executorType: 'NO_SUCH_EXECUTOR' });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1');
    const run = await service.getRun(created.run.id, 'tenant_1');
    const failedStep = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id })).find((step) => step.status === 'FAILED');

    assert.equal(result.success, false);
    assert.equal(run.status, 'FAILED');
    assert.equal(failedStep?.lastErrorCode, 'RESOURCE_NOT_FOUND');
    assert.match(failedStep?.lastErrorMessage ?? '', /拒绝静默 fallback/);
  });

  it('MockExecutor 只有显式允许时才能使用', async () => {
    const service = createService();
    await assert.rejects(
      () => createRun(service, { idempotencyKey: 'idem_mock_denied', targetIds: ['target_m'], executorType: 'MOCK' }),
      /MockExecutor/,
    );

    const allowed = await createRun(service, { idempotencyKey: 'idem_mock_allowed', targetIds: ['target_m'], executorType: 'MOCK', allowMockExecutor: true });
    const result = await service.runDispatchedExecution(allowed.run.id, 'tester', 'tenant_1', ExecutorRegistry.forTests());
    assert.equal(result.success, true);
  });

  it('Agent v2 使用独立控制面 TLS VERIFY，并区分连接地址与 SNI', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_v2_control_plane_verify',
      targetIds: ['target_v2'],
      executorType: 'AGENT',
      agentPayloads: new Map([['target_v2', {
        pluginRuntimeCapability: { runtime: 'AGENT_V2' },
        certificateVerification: { capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443 },
      }]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    assert.equal(steps[2]?.inputSnapshot.executorType, 'AGENT');
    assert.equal(steps[4]?.inputSnapshot.executorType, 'CONTROL_PLANE_TLS');
    assert.equal((steps[4]?.inputSnapshot.certificateVerification as Record<string, unknown>).connectHost, '10.255.0.127');
    assert.equal((steps[4]?.inputSnapshot.certificateVerification as Record<string, unknown>).serverName, 'test02.jacksonz.cn');
    assert.deepEqual(steps[4]?.dependsOn, [steps[3]?.stepNo]);
  });

  it('Agent v2 指定 Gateway 时由 Gateway 主动执行独立 TLS VERIFY', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_v2_gateway_verify',
      targetIds: ['target_v2_gateway'],
      executorType: 'AGENT',
      agentPayloads: new Map([['target_v2_gateway', {
        pluginRuntimeCapability: { runtime: 'AGENT_V2' },
        certificateVerification: { capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443 },
      }]]),
      gatewayRoutes: new Map([['target_v2_gateway', {
        gatewayId: 'gateway-1',
        agentId: 'gateway-agent-1',
        adapter: 'probe.tls',
      }]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    const verify = steps.find((step) => step.stepType === 'VERIFY');
    assert.equal(verify?.inputSnapshot.executorType, 'GATEWAY_FORWARD');
    assert.equal(verify?.inputSnapshot.gatewayId, 'gateway-1');
    assert.equal((verify?.inputSnapshot.certificateVerification as Record<string, unknown>).connectHost, '10.255.0.127');
    assert.equal((verify?.inputSnapshot.certificateVerification as Record<string, unknown>).serverName, 'test02.jacksonz.cn');
  });

  it('证书写入结果未知但已有目标指纹时主动核验并继续，不重放 INSTALL', async () => {
    const expectedFingerprint = 'b'.repeat(64);
    let recoveryCalls = 0;
    const timeline: string[] = [];
    const service = createService({
      unknownResultVerifier: {
        async executeStep(input) {
          recoveryCalls += 1;
          timeline.push('VERIFY');
          assert.equal(
            (input.step.inputSnapshot.certificateVerification as Record<string, unknown>)?.expectedFingerprintSha256,
            expectedFingerprint,
          );
          return {
            success: true,
            detail: {
              certificateVerification: {
                capabilityKey: 'certificate.verify',
                schemaVersion: '1.0',
                expectedFingerprintSha256: expectedFingerprint,
                remoteCertificateSha256: expectedFingerprint,
              },
              verify: { target: 'https://example.test:443', remoteCertificateSha256: expectedFingerprint },
            },
          };
        },
      },
    });
    const created = await createRun(service, {
      idempotencyKey: 'idem_unknown_certificate_recovery',
      targetIds: ['target_unknown_certificate'],
      executorType: 'AGENT',
      agentPayloads: new Map([['target_unknown_certificate', {
        certificateVerification: {
          capabilityKey: 'certificate.verify',
          schemaVersion: '1.0',
          connectHost: '127.0.0.1',
          serverName: 'example.test',
          port: 443,
          expectedFingerprintSha256: expectedFingerprint,
        },
      }]]),
    });
    const persistedInstall = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id }))
      .find((step) => step.stepType === 'INSTALL');
    assert.equal((persistedInstall?.inputSnapshot.certificateVerification as Record<string, unknown>)?.expectedFingerprintSha256, expectedFingerprint);
    assert.ok(persistedInstall);
    await service.updateStepForTest(persistedInstall.id, {
      inputSnapshot: {
        ...persistedInstall.inputSnapshot,
        certificateVerification: {
          ...(persistedInstall.inputSnapshot.certificateVerification as Record<string, unknown>),
          expectedFingerprintSha256: undefined,
        },
        deploymentArtifact: { expectedFingerprintSha256: expectedFingerprint },
      },
    }, 'tenant_1');
    const installCalls: string[] = [];
    const executor = new TrackingExecutor(async (input) => {
      timeline.push(input.step.stepType);
      if (input.step.stepType === 'INSTALL') {
        installCalls.push(input.step.id);
        return {
          success: false,
          errorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
          errorMessage: 'Plugin Runner 返回结果不明',
          detail: {
            executionStatus: 'UNKNOWN',
            mayBeUnknown: true,
            operations: [{ operationType: 'filesystem.atomic_replace', status: 'SUCCEEDED' }],
          },
        };
      }
      return { success: true };
    });
    const first = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));
    assert.equal(first.pending, true);
    assert.equal(first.pendingState, 'WAITING_RESULT');
    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(result.success, true);
    assert.equal(installCalls.length, 1);
    assert.equal(recoveryCalls, 1);
    assert.ok(timeline.indexOf('RELOAD') >= 0);
    assert.ok(timeline.indexOf('RELOAD') < timeline.indexOf('VERIFY'));
    const recoveredInstall = steps.find((step) => step.stepType === 'INSTALL');
    assert.equal(recoveredInstall?.status, 'SUCCESS');
    assert.equal((recoveredInstall?.inputSnapshot.resultDetail as Record<string, unknown> | undefined)?.executionStatus, 'SUCCESS');
    assert.equal((recoveredInstall?.inputSnapshot.resultDetail as Record<string, unknown> | undefined)?.unknownReason, undefined);
    assert.equal(steps.every((step) => step.status === 'SUCCESS'), true);
  });

  it('Agent 完整计划未确认 service.reload 时不得提前执行 TLS 核验', async () => {
    let recoveryCalls = 0;
    const service = createService({
      unknownResultVerifier: {
        async executeStep() {
          recoveryCalls += 1;
          return { success: true };
        },
      },
    });
    const targetId = 'target_unknown_before_reload';
    const payload = withTestAgentV2ExecutionAuthorization('plan_1', targetId, {
      certificateVerification: {
        capabilityKey: 'certificate.verify',
        schemaVersion: '1.0',
        connectHost: '127.0.0.1',
        serverName: 'example.test',
        port: 443,
        expectedFingerprintSha256: 'd'.repeat(64),
      },
    });
    const basePlan = payload.plan as Record<string, unknown>;
    const operations = [
      ...((basePlan.operations as Array<Record<string, unknown>>) ?? []),
      {
        operationId: `reload-${targetId}`,
        operationType: 'service.reload',
        stage: 'execute',
        input: { serviceName: 'apache2' },
        dependsOn: [],
        idempotencyKey: `reload-idempotency-${targetId}`,
        timeoutSeconds: 30,
      },
    ];
    const unsignedPlan = { ...basePlan, operations, planDigest: '' };
    payload.plan = { ...unsignedPlan, planDigest: computeAgentPlanDigest(unsignedPlan as any) };

    const created = await createRun(service, {
      idempotencyKey: 'idem_unknown_before_reload',
      targetIds: [targetId],
      executorType: 'AGENT',
      agentPayloads: new Map([[targetId, payload]]),
    });
    const executor = new TrackingExecutor(async (input) => input.step.stepType === 'INSTALL'
      ? {
          success: false,
          errorCode: 'AGENT_EXECUTION_UNKNOWN',
          errorMessage: 'Agent 写入结果不明，未确认重载',
          detail: {
            executionStatus: 'UNKNOWN',
            operationResults: [{ operationType: 'filesystem.atomic_replace', status: 'SUCCEEDED' }],
          },
        }
      : { success: true });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(result.pending, true);
    assert.equal(result.pendingState, 'AWAITING_CONFIRMATION');
    assert.equal(recoveryCalls, 0);
    assert.equal(steps.find((step) => step.stepType === 'INSTALL')?.status, 'RUNNING');
    assert.equal(steps.find((step) => step.stepType === 'RELOAD')?.status, 'PENDING');
  });

  it('Agent 尚无成功写操作证据时不提前执行部署后 TLS 核验', async () => {
    let recoveryCalls = 0;
    const service = createService({
      unknownResultVerifier: {
        async executeStep() {
          recoveryCalls += 1;
          return { success: true };
        },
      },
    });
    const targetId = 'target_unknown_before_write';
    const created = await createRun(service, {
      idempotencyKey: 'idem_unknown_before_write',
      targetIds: [targetId],
      executorType: 'AGENT',
      agentPayloads: new Map([[targetId, {
        certificateVerification: {
          capabilityKey: 'certificate.verify',
          schemaVersion: '1.0',
          connectHost: '127.0.0.1',
          serverName: 'example.test',
          port: 443,
          expectedFingerprintSha256: 'c'.repeat(64),
        },
      }]]),
    });
    const tracking = new TrackingExecutor(async (input) => input.step.stepType === 'BACKUP'
      ? {
          success: false,
          errorCode: 'AGENT_EXECUTION_UNKNOWN',
          errorMessage: 'Agent 回执签名材料不可用，写入状态不明',
          detail: { executionStatus: 'UNKNOWN', receiptUnavailable: true },
        }
      : { success: true });
    const first = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(tracking));
    assert.equal(first.pending, true);
    assert.equal(recoveryCalls, 0);
    assert.equal(first.pendingState, 'AWAITING_CONFIRMATION');
  });

  it('Workflow 证书部署统一追加宿主 VERIFY，默认由平台后端执行', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_workflow_host_verify',
      targetIds: ['target_workflow'],
      executorType: 'WORKFLOW',
      agentPayloads: new Map([['target_workflow', {
        pluginRuntimeCapability: { runtime: 'WORKFLOW_DSL' },
        workflowRequest: { workflowVersionId: 'workflow-version-1' },
        certificateVerification: { capabilityKey: 'certificate.verify', schemaVersion: '1.0', connectHost: '10.255.0.127', serverName: 'test02.jacksonz.cn', port: 443 },
      }]]),
    });
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });
    assert.deepEqual(steps.map((step) => step.stepType), ['DISCOVER', 'BACKUP', 'INSTALL', 'RELOAD', 'VERIFY']);
    assert.equal(steps[2]?.inputSnapshot.executorType, 'WORKFLOW');
    assert.equal(steps[4]?.inputSnapshot.executorType, 'CONTROL_PLANE_TLS');
  });

  it('failurePolicy=continue 跳过失败目标剩余步骤，但继续其它目标；batchSize 和 retry 写入实际调度', async () => {
    const service = createService();
    const created = await createRun(service, {
      idempotencyKey: 'idem_continue_batch_retry',
      targetIds: ['target_a', 'target_b', 'target_c'],
      concurrencyLimit: 2,
      failurePolicy: 'continue',
      retry: { maxAttempts: 2, backoffSeconds: 7 },
    });
    const firstStepA = (await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id })).find((step) => step.name === 'BACKUP target_a')!;
    let callsA = 0;
    const executor = new TrackingExecutor(async (input) => {
      if (input.step.id === firstStepA.id) {
        callsA += 1;
        return { success: false, errorCode: 'UNSAFE_REMOTE_STATE', errorMessage: 'unsafe to retry' };
      }
      return { success: true };
    });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));
    const run = await service.getRun(created.run.id, 'tenant_1');
    const steps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: created.run.id });

    assert.equal(result.success, false);
    assert.equal(run.status, 'FAILED');
    assert.equal(run.concurrencyLimit, 2);
    assert.deepEqual(run.summary.retry, { maxAttempts: 2, backoffSeconds: 7 });
    assert.equal(steps.find((step) => step.name === 'INSTALL target_a')?.status, 'SKIPPED');
    assert.equal(steps.filter((step) => step.deploymentPlanTargetId === 'target_b').every((step) => step.status === 'SUCCESS'), true);
    assert.equal(callsA, 1);
  });

  it('failurePolicy=rollback 会自动创建 rollback run 并把源 run 标为 ROLLBACK_RUNNING', async () => {
    const service = createService();
    const created = await createRun(service, { idempotencyKey: 'idem_auto_rollback', targetIds: ['target_rb'], failurePolicy: 'rollback' });
    const executor = new TrackingExecutor(async (input) => {
      if (input.step.stepType === 'BACKUP') return { success: false, errorCode: 'SSH_COMMAND_FAILED', errorMessage: 'install blocked' };
      return { success: true };
    });

    const result = await service.runDispatchedExecution(created.run.id, 'tester', 'tenant_1', createTrackingRegistry(executor));
    const sourceRun = await service.getRun(created.run.id, 'tenant_1');
    const runs = await service.listRuns({ tenantId: 'tenant_1', deploymentPlanId: 'plan_1' });
    const rollbackRun = runs.find((run) => run.type === 'rollback');

    assert.equal(result.success, false);
    assert.equal(sourceRun.status, 'ROLLBACK_RUNNING');
    assert.ok(rollbackRun);
    assert.equal(rollbackRun?.status, 'DISPATCHED');
  });

  it('工作流回滚运行沿用目标请求但显式切换到 rollback 分支', async () => {
    const service = createService();
    const targetId = 'target_workflow_rollback_branch';
    const created = await createRun(service, {
      idempotencyKey: 'idem_workflow_rollback_branch',
      targetIds: [targetId],
      executorType: 'WORKFLOW',
      agentPayloads: new Map([[targetId, {
        workflowRequest: { workflowVersionId: 'workflow-version-fixture' },
      }]]),
    });
    await service.getRepository().updateRun(created.run.id, {
      status: 'FAILED',
      errorCode: 'WORKFLOW_ASSERTION_FAILED',
      errorMessage: 'verify failed',
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: 'tester',
    });

    const rollback = await service.rollback({
      runId: created.run.id,
      idempotencyKey: 'idem_workflow_rollback_branch_run',
      actorId: 'tester',
      tenantId: 'tenant_1',
    });
    const rollbackSteps = await service.listSteps({ tenantId: 'tenant_1', executionRunId: rollback.rollbackRun.id });
    const workflowRequest = rollbackSteps[0]?.inputSnapshot.workflowRequest as Record<string, unknown>;

    assert.equal(workflowRequest.executionBranch, 'rollback');
  });
});
