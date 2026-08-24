import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AgentsApplicationService } from './application/agents.application-service.js';

describe('Agent direct control api', () => {
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
    assert.equal(second.status, 'ONLINE');
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
    const app = createApp({ db: database });
    const headers = {
      'x-tenant-id': 'tenant_agent_direct_control',
      'x-request-id': 'req_agent_direct_control_register',
    };

    const registerResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'win-go-direct-control-01',
        hostname: 'WIN-GO-01',
        version: '0.1.0',
        osType: 'windows',
        arch: 'amd64',
        zone: 'default',
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
        ...headers,
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
        ...headers,
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
    const app = createApp({ db: database });
    const headers = {
      'x-tenant-id': 'tenant_agent_recent_logs',
      'x-request-id': 'req_agent_recent_logs_register',
    };

    const registerResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'win-go-direct-control-02',
        hostname: 'WIN-GO-02',
        version: '0.1.0',
        osType: 'windows',
        arch: 'amd64',
        zone: 'default',
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: '10.10.0.10:18930',
          protocolVersion: 'v1',
          supportedActions: ['health', 'discovery.run', 'windows.iis.deploy_certificate'],
          lastReadyAt: '2026-06-30T11:00:00.000Z',
        },
      },
    });
    assert.equal(registerResponse.statusCode, 201);
    const agentId = (registerResponse.body as { id: string }).id;

    const agentsService = app.getResource('agentsService') as AgentsApplicationService;
    const directTask = await agentsService.enqueueTask(headers['x-tenant-id'], {
      agentId,
      executionRunId: 'run_direct_recent_logs',
      executionStepId: 'step_direct_recent_logs',
      idempotencyKey: 'run_direct_recent_logs:step_direct_recent_logs:1',
      payload: {
        type: 'windows.iis.deploy_certificate',
        siteName: 'Direct Site',
        bindingSelector: {
          bindingInformation: '*:443:direct-log.example.com',
        },
        dryRun: false,
      },
    }, 'req_enqueue_direct_recent_logs');
    await agentsService.ackTask(headers['x-tenant-id'], {
      agentId,
      taskId: directTask.id,
      leaseId: `direct:${directTask.id}`,
    });
    const directLogResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      headers: {
        ...headers,
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

    const queuedTask = await agentsService.enqueueTask(headers['x-tenant-id'], {
      agentId,
      executionRunId: 'run_queued_recent_logs',
      executionStepId: 'step_queued_recent_logs',
      idempotencyKey: 'run_queued_recent_logs:step_queued_recent_logs:1',
      payload: {
        type: 'windows.iis.deploy_certificate',
        siteName: 'Fallback Site',
        bindingSelector: {
          bindingInformation: '*:443:fallback-log.example.com',
        },
        dryRun: true,
        dispatchDetail: {
          mode: 'agent_task_enqueued',
          directFallback: {
            attempted: true,
            errorCode: 'EXECUTION_TARGET_UNAVAILABLE',
            errorMessage: 'connect ECONNREFUSED 127.0.0.1:9',
          },
        },
      },
    }, 'req_enqueue_queued_recent_logs');
    const queuedLogResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/tasks/logs',
      headers: {
        ...headers,
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
        ...headers,
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
        directFallback?: {
          attempted: boolean;
          errorCode?: string;
          errorMessage?: string;
        };
      }>;
    };

    const directLog = detail.recentTaskLogs.find((item) => item.taskId === directTask.id);
    assert.ok(directLog);
    assert.equal(directLog.executionMode, 'direct');
    assert.equal(directLog.siteName, 'Direct Site');
    assert.equal(directLog.bindingInformation, '*:443:direct-log.example.com');
    assert.equal(directLog.dryRun, false);
    assert.equal(directLog.directFallback, undefined);

    const queuedLog = detail.recentTaskLogs.find((item) => item.taskId === queuedTask.id);
    assert.ok(queuedLog);
    assert.equal(queuedLog.executionMode, 'queued');
    assert.equal(queuedLog.siteName, 'Fallback Site');
    assert.equal(queuedLog.bindingInformation, '*:443:fallback-log.example.com');
    assert.equal(queuedLog.dryRun, true);
    assert.equal(queuedLog.directFallback?.attempted, true);
    assert.equal(queuedLog.directFallback?.errorCode, 'EXECUTION_TARGET_UNAVAILABLE');
    assert.equal(queuedLog.directFallback?.errorMessage, 'connect ECONNREFUSED 127.0.0.1:9');
  });
});
