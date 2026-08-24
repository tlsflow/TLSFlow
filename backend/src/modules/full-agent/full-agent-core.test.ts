import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { CapabilityDetector } from './capability-detector.js';
import { FullAgentCoreService } from './full-agent-core.service.js';
import type { FullAgentConfig } from './full-agent.types.js';
import { LocalTaskLedger } from './local-task-ledger.js';
import { MockLocalExecutor } from './mock-local-executor.js';

const config: FullAgentConfig = {
  tenantId: 'tenant_full_agent_test',
  agentKey: 'agent-local-001',
  hostname: 'gcac-local-agent',
  version: '0.1.0',
  osType: 'linux',
  arch: 'x64',
  dataDir: '/tmp/gcac-full-agent',
  dryRunDefault: false,
  heartbeatIntervalSeconds: 30,
};

function task(overrides: Partial<Parameters<LocalTaskLedger['accept']>[0]> = {}): Parameters<LocalTaskLedger['accept']>[0] {
  return {
    id: 'task_001',
    tenantId: config.tenantId,
    agentId: 'agt_001',
    executionRunId: 'run_001',
    executionStepId: 'step_001',
    idempotencyKey: 'idem_001',
    payload: { simulate: 'success' },
    status: 'queued',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
    requestId: 'req_001',
    ...overrides,
  };
}

describe('spec012 Full Agent 最小骨架', () => {
  it('注册后生成 FullAgentIdentity，并上报 fixture 能力', () => {
    const agent = new FullAgentCoreService(config);
    const identity = agent.register({ processExec: true, fileWrite: true, serviceControl: true });

    assert.equal(identity.role, 'full_agent');
    assert.equal(identity.agentKey, config.agentKey);
    assert.equal(identity.hostname, config.hostname);
    assert.match(identity.capabilityVersion ?? '', /^[a-f0-9]{16}$/);
  });

  it('LocalTaskLedger 对 taskId 幂等、idempotencyKey 冲突和非终态恢复有硬保护', () => {
    const ledger = new LocalTaskLedger();
    const first = ledger.accept(task());
    const repeated = ledger.accept(task({ payload: { simulate: 'failure' } }));
    assert.equal(repeated, first);

    assert.throws(() => ledger.accept(task({ id: 'task_002', payload: { simulate: 'failure' } })), (error) => {
      assert.equal(error instanceof AppError && error.errorCode, 'IDEMPOTENCY_CONFLICT');
      return true;
    });

    ledger.markRunning('task_001', 'lease_001');
    const restored = new LocalTaskLedger(ledger.snapshot());
    assert.equal(restored.get('task_001')?.status, 'recovering');
    assert.equal(restored.recoverable().length, 1);
  });

  it('CapabilityDetector 基于 fixture 输出能力声明和稳定 capabilityVersion', () => {
    const detector = new CapabilityDetector();
    const detected = detector.detect(config, {
      osType: 'windows',
      arch: 'arm64',
      processExec: true,
      fileWrite: false,
      serviceControl: true,
      runtime: 'node',
    });
    const repeated = detector.detect(config, {
      osType: 'windows',
      arch: 'arm64',
      processExec: true,
      fileWrite: false,
      serviceControl: true,
      runtime: 'node',
    });

    assert.equal(detected.capabilityVersion, repeated.capabilityVersion);
    assert.equal(detected.compatibilityLevel, 'L3');
    assert.deepEqual(detected.capabilities.map((item) => item.capabilityKey), [
      'host.os',
      'host.arch',
      'process.exec',
      'file.write',
      'service.control',
      'fullagent.runtime',
    ]);
    assert.equal(detected.capabilities.find((item) => item.capabilityKey === 'fullagent.runtime')?.evidence?.alias, 'full_agent.runtime');
  });

  it('MockLocalExecutor 支持 dry-run、脱敏、失败和超时模拟', () => {
    const executor = new MockLocalExecutor();
    const dryRun = executor.execute({ task: task({ payload: { dryRun: true, token: 'secret-token-value' } }) });
    assert.equal(dryRun.status, 'dry_run');
    assert.equal(dryRun.success, true);
    assert.match(dryRun.stdout, /\[REDACTED\]/);

    const failed = executor.execute({ task: task({ id: 'task_failed', payload: { simulate: 'failure' } }) });
    assert.equal(failed.success, false);
    assert.equal(failed.errorCode, 'MOCK_EXECUTION_FAILED');

    const timeout = executor.execute({ task: task({ id: 'task_timeout', payload: { simulate: 'timeout', durationMs: 1000 } }), timeoutMs: 10 });
    assert.equal(timeout.status, 'timeout');
    assert.equal(timeout.errorCode, 'AGENT_TASK_TIMEOUT');
  });

  it('控制面 mock 主链路跑通注册、心跳、拉任务、ack、日志和 result', () => {
    const agent = new FullAgentCoreService(config);
    const identity = agent.register({ processExec: true, fileWrite: true, serviceControl: true });
    const controlPlane = agent.getControlPlaneClient();
    const enqueued = controlPlane.enqueueTask(identity, {
      executionRunId: 'run_chain',
      executionStepId: 'step_chain',
      idempotencyKey: 'idem_chain',
      payload: { simulate: 'success', password: 'plain-secret' },
    });

    const result = agent.runOnce();

    assert.equal(result.task?.taskId, enqueued.id);
    assert.equal(result.execution?.success, true);
    assert.equal(result.submittedResult?.status, 'succeeded');
    assert.equal(result.logs.length, 2);
    assert.match(result.logs[1].message, /\[REDACTED\]/);
    assert.equal(agent.getLedger().get(enqueued.id)?.status, 'succeeded');
  });
});
