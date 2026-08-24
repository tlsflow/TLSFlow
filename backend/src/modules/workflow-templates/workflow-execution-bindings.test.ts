import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { WorkflowExecutionBindingsService } from './application/workflow-execution-bindings.service.js';
import { WorkflowExecutionBindingsRepository } from './repository/workflow-execution-bindings.repository.js';

async function service() { const db=new PgliteDatabase(); await runMigrations(db,'src/database/migrations'); return new WorkflowExecutionBindingsService(new WorkflowExecutionBindingsRepository(db)); }
const base={ tenantId:'tenant_1',workflowTemplateId:'workflow_1',workflowVersionSelection:'PINNED' as const,workflowVersionId:'version_1',runner:'CONTROL_PLANE' as const,connectionBindings:{},variableBindings:{},credentialBindings:{},certificateArtifactBindings:{} };

test('工作流执行绑定支持创建、乐观锁更新和停用',async()=>{ const target=await service(); const created=await target.create(base); assert.equal(created.version,1); const updated=await target.update(base.tenantId,created.id,{expectedVersion:1,variableBindings:{path:'/etc/cert'}}); assert.equal(updated.version,2); await assert.rejects(()=>target.update(base.tenantId,created.id,{expectedVersion:1,variableBindings:{}}),(error:any)=>error.errorCode==='RESOURCE_VERSION_CONFLICT'); const disabled=await target.disable(base.tenantId,created.id,2); assert.equal(disabled.status,'DISABLED'); });
test('版本、Gateway、Credential 和明文 Secret 校验失败关闭',async()=>{ const target=await service(); await assert.rejects(()=>target.create({...base,workflowVersionId:undefined})); await assert.rejects(()=>target.create({...base,runner:'GATEWAY',gatewayId:undefined})); await assert.rejects(()=>target.create({...base,credentialBindings:{ssh:{credentialId:''}}})); await assert.rejects(()=>target.create({...base,connectionBindings:{ssh:{password:'plain'}}}),(error:any)=>error.errorCode==='SECRET_REF_INVALID'); });
test('切换到最新发布版本时清除旧的固定版本',async()=>{ const target=await service(); const created=await target.create(base); const updated=await target.update(base.tenantId,created.id,{expectedVersion:1,workflowVersionSelection:'LATEST_PUBLISHED'}); assert.equal(updated.workflowVersionSelection,'LATEST_PUBLISHED'); assert.equal(updated.workflowVersionId,undefined); });
