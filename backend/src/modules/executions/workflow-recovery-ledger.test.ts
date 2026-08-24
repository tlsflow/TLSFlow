import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { WorkflowRecoveryLedgerService } from './application/workflow-recovery-ledger.service.js';

async function fixture() {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260724000800_plugin_workflow_recovery.sql'), 'utf8'));
  return { db, service: new WorkflowRecoveryLedgerService(db, () => new Date('2026-07-24T00:00:00.000Z')) };
}

describe('WorkflowRecoveryLedgerService', () => {
  it('固定插件、工作流和输入哈希，重复开始保持幂等', async () => {
    const { service } = await fixture();
    const input = {
      tenantId: 'tenant-a', executionRunId: 'run-1', executionStepId: 'step-1', pluginVersionId: 'plugin-v1',
      workflowVersionId: 'workflow-v1', capabilityKey: 'certificate.deploy', target: { deviceId: 'device-1' },
      plan: { action: 'deploy' }, runtimeInput: { certificateRef: 'artifact://cert-1' },
    };
    const first = await service.begin(input);
    const repeated = await service.begin(input);

    assert.equal(repeated.id, first.id);
    await assert.rejects(() => service.begin({ ...input, pluginVersionId: 'plugin-v2' }), /固定版本或输入哈希不一致/);
  });

  it('写入规范化 checkpoint，并拒绝哈希变化和敏感内容', async () => {
    const { service } = await fixture();
    const ledger = await service.begin({
      tenantId: 'tenant-a', executionRunId: 'run-2', executionStepId: 'step-2', pluginVersionId: 'plugin-v1',
      workflowVersionId: 'workflow-v1', capabilityKey: 'certificate.deploy', target: {}, plan: {}, runtimeInput: {},
    });
    const capture = { etag: 'v1' };
    const captureHash = createHash('sha256').update('{"etag":"v1"}').digest('hex');
    const checkpoint = await service.recordCheckpoint({
      tenantId: 'tenant-a', ledgerId: ledger.id, checkpointName: 'before-write', workflowStepName: 'backup',
      capture, captureHash, requiredForRollback: true,
    });

    assert.equal(checkpoint.captureHash, captureHash);
    await assert.rejects(() => service.recordCheckpoint({
      tenantId: 'tenant-a', ledgerId: ledger.id, checkpointName: 'before-write', workflowStepName: 'backup',
      capture: { etag: 'v2' }, captureHash: createHash('sha256').update('{"etag":"v2"}').digest('hex'), requiredForRollback: true,
    }), /内容发生变化/);
    await assert.rejects(() => service.recordCheckpoint({
      tenantId: 'tenant-a', ledgerId: ledger.id, checkpointName: 'secret', workflowStepName: 'backup',
      capture: { privateKey: 'hidden' }, captureHash: '0'.repeat(64), requiredForRollback: true,
    }), /敏感字段/);
  });

  it('根据非幂等中断和回滚 checkpoint 分类恢复动作', async () => {
    const { service } = await fixture();
    const ledger = await service.begin({
      tenantId: 'tenant-a', executionRunId: 'run-3', executionStepId: 'step-3', pluginVersionId: 'plugin-v1',
      workflowVersionId: 'workflow-v1', capabilityKey: 'certificate.deploy', target: {}, plan: {}, runtimeInput: {},
    });
    const capture = { bindingDigest: 'abc' };
    const captureHash = createHash('sha256').update('{"bindingDigest":"abc"}').digest('hex');
    await service.recordCheckpoint({
      tenantId: 'tenant-a', ledgerId: ledger.id, checkpointName: 'binding-backup', workflowStepName: 'backup',
      capture, captureHash, requiredForRollback: true,
    });

    const classified = await service.classifyInterrupted({ tenantId: 'tenant-a', ledgerId: ledger.id, runningStepId: 'install', runningStepIdempotent: false });
    assert.equal(classified.recoveryClassification, 'ROLLBACK_REQUIRED');
  });
});
