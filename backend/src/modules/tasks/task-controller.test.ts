import assert from 'node:assert/strict';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import { AppError } from '../../common/errors/app-error.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { TasksController } from './task.controller.js';

test('普通用户查询任务时默认只返回本人任务，includeAll 不能扩大用户范围', async () => {
  let receivedQuery: Record<string, unknown> | undefined;
  const service = {
    list: async (query: Record<string, unknown>) => {
      receivedQuery = query;
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
  };
  const security = createSecurityMock([]);
  const app = createTaskControllerTestApp(service, security);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks?includeAll=true',
    headers: testAuthHeaders('user-1', 'tenant-1'),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedQuery?.requestedBy, 'user-1');
  assert.equal(receivedQuery?.includeAll, true);
});

test('没有 task.read.all 时显式查询其他用户任务会被拒绝', async () => {
  let listed = false;
  const service = {
    list: async () => {
      listed = true;
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
  };
  const security = createSecurityMock([]);
  const app = createTaskControllerTestApp(service, security);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks?filter[requestedBy]=user-2',
    headers: testAuthHeaders('user-1', 'tenant-1'),
  });

  assert.equal(response.statusCode, 403);
  assert.equal(listed, false);
});

test('task.read.all 或 task.* 权限可以查询同租户全部用户任务', async () => {
  let receivedQuery: Record<string, unknown> | undefined;
  const service = {
    list: async (query: Record<string, unknown>) => {
      receivedQuery = query;
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
  };
  const security = createSecurityMock(['task.*']);
  const app = createTaskControllerTestApp(service, security);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks?filter[requestedBy]=user-2&includeAll=true',
    headers: testAuthHeaders('user-1', 'tenant-1'),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedQuery?.requestedBy, 'user-2');
});

test('approval.decide users can query active pending approval tasks from other users', async () => {
  let receivedQuery: Record<string, unknown> | undefined;
  const service = {
    list: async (query: Record<string, unknown>) => {
      receivedQuery = query;
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
  };
  const security = createSecurityMock(['task.read', 'approval.decide']);
  const app = createTaskControllerTestApp(service, security);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks?filter[status]=RETRY_WAITING',
    headers: testAuthHeaders('user-1', 'tenant-1'),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedQuery?.requestedBy, 'user-1');
  assert.equal(receivedQuery?.includePendingApprovals, true);
});

test('数据库迁移前任务控制面返回明确的未就绪状态', async () => {
  const service = {
    getLifecycle: () => ({ status: 'MIGRATION_PENDING' as const }),
    list: async () => {
      throw new Error('迁移前不应访问任务表');
    },
  };
  const app = createTaskControllerTestApp(service, createSecurityMock([]), 'MIGRATION_PENDING');

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks',
    headers: testAuthHeaders('user-1', 'tenant-1'),
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    errorCode: 'TASK_CONTROL_PLANE_NOT_READY',
    message: '任务控制面等待数据库迁移完成',
    details: { status: 'MIGRATION_PENDING' },
    requestId: response.headers['x-request-id'],
  });
});

function createTaskControllerTestApp(
  service: Record<string, unknown>,
  security: ReturnType<typeof createSecurityMock>,
  status: 'READY' | 'MIGRATION_PENDING' = 'READY',
): App {
  const app = configureTestAuth(new App());
  new TasksController({
    ...service,
    getLifecycle: () => ({ status }),
  } as never, security as never).register(app.router);
  return app;
}

function createSecurityMock(permissions: string[]) {
  return {
    rbac: {
      getUser: async () => ({ id: 'user-1' }),
      rolesForUser: async () => [],
      permissionsForSubject: async () => permissions,
      assertCan: async (_subject: unknown, action: string) => {
        if (action === 'task.read' || permissions.includes('*') || permissions.includes('task.*') || permissions.includes(action)) return;
        throw new AppError('AUTH_FORBIDDEN', '无权访问任务');
      },
    },
  };
}
