import assert from 'node:assert/strict';
import test from 'node:test';
import type { AuditLogEntity } from '../../persistence/entities/audit-log.entity.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { WriteAuditInput } from '../audits/audit.service.js';
import { AuditService } from '../audits/audit.service.js';
import { runMigrations } from '../../database/migration-runner.js';
import { TaskRepository } from './task.repository.js';
import { TasksApplicationService } from './task.application-service.js';

class RecordingAuditService extends AuditService {
  readonly inputs: WriteAuditInput[] = [];

  override async write(input: WriteAuditInput): Promise<AuditLogEntity> {
    this.inputs.push(input);
    return {
      id: `audit-${this.inputs.length}`,
      tenantId: input.context?.tenantId,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      result: input.result,
      riskLevel: input.riskLevel,
      detail: input.detail,
      createdAt: new Date().toISOString(),
    };
  }
}

test('监控任务创建、取消和重试不写入审计，其他任务保持审计', async () => {
  const db = new PgliteDatabase();
  try {
    await runMigrations(db);
    const audit = new RecordingAuditService();
    const service = new TasksApplicationService(new TaskRepository(db), audit);

    const monitoringTask = await service.enqueue({
      tenantId: 'tenant-task-audit',
      taskType: 'MONITORING_BATCH',
      requestedBy: 'system',
      triggerSource: 'monitoring.scheduler',
    });
    await service.cancel(monitoringTask.tenantId, monitoringTask.id, 'system', '监控任务不需要人工取消');
    await service.retry(monitoringTask.tenantId, monitoringTask.id, 'system');

    const executionTask = await service.enqueue({
      tenantId: 'tenant-task-audit',
      taskType: 'REPORT_EXPORT',
      requestedBy: 'user-audit',
      triggerSource: 'report.manual',
    });
    await service.cancel(executionTask.tenantId, executionTask.id, 'user-audit', '用户取消');
    await service.retry(executionTask.tenantId, executionTask.id, 'user-audit');

    assert.deepEqual(audit.inputs.map((input) => input.eventType), [
      'task.created',
      'task.cancelled',
      'task.retried',
    ]);
    assert.deepEqual(audit.inputs.map((input) => input.resourceId), [
      executionTask.id,
      executionTask.id,
      executionTask.id,
    ]);
  } finally {
    await db.close();
  }
});
