import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { PgAgentsRepository } from '../agents/repository/agents.repository.js';
import { AuditService } from '../audits/audit.service.js';
import type { WriteAuditInput } from '../audits/audit.service.js';
import { ForwardingGrantService } from './forwarding-grant.service.js';
import { GatewayAgentProcess } from './gateway-agent-process.js';
import { computeAgentExecutionReceiptDigest, computeAgentPlanDigest, type AgentExecutionReceiptV1, type AgentPlanV1, type AgentCapabilityTokenV1, type PolicyAuthorityDecisionV1 } from '../agents/security/agent-security.contract.js';
import { GatewayTaskReplayGuard, GatewayV2ForwardingService, GatewayV2ReplayGuard } from './gateway-v2-forwarding.service.js';
import { GatewayTaskAuditWriter, type GatewayTargetHistoryRecord, type GatewayTargetHistoryRepositoryPort } from './gateway-target-history.service.js';
import { GatewayTaskService } from './gateway-task.service.js';
import { createDurableGatewayTaskRepositories } from './gateway-task.repository.js';
import type { GatewayAgentProfile, GatewayAgentTaskResultInput, GatewayAgentV2ForwardRequest, GatewayAgentV2ForwardResult, GatewayAgentV2Forwarder, GatewayGrantV1, Zone } from './gateway-agent.types.js';
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
      allowedAdapters: ['probe.tcp', 'probe.http', 'probe.agent', 'forward.agent_task'],
      allowedActions: ['gateway.probe', 'gateway.forward.agent_task'],
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
    adapters: ['probe.tcp', 'probe.http', 'probe.agent', 'forward.agent_task'],
    capabilities: ['gateway.probe.tcp', 'gateway.probe.http', 'gateway.probe.agent', 'gateway.forward.agent_task'],
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

function createV2Materials(
  tenantId: string,
  agentId: string,
  forwardingGrantId: string,
  status: 'SUCCESS' | 'FAILED' | 'UNKNOWN' = 'SUCCESS',
  options: {
    operationType?: AgentPlanV1['operations'][number]['operationType'];
    operationInput?: Record<string, unknown>;
    capability?: string;
    allowedPaths?: string[];
    allowedServices?: string[];
    artifactDigests?: string[];
  } = {},
) {
  const operationType = options.operationType ?? 'filesystem.read';
  const capability = options.capability ?? operationType;
  const allowedPaths = options.allowedPaths ?? ['/var/lib/gcac'];
  const allowedServices = options.allowedServices ?? [];
  const artifactDigests = options.artifactDigests ?? ['a'.repeat(64)];
  const issuedAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const planBase = {
    planVersion: 'gcac.agent-security/v1' as const,
    planId: 'plan_gateway_v2_001',
    agentId,
    tenantId,
    pluginId: 'web.nginx',
    pluginVersionId: 'plugin-version-1',
    capability,
    operations: [{
      operationId: 'operation-1',
      operationType,
      stage: 'prepare' as const,
      input: options.operationInput ?? { path: '/var/lib/gcac/config.json' },
      dependsOn: [],
      idempotencyKey: 'operation-idempotency-1',
      timeoutSeconds: 30,
    }],
    planDigest: '',
    tokenId: 'token_gateway_v2_001',
    policyDecisionId: 'decision_gateway_v2_001',
    nonce: `nonce_gateway_v2_${Date.now()}`,
    expiresAt,
    writeEffect: true,
  } satisfies AgentPlanV1;
  const plan = { ...planBase, planDigest: computeAgentPlanDigest(planBase) };
  const token: AgentCapabilityTokenV1 = {
    tokenVersion: 'gcac.agent-security/v1',
    tokenId: plan.tokenId,
    agentId,
    tenantId,
    pluginId: plan.pluginId,
    pluginVersionId: plan.pluginVersionId,
    capability: plan.capability,
    actions: [capability],
    allowedPaths,
    allowedServices,
    artifactDigests,
    policyRef: 'policy-gateway-v2-001',
    policyVersion: 'policy-version-1',
    issuedAt,
    expiresAt,
    nonce: plan.nonce,
    planDigest: plan.planDigest,
    authorityKeyId: 'authority-production-1',
    signature: 'signed-capability-token',
  };
  const policyDecision: PolicyAuthorityDecisionV1 = {
    decisionVersion: 'gcac.agent-security/v1',
    decisionId: plan.policyDecisionId,
    allowed: true,
    agentId,
    tenantId,
    pluginId: plan.pluginId,
    pluginVersionId: plan.pluginVersionId,
    capability: plan.capability,
    actions: [capability],
    allowedPaths,
    allowedServices,
    artifactDigests,
    policyRef: token.policyRef,
    policyVersion: token.policyVersion,
    planDigest: plan.planDigest,
    tokenId: token.tokenId,
    nonce: token.nonce,
    issuedAt,
    validUntil: expiresAt,
    authorityKeyId: token.authorityKeyId,
    revocationRef: 'revocation-gateway-v2-001',
    signature: 'signed-policy-decision',
  };
  const grant: GatewayGrantV1 = {
    grantId: 'grant-gateway-v2-001',
    tenantId,
    agentId,
    actionType: 'agent.plan.execute',
    planId: plan.planId,
    planDigest: plan.planDigest,
    pluginId: token.pluginId,
    pluginVersionId: token.pluginVersionId,
    capability: token.capability,
    tokenId: token.tokenId,
    policyDecisionId: policyDecision.decisionId,
    nonce: token.nonce,
    revocationRef: policyDecision.revocationRef,
    forwardingGrantId,
  };
  const receiptBase = {
    receiptVersion: 'gcac.agent-security/v1' as const,
    operationId: 'operation-1',
    planId: plan.planId,
    planDigest: plan.planDigest,
    agentId,
    tenantId,
    tokenId: token.tokenId,
    status,
    startedAt: issuedAt,
    completedAt: new Date().toISOString(),
    operationResults: [{ operationId: 'operation-1', status }],
    nonceConsumed: true,
    ...(status === 'SUCCESS' ? {} : status === 'UNKNOWN' ? { unknownReason: 'Agent 返回结果不明' } : { errorCode: 'AGENT_OPERATION_FAILED' }),
    digest: '',
  } satisfies AgentExecutionReceiptV1;
  const receipt = { ...receiptBase, digest: computeAgentExecutionReceiptDigest(receiptBase) };
  return { plan, token, policyDecision, grant, receipt };
}

class FakeGatewayV2Forwarder implements GatewayAgentV2Forwarder {
  readonly requests: GatewayAgentV2ForwardRequest[] = [];
  constructor(private readonly outcome: 'SUCCESS' | 'FAILED' | 'UNKNOWN' = 'SUCCESS', private readonly throwError = false) {}

  async forward(request: GatewayAgentV2ForwardRequest): Promise<GatewayAgentV2ForwardResult> {
    this.requests.push(structuredClone(request));
    if (this.throwError) throw new Error('模拟 Gateway 到目标 Agent 的连接崩溃');
    const receipt = request.plan ? (() => {
      const base = {
        receiptVersion: 'gcac.agent-security/v1' as const,
        operationId: request.plan.operations[0].operationId,
        planId: request.plan.planId,
        planDigest: request.plan.planDigest,
        agentId: request.token.agentId,
        tenantId: request.tenantId,
        tokenId: request.token.tokenId,
        status: this.outcome,
        startedAt: request.token.issuedAt,
        completedAt: new Date().toISOString(),
        operationResults: [{ operationId: request.plan.operations[0].operationId, status: this.outcome }],
        nonceConsumed: true,
        ...(this.outcome === 'SUCCESS' ? {} : this.outcome === 'UNKNOWN' ? { unknownReason: 'Agent 返回结果不明' } : { errorCode: 'AGENT_OPERATION_FAILED' }),
        digest: '',
      } satisfies AgentExecutionReceiptV1;
      return { ...base, digest: computeAgentExecutionReceiptDigest(base) };
    })() : undefined;
    return {
      accepted: true,
      tenantId: request.tenantId,
      agentId: request.token.agentId,
      actionType: request.actionType,
      tokenId: request.token.tokenId,
      planDigest: request.token.planDigest,
      nonce: request.token.nonce,
      revocationRef: request.policyDecision.revocationRef,
      grantId: request.grant.grantId,
      forwardingGrantId: request.forwardingGrant.id,
      receipt,
    };
  }
}

function dispatchV2Task(tenantId: string, materials: ReturnType<typeof createV2Materials>, forwardingGrant: ReturnType<typeof issueGrant>): GatewayTaskService {
  const service = new GatewayTaskService();
  service.dispatch({
    idempotencyKey: `idem-${materials.token.nonce}`,
    tenantId,
    planId: materials.plan.planId,
    executionRunId: 'run_process',
    stepId: 'step_process',
    gatewayId: forwardingGrant.gatewayId,
    delegatedTargetId: forwardingGrant.delegatedTargetId,
    target: { id: forwardingGrant.delegatedTargetId, zoneId: 'zone_prod' },
    adapter: forwardingGrant.routeChannel,
    action: 'gateway.forward.agent_task',
    payload: { actionType: materials.grant.actionType, token: materials.token, policyDecision: materials.policyDecision, plan: materials.plan },
    grant: materials.grant,
    forwardingGrant,
  });
  return service;
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
  it('拒绝不受支持的 Gateway 路由通道', () => {
    const router = new ZoneRouter(zones, [gateway()], new ReachabilityService());

    assert.throws(() => router.route({
      zoneId: 'zone_prod',
      targetId: 'host_legacy',
      protocols: ['ssh'],
      action: 'gateway.forward.agent_task',
      now,
    }), { errorCode: 'VALIDATION_FAILED' });
  });

  it('GatewayTask 和 ForwardingGrant 都拒绝不受支持的路由通道', () => {
    const gatewayTasks = new GatewayTaskService();
    assert.throws(() => gatewayTasks.dispatch({
      idempotencyKey: 'idem_legacy_gateway_task',
      executionRunId: 'run_legacy_gateway_task',
      stepId: 'step_legacy_gateway_task',
      gatewayId: 'gw_001',
      delegatedTargetId: 'target_legacy_gateway_task',
      target: { id: 'target_legacy_gateway_task', zoneId: 'zone_prod' },
      adapter: 'script_package',
      action: 'gateway.forward.agent_task',
    }), { errorCode: 'VALIDATION_FAILED' });

    assert.throws(() => new ForwardingGrantService().issue({
      gatewayId: 'gw_001',
      delegatedTargetId: 'target_legacy_gateway_task',
      taskType: 'gateway.forward.agent_task',
      routeChannel: 'manual',
      executionRunId: 'run_legacy_gateway_task',
      stepId: 'step_legacy_gateway_task',
    }), { errorCode: 'VALIDATION_FAILED' });
  });

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

  it('Gateway v2 拒绝跨租户、越权路径、服务和 Artifact', () => {
    const forwardingService = new GatewayV2ForwardingService();
    const tenantId = 'tenant_gateway_scope';

    const crossTenantGrant = issueGrant({ tenantId, gatewayId: 'gw_scope', delegatedTargetId: 'agent_scope', delegatedAgentId: 'agent_scope' });
    const crossTenantMaterials = createV2Materials(tenantId, 'agent_scope', crossTenantGrant.id);
    const crossTenantTasks = dispatchV2Task(tenantId, crossTenantMaterials, crossTenantGrant);
    const crossTenantTask = crossTenantTasks.listRecoverable()[0];
    assert.throws(() => forwardingService.prepare(crossTenantTask, 'tenant_other', 'req-cross-tenant'), { errorCode: 'AUTH_FORBIDDEN' });

    const pathGrant = issueGrant({ tenantId, gatewayId: 'gw_scope', delegatedTargetId: 'agent_scope', delegatedAgentId: 'agent_scope' });
    const pathMaterials = createV2Materials(tenantId, 'agent_scope', pathGrant.id, 'SUCCESS', { operationInput: { path: '/etc/shadow' } });
    const pathTask = dispatchV2Task(tenantId, pathMaterials, pathGrant).listRecoverable()[0];
    assert.throws(() => forwardingService.prepare(pathTask, tenantId, 'req-path'), { errorCode: 'AUTH_FORBIDDEN' });

    const serviceGrant = issueGrant({ tenantId, gatewayId: 'gw_scope', delegatedTargetId: 'agent_scope', delegatedAgentId: 'agent_scope' });
    const serviceMaterials = createV2Materials(tenantId, 'agent_scope', serviceGrant.id, 'SUCCESS', {
      operationType: 'service.status',
      capability: 'service.status',
      operationInput: { serviceName: 'sshd' },
      allowedServices: ['nginx'],
    });
    const serviceTask = dispatchV2Task(tenantId, serviceMaterials, serviceGrant).listRecoverable()[0];
    assert.throws(() => forwardingService.prepare(serviceTask, tenantId, 'req-service'), { errorCode: 'AUTH_FORBIDDEN' });

    const artifactGrant = issueGrant({ tenantId, gatewayId: 'gw_scope', delegatedTargetId: 'agent_scope', delegatedAgentId: 'agent_scope' });
    const artifactMaterials = createV2Materials(tenantId, 'agent_scope', artifactGrant.id, 'SUCCESS', { operationInput: { path: '/var/lib/gcac/config.json', artifactDigest: 'b'.repeat(64) } });
    const artifactTask = dispatchV2Task(tenantId, artifactMaterials, artifactGrant).listRecoverable()[0];
    assert.throws(() => forwardingService.prepare(artifactTask, tenantId, 'req-artifact'), { errorCode: 'AUTH_FORBIDDEN' });
  });

  it('Gateway v2 拒绝 Token/Nonce 重放和错误 receipt 绑定', () => {
    const guard = new GatewayV2ReplayGuard();
    const binding = { tenantId: 'tenant-replay', agentId: 'agent-replay', tokenId: 'token-replay', nonce: 'nonce-replay', revocationRef: 'revocation-replay' };
    guard.consume(binding);
    assert.throws(() => guard.consume(binding), { errorCode: 'AUTH_FORBIDDEN' });

    const forwardingService = new GatewayV2ForwardingService();
    const forwardingGrant = issueGrant({ tenantId: 'tenant-receipt', gatewayId: 'gw_receipt', delegatedTargetId: 'agent_receipt', delegatedAgentId: 'agent_receipt' });
    const materials = createV2Materials('tenant-receipt', 'agent_receipt', forwardingGrant.id);
    const task = dispatchV2Task('tenant-receipt', materials, forwardingGrant).listRecoverable()[0];
    const request = forwardingService.prepare(task, 'tenant-receipt', 'req-receipt');
    const invalidReceiptBase = { ...materials.receipt, agentId: 'agent-attacker', digest: '' };
    const invalidReceipt = { ...invalidReceiptBase, digest: computeAgentExecutionReceiptDigest(invalidReceiptBase) };
    assert.throws(() => forwardingService.validateResult(request, {
      accepted: true,
      tenantId: request.tenantId,
      agentId: request.token.agentId,
      actionType: request.actionType,
      tokenId: request.token.tokenId,
      planDigest: request.token.planDigest,
      nonce: request.token.nonce,
      revocationRef: request.policyDecision.revocationRef,
      grantId: request.grant.grantId,
      forwardingGrantId: request.forwardingGrant.id,
      receipt: invalidReceipt,
    }), { errorCode: 'AUTH_FORBIDDEN' });
  });

  it('Gateway Grant 缺少 capability 或 policy decision 绑定时拒绝转发', () => {
    const forwardingService = new GatewayV2ForwardingService();
    const forwardingGrant = issueGrant({ tenantId: 'tenant-grant-binding', gatewayId: 'gw_grant_binding', delegatedTargetId: 'agent_grant_binding', delegatedAgentId: 'agent_grant_binding' });
    const materials = createV2Materials('tenant-grant-binding', 'agent_grant_binding', forwardingGrant.id);
    const task = dispatchV2Task('tenant-grant-binding', materials, forwardingGrant).listRecoverable()[0];

    for (const field of ['capability', 'policyDecisionId'] as const) {
      const malformedGrant = { ...materials.grant, [field]: '' };
      const malformedTask = {
        ...task,
        grant: malformedGrant,
        payload: { ...task.payload, grant: malformedGrant },
      };
      assert.throws(() => forwardingService.prepare(malformedTask, 'tenant-grant-binding', `req-missing-${field}`), { errorCode: 'AUTH_FORBIDDEN' });
    }
  });

  it('GatewayTask 重启恢复已消费 Nonce，并拒绝重放', async () => {
    const tenantId = 'tenant_gateway_restart';
    const db = new PgliteDatabase();
    await runMigrations(db);
    const firstRepositories = await createDurableGatewayTaskRepositories(db);
    const firstService = new GatewayTaskService({ repositories: firstRepositories });
    const forwardingGrant = issueGrant({
      tenantId,
      gatewayId: 'gw_restart',
      delegatedTargetId: 'agent_restart',
      delegatedAgentId: 'agent_restart',
    });
    const materials = createV2Materials(tenantId, 'agent_restart', forwardingGrant.id);
    const task = firstService.dispatch({
      id: 'gateway_task_restart_001',
      idempotencyKey: 'idem_gateway_task_restart_001',
      tenantId,
      planId: materials.plan.planId,
      executionRunId: forwardingGrant.executionRunId,
      stepId: forwardingGrant.stepId,
      gatewayId: forwardingGrant.gatewayId,
      delegatedTargetId: forwardingGrant.delegatedTargetId,
      target: { id: forwardingGrant.delegatedTargetId, zoneId: 'zone_prod' },
      adapter: forwardingGrant.routeChannel,
      action: 'gateway.forward.agent_task',
      payload: { actionType: materials.grant.actionType, token: materials.token, policyDecision: materials.policyDecision, plan: materials.plan },
      grant: materials.grant,
      forwardingGrant,
    });
    const binding = {
      taskId: task.id,
      tenantId,
      agentId: materials.token.agentId,
      tokenId: materials.token.tokenId,
      nonce: materials.token.nonce,
      revocationRef: materials.policyDecision.revocationRef,
    };
    const consumedForwardingGrant = new ForwardingGrantService().consume(forwardingGrant);
    new GatewayTaskReplayGuard(firstService).consume(binding, consumedForwardingGrant);
    await firstService.flushPersistence();

    const restartedRepositories = await createDurableGatewayTaskRepositories(db);
    const restartedService = new GatewayTaskService({ repositories: restartedRepositories });
    const restored = restartedService.get(task.id);

    assert.equal(restored?.forwardingGrant?.status, 'used');
    assert.equal(restored?.forwardingGrant?.remainingUses, 0);
    assert.equal(restored?.v2NonceBinding?.nonce, materials.token.nonce);
    assert.equal(typeof restored?.v2NonceBinding?.consumedAt, 'string');
    assert.throws(
      () => restartedService.assertV2NonceAvailable(binding),
      { errorCode: 'AUTH_FORBIDDEN' },
    );
    assert.throws(
      () => new GatewayTaskReplayGuard(restartedService).assertAvailable(binding),
      { errorCode: 'AUTH_FORBIDDEN' },
    );
  });

  it('GatewayTask Receipt 回写严格绑定 Agent，并拒绝已落账任务的替换 Receipt', async () => {
    const tenantId = 'tenant_gateway_result_binding';
    const delegatedTargetId = 'managed-target-result-binding';
    const delegatedAgentId = 'agent-result-binding';
    const db = new PgliteDatabase();
    await runMigrations(db);
    const service = new GatewayTaskService({ repositories: await createDurableGatewayTaskRepositories(db) });
    const forwardingGrant = issueGrant({
      tenantId,
      gatewayId: 'gw_result_binding',
      delegatedTargetId,
      delegatedAgentId,
      executionRunId: 'run_result_binding',
      stepId: 'step_result_binding',
    });
    const materials = createV2Materials(tenantId, delegatedAgentId, forwardingGrant.id);
    const task = service.dispatch({
      id: 'gateway_task_result_binding',
      idempotencyKey: 'idem_gateway_task_result_binding',
      tenantId,
      planId: materials.plan.planId,
      executionRunId: forwardingGrant.executionRunId,
      stepId: forwardingGrant.stepId,
      gatewayId: forwardingGrant.gatewayId,
      delegatedTargetId,
      target: { id: delegatedTargetId, zoneId: 'zone_prod' },
      adapter: forwardingGrant.routeChannel,
      action: 'gateway.forward.agent_task',
      payload: { actionType: materials.grant.actionType, ...materials },
      grant: materials.grant,
      forwardingGrant,
    });
    const resultInput: GatewayAgentTaskResultInput = {
      gatewayTaskId: task.id,
      agentTaskId: 'agent-task-result-binding',
      tenantId,
      agentId: delegatedTargetId,
      leaseId: 'lease-result-binding',
      actionType: 'agent.plan.execute',
      success: true,
      executionStatus: 'SUCCESS',
      detail: { receipt: materials.receipt },
      receipt: materials.receipt,
    };

    await assert.rejects(service.recordAgentTaskResult(resultInput), { errorCode: 'AUTH_FORBIDDEN' });

    const completed = await service.recordAgentTaskResult({
      ...resultInput,
      agentId: delegatedAgentId,
    });
    assert.equal(completed.result?.receipt?.digest, materials.receipt.digest);

    const lateReceiptBase = {
      ...materials.receipt,
      completedAt: new Date(Date.now() - 500).toISOString(),
      digest: '',
    };
    const lateReceipt = { ...lateReceiptBase, digest: computeAgentExecutionReceiptDigest(lateReceiptBase) };
    await assert.rejects(
      service.recordAgentTaskResult({ ...resultInput, agentId: delegatedAgentId, receipt: lateReceipt, detail: { receipt: lateReceipt } }),
      { errorCode: 'RESOURCE_VERSION_CONFLICT' },
    );
  });

  it('GatewayAgentProcess 未装配持久化 GatewayTask 时失败关闭', () => {
    assert.throws(
      () => new GatewayAgentProcess({
        tenantId: 'tenant_gateway_no_persistence',
        agentId: 'agent_gateway_no_persistence',
        agents: new AgentsApplicationService(),
        gatewayTasks: new GatewayTaskService(),
      }),
      { errorCode: 'EXECUTION_TARGET_UNAVAILABLE' },
    );
  });

  it('GatewayAgentProcess 必须把完整 Agent v2 授权材料转发给真实 Agent，并只接受真实 receipt', async () => {
    const tenantId = 'tenant_gateway_process';
    const db = new PgliteDatabase();
    await runMigrations(db);
    const agents = new AgentsApplicationService(new PgAgentsRepository(db));
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
    const gatewayTasks = new GatewayTaskService({ repositories: await createDurableGatewayTaskRepositories(db) });
    const forwardingGrant = issueGrant({ tenantId, gatewayId: 'gw_process', delegatedTargetId: 'agent_target_process', delegatedAgentId: 'agent_target_process' });
    const materials = createV2Materials(tenantId, 'agent_target_process', forwardingGrant.id);
    const gatewayTask = gatewayTasks.dispatch({
      id: 'gateway_task_process_001',
      idempotencyKey: 'idem_gateway_process_001',
      planId: materials.plan.planId,
      executionRunId: 'run_process',
      stepId: 'step_process',
      gatewayId: 'gw_process',
      delegatedTargetId: 'agent_target_process',
      target: { id: 'agent_target_process', zoneId: 'zone_prod' },
      adapter: 'forward.agent_task',
      action: 'gateway.forward.agent_task',
      payload: { actionType: 'agent.plan.execute', ...materials },
      grant: materials.grant,
      tenantId,
      forwardingGrant,
      now,
    });
    const agentTask = await agents.enqueueTask(tenantId, {
      agentId: gatewayAgent.id,
      executionRunId: gatewayTask.executionRunId,
      executionStepId: gatewayTask.stepId,
      idempotencyKey: gatewayTask.idempotencyKey,
      payload: {
        actionType: 'agent.plan.execute',
        token: materials.token,
        policyDecision: materials.policyDecision,
        plan: materials.plan,
        gatewayTask,
        dryRun: false,
      },
    }, 'req_enqueue_gateway_process');

    const process = new GatewayAgentProcess({
      tenantId,
      agentId: gatewayAgent.id,
      agents,
      gatewayTasks,
      forwarder: new FakeGatewayV2Forwarder(),
      leaseFactory: () => 'lease_gateway_process_001',
    });
    const tick = await process.tick();

    assert.deepEqual(tick, { pulled: 1, processed: 1, succeeded: 1, failed: 0 });
    assert.equal(gatewayTasks.get(gatewayTask.id)?.status, 'success');
    assert.equal(gatewayTasks.get(gatewayTask.id)?.result?.executionStatus, 'SUCCESS');
    assert.equal(gatewayTasks.listEvidence(gatewayTask.id)[0].adapter, 'forward.agent_task');
    const completedAgentTask = (await agents.listTaskQueue(tenantId, gatewayAgent.id)).tasks.find((task) => task.id === agentTask.id)!;
    assert.equal(completedAgentTask.status, 'succeeded');
    assert.equal(gatewayTasks.get(gatewayTask.id)?.forwardingGrant?.status, 'used');
    assert.equal(gatewayTasks.get(gatewayTask.id)?.result?.receipt?.planDigest, materials.plan.planDigest);
  });

  it('GatewayAgentProcess 缺少 ForwardingGrant 时拒绝转发', async () => {
    const tenantId = 'tenant_gateway_grant_denied';
    const db = new PgliteDatabase();
    await runMigrations(db);
    const agents = new AgentsApplicationService(new PgAgentsRepository(db));
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
    const gatewayTasks = new GatewayTaskService({ repositories: await createDurableGatewayTaskRepositories(db) });
    const materials = createV2Materials(tenantId, 'agent_target_process', 'missing-forwarding-grant');
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
      payload: { actionType: 'agent.plan.execute', ...materials },
      grant: materials.grant,
      tenantId,
      now,
    });
    await agents.enqueueTask(tenantId, {
      agentId: gatewayAgent.id,
      executionRunId: gatewayTask.executionRunId,
      executionStepId: gatewayTask.stepId,
      idempotencyKey: gatewayTask.idempotencyKey,
      payload: { actionType: 'agent.plan.execute', gatewayTask },
    }, 'req_enqueue_gateway_grant_denied');

    const process = new GatewayAgentProcess({
      tenantId,
      agentId: gatewayAgent.id,
      agents,
      gatewayTasks,
      forwarder: new FakeGatewayV2Forwarder(),
      leaseFactory: () => 'lease_gateway_grant_denied',
    });

    const tick = await process.tick();

    assert.deepEqual(tick, { pulled: 1, processed: 1, succeeded: 0, failed: 1 });
    assert.equal(gatewayTasks.get(gatewayTask.id)?.result?.errorCode, 'AUTH_FORBIDDEN');
  });

  it('真实 AgentTask Receipt 通过 Agent v2 主链回写 GatewayTask 并消费 Nonce', async () => {
    const tenantId = 'tenant_gateway_receipt_sync';
    const db = new PgliteDatabase();
    await runMigrations(db);
    const agents = new AgentsApplicationService(new PgAgentsRepository(db));
    const gatewayAgent = await agents.register(tenantId, {
      agentKey: 'gateway-agent-receipt-sync',
      hostname: 'gw-receipt-sync',
      version: '0.1.0',
      osType: 'linux',
      role: 'gateway',
      zoneIds: ['zone_prod'],
      adapters: ['forward.agent_task'],
      capabilities: ['gateway.forward.agent_task'],
    }, 'req_register_gateway_receipt_sync');
    const gatewayTasks = new GatewayTaskService({ repositories: await createDurableGatewayTaskRepositories(db) });
    agents.setGatewayTaskResultSink(gatewayTasks);
    const forwardingGrant = issueGrant({
      tenantId,
      gatewayId: 'gw_receipt_sync',
      delegatedTargetId: 'agent_target_receipt_sync',
      delegatedAgentId: 'agent_target_receipt_sync',
      executionRunId: 'run_receipt_sync',
      stepId: 'step_receipt_sync',
    });
    const materials = createV2Materials(tenantId, 'agent_target_receipt_sync', forwardingGrant.id, 'UNKNOWN');
    const gatewayTask = gatewayTasks.dispatch({
      id: 'gateway_task_receipt_sync',
      idempotencyKey: 'idem_gateway_receipt_sync',
      tenantId,
      planId: materials.plan.planId,
      executionRunId: forwardingGrant.executionRunId,
      stepId: forwardingGrant.stepId,
      gatewayId: forwardingGrant.gatewayId,
      delegatedTargetId: forwardingGrant.delegatedTargetId,
      target: { id: forwardingGrant.delegatedTargetId, zoneId: 'zone_prod' },
      adapter: forwardingGrant.routeChannel,
      action: 'gateway.forward.agent_task',
      payload: { actionType: materials.grant.actionType, ...materials },
      grant: materials.grant,
      forwardingGrant,
    });
    const agentTask = await agents.enqueueTask(tenantId, {
      agentId: gatewayAgent.id,
      executionRunId: gatewayTask.executionRunId,
      executionStepId: gatewayTask.stepId,
      idempotencyKey: gatewayTask.idempotencyKey,
      payload: {
        actionType: materials.grant.actionType,
        token: materials.token,
        policyDecision: materials.policyDecision,
        plan: materials.plan,
        gatewayTask,
      },
    }, 'req_enqueue_gateway_receipt_sync');
    const leaseId = 'lease_gateway_receipt_sync';
    await agents.ackTask(tenantId, { agentId: gatewayAgent.id, taskId: agentTask.id, leaseId });

    await agents.submitResult(tenantId, {
      agentId: gatewayAgent.id,
      taskId: agentTask.id,
      leaseId,
      success: false,
      status: 'UNKNOWN',
      errorCode: 'AGENT_CONNECTION_LOST',
      detail: { receipt: materials.receipt },
    });

    const completed = gatewayTasks.get(gatewayTask.id)!;
    assert.equal(completed.status, 'unknown');
    assert.equal(completed.result?.executionStatus, 'UNKNOWN');
    assert.equal(completed.result?.receipt?.digest, materials.receipt.digest);
    assert.equal(completed.forwardingGrant?.status, 'used');
    assert.equal(completed.v2NonceBinding?.nonce, materials.token.nonce);
    assert.equal(gatewayTasks.listEvidence(gatewayTask.id).length, 1);
  });

  it('目标 Agent 崩溃或超时后写入 UNKNOWN，ForwardingGrant 和 nonce 均禁止重放', async () => {
    const tenantId = 'tenant_gateway_unknown';
    const db = new PgliteDatabase();
    await runMigrations(db);
    const agents = new AgentsApplicationService(new PgAgentsRepository(db));
    const gatewayAgent = await agents.register(tenantId, {
      agentKey: 'gateway-agent-unknown', hostname: 'gw-unknown', version: '0.1.0', osType: 'linux', role: 'gateway',
      zoneIds: ['zone_prod'], adapters: ['forward.agent_task'], capabilities: ['gateway.forward.agent_task'],
    }, 'req_register_gateway_unknown');
    const gatewayTasks = new GatewayTaskService({ repositories: await createDurableGatewayTaskRepositories(db) });
    const forwardingGrant = issueGrant({ tenantId, gatewayId: 'gw_unknown', delegatedTargetId: 'agent_unknown', delegatedAgentId: 'agent_unknown', executionRunId: 'run_unknown', stepId: 'step_unknown' });
    const materials = createV2Materials(tenantId, 'agent_unknown', forwardingGrant.id);
    const gatewayTask = gatewayTasks.dispatch({
      id: 'gateway_task_unknown', idempotencyKey: 'idem_gateway_unknown', tenantId, planId: materials.plan.planId,
      executionRunId: 'run_unknown', stepId: 'step_unknown', gatewayId: 'gw_unknown', delegatedTargetId: 'agent_unknown',
      target: { id: 'agent_unknown', zoneId: 'zone_prod' }, adapter: 'forward.agent_task', action: 'gateway.forward.agent_task',
      payload: { actionType: 'agent.plan.execute', ...materials }, grant: materials.grant, forwardingGrant,
    });
    const agentTask = await agents.enqueueTask(tenantId, {
      agentId: gatewayAgent.id, executionRunId: gatewayTask.executionRunId, executionStepId: gatewayTask.stepId,
      idempotencyKey: gatewayTask.idempotencyKey,
      payload: {
        actionType: 'agent.plan.execute',
        token: materials.token,
        policyDecision: materials.policyDecision,
        plan: materials.plan,
        gatewayTask,
      },
    }, 'req_enqueue_gateway_unknown');
    const forwarder = new FakeGatewayV2Forwarder('SUCCESS', true);
    const process = new GatewayAgentProcess({ tenantId, agentId: gatewayAgent.id, agents, gatewayTasks, forwarder, leaseFactory: () => 'lease_gateway_unknown' });

    const tick = await process.tick();

    assert.deepEqual(tick, { pulled: 1, processed: 1, succeeded: 0, failed: 1 });
    assert.equal(gatewayTasks.get(gatewayTask.id)?.status, 'unknown');
    assert.equal(gatewayTasks.get(gatewayTask.id)?.result?.executionStatus, 'UNKNOWN');
    assert.equal(gatewayTasks.get(gatewayTask.id)?.forwardingGrant?.status, 'used');
    assert.equal(gatewayTasks.get(gatewayTask.id)?.v2NonceBinding?.nonce, materials.token.nonce);
    assert.equal(forwarder.requests.length, 1);
    const completedAgentTask = (await agents.listTaskQueue(tenantId, gatewayAgent.id)).tasks.find((task) => task.id === agentTask.id)!;
    assert.equal(completedAgentTask.result?.status, 'UNKNOWN');
  });
});
