import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as signPayload } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import type { FullAgentConfig } from './full-agent.types.js';
import { LocalProviderRuntime } from './runtime.js';
import { RecoveryLedger } from './recovery-ledger.js';
import { LocalUpgradeManager, type LocalUpgradePlan } from './upgrade.js';
import { LocalTaskLedger } from './local-task-ledger.js';

const config: FullAgentConfig = {
  tenantId: 'tenant_full_agent_runtime_test',
  agentKey: 'agent-local-runtime',
  hostname: 'gcac-local-agent',
  version: '0.1.0',
  osType: 'linux',
  arch: 'x64',
  dataDir: '/tmp/gcac-full-agent-runtime',
  dryRunDefault: true,
  heartbeatIntervalSeconds: 30,
};

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function task(payload: Record<string, unknown>, id = 'task_runtime_001') {
  return {
    id,
    tenantId: config.tenantId,
    agentId: 'agt_runtime_001',
    executionRunId: `run_${id}`,
    executionStepId: `step_${id}`,
    idempotencyKey: `idem_${id}`,
    payload,
    status: 'queued' as const,
    createdAt: '2026-06-09T00:00:00.000Z',
    updatedAt: '2026-06-09T00:00:00.000Z',
    requestId: `req_${id}`,
  };
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'gcac-full-agent-'));
}

describe('spec012 Full Agent 真实本地 Runtime/Upgrade/Recovery 骨架', () => {
  it('LocalProviderRuntime 默认 dry-run，不真实改写文件，但 ledger 记录可断点恢复', async () => {
    const root = await tempRoot();
    const dataDir = join(root, 'data');
    const workDir = join(root, 'work');
    const targetPath = join(workDir, 'service.conf');
    await mkdir(workDir, { recursive: true });
    await writeFile(targetPath, 'old');

    const ledger = new RecoveryLedger(join(dataDir, 'recovery-ledger.json'));
    const runtime = new LocalProviderRuntime({ dataDir, allowedRoots: [workDir], dryRunDefault: true, ledger });
    const result = await runtime.execute(task({ action: 'write-file', targetPath, content: 'new' }));

    assert.equal(result.result.status, 'dry_run');
    assert.equal(result.result.success, true);
    assert.equal(await readFile(targetPath, 'utf8'), 'old');

    const restoredLedger = await RecoveryLedger.load(join(dataDir, 'recovery-ledger.json'));
    assert.equal(restoredLedger.get('task_runtime_001')?.status, 'succeeded');
    assert.equal(restoredLedger.recoverable().length, 0);
  });

  it('SafeFileSystem 支持受限备份、原子写、verify 失败后按备份回滚', async () => {
    const root = await tempRoot();
    const dataDir = join(root, 'data');
    const workDir = join(root, 'work');
    const targetPath = join(workDir, 'service.conf');
    await mkdir(workDir, { recursive: true });
    await writeFile(targetPath, 'old');

    const runtime = new LocalProviderRuntime({ dataDir, allowedRoots: [workDir], dryRunDefault: false });
    const result = await runtime.execute(task({
      action: 'write-file',
      targetPath,
      content: 'new',
      expectedSha256: sha256('not-new'),
      backupTargets: [targetPath],
      dryRun: false,
    }, 'task_runtime_rollback'));

    assert.equal(result.result.success, false);
    assert.equal(result.result.errorCode, 'VERIFY_FAILED_ROLLED_BACK');
    assert.equal(await readFile(targetPath, 'utf8'), 'old');
  });

  it('SafeCommandExecutor 非 dry-run 只执行 allowlist 命令，拒绝危险命令', async () => {
    const root = await tempRoot();
    const runtime = new LocalProviderRuntime({ dataDir: join(root, 'data'), allowedRoots: [root], dryRunDefault: false, commandAllowlist: ['node'] });

    const denied = await runtime.execute(task({ action: 'run-command', command: 'rm', args: ['-rf', '/'], dryRun: false }, 'task_cmd_denied'));
    assert.equal(denied.result.success, false);
    assert.equal(denied.result.errorCode, 'COMMAND_NOT_ALLOWED');

    const dryRun = await runtime.execute(task({ action: 'run-command', command: 'rm', args: ['-rf', '/'], dryRun: true }, 'task_cmd_dry'));
    assert.equal(dryRun.result.status, 'dry_run');
    assert.match(dryRun.result.stdout, /command not executed/);
  });

  it('LocalUpgradeManager 从本地包读取，校验 sha256 和 ed25519 签名，staging 后 activate', async () => {
    const root = await tempRoot();
    const dataDir = join(root, 'data');
    const packageDir = join(root, 'packages');
    const installDir = join(root, 'install');
    const packagePath = join(packageDir, 'agent-0.2.0.pkg');
    await mkdir(packageDir, { recursive: true });
    await mkdir(installDir, { recursive: true });
    await writeFile(packagePath, 'agent package 0.2.0');
    await writeFile(join(installDir, 'agent-current.pkg'), 'agent package 0.1.0');

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const packageBytes = await readFile(packagePath);
    const signature = signPayload(null, packageBytes, privateKey).toString('base64');
    const plan: LocalUpgradePlan = {
      planId: 'upg_real_001',
      targetVersion: '0.2.0',
      packageUri: `file://${packagePath}`,
      packageSha256: sha256(packageBytes),
      signature,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      rollbackVersion: config.version,
      maintenanceWindowOpen: true,
      dryRun: false,
    };

    const manager = new LocalUpgradeManager({ config: { ...config, dataDir }, dataDir, installDir, allowedPackageRoots: [packageDir], dryRunDefault: true });
    const success = await manager.applyPlan(plan);

    assert.equal(success.status, 'succeeded');
    assert.equal(success.currentVersion, '0.2.0');
    assert.equal(await readFile(join(installDir, 'agent-current.pkg'), 'utf8'), 'agent package 0.2.0');
    assert.equal(manager.recoverablePlans().length, 0);
  });

  it('LocalUpgradeManager 哈希/签名失败拒绝，启动失败回滚到旧包，运行中任务阻断升级', async () => {
    const root = await tempRoot();
    const dataDir = join(root, 'data');
    const packageDir = join(root, 'packages');
    const installDir = join(root, 'install');
    const packagePath = join(packageDir, 'agent-0.3.0.pkg');
    await mkdir(packageDir, { recursive: true });
    await mkdir(installDir, { recursive: true });
    await writeFile(packagePath, 'agent package 0.3.0');
    await writeFile(join(installDir, 'agent-current.pkg'), 'agent package 0.1.0');

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const packageBytes = await readFile(packagePath);
    const basePlan: LocalUpgradePlan = {
      planId: 'upg_real_rollback',
      targetVersion: '0.3.0',
      packageUri: packagePath,
      packageSha256: sha256(packageBytes),
      signature: signPayload(null, packageBytes, privateKey).toString('base64'),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      rollbackVersion: config.version,
      maintenanceWindowOpen: true,
      dryRun: false,
    };

    const manager = new LocalUpgradeManager({ config: { ...config, dataDir }, dataDir, installDir, allowedPackageRoots: [packageDir], dryRunDefault: true });
    const badHash = await manager.applyPlan({ ...basePlan, planId: 'upg_bad_hash', packageSha256: 'bad' });
    assert.equal(badHash.status, 'rejected');
    assert.equal(badHash.errorCode, 'UPGRADE_HASH_INVALID');

    const badSignature = await manager.applyPlan({ ...basePlan, planId: 'upg_bad_sig', signature: Buffer.from('bad').toString('base64') });
    assert.equal(badSignature.status, 'rejected');
    assert.equal(badSignature.errorCode, 'UPGRADE_SIGNATURE_INVALID');

    const runningLedger = new LocalTaskLedger();
    runningLedger.accept(task({ action: 'write-file' }, 'task_running'));
    const blocked = await manager.applyPlan({ ...basePlan, planId: 'upg_blocked' }, runningLedger);
    assert.equal(blocked.status, 'rejected');
    assert.equal(blocked.errorCode, 'UPGRADE_BLOCKED_BY_RUNNING_TASKS');

    const rolledBack = await manager.applyPlan({ ...basePlan, planId: 'upg_startup_fail', simulateStartupFailure: true });
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(await readFile(join(installDir, 'agent-current.pkg'), 'utf8'), 'agent package 0.1.0');
  });
});
