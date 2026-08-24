import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { newId } from '../../shared/id.js';
import { DeploymentInputSnapshotsRepository } from './repository/deployment-input-snapshots.repository.js';
import type { DeploymentInputSnapshotEntity } from './dto/deployment-input-snapshot.dto.js';

test('部署输入快照迁移后可查询且数据库拒绝更新和删除', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile('src/database/migrations/20260730000300_deployment_input_snapshots.sql', 'utf8'));
  await db.exec(await readFile('src/database/migrations/20260730000600_sanitize_deployment_input_snapshots.sql', 'utf8'));
  const repository = new DeploymentInputSnapshotsRepository(db);
  const entity: DeploymentInputSnapshotEntity = {
    id: newId('dis'),
    tenantId: 'tenant-1',
    deploymentPlanId: 'plan-1',
    deploymentPlanTargetId: 'target-1',
    revision: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    createdBy: 'user-1',
    snapshot: {
      apiVersion: 'gcac.deployment-input-snapshot/v1',
      snapshotVersion: 1,
      resolvedAt: '2026-07-30T00:00:00.000Z',
      contractVersion: 'gcac.deployment-input/v1',
      identity: { pluginVersionId: 'plugin-version-1' },
      input: { assetContext: {} as any, variables: {}, connections: {}, credentials: {}, artifacts: {} },
      sources: {},
      sensitivePaths: [],
      issues: [],
      executable: true,
      resolvedSha256: 'a'.repeat(64),
      redaction: { sensitivePathCount: 0, genericRuleMatchCount: 0 },
    },
  };
  const secret = 'runtime-private-key';
  const runtimeSnapshot = {
    apiVersion: 'gcac.deployment-input-runtime-snapshot/v1' as const,
    contract: { apiVersion: 'gcac.deployment-input/v1' as const, variables: {}, connections: {}, credentials: {}, artifacts: {} },
    effectiveBinding: {
      inputBindings: { apiVersion: 'gcac.input-bindings/v1' as const, variables: {}, connections: {}, credentials: {}, artifacts: {} },
      provenance: {},
    },
    resolvedDeploymentInput: {
      apiVersion: 'gcac.resolved-deployment-input/v1' as const,
      contractVersion: 'gcac.deployment-input/v1' as const,
      assetContext: {} as any,
      variables: {}, connections: {}, credentials: {},
      artifacts: { certificate: { outputs: { privateKey: secret } } },
      provenance: {}, sensitivePaths: ['artifacts.certificate.outputs.privateKey'], issues: [], executable: true,
      resolvedSha256: 'a'.repeat(64),
    },
    deploymentArtifact: { certificateVersionId: 'cv-1', certificateFormatId: 'cf-1', format: 'pem', containsPrivateKey: true, privateKeyPem: secret },
  };
  await repository.create(entity, runtimeSnapshot);
  assert.deepEqual(await repository.get('tenant-1', entity.id), entity);
  assert.deepEqual(await repository.getRuntimeSnapshot('tenant-1', entity.id), runtimeSnapshot);
  const persisted = await db.query<{ snapshot: unknown; sealed_runtime_payload: unknown }>(
    'select snapshot, sealed_runtime_payload from deployment_input_snapshots where id=$1',
    [entity.id],
  );
  assert.equal(JSON.stringify(persisted.rows[0]).includes(secret), false);
  assert.equal(JSON.stringify(persisted.rows[0]?.snapshot).includes('resolvedInput'), false);
  assert.equal(JSON.stringify(persisted.rows[0]?.snapshot).includes('resolvedDeploymentInput'), false);
  assert.equal((await repository.listByPlan('tenant-1', 'plan-1')).length, 1);
  await assert.rejects(
    () => repository.create({ ...entity, id: newId('dis') }, runtimeSnapshot),
    /uq_deployment_input_snapshots_target_revision|duplicate key/i,
  );
  await assert.rejects(
    () => db.query('update deployment_input_snapshots set revision=2 where id=$1', [entity.id]),
    /immutable/,
  );
  await assert.rejects(
    () => db.query('delete from deployment_input_snapshots where id=$1', [entity.id]),
    /immutable/,
  );
});

test('部署输入快照迁移可随事务完整回滚', async () => {
  const db = new PgliteDatabase();
  const sql = await readFile('src/database/migrations/20260730000300_deployment_input_snapshots.sql', 'utf8');
  await assert.rejects(() => db.transaction(async (transaction) => {
    await transaction.exec(sql);
    throw new Error('rollback rehearsal');
  }), /rollback rehearsal/);

  const result = await db.query<{ count: string }>(
    `select count(*)::text count
       from information_schema.tables
      where table_schema='public' and table_name='deployment_input_snapshots'`,
  );
  assert.equal(result.rows[0]?.count, '0');
});

test('部署输入快照安全迁移删除历史完整运行输入并恢复不可变约束', async () => {
  const db = new PgliteDatabase();
  await db.exec(await readFile('src/database/migrations/20260730000300_deployment_input_snapshots.sql', 'utf8'));
  const secret = 'historical-private-key';
  const snapshot = {
    apiVersion: 'gcac.deployment-input-snapshot/v1', snapshotVersion: 1,
    resolvedAt: '2026-07-30T00:00:00.000Z', contractVersion: 'gcac.deployment-input/v1',
    contract: { variables: { password: { default: secret } } },
    effectiveBinding: { inputBindings: { variables: { password: secret } } },
    identity: {}, input: { assetContext: {}, variables: { password: '[REDACTED]' }, connections: {}, credentials: {}, artifacts: {} },
    sources: {}, sensitivePaths: ['variables.password'], issues: [], executable: true,
    resolvedSha256: 'b'.repeat(64),
    resolvedInput: { credentials: { management: { password: secret } } },
    resolvedDeploymentInput: { artifacts: { certificate: { privateKey: secret } } },
    redaction: { sensitivePathCount: 1, genericRuleMatchCount: 1 },
  };
  await db.query(
    `insert into deployment_input_snapshots
      (id, tenant_id, deployment_plan_id, deployment_plan_target_id, revision, snapshot, created_at, created_by)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
    ['snapshot-legacy', 'tenant-1', 'plan-1', 'target-1', 1, JSON.stringify(snapshot), '2026-07-30T00:00:00.000Z', 'user-1'],
  );
  await db.exec(`
    create table pg_documents (
      namespace varchar(128) not null,
      document_id varchar(128) not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (namespace, document_id)
    );
    create table pg_execution_steps (
      id text primary key,
      input_snapshot jsonb not null
    );
  `);
  await db.query(
    `insert into pg_documents (namespace, document_id, payload)
     values ('deployment-plans:targets', 'target-1', $1::jsonb)`,
    [JSON.stringify({
      id: 'target-1',
      strategyPayload: {
        deploymentInputSnapshotRef: {
          apiVersion: 'gcac.deployment-input-snapshot/v1',
          snapshotId: 'snapshot-legacy',
          revision: 1,
          resolvedSha256: 'b'.repeat(64),
        },
      },
    })],
  );
  await db.query(
    `insert into pg_execution_steps (id, input_snapshot) values ('step-legacy', $1::jsonb)`,
    [JSON.stringify({
      resolvedInput: { password: secret },
      resolvedDeploymentInput: { privateKey: secret },
      deploymentArtifact: { pfxBase64: secret },
      artifact: { privateKeyPem: secret },
      deploymentInputSnapshotRef: { snapshotId: 'snapshot-legacy' },
    })],
  );

  await db.exec(await readFile('src/database/migrations/20260730000600_sanitize_deployment_input_snapshots.sql', 'utf8'));
  const persisted = await db.query<{ snapshot: unknown }>('select snapshot from deployment_input_snapshots where id=$1', ['snapshot-legacy']);
  assert.equal(JSON.stringify(persisted.rows[0]?.snapshot).includes(secret), false);
  const target = await db.query<{ payload: Record<string, any> }>(
    `select payload from pg_documents where namespace='deployment-plans:targets' and document_id='target-1'`,
  );
  assert.equal(target.rows[0]?.payload.strategyPayload.deploymentInputSnapshotRef, undefined);
  assert.equal(
    target.rows[0]?.payload.strategyPayload.deploymentInputSnapshotInvalidated.reason,
    'SEALED_RUNTIME_PAYLOAD_REQUIRED',
  );
  const step = await db.query<{ input_snapshot: unknown }>(
    `select input_snapshot from pg_execution_steps where id='step-legacy'`,
  );
  assert.equal(JSON.stringify(step.rows[0]?.input_snapshot).includes(secret), false);
  assert.deepEqual(step.rows[0]?.input_snapshot, {
    deploymentInputSnapshotRef: { snapshotId: 'snapshot-legacy' },
  });
  await assert.rejects(
    () => db.query('delete from deployment_input_snapshots where id=$1', ['snapshot-legacy']),
    /immutable/,
  );
});
