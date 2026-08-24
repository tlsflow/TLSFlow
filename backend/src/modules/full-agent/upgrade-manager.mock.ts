import { createHash } from 'node:crypto';
import type { FullAgentConfig, UpgradePlanLike, UpgradeResult } from './full-agent.types.js';
import type { LocalTaskLedger } from './local-task-ledger.js';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export class MockUpgradeManager {
  constructor(private readonly config: FullAgentConfig) {}

  expectedPackageHash(plan: Pick<UpgradePlanLike, 'targetVersion'>): string {
    return sha256(`mock-full-agent-package:${plan.targetVersion}`);
  }

  applyPlan(plan: UpgradePlanLike, ledger?: Pick<LocalTaskLedger, 'recoverable'>): UpgradeResult {
    const runningTasks = ledger?.recoverable().length ?? 0;
    if (runningTasks > 0) {
      return {
        status: 'rejected',
        currentVersion: this.config.version,
        targetVersion: plan.targetVersion,
        rollbackVersion: plan.rollbackVersion,
        errorCode: 'UPGRADE_BLOCKED_BY_RUNNING_TASKS',
        errorMessage: '存在未终态任务，mock 升级必须等待任务完成或维护窗口',
        detail: { runningTasks },
      };
    }

    if (plan.maintenanceWindowOpen === false) {
      return {
        status: 'rejected',
        currentVersion: this.config.version,
        targetVersion: plan.targetVersion,
        rollbackVersion: plan.rollbackVersion,
        errorCode: 'UPGRADE_OUTSIDE_MAINTENANCE_WINDOW',
        errorMessage: '不在维护窗口内，拒绝升级',
        detail: { planId: plan.planId },
      };
    }

    const expectedHash = this.expectedPackageHash(plan);
    if (plan.simulate === 'hash_mismatch' || plan.packageSha256 !== expectedHash) {
      return {
        status: 'rejected',
        currentVersion: this.config.version,
        targetVersion: plan.targetVersion,
        rollbackVersion: plan.rollbackVersion,
        errorCode: 'UPGRADE_HASH_INVALID',
        errorMessage: '升级包哈希校验失败',
        detail: { expectedHash, actualHash: plan.packageSha256 },
      };
    }

    if (plan.simulate === 'signature_invalid' || plan.signature !== `mock-signature:${plan.targetVersion}`) {
      return {
        status: 'rejected',
        currentVersion: this.config.version,
        targetVersion: plan.targetVersion,
        rollbackVersion: plan.rollbackVersion,
        errorCode: 'UPGRADE_SIGNATURE_INVALID',
        errorMessage: '升级包签名校验失败',
        detail: { signature: plan.signature },
      };
    }

    const rollbackPoint = {
      version: this.config.version,
      configDigest: sha256(JSON.stringify({
        agentKey: this.config.agentKey,
        hostname: this.config.hostname,
        dataDir: this.config.dataDir,
      })),
      serviceState: 'mock-running',
    };

    if (plan.simulate === 'startup_failure') {
      return {
        status: 'rolled_back',
        currentVersion: rollbackPoint.version,
        targetVersion: plan.targetVersion,
        rollbackVersion: plan.rollbackVersion,
        errorCode: 'UPGRADE_STARTUP_FAILED_ROLLED_BACK',
        errorMessage: '新版本启动失败，已回滚到上一 mock 版本',
        detail: { rollbackPoint },
      };
    }

    return {
      status: 'succeeded',
      currentVersion: plan.targetVersion,
      targetVersion: plan.targetVersion,
      rollbackVersion: plan.rollbackVersion,
      detail: {
        rollbackPoint,
        packageVerified: true,
        realSystemMutation: false,
      },
    };
  }
}
