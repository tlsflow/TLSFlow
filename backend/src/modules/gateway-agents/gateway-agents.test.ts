import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MockAdapterRuntime, curlMockAdapter, sshMockAdapter, winRmMockAdapter } from './adapter-runtime.mock.js';
import { MockCredentialBroker } from './credential-broker.mock.js';
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
});
