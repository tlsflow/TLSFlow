import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AgentsApplicationService } from './application/agents.application-service.js';
import { createSecurityServices, type SecurityServices } from '../security/security.controller.js';

describe('Agent direct control api', () => {
  it('非直连 Agent 能力重扫进入现有任务队列且重复请求复用活动任务', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const registered = await agentsService.register('tenant_agent_queued_rescan', {
      agentKey: 'queued-rescan-agent',
      machineId: 'queued-rescan-machine',
      hostname: 'queued-rescan-host',
      version: '1.0.0',
      osType: 'windows',
      arch: 'amd64',
    }, 'request_register_queued_rescan');

    const first = await agentsService.enqueueCapabilityRescanTask('tenant_agent_queued_rescan', {
      agentId: registered.id,
      requestedBy: 'user-1',
    }, 'request_queued_rescan_1');
    const repeated = await agentsService.enqueueCapabilityRescanTask('tenant_agent_queued_rescan', {
      agentId: registered.id,
      requestedBy: 'user-1',
    }, 'request_queued_rescan_2');

    assert.equal(first.status, 'queued');
    assert.equal(first.payload.type, 'agent.capability.rescan');
    assert.equal(repeated.id, first.id);
    assert.deepEqual((await agentsService.pullTasks('tenant_agent_queued_rescan', registered.id)).map((task) => task.id), [first.id]);
  });

  it('Agent 轮询与控制面直连竞态时，重复 ack 返回已有 lease 而不是失败', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_ack_race';
    const agent = await agentsService.register(tenantId, {
      agentKey: 'ack-race-agent',
      hostname: 'ACK-RACE-AGENT',
      version: '0.1.0',
      osType: 'linux',
    }, 'req_ack_race_register');
    const task = await agentsService.enqueueTask(tenantId, {
      agentId: agent.id,
      executionRunId: 'run_ack_race',
      executionStepId: 'step_ack_race',
      idempotencyKey: 'run_ack_race:step_ack_race:1',
      payload: { actionType: 'agent.plan.execute' },
    }, 'req_ack_race_enqueue');

    const agentLease = 'lease_agent_poll';
    const firstAck = await agentsService.ackTask(tenantId, {
      agentId: agent.id,
      taskId: task.id,
      leaseId: agentLease,
    });
    const staleDirectAck = await agentsService.ackTask(tenantId, {
      agentId: agent.id,
      taskId: task.id,
      leaseId: `direct:${task.id}`,
    });

    assert.equal(firstAck.status, 'acked');
    assert.equal(firstAck.leaseId, agentLease);
    assert.equal(staleDirectAck.status, 'acked');
    assert.equal(staleDirectAck.leaseId, agentLease);
  });

  it('并发 ack 只能由一个 lease 原子占有任务', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_atomic_ack';
    const agent = await agentsService.register(tenantId, {
      agentKey: 'atomic-ack-agent',
      hostname: 'ATOMIC-ACK-AGENT',
      version: '0.1.0',
      osType: 'linux',
    }, 'req_atomic_ack_register');
    const task = await agentsService.enqueueTask(tenantId, {
      agentId: agent.id,
      executionRunId: 'run_atomic_ack',
      executionStepId: 'step_atomic_ack',
      idempotencyKey: 'run_atomic_ack:step_atomic_ack:1',
      payload: { actionType: 'agent.plan.execute' },
    }, 'req_atomic_ack_enqueue');

    const results = await Promise.all([
      agentsService.ackTask(tenantId, { agentId: agent.id, taskId: task.id, leaseId: 'lease_atomic_a' }),
      agentsService.ackTask(tenantId, { agentId: agent.id, taskId: task.id, leaseId: 'lease_atomic_b' }),
    ]);

    assert.equal(results[0].status, 'acked');
    assert.equal(results[1].status, 'acked');
    assert.equal(results[0].leaseId, results[1].leaseId);
    assert.ok(['lease_atomic_a', 'lease_atomic_b'].includes(results[0].leaseId ?? ''));
  });

  it('直连发现任务已被 Agent 占有时，返回异步等待而不再次执行', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_direct_claimed';
    const agent = await agentsService.register(tenantId, {
      agentKey: 'direct-claimed-agent',
      hostname: 'DIRECT-CLAIMED-AGENT',
      version: '0.1.0',
      osType: 'linux',
    }, 'req_direct_claimed_register');
    const task = await agentsService.enqueueTask(tenantId, {
      agentId: agent.id,
      executionRunId: 'run_direct_claimed',
      executionStepId: 'step_direct_claimed',
      idempotencyKey: 'run_direct_claimed:step_direct_claimed:1',
      payload: { actionType: 'agent.plan.execute' },
    }, 'req_direct_claimed_enqueue');
    await agentsService.ackTask(tenantId, {
      agentId: agent.id,
      taskId: task.id,
      leaseId: 'lease_agent_owner',
    });

    const result = await agentsService.executeTaskDirect(tenantId, task.id, 'req_direct_claimed_execute');

    assert.equal(result.success, true);
    assert.equal(result.asyncPending, true);
    assert.equal(result.errorCode, 'AGENT_TASK_ALREADY_CLAIMED');
    assert.equal(result.detail.executionMode, 'queued');
  });

  it('无直连地址的 Agent v2 任务被轮询占有时返回异步等待', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_trust_inspect_wait';
    const agent = await agentsService.register(tenantId, {
      agentKey: 'trust-inspect-wait-agent',
      hostname: 'TRUST-INSPECT-WAIT-AGENT',
      version: '0.1.0',
      osType: 'linux',
    }, 'req_trust_inspect_wait_register');
    const task = await agentsService.enqueueTask(tenantId, {
      agentId: agent.id,
      executionRunId: 'run_trust_inspect_wait',
      executionStepId: 'step_trust_inspect_wait',
      idempotencyKey: 'agent.plan.execute:agent-v2-wait-agent',
      payload: {
        actionType: 'agent.plan.execute',
      },
    }, 'req_trust_inspect_wait_enqueue');
    await agentsService.ackTask(tenantId, {
      agentId: agent.id,
      taskId: task.id,
      leaseId: 'lease_trust_inspect_agent',
    });

    const result = await agentsService.executeTaskDirect(tenantId, task.id, 'req_agent_v2_wait_execute');
    assert.equal(result.success, true);
    assert.equal(result.asyncPending, true);
    assert.equal(result.errorCode, 'AGENT_TASK_ALREADY_CLAIMED');
    assert.equal(result.detail.executionMode, 'queued');
  });

  it('同一 Agent 可复用原始一次性令牌完成幂等重注册', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_idempotent_register';
    const token = await agentsService.createEnrollmentToken(tenantId, {
      allowedRoles: ['full_agent'],
      allowedZones: ['default'],
      maxUses: 1,
      ttlSeconds: 60,
      createdBy: 'test',
    }, 'req_create_idempotent_token');
    const input = {
      agentKey: 'windows-compat-idempotent-01',
      machineId: 'windows-compat-machine-01',
      hostname: 'WIN-COMPAT-01',
      version: '0.1.2',
      osType: 'WINDOWS',
      arch: 'amd64',
      role: 'full_agent',
      zone: 'default',
      enrollmentToken: token.token,
    };

    const first = await agentsService.register(tenantId, input, 'req_register_first');
    const second = await agentsService.register(tenantId, input, 'req_register_after_restart');

    assert.equal(second.id, first.id);
    assert.equal(first.status, 'OFFLINE');
    assert.equal(second.status, 'OFFLINE');
    const detailBeforeHeartbeat = await agentsService.getAgentDetail(tenantId, first.id);
    assert.equal(detailBeforeHeartbeat.latestHeartbeat, undefined);
    assert.equal(detailBeforeHeartbeat.health.lastHeartbeatAt, undefined);

    await agentsService.heartbeat(tenantId, {
      agentId: first.id,
      version: input.version,
      status: 'ONLINE',
    }, 'req_register_first_heartbeat');
    assert.equal((await agentsService.getAgentDetail(tenantId, first.id)).agent.status, 'ONLINE');
  });

  it('生产 HTTP 入口仅允许有效 Agent Token 为机器回调装配租户上下文', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_machine_auth';
    const token = await agentsService.createEnrollmentToken(tenantId, {
      allowedRoles: ['full_agent'],
      allowedZones: ['default'],
      maxUses: 1,
      ttlSeconds: 60,
      createdBy: 'test',
    }, 'req_create_machine_token');
    const machineHeaders = {
      'x-agent-token': token.token,
      'x-tenant-id': 'tenant_attacker',
    };

    const register = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: machineHeaders,
      body: {
        agentKey: 'machine-auth-agent',
        hostname: 'MACHINE-AUTH',
        version: '1.0.0',
        osType: 'WINDOWS',
        role: 'full_agent',
        zone: 'default',
        enrollmentToken: token.token,
      },
    });
    assert.equal(register.statusCode, 201);
    const agent = register.body as { id: string; tenantId: string };
    assert.equal(agent.tenantId, tenantId);

    const heartbeat = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/heartbeat',
      headers: machineHeaders,
      body: {
        agentId: agent.id,
        version: '1.0.0',
        status: 'ONLINE',
      },
    });
    assert.equal(heartbeat.statusCode, 200);

    const invalidToken = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/heartbeat',
      headers: { 'x-agent-token': 'invalid-token', 'x-tenant-id': tenantId },
      body: {
        agentId: agent.id,
        version: '1.0.0',
        status: 'ONLINE',
      },
    });
    assert.equal(invalidToken.statusCode, 401);

    const humanRoute = await app.inject({
      method: 'GET',
      path: '/api/v1/agents',
      headers: machineHeaders,
    });
    assert.equal(humanRoute.statusCode, 401);
  });

  it('Agent 离线时健康状态必须覆盖历史健康心跳', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_offline_health_priority';
    const agent = await agentsService.register(tenantId, {
      agentKey: 'offline-health-priority-01',
      hostname: 'WIN-OFFLINE-01',
      version: '0.1.2',
      osType: 'WINDOWS',
      arch: 'amd64',
    }, 'req_register_offline_health');
    await agentsService.heartbeat(tenantId, {
      agentId: agent.id,
      version: '0.1.2',
      status: 'ONLINE',
      runtimeHealth: {
        modelVersion: 'gcac.agent.health.v1',
        status: 'healthy',
      },
    }, 'req_heartbeat_offline_health');
    const firstEvaluation = await agentsService.evaluateOfflineAgents({
      now: new Date(Date.now() + 181_000),
      offlineTimeoutSeconds: 180,
      requiredConsecutiveTimeouts: 2,
    });
    assert.equal(firstEvaluation.transitioned, 0);
    assert.equal((await agentsService.getAgentDetail(tenantId, agent.id)).agent.status, 'ONLINE');

    const secondEvaluation = await agentsService.evaluateOfflineAgents({
      now: new Date(Date.now() + 191_000),
      offlineTimeoutSeconds: 180,
      requiredConsecutiveTimeouts: 2,
    });
    assert.equal(secondEvaluation.transitioned, 1);

    const detail = await agentsService.getAgentDetail(tenantId, agent.id);

    assert.equal(detail.health.offline, true);
    assert.equal(detail.health.status, 'failed');
  });

  it('注册和心跳应持久化 directControl 并在 detail health 中返回', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database, security: createSecurityServices() });
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const tenantId = 'tenant_agent_direct_control';
    const enrollment = await agentsService.createEnrollmentToken(tenantId, {
      allowedRoles: ['full_agent'],
      allowedZones: ['default'],
      maxUses: 1,
      ttlSeconds: 60,
      createdBy: 'test',
    }, 'req_create_direct_control_token');
    const userAuthorization = await createTestUserAuthorization(app, tenantId, 'direct_control');
    const machineHeaders = {
      'x-agent-token': enrollment.token,
      'x-request-id': 'req_agent_direct_control_register',
    };
    const userHeaders = {
      authorization: userAuthorization,
      'x-request-id': 'req_agent_direct_control_register',
    };

    const registerResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: machineHeaders,
      body: {
        agentKey: 'win-go-direct-control-01',
        hostname: 'WIN-GO-01',
        version: '0.1.0',
        osType: 'windows',
        arch: 'amd64',
        zone: 'default',
        enrollmentToken: enrollment.token,
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: '10.10.0.8:18930',
          protocolVersion: 'v1',
          supportedActions: ['health'],
          lastReadyAt: '2026-06-30T10:00:00.000Z',
        },
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const registeredAgent = registerResponse.body as { id: string; directControl?: { enabled: boolean; listenAddress?: string } };
    assert.ok(registeredAgent.id);
    assert.equal(registeredAgent.directControl?.enabled, true);
    assert.equal(registeredAgent.directControl?.listenAddress, '10.10.0.8:18930');

    const heartbeatResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/heartbeat',
      headers: {
        ...machineHeaders,
        'x-request-id': 'req_agent_direct_control_heartbeat',
      },
      body: {
        agentId: registeredAgent.id,
        version: '0.1.1',
        status: 'ONLINE',
        taskSummary: {
          running: 1,
          queued: 2,
          succeeded: 3,
          failed: 0,
        },
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: '10.10.0.9:18930',
          protocolVersion: 'v1',
          supportedActions: ['health'],
          lastReadyAt: '2026-06-30T10:05:00.000Z',
        },
        runtimeHealth: {
          modelVersion: 'v1',
          status: 'healthy',
          pendingResultCount: 0,
          recoverableTaskCount: 0,
          lastSelfCheckAt: '2026-06-30T10:05:00.000Z',
          directControl: {
            enabled: true,
            reachable: true,
            listenAddress: '10.10.0.9:18930',
            protocolVersion: 'v1',
            supportedActions: ['health'],
            lastReadyAt: '2026-06-30T10:05:00.000Z',
          },
        },
      },
    });
    assert.equal(heartbeatResponse.statusCode, 200);

    const detailResponse = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/detail?agentId=${registeredAgent.id}`,
      headers: {
        ...userHeaders,
        'x-request-id': 'req_agent_direct_control_detail',
      },
    });
    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.body as {
      agent: {
        directControl?: {
          enabled: boolean;
          reachable: boolean;
          listenAddress?: string;
          supportedActions: string[];
        };
      };
      latestHeartbeat?: {
        directControl?: {
          enabled: boolean;
          reachable: boolean;
          listenAddress?: string;
        };
      };
      health: {
        directControl?: {
          enabled: boolean;
          reachable: boolean;
          listenAddress?: string;
          protocolVersion?: string;
          supportedActions: string[];
        };
      };
    };

    assert.equal(detail.agent.directControl?.enabled, true);
    assert.equal(detail.agent.directControl?.reachable, true);
    assert.equal(detail.agent.directControl?.listenAddress, '10.10.0.9:18930');
    assert.deepEqual(detail.agent.directControl?.supportedActions, ['health']);

    assert.equal(detail.latestHeartbeat?.directControl?.enabled, true);
    assert.equal(detail.latestHeartbeat?.directControl?.listenAddress, '10.10.0.9:18930');

    assert.equal(detail.health.directControl?.enabled, true);
    assert.equal(detail.health.directControl?.reachable, true);
    assert.equal(detail.health.directControl?.listenAddress, '10.10.0.9:18930');
    assert.equal(detail.health.directControl?.protocolVersion, 'v1');
    assert.deepEqual(detail.health.directControl?.supportedActions, ['health']);
  });

  it('Agent detail 应暴露 recentTaskLogs 的执行模式与直连回退原因', async () => {
    const database = new PgliteDatabase();
    await runMigrations(database, 'src/database/migrations');
    const app = createApp({ db: database, security: createSecurityServices() });
    const tenantId = 'tenant_agent_recent_logs';
    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const enrollment = await agentsService.createEnrollmentToken(tenantId, {
      allowedRoles: ['full_agent'],
      allowedZones: ['default'],
      maxUses: 1,
      ttlSeconds: 60,
      createdBy: 'test',
    }, 'req_create_recent_logs_token');
    const userAuthorization = await createTestUserAuthorization(app, tenantId, 'recent_logs');
    const machineHeaders = {
      'x-agent-token': enrollment.token,
      'x-request-id': 'req_agent_recent_logs_register',
    };

    const registerResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers: machineHeaders,
      body: {
        agentKey: 'win-go-direct-control-02',
        hostname: 'WIN-GO-02',
        version: '0.1.0',
        osType: 'windows',
        arch: 'amd64',
        zone: 'default',
        enrollmentToken: enrollment.token,
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: '10.10.0.10:18930',
          protocolVersion: 'v1',
          supportedActions: ['health', 'agent.plan.execute'],
          lastReadyAt: '2026-06-30T11:00:00.000Z',
        },
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const agentId = (registerResponse.body as { id: string }).id;

    const directTask = await agentsService.enqueueTask(tenantId, {
      agentId,
      executionRunId: 'run_direct_recent_logs',
      executionStepId: 'step_direct_recent_logs',
      idempotencyKey: 'run_direct_recent_logs:step_direct_recent_logs:1',
      payload: {
        actionType: 'agent.plan.execute',
        siteName: 'Direct Site',
        bindingSelector: {
          bindingInformation: '*:443:direct-log.example.com',
        },
        dryRun: false,
      },
    }, 'req_enqueue_direct_recent_logs');
    await agentsService.ackTask(tenantId, {
      agentId,
      taskId: directTask.id,
      leaseId: `direct:${directTask.id}`,
    });
    const directLogResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      headers: {
        ...machineHeaders,
        'x-request-id': 'req_submit_direct_log',
      },
      body: {
        agentId,
        taskId: directTask.id,
        sequence: 1,
        level: 'info',
        message: 'direct execute log',
        emittedAt: '2026-06-30T11:01:00.000Z',
      },
    });
    assert.equal(directLogResponse.statusCode, 201);

    const queuedTask = await agentsService.enqueueTask(tenantId, {
      agentId,
      executionRunId: 'run_queued_recent_logs',
      executionStepId: 'step_queued_recent_logs',
      idempotencyKey: 'run_queued_recent_logs:step_queued_recent_logs:1',
      payload: {
        actionType: 'agent.plan.execute',
        siteName: 'Fallback Site',
        bindingSelector: {
          bindingInformation: '*:443:fallback-log.example.com',
        },
        dryRun: true,
      },
    }, 'req_enqueue_queued_recent_logs');
    const queuedLogResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      headers: {
        ...machineHeaders,
        'x-request-id': 'req_submit_queued_log',
      },
      body: {
        agentId,
        taskId: queuedTask.id,
        sequence: 1,
        level: 'warn',
        message: 'queued fallback log',
        emittedAt: '2026-06-30T11:02:00.000Z',
      },
    });
    assert.equal(queuedLogResponse.statusCode, 201);

    const detailResponse = await app.inject({
      method: 'GET',
      path: `/api/v1/agents/detail?agentId=${agentId}`,
      headers: {
        authorization: userAuthorization,
        'x-request-id': 'req_agent_recent_logs_detail',
      },
    });
    assert.equal(detailResponse.statusCode, 200);
    const detail = detailResponse.body as {
      recentTaskLogs: Array<{
        taskId: string;
        executionMode?: 'direct' | 'queued';
        siteName?: string;
        bindingInformation?: string;
        dryRun: boolean;
      }>;
    };

    const directLog = detail.recentTaskLogs.find((item) => item.taskId === directTask.id);
    assert.ok(directLog);
    assert.equal(directLog.executionMode, 'direct');
    assert.equal(directLog.siteName, 'Direct Site');
    assert.equal(directLog.bindingInformation, '*:443:direct-log.example.com');
    assert.equal(directLog.dryRun, false);

    const queuedLog = detail.recentTaskLogs.find((item) => item.taskId === queuedTask.id);
    assert.ok(queuedLog);
    assert.equal(queuedLog.executionMode, 'queued');
    assert.equal(queuedLog.siteName, 'Fallback Site');
    assert.equal(queuedLog.bindingInformation, '*:443:fallback-log.example.com');
    assert.equal(queuedLog.dryRun, true);
  });
});

async function createTestUserAuthorization(app: ReturnType<typeof createApp>, tenantId: string, suffix: string): Promise<string> {
  const security = app.getResource('securityServices') as SecurityServices;
  const username = `agent-api-${suffix}`;
  const password = 'agent-api-test-password';
  await security.auth.createUserWithPassword({
    id: `user_agent_api_${suffix}`,
    username,
    displayName: `Agent API ${suffix}`,
    password,
    status: 'active',
    tenantId,
    tenantName: tenantId,
  });
  const login = await app.inject({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { username, password },
  });
  assert.equal(login.statusCode, 200);
  return `Bearer ${(login.body as { token: string }).token}`;
}
