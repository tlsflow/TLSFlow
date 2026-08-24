import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MockAdapterRuntime, curlMockAdapter, sshMockAdapter, winRmMockAdapter } from './adapter-runtime.mock.js';
import { MockCredentialBroker } from './credential-broker.mock.js';
import { GatewayCredentialBroker } from './credential-broker.service.js';
import { GatewayAgentProcess } from './gateway-agent-process.js';
import { GatewayTaskService } from './gateway-task.service.js';
import type { AdapterContext, AdapterExecutionResult, GatewayAdapterDescriptor, GatewayAgentProfile, GatewayTask, Zone } from './gateway-agent.types.js';
import { ReachabilityService } from './reachability.service.js';
import { ZoneRouter } from './zone-router.js';
import { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { PermissionBroker } from '../security/permission-broker.service.js';
import { RBACService } from '../rbac/rbac.service.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { PluginPermissionService } from '../plugins/plugin-permission.service.js';
import { AuditService } from '../audits/audit.service.js';

const now = new Date('2026-06-08T00:00:00.000Z');

const zones: Zone[] = [
  {
    id: 'zone_prod',
    name: '生产区',
    type: 'production',
    enabled: true,
    policy: {
      priority: 10,
      allowedAdapters: ['ssh', 'winrm', 'curl'],
      allowedActions: ['read', 'write', 'exec', 'upload'],
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
    adapters: ['ssh', 'curl'],
    capabilities: ['adapter.ssh', 'adapter.curl', 'cert.deploy'],
    capabilitySetId: 'capset_001',
    currentLoad: 0,
    maxConcurrentTasks: 4,
    successRate: 0.95,
    lastHeartbeatAt: now.toISOString(),
    ...overrides,
  };
}

function createCredentialBrokerFixture() {
  const audit = new AuditService();
  const rbac = new RBACService(undefined, undefined, undefined, undefined, audit);
  const approvals = new ApprovalService();
  const grants = new ExecutionGrantService();
  const permissionBroker = new PermissionBroker(rbac, approvals, grants, new PluginPermissionService());
  const broker = new GatewayCredentialBroker(permissionBroker, grants, audit);
  const subject = { id: 'operator_1', type: 'user' as const };
  const baseInput = {
    subject,
    taskId: 'task_cred_prod',
    operatorId: subject.id,
    executionRunId: 'run_cred_prod',
    stepId: 'step_cred_prod',
    gatewayId: 'gw_001',
    targetId: 'host_001',
    protocol: 'ssh' as const,
    secretRef: 'secret://ssh_key/sec_prod#v1',
    requestedActions: ['exec'],
    ttlSeconds: 60,
    now: new Date(),
  };

  return { audit, rbac, approvals, grants, broker, subject, baseInput };
}

function createGatewayTaskInput(overrides: Partial<Parameters<GatewayTaskService['dispatch']>[0]> = {}): Parameters<GatewayTaskService['dispatch']>[0] {
  return {
    id: 'gateway_task_fixture_001',
    idempotencyKey: 'idem_gateway_task_fixture_001',
    operatorId: 'operator_1',
    planId: 'plan_fixture',
    executionRunId: 'run_fixture',
    stepId: 'step_fixture',
    gatewayId: 'gw_fixture',
    delegatedTargetId: 'host_fixture',
    target: { id: 'host_fixture', zoneId: 'zone_prod', host: '10.0.0.30', port: 22 },
    adapter: 'ssh',
    action: 'exec',
    payload: { commandRef: 'secret://commands/fixture' },
    credentialSessionId: 'cred_sess_fixture',
    credentialLeaseId: 'lease_cred_fixture',
    now,
    ...overrides,
  };
}

async function createGatewayProcessFixture(idSuffix: string, gatewayTasks: GatewayTaskService = new GatewayTaskService()) {
  const tenantId = `tenant_gateway_${idSuffix}`;
  const agents = new AgentsApplicationService();
  const gatewayAgent = await agents.register(tenantId, {
    agentKey: `gateway-agent-${idSuffix}`,
    hostname: `gw-${idSuffix}`,
    version: '0.1.0',
    osType: 'linux',
    role: 'gateway',
    zoneIds: ['zone_prod'],
    adapters: ['ssh'],
    capabilities: ['adapter.ssh'],
  }, `req_register_${idSuffix}`);
  const gatewayTask = gatewayTasks.dispatch(createGatewayTaskInput({
    id: `gateway_task_${idSuffix}`,
    idempotencyKey: `idem_gateway_${idSuffix}`,
  }));
  const agentTask = await agents.enqueueTask(tenantId, {
    agentId: gatewayAgent.id,
    executionRunId: gatewayTask.executionRunId,
    executionStepId: gatewayTask.stepId,
    idempotencyKey: gatewayTask.idempotencyKey,
    payload: { type: 'gateway.task.run', gatewayTask, dryRun: false },
  }, `req_enqueue_${idSuffix}`);
  return { tenantId, agents, gatewayAgent, gatewayTasks, gatewayTask, agentTask };
}

function countingRuntime(counter: { runs: number }, evidenceSequence = 1): MockAdapterRuntime {
  const descriptor: GatewayAdapterDescriptor = {
    ...sshMockAdapter,
    run(ctx: AdapterContext, task: GatewayTask): AdapterExecutionResult {
      counter.runs += 1;
      return {
        success: true,
        status: 'success',
        summary: '恢复执行成功',
        evidence: [{
          taskId: task.id,
          operatorId: task.operatorId,
          planId: task.planId,
          executionRunId: task.executionRunId,
          stepId: task.stepId,
          gatewayId: ctx.gatewayId,
          delegatedTargetId: task.delegatedTargetId,
          adapter: task.adapter,
          credentialSessionId: ctx.credentialSessionId,
          credentialLeaseId: task.credentialLeaseId,
          action: task.action,
          result: 'success',
          evidenceRef: `audit://gateway-evidence/${task.id}/${evidenceSequence}`,
          sequence: evidenceSequence,
          kind: 'command_summary',
          summary: '恢复任务日志 sequence=1',
          metadata: { sequence: evidenceSequence },
        }],
      };
    },
  };
  return new MockAdapterRuntime([descriptor]);
}

describe('spec014 Gateway Agent 与隔离区执行 mock-safe 闭环', () => {
  it('ZoneRouter 按 zone、capability、reachability、load、status 选择最优 Gateway，并保留 failover 候选', () => {
    const reachability = new ReachabilityService();
    const fast = gateway({ id: 'gw_fast', currentLoad: 1, successRate: 0.99 });
    const slow = gateway({ id: 'gw_slow', currentLoad: 0, successRate: 0.85 });
    const offline = gateway({ id: 'gw_offline', status: 'offline' });

    reachability.upsert({ gatewayId: fast.id, targetId: 'host_001', protocol: 'ssh', status: 'reachable', latencyMs: 20, ttlSeconds: 60, now });
    reachability.upsert({ gatewayId: slow.id, targetId: 'host_001', protocol: 'ssh', status: 'reachable', latencyMs: 250, ttlSeconds: 60, now });
    reachability.upsert({ gatewayId: offline.id, targetId: 'host_001', protocol: 'ssh', status: 'reachable', latencyMs: 1, ttlSeconds: 60, now });

    const result = new ZoneRouter(zones, [slow, offline, fast], reachability).route({
      zoneId: 'zone_prod',
      targetId: 'host_001',
      protocols: ['ssh'],
      requiredCapabilities: ['cert.deploy'],
      now,
    });

    assert.equal(result.selectedGateway?.id, 'gw_fast');
    assert.deepEqual(result.candidateGateways.map((candidate) => candidate.gateway.id), ['gw_fast', 'gw_slow']);
    assert.equal(result.fallbackSuggestions.length, 0);
  });

  it('ReachabilityRecord 过期后阻止破坏性执行并返回降级建议', () => {
    const reachability = new ReachabilityService();
    const gw = gateway();
    reachability.upsert({
      gatewayId: gw.id,
      targetId: 'host_002',
      protocol: 'ssh',
      status: 'reachable',
      latencyMs: 10,
      ttlSeconds: 1,
      now,
    });

    const result = new ZoneRouter(zones, [gw], reachability).route({
      zoneId: 'zone_prod',
      targetId: 'host_002',
      protocols: ['ssh'],
      requiredCapabilities: ['cert.deploy'],
      destructive: true,
      now: new Date('2026-06-08T00:00:02.000Z'),
    });

    assert.equal(result.selectedGateway, undefined);
    assert.equal(result.blockedReason, 'reachability_expired');
    assert.deepEqual(result.fallbackSuggestions, ['script_package', 'manual']);
  });

  it('维护窗口外直接 blocked，不进入 Gateway 选择', () => {
    const reachability = new ReachabilityService();
    const gw = gateway();
    reachability.upsert({ gatewayId: gw.id, targetId: 'host_window', protocol: 'ssh', status: 'reachable', ttlSeconds: 60, now });

    const result = new ZoneRouter(
      [
        {
          ...zones[0],
          policy: {
            ...zones[0].policy,
            maintenanceWindow: { start: '01:00', end: '02:00', timeZone: 'UTC' },
          },
        },
      ],
      [gw],
      reachability,
    ).route({
      zoneId: 'zone_prod',
      targetId: 'host_window',
      protocols: ['ssh'],
      action: 'read',
      now,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.blockedReason, 'maintenance_window_closed');
    assert.equal(result.selectedGateway, undefined);
  });

  it('Gateway currentLoad 超限时不进入候选，只选择仍有容量的 Gateway', () => {
    const reachability = new ReachabilityService();
    const saturated = gateway({ id: 'gw_saturated', currentLoad: 4, maxConcurrentTasks: 4, successRate: 1 });
    const spare = gateway({ id: 'gw_spare', currentLoad: 3, maxConcurrentTasks: 4, successRate: 0.8 });
    reachability.upsert({ gatewayId: saturated.id, targetId: 'host_load', protocol: 'ssh', status: 'reachable', ttlSeconds: 60, now });
    reachability.upsert({ gatewayId: spare.id, targetId: 'host_load', protocol: 'ssh', status: 'reachable', ttlSeconds: 60, now });

    const result = new ZoneRouter(zones, [saturated, spare], reachability).route({
      zoneId: 'zone_prod',
      targetId: 'host_load',
      protocols: ['ssh'],
      requiredCapabilities: ['cert.deploy'],
      action: 'read',
      now,
    });

    assert.equal(result.status, 'selected');
    assert.equal(result.selectedGateway?.id, 'gw_spare');
    assert.deepEqual(result.candidateGateways.map((candidate) => candidate.gateway.id), ['gw_spare']);
  });

  it('Zone maxConcurrentTasks 达到上限时直接 blocked', () => {
    const reachability = new ReachabilityService();
    const busy = gateway({ id: 'gw_busy', currentLoad: 2, maxConcurrentTasks: 4 });
    reachability.upsert({ gatewayId: busy.id, targetId: 'host_zone_load', protocol: 'ssh', status: 'reachable', ttlSeconds: 60, now });

    const result = new ZoneRouter(
      [{ ...zones[0], policy: { ...zones[0].policy, maxConcurrentTasks: 2 } }],
      [busy],
      reachability,
    ).route({
      zoneId: 'zone_prod',
      targetId: 'host_zone_load',
      protocols: ['ssh'],
      action: 'read',
      now,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.blockedReason, 'zone_concurrency_limit');
  });

  it('allowedActions 不允许 write/install 时 blocked', () => {
    const reachability = new ReachabilityService();
    const gw = gateway();
    reachability.upsert({ gatewayId: gw.id, targetId: 'host_action', protocol: 'ssh', status: 'reachable', ttlSeconds: 60, now });
    const readOnlyZone = [{ ...zones[0], policy: { ...zones[0].policy, allowedActions: ['read'] } }];
    const router = new ZoneRouter(readOnlyZone, [gw], reachability);

    const write = router.route({
      zoneId: 'zone_prod',
      targetId: 'host_action',
      protocols: ['ssh'],
      action: 'write',
      now,
    });
    const install = router.route({
      zoneId: 'zone_prod',
      targetId: 'host_action',
      protocols: ['ssh'],
      action: 'install',
      now,
    });

    assert.equal(write.status, 'blocked');
    assert.equal(write.blockedReason, 'action_not_allowed');
    assert.equal(install.status, 'blocked');
    assert.equal(install.blockedReason, 'action_not_allowed');
  });

  it('同目标锁存在时直接 blocked，硬禁止并发命中同一 target', () => {
    const reachability = new ReachabilityService();
    const gw = gateway();
    reachability.upsert({ gatewayId: gw.id, targetId: 'host_locked', protocol: 'ssh', status: 'reachable', ttlSeconds: 60, now });

    const result = new ZoneRouter(zones, [gw], reachability).route({
      zoneId: 'zone_prod',
      targetId: 'host_locked',
      protocols: ['ssh'],
      action: 'read',
      lockedTargetIds: ['host_locked'],
      now,
    });

    assert.equal(result.status, 'blocked');
    assert.equal(result.blockedReason, 'target_locked');
    assert.equal(result.selectedGateway, undefined);
  });

  it('requireApproval 对高风险动作返回 approvalRequired，破坏性任务可判定', () => {
    const reachability = new ReachabilityService();
    const gw = gateway();
    reachability.upsert({ gatewayId: gw.id, targetId: 'host_approval', protocol: 'ssh', status: 'reachable', ttlSeconds: 60, now });

    const result = new ZoneRouter(
      [{ ...zones[0], policy: { ...zones[0].policy, requireApproval: true } }],
      [gw],
      reachability,
    ).route({
      zoneId: 'zone_prod',
      targetId: 'host_approval',
      protocols: ['ssh'],
      action: 'write',
      destructive: true,
      now,
    });

    assert.equal(result.status, 'approvalRequired');
    assert.equal(result.approvalReason, 'zone_requires_approval');
    assert.equal(result.selectedGateway, undefined);
    assert.equal(result.blockedReason, undefined);
  });

  it('无 Gateway、不可达、能力不足时分别给出 gateway_required/script_package/manual 降级建议', () => {
    const empty = new ZoneRouter(zones, [], new ReachabilityService()).route({
      zoneId: 'zone_prod',
      targetId: 'host_003',
      protocols: ['ssh'],
      now,
    });
    assert.equal(empty.blockedReason, 'no_gateway');
    assert.deepEqual(empty.fallbackSuggestions, ['gateway_required', 'script_package', 'manual']);

    const unreachableRecords = new ReachabilityService();
    const gw = gateway();
    unreachableRecords.upsert({ gatewayId: gw.id, targetId: 'host_003', protocol: 'ssh', status: 'unreachable', ttlSeconds: 60, now });
    const unreachable = new ZoneRouter(zones, [gw], unreachableRecords).route({
      zoneId: 'zone_prod',
      targetId: 'host_003',
      protocols: ['ssh'],
      requiredCapabilities: ['cert.deploy'],
      now,
    });
    assert.equal(unreachable.blockedReason, 'unreachable');
    assert.deepEqual(unreachable.fallbackSuggestions, ['script_package', 'manual']);

    const missing = new ZoneRouter(zones, [gateway({ capabilities: ['adapter.ssh'] })], unreachableRecords).route({
      zoneId: 'zone_prod',
      targetId: 'host_003',
      protocols: ['ssh'],
      requiredCapabilities: ['cert.deploy'],
      now,
    });
    assert.equal(missing.blockedReason, 'capability_missing');
    assert.deepEqual(missing.missingCapabilities, ['cert.deploy']);
    assert.deepEqual(missing.fallbackSuggestions, ['gateway_required', 'manual']);
  });

  it('CredentialBroker mock 只发放 SecretRef/GrantRef，支持使用次数、revoke 和 expiry', () => {
    const broker = new MockCredentialBroker();
    const session = broker.issue({
      taskId: 'task_cred',
      operatorId: 'operator_1',
      executionRunId: 'run_cred',
      stepId: 'step_cred',
      auditRef: 'audit_issue_001',
      gatewayId: 'gw_001',
      targetId: 'host_001',
      protocol: 'ssh',
      secretRef: 'secret://tenant/ssh-key',
      requestedActions: ['exec'],
      ttlSeconds: 1,
      maxUses: 2,
      now,
    });

    assert.equal(session.secretRef.ref, 'secret://tenant/ssh-key');
    assert.match(session.grantRef.ref, /^grant_/);
    assert.equal(session.operatorId, 'operator_1');
    assert.equal(session.executionRunId, 'run_cred');
    assert.equal(session.stepId, 'step_cred');
    assert.deepEqual(session.auditRefs, ['audit_issue_001']);
    assert.equal(JSON.stringify(session).includes('plain-password'), false);

    const once = broker.use(session.id, 'exec', now);
    assert.equal(once.status, 'active');
    const twice = broker.use(session.id, 'exec', now);
    assert.equal(twice.status, 'used');
    assert.throws(() => broker.use(session.id, 'exec', now), /不可用/);

    const revoked = broker.revoke(session.id, now, 'audit_revoke_001');
    assert.equal(revoked.status, 'revoked');
    assert.deepEqual(revoked.auditRefs, ['audit_issue_001', 'audit_revoke_001']);

    const expiring = broker.issue({
      taskId: 'task_expire',
      gatewayId: 'gw_001',
      targetId: 'host_001',
      protocol: 'ssh',
      secretRef: 'secret://tenant/ssh-key',
      requestedActions: ['read'],
      ttlSeconds: 1,
      now,
    });
    assert.equal(broker.get(expiring.id, new Date('2026-06-08T00:00:02.000Z'))?.status, 'expired');
    assert.throws(() => broker.issue({ taskId: 'task_bad', gatewayId: 'gw_001', targetId: 'host_001', protocol: 'ssh', secretRef: 'secret://x', requestedActions: ['root'] }), /超范围/);

    const auditEvents = broker.listAuditRecords(session.id).map((record) => record.event);
    assert.deepEqual(auditEvents, ['issued', 'used', 'used', 'revoked']);
    const issuedAudit = broker.listAuditRecords(session.id)[0];
    assert.equal(issuedAudit.operatorId, 'operator_1');
    assert.equal(issuedAudit.executionRunId, 'run_cred');
    assert.equal(issuedAudit.stepId, 'step_cred');
    assert.equal(JSON.stringify(broker.listAuditRecords()).includes('secret://tenant/ssh-key'), false);
  });

  it('GatewayCredentialBroker 无权限时拒绝发放凭据并写拒绝审计', () => {
    return (async () => {
      const { broker, audit, baseInput } = createCredentialBrokerFixture();

      await assert.rejects(
        () => broker.issue(baseInput),
        (error: any) => error.errorCode === 'SEC_PERMISSION_DENIED',
      );

      assert.equal(broker.list().length, 0);
      assert.equal(broker.listAuditRecords().at(-1)?.event, 'denied');
      assert.equal((await audit.query({ eventType: 'gateway.credential.denied' })).length, 1);
      assert.equal(JSON.stringify(broker.listAuditRecords()).includes('PRIVATE_KEY_VALUE'), false);
    })();
  });

  it('GatewayCredentialBroker 高风险无审批时拒绝发放凭据', () => {
    return (async () => {
      const { broker, rbac, baseInput } = createCredentialBrokerFixture();
      await rbac.createPolicy({
        subjectType: 'user',
        subjectId: 'operator_1',
        effect: 'allow',
        actions: ['gateway.credential.issue'],
        resourceTypes: ['gatewayTarget'],
        scope: {},
      });

      await assert.rejects(
        () => broker.issue(baseInput),
        (error: any) => error.errorCode === 'SEC_APPROVAL_REQUIRED',
      );

      assert.equal(broker.list().length, 0);
      assert.equal(broker.listAuditRecords().at(-1)?.reason, 'SEC_APPROVAL_REQUIRED');
    })();
  });

  it('GatewayCredentialBroker 授权成功只返回 SecretRef/GrantRef，并写 issue/use 审计', () => {
    const { broker, rbac, approvals, grants, audit, baseInput } = createCredentialBrokerFixture();
    return (async () => {
    await rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'operator_1',
      effect: 'allow',
      actions: ['gateway.credential.issue'],
      resourceTypes: ['gatewayTarget'],
      scope: {},
    });
    const approvalParameters = {
      taskId: baseInput.taskId,
      operatorId: baseInput.operatorId,
      executionRunId: baseInput.executionRunId,
      stepId: baseInput.stepId,
      gatewayId: baseInput.gatewayId,
      targetId: baseInput.targetId,
      protocol: baseInput.protocol,
      secretRef: baseInput.secretRef,
      requestedActions: baseInput.requestedActions,
    };
    const approval = await approvals.create({
      operationType: 'gateway.credential.issue',
      resourceRefs: [{ type: 'gatewayTarget', id: baseInput.targetId }],
      riskLevel: 'high',
      parameters: approvalParameters,
      requestedBy: 'operator_1',
    });
    await approvals.decide({ approvalId: approval.id, decision: 'approved', approverId: 'security_admin' });

    const session = await broker.issue({ ...baseInput, approvalId: approval.id });

    assert.equal(session.secretRef.ref, 'secret://ssh_key/sec_prod#v1');
    assert.match(session.grantRef.ref, /^grt_/);
    assert.equal(JSON.stringify(session).includes('PRIVATE_KEY_VALUE'), false);
    assert.equal((await approvals.get(approval.id))?.status, 'consumed');
    assert.equal((await grants.validate({
      grantId: session.grantRef.ref,
      runId: baseInput.executionRunId,
      stepId: baseInput.stepId,
      executorType: 'ssh',
      secretRef: baseInput.secretRef,
      action: 'exec',
    })).id, session.grantRef.ref);

    const used = await broker.use(session.id, 'exec', now);
    assert.equal(used.status, 'used');
    assert.deepEqual(broker.listAuditRecords(session.id).map((record) => record.event), ['issued', 'used']);
    assert.equal((await audit.query({ eventType: 'gateway.credential.issued' })).length, 1);
    assert.equal((await audit.query({ eventType: 'gateway.credential.used' })).length, 1);
    assert.equal(JSON.stringify(await audit.query()).includes('PRIVATE_KEY_VALUE'), false);
    })();
  });

  it('GatewayCredentialBroker revoke 后 session 和 Grant 都不可再 use', () => {
    const { broker, rbac, approvals, grants, baseInput } = createCredentialBrokerFixture();
    return (async () => {
    await rbac.createPolicy({
      subjectType: 'user',
      subjectId: 'operator_1',
      effect: 'allow',
      actions: ['gateway.credential.issue'],
      resourceTypes: ['gatewayTarget'],
      scope: {},
    });
    const approvalParameters = {
      taskId: baseInput.taskId,
      operatorId: baseInput.operatorId,
      executionRunId: baseInput.executionRunId,
      stepId: baseInput.stepId,
      gatewayId: baseInput.gatewayId,
      targetId: baseInput.targetId,
      protocol: baseInput.protocol,
      secretRef: baseInput.secretRef,
      requestedActions: baseInput.requestedActions,
    };
    const approval = await approvals.create({
      operationType: 'gateway.credential.issue',
      resourceRefs: [{ type: 'gatewayTarget', id: baseInput.targetId }],
      riskLevel: 'high',
      parameters: approvalParameters,
      requestedBy: 'operator_1',
    });
    await approvals.decide({ approvalId: approval.id, decision: 'approved', approverId: 'security_admin' });
    const session = await broker.issue({ ...baseInput, approvalId: approval.id });

    const revoked = await broker.revoke(session.id, now, 'audit_revoke_001');

    assert.equal(revoked.status, 'revoked');
    await assert.rejects(
      () => broker.use(session.id, 'exec', now),
      (error: any) => error.errorCode === 'SEC_EXECUTOR_GRANT_DENIED',
    );
    await assert.rejects(
      () => grants.validate({
        grantId: session.grantRef.ref,
        runId: baseInput.executionRunId,
        stepId: baseInput.stepId,
        executorType: 'ssh',
        secretRef: baseInput.secretRef,
        action: 'exec',
      }),
      (error: any) => error.errorCode === 'SEC_EXECUTOR_GRANT_DENIED',
    );
    assert.deepEqual(broker.listAuditRecords(session.id).map((record) => record.event), ['issued', 'revoked']);
    })();
  });

  it('GatewayTaskService 支持 delegated task 下发、ack/result/evidence 和幂等保护', () => {
    const service = new GatewayTaskService();
    const task = service.dispatch({
      idempotencyKey: 'idem_gateway_task_001',
      operatorId: 'operator_1',
      planId: 'plan_001',
      executionRunId: 'run_001',
      stepId: 'step_001',
      gatewayId: 'gw_001',
      delegatedTargetId: 'host_001',
      target: { id: 'host_001', zoneId: 'zone_prod', host: '10.0.0.10', port: 22 },
      adapter: 'ssh',
      action: 'exec',
      payload: { commandRef: 'secret://commands/install-cert' },
      credentialSessionId: 'cred_sess_001',
      credentialLeaseId: 'lease_cred_001',
      now,
    });
    const repeated = service.dispatch({ ...task, idempotencyKey: 'idem_gateway_task_001', target: task.target });
    assert.equal(repeated, task);

    const acked = service.ack(task.id, 'lease_001', now);
    assert.equal(acked.status, 'acknowledged');
    assert.equal(service.ack(task.id, 'lease_001', now), acked);
    assert.throws(() => service.ack(task.id, 'lease_002', now), /lease 冲突/);

    const running = service.markRunning(task.id, 'lease_001', now);
    assert.equal(running.status, 'running');
    const evidence = service.appendEvidence({
      taskId: task.id,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      credentialSessionId: task.credentialSessionId,
      credentialLeaseId: task.credentialLeaseId,
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: 'success',
      evidenceRef: 'audit://gateway-evidence/001',
      kind: 'command_summary',
      summary: '已写入证书文件 hash=abc',
      metadata: { sha256: 'abc' },
      createdAt: now.toISOString(),
    });
    const completed = service.result(task.id, 'lease_001', {
      success: true,
      status: 'success',
      summary: '代表目标执行成功',
    });

    assert.equal(completed.status, 'success');
    assert.deepEqual(completed.result?.evidenceIds, [evidence.id]);
    assert.equal(completed.result?.evidenceRef, 'audit://gateway-evidence/001');
    assert.equal(service.listEvidence(task.id)[0].delegatedTargetId, 'host_001');
    assert.deepEqual(service.listEvidence(task.id)[0], {
      ...evidence,
      operatorId: 'operator_1',
      planId: 'plan_001',
      executionRunId: 'run_001',
      stepId: 'step_001',
      credentialLeaseId: 'lease_cred_001',
      action: 'exec',
      result: 'success',
      evidenceRef: 'audit://gateway-evidence/001',
    });
    assert.equal(service.result(task.id, 'lease_001', { success: false, status: 'failed', summary: '重复结果应被忽略' }), completed);
  });


  it('GatewayTaskService evidence/log 重传按 sequence 和 evidenceRef 去重，并推进 ack cursor', () => {
    const service = new GatewayTaskService();
    const task = service.dispatch(createGatewayTaskInput({ id: 'gateway_task_evidence_replay', idempotencyKey: 'idem_evidence_replay' }));
    service.ack(task.id, 'lease_evidence_replay', now);
    service.markRunning(task.id, 'lease_evidence_replay', now);

    const first = service.appendEvidence({
      taskId: task.id,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      credentialSessionId: task.credentialSessionId,
      credentialLeaseId: task.credentialLeaseId,
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: 'success',
      evidenceRef: 'audit://gateway-evidence/replay/1',
      sequence: 1,
      kind: 'log',
      summary: '第一条日志',
      metadata: {},
      createdAt: now.toISOString(),
    });
    const repeatedBySequence = service.appendEvidence({
      ...first,
      id: 'gw_evd_replay_different_id',
      evidenceRef: 'audit://gateway-evidence/replay/different-ref',
      summary: '重复 sequence 不能再写',
    });
    const repeatedByRef = service.appendEvidence({
      ...first,
      id: 'gw_evd_replay_different_id_2',
      sequence: 9,
      summary: '重复 evidenceRef 不能再写',
    });
    const second = service.appendEvidence({
      ...first,
      id: undefined,
      evidenceRef: 'audit://gateway-evidence/replay/2',
      sequence: undefined,
      summary: '自动补齐第二条日志',
    });

    assert.equal(repeatedBySequence.id, first.id);
    assert.equal(repeatedByRef.id, first.id);
    assert.equal(second.sequence, 2);
    assert.equal(service.listEvidence(task.id).length, 2);
    assert.equal(service.updateEvidenceAckCursor(task.id, 1, now).evidenceAckCursor, 1);
    assert.equal(service.updateEvidenceAckCursor(task.id, 1, now).evidenceAckCursor, 1);
    assert.equal(service.updateEvidenceAckCursor(task.id, 2, now).evidenceAckCursor, 2);
  });

  it('AdapterRuntime 暴露 SSH/WinRM/CURL mock descriptor，不执行真实协议', async () => {
    const runtime = new MockAdapterRuntime();
    assert.deepEqual(
      runtime.list().map((adapter) => adapter.type),
      ['ssh', 'winrm', 'curl'],
    );
    assert.equal(sshMockAdapter.mockSafe, true);
    assert.equal(winRmMockAdapter.mockSafe, true);
    assert.equal(curlMockAdapter.mockSafe, true);
    assert.ok(runtime.capabilities().includes('adapter.ssh'));

    const task = new GatewayTaskService().dispatch({
      idempotencyKey: 'idem_adapter',
      executionRunId: 'run_adapter',
      stepId: 'step_adapter',
      gatewayId: 'gw_001',
      delegatedTargetId: 'host_001',
      target: { id: 'host_001', zoneId: 'zone_prod' },
      adapter: 'curl',
      action: 'read',
    });
    const result = await runtime.run({ gatewayId: 'gw_001', credentialSessionId: 'cred_sess_001' }, task);
    assert.equal(result.success, true);
    assert.match(result.summary, /mock/);
    assert.equal(result.evidence[0].metadata.mockSafe, true);
  });

  it('GatewayAgentProcess 真实拉取 gateway.task.run，ack、执行、写 evidence 并提交结果', async () => {
    const tenantId = 'tenant_gateway_process';
    const agents = new AgentsApplicationService();
    const gatewayAgent = await agents.register(tenantId, {
      agentKey: 'gateway-agent-process-001',
      hostname: 'gw-process-001',
      version: '0.1.0',
      osType: 'linux',
      role: 'gateway',
      zoneIds: ['zone_prod'],
      adapters: ['ssh'],
      capabilities: ['adapter.ssh'],
    }, 'req_register_gateway_process');
    const gatewayTasks = new GatewayTaskService();
    const gatewayTask = gatewayTasks.dispatch({
      id: 'gateway_task_process_001',
      idempotencyKey: 'idem_gateway_process_001',
      operatorId: 'operator_1',
      planId: 'plan_process',
      executionRunId: 'run_process',
      stepId: 'step_process',
      gatewayId: 'gw_process',
      delegatedTargetId: 'host_process',
      target: { id: 'host_process', zoneId: 'zone_prod', host: '10.0.0.20', port: 22 },
      adapter: 'ssh',
      action: 'exec',
      payload: { commandRef: 'secret://commands/install-cert' },
      credentialSessionId: 'cred_sess_process',
      credentialLeaseId: 'lease_cred_process',
      now,
    });
    const agentTask = await agents.enqueueTask(tenantId, {
      agentId: gatewayAgent.id,
      executionRunId: gatewayTask.executionRunId,
      executionStepId: gatewayTask.stepId,
      idempotencyKey: gatewayTask.idempotencyKey,
      payload: { type: 'gateway.task.run', gatewayTask, dryRun: false },
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
    const completedGatewayTask = gatewayTasks.get(gatewayTask.id)!;
    assert.equal(completedGatewayTask.status, 'success');
    assert.equal(completedGatewayTask.delegatedTargetId, 'host_process');
    assert.equal(completedGatewayTask.result?.success, true);
    assert.equal(gatewayTasks.listEvidence(gatewayTask.id)[0].delegatedTargetId, 'host_process');
    const completedAgentTask = (await agents.listTaskQueue(tenantId, gatewayAgent.id)).tasks.find((task) => task.id === agentTask.id)!;
    assert.equal(completedAgentTask.status, 'succeeded');
    assert.equal(completedAgentTask.result?.success, true);
    assert.equal((completedAgentTask.result?.detail as Record<string, unknown>).mode, 'gateway_agent_process');
  });


  it('GatewayAgentProcess result 重传不重复执行 runtime，也不重复提交副作用', async () => {
    const fixture = await createGatewayProcessFixture('result_replay');
    const counter = { runs: 0 };
    const process = new GatewayAgentProcess({
      tenantId: fixture.tenantId,
      agentId: fixture.gatewayAgent.id,
      agents: fixture.agents,
      gatewayTasks: fixture.gatewayTasks,
      runtime: countingRuntime(counter),
      leaseFactory: () => 'lease_result_replay',
    });

    assert.deepEqual(await process.tick(), { pulled: 1, processed: 1, succeeded: 1, failed: 0 });
    assert.deepEqual(await process.tick(), { pulled: 0, processed: 0, succeeded: 0, failed: 0 });

    assert.equal(counter.runs, 1);
    assert.equal(fixture.gatewayTasks.listEvidence(fixture.gatewayTask.id).length, 1);
    assert.equal((await fixture.agents.listTaskQueue(fixture.tenantId, fixture.gatewayAgent.id)).tasks.find((task) => task.id === fixture.agentTask.id)?.status, 'succeeded');
  });

  it('GatewayAgentProcess evidence/log 重传不会重复写 Agent task logs，cursor 和 Gateway evidenceAckCursor 对齐', async () => {
    const fixture = await createGatewayProcessFixture('log_replay');
    const counter = { runs: 0 };
    const process = new GatewayAgentProcess({
      tenantId: fixture.tenantId,
      agentId: fixture.gatewayAgent.id,
      agents: fixture.agents,
      gatewayTasks: fixture.gatewayTasks,
      runtime: countingRuntime(counter, 1),
      leaseFactory: () => 'lease_log_replay',
    });

    await process.tick();
    const replay = fixture.gatewayTasks.appendEvidence({
      taskId: fixture.gatewayTask.id,
      gatewayId: fixture.gatewayTask.gatewayId,
      delegatedTargetId: fixture.gatewayTask.delegatedTargetId,
      adapter: fixture.gatewayTask.adapter,
      credentialSessionId: fixture.gatewayTask.credentialSessionId,
      credentialLeaseId: fixture.gatewayTask.credentialLeaseId,
      executionRunId: fixture.gatewayTask.executionRunId,
      stepId: fixture.gatewayTask.stepId,
      action: fixture.gatewayTask.action,
      result: 'success',
      evidenceRef: `audit://gateway-evidence/${fixture.gatewayTask.id}/1`,
      sequence: 1,
      kind: 'command_summary',
      summary: '重复日志不应再写',
      metadata: {},
      createdAt: now.toISOString(),
    });

    assert.equal(replay.id, fixture.gatewayTasks.listEvidence(fixture.gatewayTask.id)[0].id);
    assert.equal(fixture.gatewayTasks.listEvidence(fixture.gatewayTask.id).length, 1);
    assert.equal((await fixture.agents.listTaskLogs(fixture.tenantId, fixture.agentTask.id)).length, 1);
    assert.equal((await fixture.agents.getLogCursor(fixture.tenantId, fixture.gatewayAgent.id, fixture.agentTask.id)).lastAckedSequence, 1);
    assert.equal(fixture.gatewayTasks.get(fixture.gatewayTask.id)?.evidenceAckCursor, 1);
  });
});
