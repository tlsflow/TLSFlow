import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from './pglite-database.js';
import { runMigrations } from './migration-runner.js';
import { TaskRepository } from '../modules/tasks/task.repository.js';
import { TasksApplicationService } from '../modules/tasks/task.application-service.js';
import { governApplicationCertificateSupplyV2 } from './govern-application-certificate-supply-v2.js';

test('历史 V2 治理保留活动 V1，结束重复 V2 部署子任务和父任务，并保留终态事实', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const tasks = new TasksApplicationService(new TaskRepository(db));
  await tasks.initialize();
  const common = {
    tenantId: 'tenant-governance',
    requestedBy: 'operator',
    triggerSource: 'test',
    payload: {
      applicationAssetId: 'application-governance',
      policyVersionId: 'policy-version-governance',
      certificateRequestId: 'certificate-request-governance',
      certificateVersionId: 'certificate-version-governance',
    },
  } as const;
  const v1 = await tasks.enqueue({
    ...common,
    taskType: 'APPLICATION_CERTIFICATE_SUPPLY',
    idempotencyKey: 'application-certificate-supply:v1:application-governance:policy-version-governance',
    initialStatus: 'WAITING_RESULT',
  });
  const v2 = await tasks.enqueue({
    ...common,
    taskType: 'APPLICATION_CERTIFICATE_SUPPLY',
    idempotencyKey: 'application-certificate-supply:v2:application-governance:policy-version-governance:legacy-session',
    initialStatus: 'WAITING_RESULT',
  });
  const duplicateDeployment = await tasks.enqueue({
    tenantId: common.tenantId,
    requestedBy: common.requestedBy,
    triggerSource: 'test',
    taskType: 'CERTIFICATE_DEPLOY',
    parentTaskId: v2.id,
    idempotencyKey: 'execution-run:governance-duplicate',
    payload: { deploymentPlanId: 'deployment-plan-duplicate', runId: 'execution-run-duplicate' },
    initialStatus: 'WAITING_RESULT',
  });
  const completedV2 = await tasks.enqueue({
    ...common,
    taskType: 'APPLICATION_CERTIFICATE_SUPPLY',
    idempotencyKey: 'application-certificate-supply:v2:application-governance:policy-version-governance:completed-session',
  });
  const completedDeployment = await tasks.enqueue({
    tenantId: common.tenantId,
    requestedBy: common.requestedBy,
    triggerSource: 'test',
    taskType: 'CERTIFICATE_DEPLOY',
    parentTaskId: completedV2.id,
    idempotencyKey: 'execution-run:governance-completed',
    payload: { deploymentPlanId: 'deployment-plan-completed', runId: 'execution-run-completed' },
  });
  await db.query(`update task_runs set status = 'SUCCEEDED', finished_at = now() where id = any($1::text[])`, [[completedV2.id, completedDeployment.id]]);

  const report = await governApplicationCertificateSupplyV2(db, tasks, { actorId: 'governance-test' });

  assert.equal(report.queriedV2TaskCount, 2);
  assert.deepEqual(report.retainedActiveParentIds, [v1.id]);
  assert.deepEqual(report.cancelledParentIds, [v2.id]);
  assert.deepEqual(report.cancelledDeploymentTaskIds, [duplicateDeployment.id]);
  assert.equal((await tasks.detail(common.tenantId, v1.id)).task.status, 'WAITING_RESULT');
  assert.equal((await tasks.detail(common.tenantId, v2.id)).task.status, 'CANCELLED');
  assert.equal((await tasks.detail(common.tenantId, duplicateDeployment.id)).task.status, 'CANCELLED');
  assert.equal((await tasks.detail(common.tenantId, completedV2.id)).task.status, 'SUCCEEDED');
  assert.equal((await tasks.detail(common.tenantId, completedDeployment.id)).task.status, 'SUCCEEDED');
  assert.equal(
    (await db.query<{ count: number }>(
      `select count(*)::int as count from task_events where task_run_id = $1 and event_type = 'CANCELLED'`,
      [v2.id],
    )).rows[0]?.count,
    1,
  );

  await db.close();
});

test('只有活动 V2 时先接管为 V1，再保留唯一活动链', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const tasks = new TasksApplicationService(new TaskRepository(db));
  await tasks.initialize();
  const v2 = await tasks.enqueue({
    tenantId: 'tenant-governance-v2-only',
    requestedBy: 'operator',
    triggerSource: 'test',
    taskType: 'APPLICATION_CERTIFICATE_SUPPLY',
    idempotencyKey: 'application-certificate-supply:v2:application-v2-only:policy-v2-only:legacy-session',
    payload: {
      applicationAssetId: 'application-v2-only',
      policyVersionId: 'policy-v2-only',
      certificateRequestId: 'certificate-request-v2-only',
    },
    initialStatus: 'WAITING_RESULT',
  });

  const report = await governApplicationCertificateSupplyV2(db, tasks, { actorId: 'governance-test' });

  assert.deepEqual(report.retainedActiveParentIds, [v2.id]);
  assert.deepEqual(report.groups[0]?.retainedParentKind, 'V1');
  assert.equal(
    (await tasks.detail('tenant-governance-v2-only', v2.id)).task.idempotencyKey,
    'application-certificate-supply:v1:application-v2-only:policy-v2-only',
  );
  assert.equal(
    (await tasks.findByIdempotencyKey('tenant-governance-v2-only', 'APPLICATION_CERTIFICATE_SUPPLY', 'application-certificate-supply:v1:application-v2-only:policy-v2-only'))?.id,
    v2.id,
  );
  const replayed = await tasks.enqueue({
    tenantId: 'tenant-governance-v2-only',
    requestedBy: 'operator',
    triggerSource: 'test',
    taskType: 'APPLICATION_CERTIFICATE_SUPPLY',
    idempotencyKey: 'application-certificate-supply:v1:application-v2-only:policy-v2-only',
    payload: {
      applicationAssetId: 'application-v2-only',
      policyVersionId: 'policy-v2-only',
      certificateRequestId: 'certificate-request-v2-only',
    },
    initialStatus: 'WAITING_RESULT',
  });
  assert.equal(replayed.id, v2.id);

  await db.close();
});
