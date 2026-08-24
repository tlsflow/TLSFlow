import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { BusinessPermissionGrantEntity, BusinessPermissionRelationEntity } from '../../persistence/entities/business-permission.entity.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import { createBusinessPermissionRelationProjector } from './business-permission.relation-projector.js';
import { BusinessPermissionResolver } from './business-permission.resolver.js';

test('业务关系投影只从应用根对象展开部署和执行链路，使用者不能执行，撤销立即失效', async () => {
  const db = new PgliteDatabase();
  await db.exec(`
    create table pg_service_assets (id text primary key, tenant_id text not null, deleted_at timestamptz);
    create table pg_application_asset_targets (id text primary key, tenant_id text not null, application_asset_id text not null, managed_target_id text not null, deleted_at timestamptz);
    create table pg_managed_targets (id text primary key, tenant_id text not null, device_asset_id text, deleted_at timestamptz);
    create table pg_certificate_bindings (id text primary key, tenant_id text not null, service_asset_id text, managed_target_id text, deleted_at timestamptz);
  `);
  await db.query(`insert into pg_service_assets (id, tenant_id) values ('app_1', 'tenant_a'), ('app_other', 'tenant_b')`);
  await db.query(`insert into pg_managed_targets (id, tenant_id, device_asset_id) values ('target_1', 'tenant_a', 'device_1')`);
  await db.query(`insert into pg_application_asset_targets (id, tenant_id, application_asset_id, managed_target_id) values ('link_1', 'tenant_a', 'app_1', 'target_1')`);
  await db.query(`insert into pg_certificate_bindings (id, tenant_id, service_asset_id) values ('binding_1', 'tenant_a', 'app_1')`);

  const plans = new PgDocumentRepository<{ id: string; tenantId: string }>(db, 'deployment-plans:plans');
  const targets = new PgDocumentRepository<{ id: string; tenantId: string; deploymentPlanId: string; applicationAssetId: string }>(db, 'deployment-plans:targets');
  const runs = new PgDocumentRepository<{ id: string; tenantId: string; deploymentPlanId: string }>(db, 'executions:runs');
  const steps = new PgDocumentRepository<{ id: string; tenantId: string; executionRunId: string }>(db, 'executions:steps');
  await plans.create({ id: 'plan_1', tenantId: 'tenant_a' });
  await targets.create({ id: 'target_plan_1', tenantId: 'tenant_a', deploymentPlanId: 'plan_1', applicationAssetId: 'app_1' });
  await runs.create({ id: 'run_1', tenantId: 'tenant_a', deploymentPlanId: 'plan_1' });
  await steps.create({ id: 'step_1', tenantId: 'tenant_a', executionRunId: 'run_1' });

  const grants = new PgDocumentRepository<BusinessPermissionGrantEntity>(db, 'security.business_permission_grants');
  const relations = new PgDocumentRepository<BusinessPermissionRelationEntity>(db, 'security.business_permission_relations');
  const resolver = new BusinessPermissionResolver(grants, relations, undefined, createBusinessPermissionRelationProjector(db));
  const subject = { id: 'user_1', type: 'user' as const, scope: { tenantId: 'tenant_a' } };

  const userGrant = await resolver.create({
    tenantId: 'tenant_a', principalType: 'user', principalId: 'user_1', roleId: 'role_user',
    domain: 'application', level: 'user', rootObjectType: 'service_asset', rootObjectId: 'app_1', createdBy: 'admin',
  });
  assert.equal(await resolver.isActionAllowed(subject, 'application.deployment.read', { type: 'deployment_plan', id: 'plan_1' }), true);
  assert.equal(await resolver.isActionAllowed(subject, 'deployment.plan.execute', { type: 'deployment_plan', id: 'plan_1' }), false);

  const managerGrant = await resolver.create({
    tenantId: 'tenant_a', principalType: 'user', principalId: 'user_1', roleId: 'role_manager',
    domain: 'application', level: 'manager', rootObjectType: 'service_asset', rootObjectId: 'app_1', createdBy: 'admin',
  });
  assert.equal(await resolver.isActionAllowed(subject, 'deployment.plan.execute', { type: 'deployment_plan', id: 'plan_1' }), true);
  assert.deepEqual(new Set(await resolver.authorizedObjectIds(subject, 'execution_run', 'read')), new Set(['run_1']));
  assert.equal(await resolver.isActionAllowed(subject, 'execution.step.read', { type: 'execution_step', id: 'step_1' }), true);

  await resolver.revoke(managerGrant.id, managerGrant.version);
  assert.equal(await resolver.isActionAllowed(subject, 'deployment.plan.execute', { type: 'deployment_plan', id: 'plan_1' }), false);
  await resolver.revoke(userGrant.id, userGrant.version);
  assert.deepEqual(await resolver.authorizedObjectIds(subject, 'deployment_plan', 'read'), []);
  await assert.rejects(resolver.create({
    tenantId: 'tenant_a', principalType: 'user', principalId: 'user_2', roleId: 'role_other',
    domain: 'application', level: 'user', rootObjectType: 'service_asset', rootObjectId: 'app_other', createdBy: 'admin',
  }));
});
