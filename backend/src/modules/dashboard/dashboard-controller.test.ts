import assert from 'node:assert/strict';
import test from 'node:test';
import { Router } from '../../common/http/router.js';
import type { SecurityServices } from '../security/security.controller.js';
import { DashboardController } from './controller/dashboard.controller.js';

test('已认证用户没有 dashboard.read 时仍可访问仪表盘入口', async () => {
  const calls: Array<{ tenantId: string; subjectId: string }> = [];
  const service = {
    getOverview: async (input: { tenantId: string; subject: { id: string } }) => {
      calls.push({ tenantId: input.tenantId, subjectId: input.subject.id });
      return { metrics: [], statusGroups: [], recentAudits: [] };
    },
  };
  const security = {} as SecurityServices;
  const router = new Router();

  new DashboardController(service as never, security).register(router);
  const route = router.match('GET', '/api/v1/dashboard/overview');
  assert.ok(route);

  const response = await route.handler({
    method: 'GET',
    path: '/api/v1/dashboard/overview',
    query: {},
    headers: {},
    context: {
      requestId: 'req_dashboard_controller',
      traceId: 'trace_dashboard_controller',
      tenantId: 'tenant_dashboard',
      actorId: 'user_dashboard_viewer',
    },
  });

  assert.deepEqual(response, { metrics: [], statusGroups: [], recentAudits: [] });
  assert.deepEqual(calls, [{ tenantId: 'tenant_dashboard', subjectId: 'user_dashboard_viewer' }]);
});

test('未认证用户仍不能访问仪表盘接口', async () => {
  const service = { getOverview: async () => ({}) };
  const router = new Router();

  new DashboardController(service as never, {} as SecurityServices).register(router);
  const route = router.match('GET', '/api/v1/dashboard/overview');
  assert.ok(route);

  await assert.rejects(
    async () => {
      await route.handler({
        method: 'GET',
        path: '/api/v1/dashboard/overview',
        query: {},
        headers: {},
        context: {
          requestId: 'req_dashboard_unauthenticated',
          traceId: 'trace_dashboard_unauthenticated',
          tenantId: 'tenant_dashboard',
        },
      });
    },
    { errorCode: 'AUTH_UNAUTHENTICATED' },
  );
});
