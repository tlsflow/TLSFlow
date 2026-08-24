import { createHash } from 'node:crypto';
import type { AgentTaskEnvelope } from '../agents/schema/agents.schema.js';
import type { BackupManifest, BackupManager, BackupResult, RollbackManager, RollbackResult, VerifyManager, VerifyReport } from './full-agent.types.js';

function digest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function buildChecksum(manifest: Omit<BackupManifest, 'checksum'>): string {
  return digest({
    backupId: manifest.backupId,
    taskId: manifest.taskId,
    createdAt: manifest.createdAt,
    items: manifest.items,
    rollbackActions: manifest.rollbackActions,
  });
}

export class MockBackupManager implements BackupManager {
  createManifest(task: AgentTaskEnvelope, targets: string[]): BackupResult {
    if (task.payload.simulateBackup === 'failure') {
      return {
        success: false,
        errorCode: 'BACKUP_FAILED',
        errorMessage: '模拟备份失败，后续破坏性步骤必须停止',
      };
    }

    const safeTargets = targets.filter((target) => typeof target === 'string' && !target.includes('..') && target.startsWith('/mock/'));
    if (safeTargets.length !== targets.length) {
      return {
        success: false,
        errorCode: 'BACKUP_TARGET_UNSAFE',
        errorMessage: '备份目标不在 mock 安全边界内',
      };
    }

    const createdAt = new Date().toISOString();
    const partial: Omit<BackupManifest, 'checksum'> = {
      backupId: `bkp_${task.id}`,
      taskId: task.id,
      createdAt,
      items: safeTargets.map((target) => ({
        kind: 'file',
        target,
        digest: digest({ taskId: task.id, target }),
      })),
      rollbackActions: safeTargets.map((target) => ({
        type: 'restore_mock_artifact',
        target,
        digest: digest({ taskId: task.id, target }),
      })),
    };

    return {
      success: true,
      manifest: {
        ...partial,
        checksum: buildChecksum(partial),
      },
    };
  }

  verifyManifest(manifest: BackupManifest): boolean {
    return manifest.checksum === buildChecksum(manifest);
  }
}

export class MockVerifyManager implements VerifyManager {
  verify(input: { taskId: string; simulate?: unknown; expectedFingerprint?: string }): VerifyReport {
    const failed = input.simulate === 'failure' || input.simulate === 'verify_failure';
    return {
      success: !failed,
      checkedAt: new Date().toISOString(),
      checks: [
        {
          name: 'mock-local-config',
          success: !failed,
          detail: {
            taskId: input.taskId,
            expectedFingerprint: input.expectedFingerprint ?? 'mock-fingerprint',
          },
        },
        {
          name: 'mock-service-state',
          success: !failed,
          detail: { state: failed ? 'unknown' : 'running' },
        },
      ],
      errorCode: failed ? 'VERIFY_FAILED' : undefined,
      errorMessage: failed ? '模拟验证失败' : undefined,
    };
  }
}

export class MockRollbackManager implements RollbackManager {
  constructor(
    private readonly backup = new MockBackupManager(),
    private readonly verifier = new MockVerifyManager(),
  ) {}

  rollback(manifest: BackupManifest | undefined, verifyAfterRollback = true): RollbackResult {
    if (!manifest) {
      return {
        status: 'manual_intervention_required',
        success: false,
        rolledBackAt: new Date().toISOString(),
        restoredTargets: [],
        errorCode: 'ROLLBACK_POINT_MISSING',
        errorMessage: '没有备份点，不能伪造自动回滚成功',
      };
    }

    if (!this.backup.verifyManifest(manifest)) {
      return {
        status: 'manual_intervention_required',
        success: false,
        rolledBackAt: new Date().toISOString(),
        restoredTargets: [],
        errorCode: 'BACKUP_MANIFEST_TAMPERED',
        errorMessage: '备份 manifest 完整性校验失败',
      };
    }

    const verify = verifyAfterRollback ? this.verifier.verify({ taskId: manifest.taskId }) : undefined;
    return {
      status: verify?.success === false ? 'manual_intervention_required' : 'rolled_back',
      success: verify?.success !== false,
      rolledBackAt: new Date().toISOString(),
      restoredTargets: manifest.rollbackActions.map((action) => action.target),
      verify,
      errorCode: verify?.success === false ? 'ROLLBACK_VERIFY_FAILED' : undefined,
      errorMessage: verify?.success === false ? '回滚后验证失败' : undefined,
    };
  }
}
