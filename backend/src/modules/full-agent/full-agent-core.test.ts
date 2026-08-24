import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import { CapabilityDetector } from './capability-detector.js';
import { FullAgentCoreService } from './full-agent-core.service.js';
import type { FullAgentConfig } from './full-agent.types.js';
import { LocalTaskLedger } from './local-task-ledger.js';
import { MockLocalExecutor } from './mock-local-executor.js';
import { MockBackupManager, MockRollbackManager } from './backup-verify-rollback.manager.mock.js';
import { MockProviderRuntime } from './provider-runtime.mock.js';
import { MockSecretSession } from './security-session.mock.js';
import { MockUpgradeManager } from './upgrade-manager.mock.js';

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

  it('ProviderRuntime mock 校验 Provider 元数据、能力、权限和 Secret 清理', () => {
    const detector = new CapabilityDetector();
    const runtime = new MockProviderRuntime();
    assert.equal(runtime.listProviders()[0].name, 'mock.certificate');

    const missingCapability = runtime.execute({
      task: task({ payload: { providerName: 'mock.certificate', action: 'deploy', backupTargets: ['/mock/etc/nginx.conf'] } }),
      capabilities: detector.detect(config, { fileWrite: false, serviceControl: true }),
    });
    assert.equal(missingCapability.result.status, 'rejected');
    assert.equal(missingCapability.result.errorCode, 'CAPABILITY_MISSING');

    const permissionDenied = runtime.execute({
      task: task({ id: 'task_permission', idempotencyKey: 'idem_permission', payload: { providerName: 'mock.certificate', action: 'deploy', requestedPermissions: ['process.exec'] } }),
      capabilities: detector.detect(config, { fileWrite: true, serviceControl: true }),
    });
    assert.equal(permissionDenied.result.status, 'rejected');
    assert.equal(permissionDenied.result.errorCode, 'PLUGIN_PERMISSION_DENIED');

    const success = runtime.execute({
      task: task({
        id: 'task_provider_success',
        idempotencyKey: 'idem_provider_success',
        payload: {
          providerName: 'mock.certificate',
          action: 'deploy',
          backupTargets: ['/mock/etc/nginx.conf'],
          certificateSecretRef: 'secret:cert-001',
          pfxPassword: 'plain-password',
        },
      }),
      capabilities: detector.detect(config, { fileWrite: true, serviceControl: true }),
    });
    assert.equal(success.result.success, true);
    assert.equal(success.result.status, 'succeeded');
    assert.match(JSON.stringify(success.result.detail), /\[REDACTED\]/);
    assert.equal((success.result.detail.cleanupReport as { cleaned: boolean }).cleaned, true);
  });

  it('Backup/Verify/Rollback manager mock 保证备份完整性、备份失败阻断和无备份不伪造回滚', () => {
    const backup = new MockBackupManager();
    const manifestResult = backup.createManifest(task({ payload: { simulate: 'success' } }), ['/mock/etc/service.conf']);
    assert.equal(manifestResult.success, true);
    assert.equal(manifestResult.manifest && backup.verifyManifest(manifestResult.manifest), true);

    const tampered = { ...manifestResult.manifest!, items: [] };
    assert.equal(backup.verifyManifest(tampered), false);

    const failed = backup.createManifest(task({ id: 'task_backup_fail', payload: { simulateBackup: 'failure' } }), ['/mock/etc/service.conf']);
    assert.equal(failed.success, false);
    assert.equal(failed.errorCode, 'BACKUP_FAILED');

    const rollback = new MockRollbackManager();
    const noManifest = rollback.rollback(undefined);
    assert.equal(noManifest.status, 'manual_intervention_required');
    assert.equal(noManifest.errorCode, 'ROLLBACK_POINT_MISSING');
  });

  it('ProviderRuntime mock 在备份失败时阻断安装，在验证失败时触发回滚语义', () => {
    const detector = new CapabilityDetector();
    const capabilities = detector.detect(config, { fileWrite: true, serviceControl: true });
    const runtime = new MockProviderRuntime();

    const backupFailed = runtime.execute({
      task: task({ id: 'task_backup_stop', idempotencyKey: 'idem_backup_stop', payload: { providerName: 'mock.certificate', action: 'deploy', simulateBackup: 'failure' } }),
      capabilities,
    });
    assert.equal(backupFailed.result.success, false);
    assert.equal(backupFailed.result.errorCode, 'BACKUP_FAILED');
    assert.equal(JSON.stringify(backupFailed.result.detail).includes('install'), false);

    const verifyFailed = runtime.execute({
      task: task({
        id: 'task_verify_rollback',
        idempotencyKey: 'idem_verify_rollback',
        payload: {
          providerName: 'mock.certificate',
          action: 'deploy',
          backupTargets: ['/mock/etc/nginx.conf'],
          simulateVerify: 'failure',
        },
      }),
      capabilities,
    });
    assert.equal(verifyFailed.result.success, false);
    assert.equal(verifyFailed.result.errorCode, 'VERIFY_FAILED_ROLLED_BACK');
    assert.equal((verifyFailed.result.detail.rollback as { status: string }).status, 'rolled_back');
  });

  it('MockSecretSession 只允许执行期 SecretRef，并在任务结束清理明文缓存', () => {
    const secrets = new MockSecretSession();
    secrets.put('secret:pfx-password', 'super-secret');
    assert.equal(secrets.get('secret:pfx-password'), 'super-secret');
    assert.match(JSON.stringify(secrets.snapshot()), /\[REDACTED\]/);
    const cleanup = secrets.cleanup();
    assert.equal(cleanup.cachedSecretCount, 1);
    assert.equal(cleanup.cleaned, true);
    assert.equal(secrets.get('secret:pfx-password'), undefined);
    assert.throws(() => secrets.put('plain-value', 'bad'));
  });

  it('UpgradeManager mock 校验哈希签名、运行中任务阻断、启动失败回滚', () => {
    const upgrade = new MockUpgradeManager(config);
    const validPlan = {
      planId: 'upg_001',
      targetVersion: '0.2.0',
      packageSha256: upgrade.expectedPackageHash({ targetVersion: '0.2.0' }),
      signature: 'mock-signature:0.2.0',
      rollbackVersion: config.version,
      maintenanceWindowOpen: true,
    };

    const success = upgrade.applyPlan(validPlan);
    assert.equal(success.status, 'succeeded');
    assert.equal(success.currentVersion, '0.2.0');
    assert.equal(success.detail.realSystemMutation, false);

    const ledger = new LocalTaskLedger();
    ledger.accept(task({ id: 'task_running_upgrade_block', idempotencyKey: 'idem_running_upgrade_block' }));
    const blocked = upgrade.applyPlan(validPlan, ledger);
    assert.equal(blocked.status, 'rejected');
    assert.equal(blocked.errorCode, 'UPGRADE_BLOCKED_BY_RUNNING_TASKS');

    const badHash = upgrade.applyPlan({ ...validPlan, packageSha256: 'bad' });
    assert.equal(badHash.status, 'rejected');
    assert.equal(badHash.errorCode, 'UPGRADE_HASH_INVALID');

    const rolledBack = upgrade.applyPlan({ ...validPlan, simulate: 'startup_failure' });
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(rolledBack.currentVersion, config.version);
  });

  it('控制面 mock 主链路跑通注册、心跳、拉任务、ack、日志和 result', () => {
    const agent = new FullAgentCoreService(config);
    const identity = agent.register({ processExec: true, fileWrite: true, serviceControl: true });
    const controlPlane = agent.getControlPlaneClient();
    const enqueued = controlPlane.enqueueTask(identity, {
      executionRunId: 'run_chain',
      executionStepId: 'step_chain',
      idempotencyKey: 'idem_chain',
      payload: { providerName: 'mock.certificate', action: 'deploy', simulate: 'success', password: 'plain-secret', backupTargets: ['/mock/etc/service.conf'] },
    });

    const result = agent.runOnce();

    assert.equal(result.task?.taskId, enqueued.id);
    assert.equal(result.execution?.success, true);
    assert.equal(result.submittedResult?.status, 'succeeded');
    assert.equal(result.logs.length, 4);
    assert.match(result.logs.at(-1)?.message ?? '', /\[REDACTED\]/);
    assert.equal(agent.getLedger().get(enqueued.id)?.status, 'succeeded');
  });

  it('FullAgentCore 对能力不足任务返回 rejected，不假装执行成功', () => {
    const agent = new FullAgentCoreService(config);
    const identity = agent.register({ processExec: false, fileWrite: false, serviceControl: true });
    const controlPlane = agent.getControlPlaneClient();
    const enqueued = controlPlane.enqueueTask(identity, {
      executionRunId: 'run_missing_capability',
      executionStepId: 'step_missing_capability',
      idempotencyKey: 'idem_missing_capability',
      payload: { providerName: 'mock.certificate', action: 'deploy' },
    });

    const result = agent.runOnce();

    assert.equal(result.task?.taskId, enqueued.id);
    assert.equal(result.execution?.status, 'rejected');
    assert.equal(result.execution?.errorCode, 'CAPABILITY_MISSING');
    assert.equal(result.submittedResult?.status, 'failed');
    assert.equal(agent.getLedger().get(enqueued.id)?.status, 'rejected');
  });
});
