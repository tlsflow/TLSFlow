import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { GatewayTaskAuditWriter, GatewayTaskService } from '../gateway-agents/index.js';
import { GatewaysApplicationService } from './application/gateways.application-service.js';
import { GatewaysDomainService } from './domain/gateways.domain-service.js';
import { createGatewayRepository, createGatewayTargetHistoryRepository } from './repository/gateways.repository.js';

describe('spec014 Gateway Registry 持久化', () => {
  it('file-json 重建仓储后保留 registry、reachability、route 和 credential session', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'gcac-gateways-'));
    try {
      const tenantId = 'tenant_gateway_persist';
      const first = createGatewayRepository({ backend: 'file', baseDir });
      const firstDomain = new GatewaysDomainService(first);

      const gateway = firstDomain.status(tenantId, {
        action: 'register',
        agentId: 'agent_gateway_persist_001',
        zoneIds: ['zone_prod'],
        version: '1.0.0',
        adapters: ['ssh', 'curl'],
        capabilities: ['adapter.ssh', 'cert.deploy'],
        currentLoad: 1,
        maxConcurrentTasks: 4,
        successRate: 0.99,
      });
      const reachability = firstDomain.probe(tenantId, {
        gatewayId: gateway.id,
        targetId: 'host_persist_001',
        protocol: 'ssh',
        port: 22,
        status: 'reachable',
        latencyMs: 12,
        ttlSeconds: 600,
      });
      const credentialSession = first.recordCredentialSession(tenantId, {
        id: 'gcs_persist_001',
        taskId: 'task_persist_001',
        secretRef: { ref: 'secret://tenant_gateway_persist/ssh' },
        grantRef: { ref: 'grant://tenant_gateway_persist/task_persist_001' },
        gatewayId: gateway.id,
        targetId: 'host_persist_001',
        protocol: 'ssh',
        allowedActions: ['exec'],
        remainingUses: 1,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      const rebuilt = createGatewayRepository({ backend: 'file', baseDir });
      const rebuiltDomain = new GatewaysDomainService(rebuilt);
      const rebuiltApplication = new GatewaysApplicationService(rebuilt);

      const list = rebuilt.listGateways(tenantId, { page: 1, pageSize: 10, filter: {}, sort: { field: 'updatedAt', direction: 'desc' } });
      assert.equal(list.total, 1);
      assert.equal(list.items[0]?.id, gateway.id);
      assert.equal(list.items[0]?.agentId, 'agent_gateway_persist_001');

      const detail = rebuiltApplication.detail(tenantId, gateway.id);
      assert.equal(detail?.gateway.id, gateway.id);
      assert.equal(detail?.reachability.length, 1);
      assert.equal(rebuilt.listReachability(tenantId, gateway.id)[0]?.id, reachability.id);
      assert.equal(rebuilt.findReachability(tenantId, gateway.id, 'host_persist_001', 'ssh')?.status, 'reachable');

      const route = rebuiltDomain.route(tenantId, { zoneId: 'zone_prod', targetId: 'host_persist_001', protocols: ['ssh'], requiredCapabilities: ['cert.deploy'] });
      assert.equal(route.selectedGateway?.id, gateway.id);

      const revoked = rebuilt.revokeUnusedCredentialSessions(tenantId, gateway.id, new Date('2026-01-01T00:00:00.000Z'));
      assert.equal(revoked.length, 1);
      assert.equal(revoked[0]?.id, credentialSession.id);
      assert.equal(revoked[0]?.status, 'revoked');

      const reloadedAgain = createGatewayRepository({ backend: 'file', baseDir });
      assert.equal(reloadedAgain.revokeUnusedCredentialSessions(tenantId, gateway.id).length, 0);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('file-json 重建仓储后保留 Gateway target history 且 append 幂等', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'gcac-gateway-history-'));
    try {
      const tenantId = 'tenant_gateway_history_persist';
      const history = createGatewayTargetHistoryRepository({ backend: 'file', baseDir });
      const gatewayTasks = new GatewayTaskService({
        auditWriter: new GatewayTaskAuditWriter({ history }),
      });
      const task = gatewayTasks.dispatch({
        id: 'gateway_task_history_persist',
        idempotencyKey: 'idem_gateway_history_persist',
        tenantId,
        operatorId: 'operator_history_persist',
        planId: 'plan_history_persist',
        executionRunId: 'run_history_persist',
        stepId: 'step_history_persist',
        gatewayId: 'gw_history_persist',
        delegatedTargetId: 'host_history_persist',
        target: { id: 'host_history_persist', zoneId: 'zone_prod' },
        adapter: 'curl',
        action: 'verify',
        credentialLeaseId: 'grant_history_persist',
      });
      gatewayTasks.ack(task.id, 'lease_history_persist');
      gatewayTasks.markRunning(task.id, 'lease_history_persist');
      const evidence = gatewayTasks.appendEvidence({
        id: 'gw_evd_history_persist',
        taskId: task.id,
        gatewayId: task.gatewayId,
        delegatedTargetId: task.delegatedTargetId,
        adapter: task.adapter,
        credentialLeaseId: task.credentialLeaseId,
        evidenceRef: 'https://host_history_persist/verify',
        sequence: 1,
        kind: 'response_summary',
        summary: 'HTTPS verify ok',
        metadata: {
          certificateFingerprint: 'SHA256:persist',
          backupRef: 'backup://host_history_persist/before',
          verifyResult: { ok: true, statusCode: 200 },
          responseSummary: { statusCode: 200, bytes: 128 },
        },
        executionRunId: task.executionRunId,
        stepId: task.stepId,
        action: task.action,
        result: 'success',
      });
      gatewayTasks.appendEvidence({
        id: 'gw_evd_history_persist_duplicate',
        taskId: task.id,
        gatewayId: task.gatewayId,
        delegatedTargetId: task.delegatedTargetId,
        adapter: task.adapter,
        credentialLeaseId: task.credentialLeaseId,
        evidenceRef: evidence.evidenceRef,
        sequence: evidence.sequence,
        kind: 'response_summary',
        summary: 'duplicate ignored',
        metadata: {},
        executionRunId: task.executionRunId,
        stepId: task.stepId,
        action: task.action,
        result: 'success',
      });
      gatewayTasks.result(task.id, 'lease_history_persist', { success: true, status: 'success', summary: '执行完成' });
      gatewayTasks.result(task.id, 'lease_history_persist', { success: true, status: 'success', summary: '重复结果应幂等' });
      history.append({
        id: 'gateway-history:evidence:other-tenant',
        tenantId: 'tenant_other',
        taskId: 'task_other',
        executionRunId: 'run_other',
        stepId: 'step_other',
        gatewayId: 'gw_other',
        delegatedTargetId: 'host_history_persist',
        adapter: 'curl',
        action: 'verify',
        result: 'success',
        summary: '其他租户同名目标',
        createdAt: new Date().toISOString(),
      });
      history.append({
        id: 'gateway-history:evidence:other-tenant',
        tenantId: 'tenant_other',
        taskId: 'task_other',
        executionRunId: 'run_other',
        stepId: 'step_other',
        gatewayId: 'gw_other',
        delegatedTargetId: 'host_history_persist',
        adapter: 'curl',
        action: 'verify',
        result: 'success',
        summary: '重复 append 不应覆盖',
        createdAt: new Date().toISOString(),
      });

      const rebuilt = createGatewayTargetHistoryRepository({ backend: 'file', baseDir });
      const tenantHistory = rebuilt.listByTarget('host_history_persist', tenantId);
      assert.equal(tenantHistory.length, 2);
      assert.equal(tenantHistory.filter((item) => item.evidenceId === evidence.id).length, 1);
      assert.equal(tenantHistory.filter((item) => item.id === `gateway-history:result:${task.id}`).length, 1);
      assert.equal(tenantHistory.some((item) => item.operatorId === 'operator_history_persist'), true);
      assert.equal(tenantHistory.some((item) => item.planId === 'plan_history_persist'), true);
      assert.equal(tenantHistory.some((item) => item.gatewayId === 'gw_history_persist'), true);
      assert.equal(tenantHistory.some((item) => item.credentialLeaseId === 'grant_history_persist'), true);
      const evidenceHistory = tenantHistory.find((item) => item.evidenceId === evidence.id);
      assert.equal(evidenceHistory?.certificateFingerprint, 'SHA256:persist');
      assert.equal(evidenceHistory?.backupRef, 'backup://host_history_persist/before');
      assert.deepEqual(evidenceHistory?.verifyResult, { ok: true, statusCode: 200 });
      assert.deepEqual(evidenceHistory?.responseSummary, { statusCode: 200, bytes: 128 });
      assert.equal(rebuilt.listByTarget('host_history_persist').length, 3);
      assert.equal(rebuilt.listByTarget('host_history_persist', 'tenant_other').length, 1);
      assert.equal(rebuilt.listByTask(task.id).length, 2);
      assert.equal(rebuilt.listByTask('task_other')[0]?.summary, '其他租户同名目标');
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
