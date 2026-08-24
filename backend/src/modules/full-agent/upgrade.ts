import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { FullAgentConfig, UpgradeResult } from './full-agent.types.js';
import type { LocalTaskLedger } from './local-task-ledger.js';
import { RecoveryLedger } from './recovery-ledger.js';
import { SafeFileSystem } from './runtime.js';

export interface LocalUpgradePlan {
  planId: string;
  targetVersion: string;
  packageUri: string;
  packageSha256: string;
  signature: string;
  publicKeyPem: string;
  rollbackVersion: string;
  maintenanceWindowOpen?: boolean;
  dryRun?: boolean;
  simulateStartupFailure?: boolean;
}

export interface LocalUpgradeManagerOptions {
  config: FullAgentConfig;
  dataDir?: string;
  installDir: string;
  allowedPackageRoots: string[];
  dryRunDefault?: boolean;
  ledger?: RecoveryLedger;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function fileUriToPath(uriOrPath: string): string {
  if (uriOrPath.startsWith('file://')) return new URL(uriOrPath).pathname;
  return uriOrPath;
}

function verifyEd25519(input: { publicKeyPem: string; payload: Buffer; signature: string }): boolean {
  const publicKey = createPublicKey(input.publicKeyPem);
  const signature = Buffer.from(input.signature, 'base64');
  return verifySignature(null, input.payload, publicKey, signature);
}

export class LocalUpgradeManager {
  private readonly fs: SafeFileSystem;
  private readonly dataDir: string;
  private readonly dryRunDefault: boolean;
  private readonly ledger: RecoveryLedger;
  private readonly installDir: string;

  constructor(private readonly options: LocalUpgradeManagerOptions) {
    this.dataDir = options.dataDir ?? options.config.dataDir;
    this.dryRunDefault = options.dryRunDefault ?? true;
    this.ledger = options.ledger ?? new RecoveryLedger(join(this.dataDir, 'upgrade-ledger.json'));
    this.installDir = resolve(options.installDir);
    this.fs = new SafeFileSystem(this.dataDir, [this.installDir, ...options.allowedPackageRoots]);
  }

  async applyPlan(plan: LocalUpgradePlan, taskLedger?: Pick<LocalTaskLedger, 'recoverable'>): Promise<UpgradeResult> {
    const dryRun = plan.dryRun ?? this.dryRunDefault;
    await this.ledger.start(plan.planId, 'upgrade', 'received', { targetVersion: plan.targetVersion, dryRun });

    const runningTasks = taskLedger?.recoverable().length ?? 0;
    if (runningTasks > 0) {
      await this.ledger.record(plan.planId, 'failed', 'blocked-running-tasks', { runningTasks });
      return this.result(plan, 'rejected', this.options.config.version, { runningTasks }, 'UPGRADE_BLOCKED_BY_RUNNING_TASKS', '存在未终态任务，拒绝升级');
    }
    if (plan.maintenanceWindowOpen === false) {
      await this.ledger.record(plan.planId, 'failed', 'maintenance-window', {});
      return this.result(plan, 'rejected', this.options.config.version, {}, 'UPGRADE_OUTSIDE_MAINTENANCE_WINDOW', '不在维护窗口内，拒绝升级');
    }

    try {
      const packagePath = this.fs.resolveAllowed(fileUriToPath(plan.packageUri));
      const packageBytes = await readFile(packagePath);
      const actualHash = sha256(packageBytes);
      if (actualHash !== plan.packageSha256) {
        await this.ledger.record(plan.planId, 'failed', 'hash', { actualHash });
        return this.result(plan, 'rejected', this.options.config.version, { actualHash }, 'UPGRADE_HASH_INVALID', '升级包 sha256 校验失败');
      }
      if (!verifyEd25519({ publicKeyPem: plan.publicKeyPem, payload: packageBytes, signature: plan.signature })) {
        await this.ledger.record(plan.planId, 'failed', 'signature', {});
        return this.result(plan, 'rejected', this.options.config.version, {}, 'UPGRADE_SIGNATURE_INVALID', '升级包 ed25519 签名校验失败');
      }
      await this.ledger.record(plan.planId, 'verified', 'package-verified', { packagePath, actualHash });

      const previousPath = join(this.installDir, 'agent-current.pkg');
      const rollbackPath = join(this.dataDir, 'upgrade-rollback', `${plan.planId}-${basename(previousPath)}`);
      const stagedPath = join(this.dataDir, 'upgrade-staging', `${plan.planId}-${basename(packagePath)}`);
      const rollbackPoint = { version: this.options.config.version, previousPath, rollbackPath, existed: await exists(previousPath) };

      if (!dryRun) {
        await mkdir(dirname(stagedPath), { recursive: true });
        await copyFile(packagePath, stagedPath);
        if (rollbackPoint.existed) {
          await mkdir(dirname(rollbackPath), { recursive: true });
          await copyFile(previousPath, rollbackPath);
        }
      }
      await this.ledger.record(plan.planId, 'staged', 'staged', { stagedPath, rollbackPoint });

      if (!dryRun) {
        await mkdir(dirname(previousPath), { recursive: true });
        await rename(stagedPath, previousPath);
      }
      await this.ledger.record(plan.planId, 'activated', 'activated', { previousPath });

      if (plan.simulateStartupFailure) {
        if (!dryRun) {
          if (rollbackPoint.existed) await copyFile(rollbackPath, previousPath);
          else await rm(previousPath, { force: true });
        }
        await this.ledger.record(plan.planId, 'rolled_back', 'startup-failed-rollback', { rollbackPoint });
        return this.result(plan, 'rolled_back', this.options.config.version, { rollbackPoint, dryRun, packageVerified: true }, 'UPGRADE_STARTUP_FAILED_ROLLED_BACK', '新版本启动失败，已回滚');
      }

      await this.ledger.record(plan.planId, 'succeeded', 'done', { rollbackPoint, dryRun });
      return this.result(plan, 'succeeded', plan.targetVersion, { rollbackPoint, dryRun, packageVerified: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : '升级失败';
      await this.ledger.record(plan.planId, 'failed', 'exception', { errorMessage: message });
      return this.result(plan, 'rejected', this.options.config.version, {}, 'UPGRADE_APPLY_FAILED', message);
    }
  }

  recoverablePlans() {
    return this.ledger.recoverable();
  }

  private result(plan: LocalUpgradePlan, status: UpgradeResult['status'], currentVersion: string, detail: Record<string, unknown>, errorCode?: string, errorMessage?: string): UpgradeResult {
    return {
      status,
      currentVersion,
      targetVersion: plan.targetVersion,
      rollbackVersion: plan.rollbackVersion,
      errorCode,
      errorMessage,
      detail,
    };
  }
}
