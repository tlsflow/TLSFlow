import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { AuditService } from '../audits/audit.service.js';
import type { WriteAuditInput } from '../audits/audit.service.js';
import { ForwardingGrantService } from './forwarding-grant.service.js';
import { GatewayAgentProcess } from './gateway-agent-process.js';
import { GatewayTaskAuditWriter, type GatewayTargetHistoryRecord, type GatewayTargetHistoryRepositoryPort } from './gateway-target-history.service.js';
import { GatewayTaskService } from './gateway-task.service.js';
import type { GatewayAgentProfile, Zone } from './gateway-agent.types.js';
import { ReachabilityService } from './reachability.service.js';
import { ZoneRouter } from './zone-router.js';

const now = new Date('2026-06-08T00:00:00.000Z');

const zones: Zone[] = [
  {
    id: 'zone_prod',
    name: '生产区',
    type: 'production',
    enabled: true,
    policy: {
      priority: 10,
      allowedAdapters: ['probe.tcp', 'probe.http', 'probe.agent', 'forward.agent_task', 'forward.direct_control'],
      allowedActions: ['gateway.probe', 'gateway.forward.agent_task', 'gateway.forward.direct_control'],
      maxConcurrentTasks: 10,
    },
  },
];

function gateway(overrides: Partial<GatewayAgentProfile> = {}): GatewayAgentProfile {
  return {
    id: 'gw_001',
    agentId: 'agent_gateway_001',
    zoneIds: ['zone_prod'],
    version: '0.1.0',
    status: 'online',
    adapters: ['probe.tcp', 'probe.http', 'probe.agent', 'forward.agent_task', 'forward.direct_control'],
    capabilities: ['gateway.probe.tcp', 'gateway.probe.http', 'gateway.probe.agent', 'gateway.forward.agent_task', 'gateway.forward.direct_control'],
    capabilitySetId: 'capset_001',
    currentLoad: 0,
    maxConcurrentTasks: 4,
    successRate: 0.95,
    lastHeartbeatAt: now.toISOString(),
    ...overrides,
  };
}

function issueGrant(overrides: Partial<Parameters<ForwardingGrantService['issue']>[0]> = {}) {
  return new ForwardingGrantService().issue({
    gatewayId: 'gw_process',
    delegatedTargetId: 'agent_target_process',
    delegatedAgentId: 'agent_target_process',
    taskType: 'gateway.forward.agent_task',
    routeChannel: 'forward.agent_task',
    executionRunId: 'run_process',
    stepId: 'step_process',
    ...overrides,
  });
}

class MemoryAuditService extends AuditService {
  readonly writes: WriteAuditInput[] = [];

  override async write(input: WriteAuditInput): Promise<any> {
    this.writes.push(input);
    return { id: `audit_${this.writes.length}`, ...input, createdAt: new Date().toISOString() };
  }
}

class MemoryGatewayTargetHistoryRepository implements GatewayTargetHistoryRepositoryPort {
  readonly rows: GatewayTargetHistoryRecord[] = [];

  async append(record: GatewayTargetHistoryRecord): Promise<GatewayTargetHistoryRecord> {
    const existing = this.rows.find((item) => item.id === record.id);
    if (existing) return existing;
    this.rows.push(record);
    return record;
  }

  async listByTarget(delegatedTargetId: string, tenantId?: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.rows.filter((item) => item.delegatedTargetId === delegatedTargetId && (!tenantId || item.tenantId === tenantId));
  }

  async listByTask(taskId: string): Promise<GatewayTargetHistoryRecord[]> {
    return this.rows.filter((item) => item.taskId === taskId);
  }
}

describe('spec014 Gateway 区域路由器', () => {
  it('ZoneRouter 只按 probe/forward 通道选择 Gateway，不依赖协议 Adapter', () => {
    const reachability = new ReachabilityService();
    const fast = gateway({ id: 'gw_fast', currentLoad: 1, successRate: 0.99 });
    const slow = gateway({ id: 'gw_slow', currentLoad: 0, successRate: 0.85 });
    reachability.upsert({ gatewayId: fast.id, targetId: 'host_001', protocol: 'forward.agent_task', status: 'reachable', latencyMs: 20, ttlSeconds: 60, now });
    reachability.upsert({ gatewayId: slow.id, targetId: 'host_001', protocol: 'forward.agent_task', status: 'reachable', latencyMs: 250, ttlSeconds: 60, now });

    const result = new ZoneRouter(zones, [slow, fast], reachability).route({
      zoneId: 'zone_prod',
      targetId: 'host_001',
      protocols: ['forward.agent_task'],
      requiredCapabilities: ['gateway.forward.agent_task'],
      action: 'gateway.forward.agent_task',
      now,
    });

    assert.equal(result.status, 'selected');
    assert.equal(result.selectedGateway?.id, 'gw_fast');
    assert.deepEqual(result.candidateGateways.map((candidate) => candidate.gateway.id), ['gw_fast', 'gw_slow']);
  });

  it('HTTP/CURL 只作为 probe.http 可达性记录参与路由', () => {
    const reachability = new ReachabilityService();
    const gw = gateway();
    reachability.upsert({ gatewayId: gw.id, targetId: 'service_http', protocol: 'probe.http', status: 'reachable', ttlSeconds: 60, now });

    const result = new ZoneRouter(zones, [gw], reachability).route({
      zoneId: 'zone_prod',
      targetId: 'service_http',
      protocols: ['probe.http'],
      requiredCapabilities: ['gateway.probe.http'],
      action: 'gateway.probe',
      now,
    });

    assert.equal(result.status, 'selected');
    assert.equal(result.selectedGateway?.id, gw.id);
  });

  it('GatewayTaskService 记录 gateway.forward.agent_task 的任务、日志和结果', async () => {
    const audit = new MemoryAuditService();
    const history = new MemoryGatewayTargetHistoryRepository();
    const service = new GatewayTaskService({ auditWriter: new GatewayTaskAuditWriter({ audit, history }) });
    const task = service.dispatch({
      id: 'gateway_task_forward_001',
      idempotencyKey: 'idem_gateway_task_forward_001',
      operatorId: 'operator_1',
      planId: 'plan_001',
      executionRunId: 'run_001',
      stepId: 'step_001',
      gatewayId: 'gw_001',
      delegatedTargetId: 'agent_target_001',
      target: { id: 'agent_target_001', zoneId: 'zone_prod' },
      adapter: 'forward.agent_task',
      action: 'gateway.forward.agent_task',
      payload: { type: 'gateway.forward.agent_task', targetPayload: { type: 'linux.nginx.deploy_certificate' } },
      forwardingGrant: issueGrant({
        gatewayId: 'gw_001',
        delegatedTargetId: 'agent_target_001',
        delegatedAgentId: 'agent_target_001',
        executionRunId: 'run_001',
        stepId: 'step_001',
        now: undefined,
      }),
      now,
    });

    service.ack(task.id, 'lease_001', now);
    service.markRunning(task.id, 'lease_001', now);
    const evidence = service.appendEvidence({
      taskId: task.id,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: 'success',
      evidenceRef: 'audit://gateway-route/001',
      kind: 'log',
      summary: 'gateway.forward.agent_task 已包装',
      metadata: {},
      createdAt: now.toISOString(),
    });
    const completed = service.result(task.id, 'lease_001', {
      success: true,
      status: 'success',
      summary: 'Gateway forward 已完成路由包装',
    });

    assert.equal(completed.status, 'success');
    assert.deepEqual(completed.result?.evidenceIds, [evidence.id]);
    assert.equal(service.listEvidence(task.id)[0].adapter, 'forward.agent_task');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(audit.writes.filter((item) => item.eventType === 'gateway.task.result.recorded').length, 1);
    assert.equal((await history.listByTarget('agent_target_001')).length, 2);
  });

  it('GatewayAgentProcess 只处理 gateway.probe/forward 任务，不执行协议 Adapter', async () => {
    const tenantId = 'tenant_gateway_process';
    const agents = new AgentsApplicationService();
    const gatewayAgent = await agents.register(tenantId, {
      agentKey: 'gateway-agent-process-001',
      hostname: 'gw-process-001',
      version: '0.1.0',
      osType: 'linux',
      role: 'gateway',
      zoneIds: ['zone_prod'],
      adapters: ['forward.agent_task'],
      capabilities: ['gateway.forward.agent_task'],
    }, 'req_register_gateway_process');
    const gatewayTasks = new GatewayTaskService();
    const gatewayTask = gatewayTasks.dispatch({
      id: 'gateway_task_process_001',
      idempotencyKey: 'idem_gateway_process_001',
      executionRunId: 'run_process',
      stepId: 'step_process',
      gatewayId: 'gw_process',
      delegatedTargetId: 'agent_target_process',
      target: { id: 'agent_target_process', zoneId: 'zone_prod' },
      adapter: 'forward.agent_task',
      action: 'gateway.forward.agent_task',
      payload: { type: 'gateway.forward.agent_task', targetPayload: { type: 'linux.nginx.deploy_certificate' } },
      forwardingGrant: issueGrant(),
      now,
    });
    const agentTask = await agents.enqueueTask(tenantId, {
      agentId: gatewayAgent.id,
      executionRunId: gatewayTask.executionRunId,
      executionStepId: gatewayTask.stepId,
      idempotencyKey: gatewayTask.idempotencyKey,
      payload: { type: 'gateway.forward.agent_task', gatewayTask, dryRun: false },
    }, 'req_enqueue_gateway_process');

    const process = new GatewayAgentProcess({
      tenantId,
      agentId: gatewayAgent.id,
      agents,
      gatewayTasks,
      leaseFactory: () => 'lease_gateway_process_001',
    });
    const tick = await process.tick();

    assert.deepEqual(tick, { pulled: 1, processed: 1, succeeded: 1, failed: 0 });
    assert.equal(gatewayTasks.get(gatewayTask.id)?.status, 'success');
    assert.equal(gatewayTasks.listEvidence(gatewayTask.id)[0].adapter, 'forward.agent_task');
    const completedAgentTask = (await agents.listTaskQueue(tenantId, gatewayAgent.id)).tasks.find((task) => task.id === agentTask.id)!;
    assert.equal(completedAgentTask.status, 'succeeded');
    assert.equal(gatewayTasks.get(gatewayTask.id)?.forwardingGrant?.status, 'used');
  });

  it('GatewayAgentProcess 缺少 ForwardingGrant 时拒绝转发', async () => {
    const tenantId = 'tenant_gateway_grant_denied';
    const agents = new AgentsApplicationService();
    const gatewayAgent = await agents.register(tenantId, {
      agentKey: 'gateway-agent-grant-denied',
      hostname: 'gw-grant-denied',
      version: '0.1.0',
      osType: 'linux',
      role: 'gateway',
      zoneIds: ['zone_prod'],
      adapters: ['forward.agent_task'],
      capabilities: ['gateway.forward.agent_task'],
    }, 'req_register_gateway_grant_denied');
    const gatewayTasks = new GatewayTaskService();
    const gatewayTask = gatewayTasks.dispatch({
      id: 'gateway_task_grant_denied',
      idempotencyKey: 'idem_gateway_grant_denied',
      executionRunId: 'run_process',
      stepId: 'step_process',
      gatewayId: 'gw_process',
      delegatedTargetId: 'agent_target_process',
      target: { id: 'agent_target_process', zoneId: 'zone_prod' },
      adapter: 'forward.agent_task',
      action: 'gateway.forward.agent_task',
      payload: { type: 'gateway.forward.agent_task', targetPayload: { type: 'linux.nginx.deploy_certificate' } },
      now,
    });
    await agents.enqueueTask(tenantId, {
      agentId: gatewayAgent.id,
      executionRunId: gatewayTask.executionRunId,
      executionStepId: gatewayTask.stepId,
      idempotencyKey: gatewayTask.idempotencyKey,
      payload: { type: 'gateway.forward.agent_task', gatewayTask },
    }, 'req_enqueue_gateway_grant_denied');

    const process = new GatewayAgentProcess({
      tenantId,
      agentId: gatewayAgent.id,
      agents,
      gatewayTasks,
      leaseFactory: () => 'lease_gateway_grant_denied',
    });

    const tick = await process.tick();

    assert.deepEqual(tick, { pulled: 1, processed: 1, succeeded: 0, failed: 1 });
    assert.equal(gatewayTasks.get(gatewayTask.id)?.result?.errorCode, 'GATEWAY_FORWARDING_GRANT_DENIED');
  });
});
