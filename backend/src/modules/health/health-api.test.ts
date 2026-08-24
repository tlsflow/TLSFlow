import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import type { SecurityServices } from '../security/security.controller.js';

describe('健康检查 API', () => {
  it('健康检查接口返回统一 JSON 和 requestId 响应头', async () => {
    const app = await createPreMigrationTestApp();
    try {
      const response = await app.inject({ method: 'GET', path: '/api/v1/health', headers: { 'x-request-id': 'req_integration' } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['x-request-id'], 'req_integration');
      const body = response.body as { status: string; dependencies: Record<string, string> };
      assert.equal(body.status, 'OK');
      assert.equal(body.dependencies.database, 'UNKNOWN');
      assert.equal(body.dependencies.queue, 'UNKNOWN');
      assert.equal(app.getResource<{ getLifecycle: () => { status: string } }>('tasksService')?.getLifecycle().status, 'MIGRATION_PENDING');
    } finally {
      await app.getResource<{ close?: () => Promise<void> }>('database')?.close?.();
    }
  });

  it('不存在的接口返回统一错误响应', async () => {
    const app = await createPreMigrationTestApp();
    try {
      const response = await app.inject({ method: 'GET', path: '/api/v1/not-exists', headers: { 'x-request-id': 'req_404' } });
      assert.equal(response.statusCode, 404);
      const body = response.body as { errorCode: string; requestId: string };
      assert.equal(body.errorCode, 'RESOURCE_NOT_FOUND');
      assert.equal(body.requestId, 'req_404');
    } finally {
      await app.getResource<{ close?: () => Promise<void> }>('database')?.close?.();
    }
  });

  it('数据库迁移并完成任务控制面初始化后健康依赖变为就绪', async () => {
    const app = await createPostMigrationTestApp();
    try {
      const tasksService = app.getResource<{ initialize: () => Promise<void>; getLifecycle: () => { status: string } }>('tasksService');
      assert.ok(tasksService);
      await tasksService.initialize();

      const response = await app.inject({ method: 'GET', path: '/api/v1/health', headers: { 'x-request-id': 'req_migrated' } });
      assert.equal(response.statusCode, 200);
      const body = response.body as { status: string; dependencies: Record<string, string> };
      assert.equal(body.status, 'OK');
      assert.equal(body.dependencies.database, 'OK');
      assert.equal(body.dependencies.queue, 'OK');
      assert.equal(tasksService.getLifecycle().status, 'READY');
    } finally {
      await app.getResource<{ close?: () => Promise<void> }>('database')?.close?.();
    }
  });
});

async function createPreMigrationTestApp() {
  const database = new PgliteDatabase();
  const app = createApp({ db: database, corePersistence: { mode: 'memory' }, security: createHealthSecurityStub() });
  await waitForAppHydration(app);
  return app;
}

async function createPostMigrationTestApp() {
  const database = new PgliteDatabase();
  await runMigrations(database, 'src/database/migrations');
  const app = createApp({ db: database, corePersistence: { mode: 'memory' }, security: createHealthSecurityStub() });
  await waitForAppHydration(app);
  return app;
}

async function waitForAppHydration(app: ReturnType<typeof createApp>): Promise<void> {
  const workflowTemplates = app.getResource<{ listTemplates?: () => Promise<unknown> }>('workflowTemplatesService');
  await workflowTemplates?.listTemplates?.();
}

function createHealthSecurityStub(): SecurityServices {
  return {
    rbac: {
      getUser: async () => undefined,
      rolesForUser: async () => [],
      permissionsForSubject: async () => [],
      assertCan: async () => undefined,
      can: async () => ({ allowed: true }),
    } as never,
    objectPermissions: { can: async () => ({ allowed: true }) } as never,
    audit: { write: async () => ({}) } as never,
    approvals: { setDecisionListener: () => undefined } as never,
    grants: { validate: async () => ({ allowedActions: [] }) } as never,
    secrets: {} as never,
    auth: { parseRequestIdentity: async () => undefined } as never,
    externalIdentity: {} as never,
  };
}
