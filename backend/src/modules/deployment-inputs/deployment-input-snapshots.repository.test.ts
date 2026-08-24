import assert from 'node:assert/strict';
import test from 'node:test';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { newId } from '../../shared/id.js';
import { DeploymentInputSnapshotsRepository } from './repository/deployment-input-snapshots.repository.js';
import type { DeploymentInputSnapshotEntity } from './dto/deployment-input-snapshot.dto.js';

test('部署输入快照迁移后可查询且数据库拒绝更新和删除', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
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
