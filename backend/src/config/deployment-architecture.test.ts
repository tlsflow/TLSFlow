import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp, getRouteContracts } from '../app.module.js';
import { runMigrations } from '../database/migration-runner.js';
import { PgliteDatabase } from '../database/pglite-database.js';
import { createSecurityServices } from '../modules/security/security.controller.js';
import { deploymentFeatures, resolveDeploymentArchitecture } from './deployment-architecture.js';

describe('部署架构装配', () => {
  it('默认保持标准架构并拒绝非法配置', () => {
    assert.equal(resolveDeploymentArchitecture(undefined), 'standard');
    assert.equal(resolveDeploymentArchitecture(' SMALL '), 'small');
    assert.deepEqual(deploymentFeatures('small'), { browserRuntime: false });
    assert.deepEqual(deploymentFeatures('standard'), { browserRuntime: true });
    assert.throws(() => resolveDeploymentArchitecture('personal'), /只允许 small 或 standard/);
  });

  it('小型架构不装配 Browser Runtime 服务和接口', async () => {
    const app = await createTestApp('small');
    assert.equal(app.getResource('browserRuntimeClient'), undefined);
    assert.equal(app.getResource('browserCredentialSessionService'), undefined);

    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/credentials/browser-sessions',
      body: {},
    });
    assert.equal(response.statusCode, 404);

    const health = await app.inject({ method: 'GET', path: '/api/v1/health' });
    assert.equal((health.body as { deploymentArchitecture: string }).deploymentArchitecture, 'small');
    assert.deepEqual((health.body as { features: unknown }).features, { browserRuntime: false });
    assert.equal(getRouteContracts('small').some((route) => route.path.includes('/browser-sessions')), false);
  });

  it('标准架构装配 Browser Runtime 服务和接口合同', async () => {
    const app = await createTestApp('standard');
    assert.ok(app.getResource('browserRuntimeClient'));
    assert.ok(app.getResource('browserCredentialSessionService'));
    assert.equal(getRouteContracts('standard').some((route) => route.path.includes('/browser-sessions')), true);

    const health = await app.inject({ method: 'GET', path: '/api/v1/health' });
    assert.equal((health.body as { deploymentArchitecture: string }).deploymentArchitecture, 'standard');
    assert.deepEqual((health.body as { features: unknown }).features, { browserRuntime: true });
  });
});

async function createTestApp(deploymentArchitecture: 'small' | 'standard') {
  const db = new PgliteDatabase();
  await runMigrations(db, 'src/database/migrations');
  return createApp({
    db,
    deploymentArchitecture,
    corePersistence: { mode: 'memory' },
    security: createSecurityServices(),
  });
}
