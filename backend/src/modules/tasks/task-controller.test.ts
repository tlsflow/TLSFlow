import assert from 'node:assert/strict';
import test from 'node:test';
import { App } from '../../common/http/app.js';
import { AppError } from '../../common/errors/app-error.js';
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
  const app = new App({ allowLegacyHeaderContext: true });
  new TasksController(service as never, security as never).register(app.router);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks?includeAll=true',
    headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user-1' },
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
  const app = new App({ allowLegacyHeaderContext: true });
  new TasksController(service as never, security as never).register(app.router);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks?filter[requestedBy]=user-2',
    headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user-1' },
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
  const app = new App({ allowLegacyHeaderContext: true });
  new TasksController(service as never, security as never).register(app.router);

  const response = await app.inject({
    method: 'GET',
    path: '/api/v1/tasks?filter[requestedBy]=user-2&includeAll=true',
    headers: { 'x-tenant-id': 'tenant-1', 'x-actor-id': 'user-1' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedQuery?.requestedBy, 'user-2');
});

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
