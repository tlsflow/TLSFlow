import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { App } from '../../common/http/app.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { SecurityController } from './security.controller.js';
import { createPersistedSecurityServices } from './security-services.persistence.js';

describe('多租户模式 API', () => {
  it('预检查通过后可以启用层级多租户，并使旧上下文失败关闭', async () => {
    const fixture = await createFixture('single');
    const token = await fixture.loginAdmin();

    const preflight = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/preflight',
      headers: { authorization: `Bearer ${token}` },
      body: { confirmation: 'preflight-20260806' },
    });
    assert.equal(preflight.statusCode, 200);
    const preflightBody = preflight.body as {
      state: { mode: string; lifecycleState: string };
      batch: { id: string; status: string };
      report: { blockers: number; warnings: number };
    };
    assert.equal(preflightBody.batch.status, 'COMPLETED');
    assert.equal(preflightBody.report.blockers, 0);

    const enabled = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/enable',
      headers: { authorization: `Bearer ${token}` },
      body: {
        preflightBatchId: preflightBody.batch.id,
        confirmation: 'enable-20260806',
      },
    });
    assert.equal(enabled.statusCode, 200);
    const enabledBody = enabled.body as {
      state: { mode: string; lifecycleState: string; lastEnableBatchId: string };
      batch: { id: string; status: string };
    };
    assert.equal(enabledBody.state.mode, 'hierarchical');
    assert.equal(enabledBody.state.lifecycleState, 'HIERARCHICAL');
    assert.equal(enabledBody.batch.status, 'COMPLETED');

    const stale = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/system/tenant-mode',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((stale.body as { errorCode: string }).errorCode, 'TENANT_CONTEXT_STALE');

    const freshToken = await fixture.loginAdmin();
    const state = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/system/tenant-mode',
      headers: { authorization: `Bearer ${freshToken}` },
    });
    assert.equal(state.statusCode, 200);
    assert.equal((state.body as { state: { mode: string } }).state.mode, 'hierarchical');
  });

  it('预检查发现阻断项时保持 SINGLE 且拒绝启用', async () => {
    const fixture = await createFixture('single');
    const token = await fixture.loginAdmin();
    await fixture.security.objectPermissions.createObjectSet({
      id: 'oset_preflight_blocker',
      tenantId: '*',
      name: '历史全局集合',
      kind: 'dynamic',
      objectTypes: ['certificate'],
      conditions: {},
      status: 'active',
    });

    const preflight = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/preflight',
      headers: { authorization: `Bearer ${token}` },
      body: { confirmation: 'preflight-blocked-20260806' },
    });
    assert.equal(preflight.statusCode, 200);
    const preflightBody = preflight.body as {
      batch: { id: string; status: string };
      report: { blockers: number; items: Array<{ id: string; status: string }> };
    };
    assert.equal(preflightBody.batch.status, 'FAILED');
    assert.equal(preflightBody.report.blockers > 0, true);
    assert.equal(preflightBody.report.items.some((item) => item.id === 'legacy-wildcard-permissions' && item.status === 'blocked'), true);

    const denied = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/enable',
      headers: { authorization: `Bearer ${token}` },
      body: {
        preflightBatchId: preflightBody.batch.id,
        confirmation: 'enable-blocked-20260806',
      },
    });
    assert.equal(denied.statusCode, 409);
    assert.equal((denied.body as { errorCode: string }).errorCode, 'TENANT_PREFLIGHT_FAILED');

    const state = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/system/tenant-mode',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(state.statusCode, 200);
    const stateBody = state.body as {
      state: { mode: string; lifecycleState: string; lastPreflightBatchId?: string };
      lastPreflightBatch?: { status: string };
    };
    assert.equal(stateBody.state.mode, 'single');
    assert.equal(stateBody.state.lifecycleState, 'SINGLE');
    assert.equal(stateBody.lastPreflightBatch?.status, 'FAILED');
  });

  it('启用故障注入时保持 SINGLE 并记录失败批次', async () => {
    const fixture = await createFixture('single');
    const token = await fixture.loginAdmin();

    const preflight = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/preflight',
      headers: { authorization: `Bearer ${token}` },
      body: { confirmation: 'preflight-enable-fail-20260806' },
    });
    const preflightBatchId = (preflight.body as { batch: { id: string } }).batch.id;

    const failed = await fixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/enable',
      headers: { authorization: `Bearer ${token}` },
      body: {
        preflightBatchId,
        confirmation: 'enable-fail-20260806',
        simulateFailureStep: 'before_publish',
      },
    });
    assert.equal(failed.statusCode, 409);
    assert.equal((failed.body as { errorCode: string }).errorCode, 'TENANT_MIGRATION_FAILED');

    const state = await fixture.app.inject({
      method: 'GET',
      path: '/api/v1/system/tenant-mode',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(state.statusCode, 200);
    const stateBody = state.body as {
      state: { mode: string; lifecycleState: string };
      lastEnableBatch?: { status: string; errorCode?: string };
    };
    assert.equal(stateBody.state.mode, 'single');
    assert.equal(stateBody.state.lifecycleState, 'SINGLE');
    assert.equal(stateBody.lastEnableBatch?.status, 'FAILED');
    assert.equal(stateBody.lastEnableBatch?.errorCode, 'TENANT_MIGRATION_FAILED');
  });

  it('启用后可以成功回滚到 SINGLE，回滚故障会停在受控状态', async () => {
    const successFixture = await createFixture('single');
    const successToken = await successFixture.loginAdmin();
    const successPreflight = await successFixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/preflight',
      headers: { authorization: `Bearer ${successToken}` },
      body: { confirmation: 'preflight-rollback-20260806' },
    });
    const successPreflightBatchId = (successPreflight.body as { batch: { id: string } }).batch.id;
    const enabled = await successFixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/enable',
      headers: { authorization: `Bearer ${successToken}` },
      body: {
        preflightBatchId: successPreflightBatchId,
        confirmation: 'enable-rollback-20260806',
      },
    });
    assert.equal(enabled.statusCode, 200);

    const rollbackToken = await successFixture.loginAdmin();
    const rolledBack = await successFixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/rollback',
      headers: { authorization: `Bearer ${rollbackToken}` },
      body: { confirmation: 'rollback-20260806' },
    });
    assert.equal(rolledBack.statusCode, 200);
    assert.equal((rolledBack.body as { state: { mode: string; lifecycleState: string } }).state.mode, 'single');
    assert.equal((rolledBack.body as { state: { lifecycleState: string } }).state.lifecycleState, 'SINGLE');

    const staleRollbackToken = await successFixture.app.inject({
      method: 'GET',
      path: '/api/v1/system/tenant-mode',
      headers: { authorization: `Bearer ${rollbackToken}` },
    });
    assert.equal(staleRollbackToken.statusCode, 409);
    assert.equal((staleRollbackToken.body as { errorCode: string }).errorCode, 'TENANT_CONTEXT_STALE');

    const failedFixture = await createFixture('single');
    const failedToken = await failedFixture.loginAdmin();
    const failedPreflight = await failedFixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/preflight',
      headers: { authorization: `Bearer ${failedToken}` },
      body: { confirmation: 'preflight-rollback-fail-20260806' },
    });
    const failedPreflightBatchId = (failedPreflight.body as { batch: { id: string } }).batch.id;
    const failedEnable = await failedFixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/enable',
      headers: { authorization: `Bearer ${failedToken}` },
      body: {
        preflightBatchId: failedPreflightBatchId,
        confirmation: 'enable-rollback-fail-20260806',
      },
    });
    assert.equal(failedEnable.statusCode, 200);

    const hierarchicalToken = await failedFixture.loginAdmin();
    const failedRollback = await failedFixture.app.inject({
      method: 'POST',
      path: '/api/v1/system/tenant-mode/rollback',
      headers: { authorization: `Bearer ${hierarchicalToken}` },
      body: {
        confirmation: 'rollback-fail-20260806',
        simulateFailureStep: 'before_publish',
      },
    });
    assert.equal(failedRollback.statusCode, 409);
    assert.equal((failedRollback.body as { errorCode: string }).errorCode, 'TENANT_MIGRATION_FAILED');

    const failedState = await failedFixture.app.inject({
      method: 'GET',
      path: '/api/v1/system/tenant-mode',
      headers: { authorization: `Bearer ${hierarchicalToken}` },
    });
    assert.equal(failedState.statusCode, 200);
    const failedStateBody = failedState.body as {
      state: { mode: string; lifecycleState: string };
      lastRollbackBatch?: { status: string; errorCode?: string };
    };
    assert.equal(failedStateBody.state.mode, 'hierarchical');
    assert.equal(failedStateBody.state.lifecycleState, 'ROLLING_BACK');
    assert.equal(failedStateBody.lastRollbackBatch?.status, 'FAILED');
    assert.equal(failedStateBody.lastRollbackBatch?.errorCode, 'TENANT_MIGRATION_FAILED');
  });
});

async function createFixture(mode: 'single' | 'hierarchical') {
  const previousMode = process.env.GCAC_TENANT_MODE;
  process.env.GCAC_TENANT_MODE = mode;

  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: `tenant-mode-api-${mode}`,
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const security = createPersistedSecurityServices(db).services;
  const app = new App();
  app.setAuthTokenResolver((authorization, cookie) => security.auth.parseRequestIdentity(authorization, cookie));
  new SecurityController(security).register(app.router);

  if (previousMode === undefined) delete process.env.GCAC_TENANT_MODE;
  else process.env.GCAC_TENANT_MODE = previousMode;

  return {
    app,
    security,
    loginAdmin: async () => {
      const response = await app.inject({
        method: 'POST',
        path: '/api/v1/auth/login',
        body: {
          username: 'admin',
          password: process.env.GCAC_INITIAL_ADMIN_PASSWORD ?? 'admin12345',
        },
      });
      assert.equal(response.statusCode, 200);
      return (response.body as { token: string }).token;
    },
  };
}
