import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { AgentExecutorAdapter } from './application/executors.js';

const headers = {
  'x-tenant-id': 'tenant_agent_direct_executor',
  'x-actor-id': 'user_1',
  'x-request-id': 'req_agent_direct_executor',
};

const migratedApp = createMigratedApp();

test('AgentExecutorAdapter 只通过 Atomic Plan 直连成功且不留下待拉取任务', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/start') {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        accepted: true,
        actionId: 'direct-action-001',
        status: 'running',
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/v1/control/actions/status?actionId=direct-action-001') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        actionId: 'direct-action-001',
        status: 'completed',
        detail: {
          mode: 'atomic_plan_completed',
          oldThumbprint: '1111111111111111111111111111111111111111',
          newThumbprint: '2222222222222222222222222222222222222222',
          rolledBack: false,
          manualRequired: false,
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind direct execute test server');

  const app = await migratedApp;
  try {
    const register = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'direct-executor-01',
        hostname: 'DIRECT-EXECUTOR-01',
        version: '0.1.0',
        osType: 'windows',
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: `127.0.0.1:${address.port}`,
          protocolVersion: 'v1',
          supportedActions: ['health', 'discovery.run', 'agent.atomic_plan.execute'],
        },
      },
    });
    assert.equal(register.statusCode, 201, JSON.stringify(register.body));
    const agentId = (register.body as { id: string }).id;

    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const adapter = new AgentExecutorAdapter(agentsService, undefined, atomicPlanCompiler() as never);
    const result = await adapter.executeStep({
      step: {
        id: 'stp_direct_success',
        tenantId: headers['x-tenant-id'],
        executionRunId: 'run_direct_success',
        deploymentPlanTargetId: 'dpt_direct_success',
        stepNo: 2,
        stepType: 'INSTALL',
        name: 'INSTALL direct success',
        dependsOn: [1],
        idempotent: true,
        attemptCount: 1,
        maxAttempts: 1,
        inputSnapshot: atomicInputSnapshot(agentId),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'tester',
        version: 1,
      },
      runType: 'apply',
      dryRun: false,
    });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.asyncPending, undefined);
    assert.equal(result.detail?.mode, 'atomic_plan_completed');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('AgentExecutorAdapter 会把 Agent Atomic PREFLIGHT 派发给 Agent 并返回统一检查项', async () => {
  let enqueueCount = 0;
  let directCount = 0;
  let compiledResolvedInput: Record<string, unknown> | undefined;
  const progressUpdates: Record<string, unknown>[] = [];
  const agents = {
    enqueueDirectTask: async () => {
      enqueueCount += 1;
      return { id: 'task_atomic_preflight', status: 'acked' };
    },
    executeTaskDirect: async (...args: unknown[]) => {
      directCount += 1;
      const reportProgress = args[3] as ((detail: Record<string, unknown>) => Promise<void> | void) | undefined;
      await reportProgress?.({
        state: 'RUNNING',
        currentOperationId: 'nginx-program-preflight',
        currentOperationType: 'preflight.assert',
        completedOperationCount: 1,
        totalOperationCount: 1,
        operationResults: [{ operationId: 'nginx-program-preflight', operationType: 'preflight.assert', stage: 'prepare', status: 'SUCCEEDED', detail: { passed: true } }],
      });
      return {
        success: true,
        detail: {
          planId: 'agplan_atomic_preflight',
          state: 'SUCCEEDED',
          operationResults: [
            {
              operationId: 'nginx-program-preflight',
              operationType: 'preflight.assert',
              stage: 'prepare',
              status: 'SUCCEEDED',
              detail: { passed: true },
            },
          ],
        },
      };
    },
  } as unknown as AgentsApplicationService;
  const compiler = {
    compile: async (input: { resolvedInput: Record<string, unknown> }) => {
      compiledResolvedInput = input.resolvedInput;
      return {
        planId: 'agplan_atomic_preflight',
        operations: [{ id: 'nginx-program-preflight' }],
      };
    },
  };
  const adapter = new AgentExecutorAdapter(agents, undefined, compiler as never);

  const result = await adapter.executeStep({
    step: {
      id: 'stp_atomic_preflight',
      tenantId: headers['x-tenant-id'],
      executionRunId: 'run_atomic_preflight',
      deploymentPlanTargetId: 'dpt_atomic_preflight',
      stepNo: 1,
      stepType: 'CUSTOM',
      name: 'Agent Atomic PREFLIGHT',
      dependsOn: [],
      idempotent: true,
      attemptCount: 1,
      maxAttempts: 1,
      inputSnapshot: {
        ...atomicInputSnapshot('agt_atomic_preflight'),
        pluginBindingId: 'plgb_atomic_preflight',
        pluginRuntimeCapability: { pluginVersionId: 'plgv_atomic_preflight' },
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'tester',
      version: 1,
    },
    runType: 'dry_run',
    dryRun: true,
    reportProgress: async (detail) => {
      progressUpdates.push(detail);
    },
  });

  assert.equal(enqueueCount, 1);
  assert.equal(directCount, 1);
  assert.equal(result.success, true);
  assert.deepEqual(result.detail?.dryRunSummary, { passed: 1, failed: 0, warning: 0, unknown: 0 });
  assert.equal((result.detail?.dryRunChecks as unknown[]).length, 1);
  assert.equal((progressUpdates[0]?.dryRunChecks as unknown[]).length, 1);
  assert.equal(compiledResolvedInput?.apiVersion, 'gcac.resolved-deployment-input/v1');
});

test('AgentExecutorAdapter 主动直连失败时明确失败且不会调用队列接口', async () => {
  let directTaskCount = 0;
  const agents = {
    enqueueDirectTask: async () => {
      directTaskCount += 1;
      return { id: 'task_direct_required', status: 'acked' };
    },
    executeTaskDirect: async () => {
      throw new Error('direct connection failed');
    },
  } as unknown as AgentsApplicationService;
  const adapter = new AgentExecutorAdapter(agents, undefined, atomicPlanCompiler() as never);
  const result = await adapter.executeStep({
    step: {
      id: 'stp_direct_required', tenantId: headers['x-tenant-id'], executionRunId: 'run_direct_required',
      deploymentPlanTargetId: 'dpt_direct_required', stepNo: 1, stepType: 'INSTALL', name: 'direct required',
      dependsOn: [], idempotent: true, attemptCount: 1, maxAttempts: 1,
      inputSnapshot: atomicInputSnapshot('agt_direct_required'),
      status: 'PENDING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'tester', version: 1,
    },
    runType: 'apply',
    dryRun: false,
  });

  assert.equal(directTaskCount, 1);
  assert.equal(result.success, false);
  assert.equal(result.asyncPending, undefined);
  assert.equal(result.detail?.mode, 'agent_direct_execute_failed');
  assert.equal(result.detail?.dispatchMode, 'direct_required');
});

test('AgentExecutorAdapter 直连不可达时明确失败且不暴露轮询任务', async () => {
  const app = await migratedApp;
  const register = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: 'direct-executor-02',
      hostname: 'DIRECT-EXECUTOR-02',
      version: '0.1.0',
      osType: 'windows',
      directControl: {
        enabled: true,
        reachable: true,
        listenAddress: '127.0.0.1:9',
        protocolVersion: 'v1',
        supportedActions: ['health', 'discovery.run', 'agent.atomic_plan.execute'],
      },
    },
  });
  assert.equal(register.statusCode, 201, JSON.stringify(register.body));
  const agentId = (register.body as { id: string }).id;

  const agentsService = app.getResource('agentsService') as AgentsApplicationService;
  const adapter = new AgentExecutorAdapter(agentsService, undefined, atomicPlanCompiler() as never);
  const result = await adapter.executeStep({
    step: {
      id: 'stp_direct_fallback',
      tenantId: headers['x-tenant-id'],
      executionRunId: 'run_direct_fallback',
      deploymentPlanTargetId: 'dpt_direct_fallback',
      stepNo: 2,
      stepType: 'INSTALL',
      name: 'INSTALL direct fallback',
      dependsOn: [1],
      idempotent: true,
      attemptCount: 1,
      maxAttempts: 1,
      inputSnapshot: atomicInputSnapshot(agentId),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'tester',
      version: 1,
    },
    runType: 'apply',
    dryRun: false,
  });

  assert.equal(result.success, false, JSON.stringify(result));
  assert.equal(result.asyncPending, undefined);
  assert.equal(result.detail?.mode, 'agent_direct_execute_failed');
  assert.equal(result.detail?.dispatchMode, 'direct_required');

  const pulled = await app.inject({
    method: 'GET',
    path: `/api/v1/agents/tasks/pull?agentId=${agentId}`,
    headers,
  });
  assert.equal(pulled.statusCode, 200);
  const tasks = pulled.body as Array<{ payload?: { type?: string } }>;
  assert.equal(tasks.length, 0);
});

test('AgentExecutorAdapter 通过 Atomic Plan 返回统一 Dry-run 结果', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/start') {
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        accepted: true,
        actionId: 'direct-action-nginx-001',
        status: 'running',
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/v1/control/actions/status?actionId=direct-action-nginx-001') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        actionId: 'direct-action-nginx-001',
        status: 'completed',
        detail: {
          mode: 'atomic_plan_preflight',
          executable: false,
          blockers: [{ code: 'WRITE_PERMISSION_DENIED' }],
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind nginx direct execute test server');

  const app = await migratedApp;
  try {
    const register = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'direct-executor-nginx-01',
        hostname: 'DIRECT-EXECUTOR-NGINX-01',
        version: '0.1.0',
        osType: 'linux',
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: `127.0.0.1:${address.port}`,
          protocolVersion: 'v1',
          supportedActions: ['health', 'discovery.run', 'agent.atomic_plan.execute'],
        },
      },
    });
    assert.equal(register.statusCode, 201, JSON.stringify(register.body));
    const agentId = (register.body as { id: string }).id;

    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const adapter = new AgentExecutorAdapter(agentsService, undefined, atomicPlanCompiler() as never);
    const result = await adapter.executeStep({
      step: {
        id: 'stp_direct_nginx_success',
        tenantId: headers['x-tenant-id'],
        executionRunId: 'run_direct_nginx_success',
        deploymentPlanTargetId: 'dpt_direct_nginx_success',
        stepNo: 1,
        stepType: 'DISCOVER',
        name: 'DISCOVER direct nginx success',
        dependsOn: [],
        idempotent: true,
        attemptCount: 1,
        maxAttempts: 1,
        inputSnapshot: atomicInputSnapshot(agentId),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'tester',
        version: 1,
      },
      runType: 'dry_run',
      dryRun: true,
    });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.asyncPending, undefined);
    assert.equal(result.detail?.mode, 'atomic_plan_preflight');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('AgentExecutorAdapter 的 Atomic Plan 在异步直连端点缺失时兼容同步端点', async () => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/start') {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/control/actions/execute') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        taskId: 'legacy-direct-task-001',
        detail: {
          mode: 'atomic_plan_sync_completed',
        },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('failed to bind legacy direct execute test server');

  const app = await migratedApp;
  try {
    const register = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'direct-executor-legacy-01',
        hostname: 'DIRECT-EXECUTOR-LEGACY-01',
        version: '0.1.0',
        osType: 'windows',
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: `127.0.0.1:${address.port}`,
          protocolVersion: 'v1',
          supportedActions: ['health', 'discovery.run', 'agent.atomic_plan.execute'],
        },
      },
    });
    assert.equal(register.statusCode, 201, JSON.stringify(register.body));
    const agentId = (register.body as { id: string }).id;

    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const adapter = new AgentExecutorAdapter(agentsService, undefined, atomicPlanCompiler() as never);
    const result = await adapter.executeStep({
      step: {
        id: 'stp_direct_legacy_success',
        tenantId: headers['x-tenant-id'],
        executionRunId: 'run_direct_legacy_success',
        deploymentPlanTargetId: 'dpt_direct_legacy_success',
        stepNo: 2,
        stepType: 'INSTALL',
        name: 'INSTALL direct legacy success',
        dependsOn: [1],
        idempotent: true,
        attemptCount: 1,
        maxAttempts: 1,
        inputSnapshot: atomicInputSnapshot(agentId),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'tester',
        version: 1,
      },
      runType: 'apply',
      dryRun: false,
    });

    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(result.detail?.mode, 'atomic_plan_sync_completed');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function atomicInputSnapshot(agentId: string): Record<string, unknown> {
  return {
    executorType: 'AGENT',
    agentId,
    actionType: 'agent.atomic_plan.execute',
    actionSchemaVersion: '1.0',
    pluginBindingId: 'plgb_atomic_fixture',
    pluginRuntimeCapability: { pluginVersionId: 'plgv_atomic_fixture' },
    resolvedDeploymentInput: resolvedDeploymentInput(),
  };
}

function atomicPlanCompiler() {
  return {
    compile: async () => ({
      apiVersion: 'gcac.agent-plan/v1',
      planId: 'agplan_atomic_fixture',
      authorization: { keyId: 'fixture', signature: 'fixture-signature' },
      operations: [],
    }),
  };
}

function resolvedDeploymentInput(): Record<string, unknown> {
  return {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset_atomic_fixture' },
      host: { id: 'host_atomic_fixture' },
      target: { id: 'target_atomic_fixture', type: 'tls.binding', key: 'fixture', metadata: {} },
      deployment: { targets: [], certificateResourceName: 'certificate' },
    },
    variables: {},
    connections: {},
    credentials: {},
    artifacts: {},
    provenance: {},
    sensitivePaths: [],
    issues: [],
    executable: true,
    resolvedSha256: 'sha256:atomic-fixture',
  };
}

async function createMigratedApp() {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  return createApp({ db: database });
}
