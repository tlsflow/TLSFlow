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
      contract: { apiVersion: 'gcac.deployment-input/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} },
      effectiveBinding: { inputBindings: { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} }, provenance: {} },
      identity: { pluginVersionId: 'plugin-version-1' },
      input: { assetContext: {} as any, variables: {}, connections: {}, credentials: {}, artifacts: {} },
      sources: {},
      sensitivePaths: [],
      issues: [],
      executable: true,
      resolvedSha256: 'a'.repeat(64),
      resolvedDeploymentInput: {
        apiVersion: 'gcac.resolved-deployment-input/v1',
        contractVersion: 'gcac.deployment-input/v1',
        assetContext: {} as any,
        variables: {}, connections: {}, credentials: {}, artifacts: {}, provenance: {}, sensitivePaths: [], issues: [], executable: true,
        resolvedSha256: 'a'.repeat(64),
      },
      redaction: { sensitivePathCount: 0, genericRuleMatchCount: 0 },
    },
  };
  await repository.create(entity);
  assert.deepEqual(await repository.get('tenant-1', entity.id), entity);
  const persisted = await db.query<{ snapshot: unknown }>('select snapshot from deployment_input_snapshots where id=$1', [entity.id]);
  assert.equal(JSON.stringify(persisted.rows[0]?.snapshot).includes('resolvedInput'), false);
  assert.equal(JSON.stringify(persisted.rows[0]?.snapshot).includes('resolvedDeploymentInput'), true);
  assert.equal((await repository.listByPlan('tenant-1', 'plan-1')).length, 1);
  await assert.rejects(
    () => repository.create({ ...entity, id: newId('dis') }),
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
