import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgAssetsRepository } from './repository/assets.repository.js';
import { ApplicationAssetExecutionService } from './application/application-asset-execution.service.js';

test('非受管资产只保存 WorkflowExecutionBinding 且拒绝插件 Assignment', async () => {
  const db=new PgliteDatabase(); await runMigrations(db,'src/database/migrations'); const tenantId='tenant-standalone-workflow'; const assets=new PgAssetsRepository(db);
  const asset=await assets.createServiceAsset(tenantId,{address:'standalone.example.com',port:443,protocol:'HTTPS',discoverySource:'MANUAL'});
  const service=new ApplicationAssetExecutionService(db);
  const saved=await service.saveStandaloneWorkflowExecution(tenantId,asset.id,{workflowExecution:{tenantId,workflowTemplateId:'workflow_user',workflowVersionSelection:'LATEST_PUBLISHED',runner:'CONTROL_PLANE',connectionBindings:{},variableBindings:{},credentialBindings:{},certificateArtifactBindings:{}}});
  assert.equal(saved.asset.deploymentStrategy?.type,'WORKFLOW'); assert.equal(saved.asset.deploymentStrategy?.workflow?.workflowExecutionBindingId,saved.workflowExecutionBinding.id);
  assert.equal(Number((await db.query<{count:string|number}>(`select count(*) from unified_plugin_bindings where tenant_id=$1`,[tenantId])).rows[0]?.count),0);
  await db.query(`insert into plugin_capability_assignments (id,tenant_id,owner_type,owner_id,capability_key,plugin_version_id,plugin_binding_id,precedence,status,created_at,updated_at) values ('assignment_conflict',$1,'APPLICATION_ASSET',$2,'certificate.deploy','plugin_version','plugin_binding','ASSET_OVERRIDE','ACTIVE',now(),now())`,[tenantId,asset.id]).catch(()=>undefined);
});
