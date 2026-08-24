import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { AuditService } from '../audits/audit.service.js';
import { GatewayTaskAuditWriter, PgGatewayTargetHistoryRepository } from './gateway-target-history.service.js';
import { GatewayTaskService } from './gateway-task.service.js';
import { ProductionGatewayAdapterRuntime } from './adapter-runtime.production.js';

const now = new Date('2026-06-09T00:00:00.000Z');

function createGatewayTask(adapter = 'curl') {
  return new GatewayTaskService().dispatch({
    id: `gateway_task_${adapter}`,
    idempotencyKey: `idem_gateway_${adapter}`,
    operatorId: 'operator_history_1',
    planId: 'plan_history_1',
    executionRunId: 'run_history_1',
    stepId: 'step_history_1',
    gatewayId: 'gw_history_1',
    delegatedTargetId: 'delegated_target_1',
    target: { id: 'delegated_target_1', zoneId: 'zone_prod' },
    adapter,
    action: adapter === 'curl' ? 'read' : 'exec',
    payload: adapter === 'curl'
      ? { url: 'https://example.test/health', expectedStatusCodes: [200] }
      : { commandRef: 'secret://commands/restart' },
    credentialSessionId: 'cred_history_1',
    credentialLeaseId: 'grt_history_1',
    now,
  });
}

describe('spec014 Gateway 生产 runtime 与目标历史', () => {
  it('生产 runtime 不注册 mockSafe descriptor，缺少 GrantRef 时拒绝执行', async () => {
    const runtime = new ProductionGatewayAdapterRuntime({ descriptors: [] });
    assert.throws(
      () =>
        runtime.register({
          type: 'mock' as any,
          displayName: 'bad mock',
          capabilities: [],
          supportedActions: [],
          mockSafe: true,
          requiresSecretRef: false,
          requiresGrantRef: true,
          precheck: () => ({ ok: true }),
          run: () => ({ success: true, status: 'success', summary: 'bad', evidence: [] }),
        } as any),
      (error: unknown) => error instanceof AppError && error.errorCode === 'VALIDATION_FAILED',
    );

    const realRuntime = new ProductionGatewayAdapterRuntime({ fetchImpl: async () => new Response('', { status: 204 }) });
    await assert.rejects(
      () => realRuntime.run({ gatewayId: 'gw_history_1' }, createGatewayTask()),
      /GrantRef/,
    );
  });

  it('CURL 生产 adapter 执行真实 fetch，默认拒绝非本地 HTTP 明文和明文 Authorization', async () => {
    const calls: string[] = [];
    const runtime = new ProductionGatewayAdapterRuntime({
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response('ok', { status: 200, headers: { 'x-check': 'ok' } });
      },
    });

    const task = createGatewayTask();
    const result = await runtime.run({ gatewayId: task.gatewayId, grantRef: { ref: 'grt_history_1' } }, task);
    assert.equal(result.success, true);
    assert.equal(result.status, 'success');
    assert.equal(calls[0], 'https://example.test/health');
    assert.equal(result.evidence[0].kind, 'response_summary');
    assert.equal(result.evidence[0].metadata.mockSafe, false);

    const httpTask = { ...task, payload: { url: 'http://example.test/plain' } };
    await assert.rejects(
      () => runtime.run({ gatewayId: task.gatewayId, grantRef: { ref: 'grt_history_1' } }, httpTask),
      /HTTPS/,
    );

    const secretTask = {
      ...task,
      payload: { url: 'https://example.test/secret', headers: { Authorization: 'Bearer plain-token-value-123456' } },
    };
    await assert.rejects(
      () => runtime.run({ gatewayId: task.gatewayId, grantRef: { ref: 'grt_history_1' } }, secretTask),
      /SecretRef|明文敏感/,
    );
  });

  it('CURL 生产 adapter 支持 SecretRef header/body、TLS SecretRef 和审批后的非本地 HTTP', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
    const runtime = new ProductionGatewayAdapterRuntime({
      fetchImpl: async (input, init) => {
        seen.push({
          url: String(input),
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        return new Response('ok', { status: 200 });
      },
    });
    const task = {
      ...createGatewayTask(),
      payload: {
        url: 'http://example.test/approved',
        method: 'POST',
        headerRefs: { Authorization: 'secret://headers/auth#current' },
        bodySecretRef: 'secret://payload/body#current',
        approvalPolicyRef: 'approval://plain-http/approved-1',
        allowPlainHttpWithApproval: true,
        tls: {
          caSecretRef: 'secret://tls/ca#current',
          clientCertSecretRef: 'secret://tls/client#current',
          verify: false,
        },
      },
    };

    const result = await runtime.run({ gatewayId: task.gatewayId, grantRef: { ref: 'grt_history_1' } }, task);

    assert.equal(result.success, true);
    assert.equal(seen[0]?.url, 'http://example.test/approved');
    assert.equal(seen[0]?.headers.authorization, '[SECRET_REF:Authorization]');
    assert.equal(seen[0]?.body, '[SECRET_REF:body]');
    assert.deepEqual(result.evidence[0].metadata.tls, { hasCaSecretRef: true, hasClientCertSecretRef: true, verify: false });

    await assert.rejects(
      () =>
        runtime.run(
          { gatewayId: task.gatewayId, grantRef: { ref: 'grt_history_1' } },
          { ...task, payload: { url: 'https://example.test/tls', tls: { verify: false } } },
        ),
      /TLS/,
    );
  });

  it('SSH/WinRM/SMB/WMI 生产 adapter 有 capability gate，但不会谎称真实执行成功', async () => {
    const runtime = new ProductionGatewayAdapterRuntime();
    for (const adapter of ['ssh', 'winrm', 'smb', 'wmi']) {
      const task = createGatewayTask(adapter);
      await assert.rejects(
        () => runtime.run({ gatewayId: task.gatewayId, grantRef: { ref: 'grt_history_1' } }, task),
        /真实协议依赖尚未接入|禁止默认 mock 成功/,
      );
    }
  });

  it('GatewayTaskAuditWriter 把 Gateway evidence/result 写入统一 Audit 和目标历史', async () => {
    const audit = new AuditService();
    const history = new PgGatewayTargetHistoryRepository();
    const writer = new GatewayTaskAuditWriter({ audit, history });
    const service = new GatewayTaskService();
    const task = service.dispatch({
      id: 'gateway_task_history_1',
      idempotencyKey: 'idem_gateway_history_1',
      operatorId: 'operator_history_1',
      planId: 'plan_history_1',
      executionRunId: 'run_history_1',
      stepId: 'step_history_1',
      gatewayId: 'gw_history_1',
      delegatedTargetId: 'delegated_target_1',
      target: { id: 'delegated_target_1', zoneId: 'zone_prod' },
      adapter: 'ssh',
      action: 'exec',
      credentialLeaseId: 'grt_history_1',
      now,
    });
    service.ack(task.id, 'lease_history_1', now);
    service.markRunning(task.id, 'lease_history_1', now);
    const evidence = service.appendEvidence({
      id: 'gw_evd_history_1',
      taskId: task.id,
      gatewayId: task.gatewayId,
      delegatedTargetId: task.delegatedTargetId,
      adapter: task.adapter,
      credentialLeaseId: task.credentialLeaseId,
      evidenceRef: 'backup://delegated_target_1/before-change',
      kind: 'backup_ref',
      summary: '变更前备份完成',
      metadata: {
        backupRef: 'backup://delegated_target_1/before-change',
        certificateFingerprint: 'SHA256:abc',
        verifyResult: { ok: true },
        responseSummary: 'stdout ok',
      },
      executionRunId: task.executionRunId,
      stepId: task.stepId,
      action: task.action,
      result: 'success',
      createdAt: now.toISOString(),
    });
    writer.recordEvidence(service.get(task.id)!, evidence);
    const completed = service.result(task.id, 'lease_history_1', { success: true, status: 'success', summary: '执行完成' });
    writer.recordResult(completed);

    const auditLogs = await audit.query({ resourceType: 'gatewayTarget', resourceId: 'delegated_target_1' });
    assert.equal(auditLogs.length, 2);
    assert.deepEqual(auditLogs.map((log) => log.eventType), ['gateway.task.evidence.recorded', 'gateway.task.result.recorded']);
    const targetHistory = await history.listByTarget('delegated_target_1');
    assert.equal(targetHistory.length, 2);
    assert.equal(targetHistory[0].operatorId, 'operator_history_1');
    assert.equal(targetHistory[0].gatewayId, 'gw_history_1');
    assert.equal(targetHistory[0].delegatedTargetId, 'delegated_target_1');
    assert.equal(targetHistory[0].adapter, 'ssh');
    assert.equal(targetHistory[0].credentialLeaseId, 'grt_history_1');
    assert.equal(targetHistory[0].certificateFingerprint, 'SHA256:abc');
    assert.equal(targetHistory[0].backupRef, 'backup://delegated_target_1/before-change');
    assert.deepEqual(targetHistory[0].verifyResult, { ok: true });
    assert.equal(targetHistory[0].responseSummary, 'stdout ok');
  });
});
