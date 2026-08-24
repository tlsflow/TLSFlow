import assert from 'node:assert/strict';
import test from 'node:test';
import { Router } from '../../../common/http/router.js';
import { InternalCaController } from './internal-ca.controller.js';

test('取消 ACME 续签任务会把路径中的任务 ID 传给仓储', async () => {
  const tenantId = 'tenant-acme-cancel';
  const jobId = 'acmerenew-cancel-target';
  let received: unknown[] | undefined;
  const controller = new InternalCaController({} as never, {
    rbac: { assertCan: async () => undefined },
  } as never, {
    repository: {
      cancelRenewalJob: async (...args: unknown[]) => {
        received = args;
        return { id: args[1], status: 'cancelled' };
      },
    },
  } as never);
  const router = new Router();
  controller.register(router);
  const path = `/api/v1/acme/renewal-jobs/${jobId}/cancel`;
  const route = router.match('POST', path);

  assert.ok(route);
  const response = await route.handler({
    method: 'POST',
    path,
    query: {},
    headers: {},
    body: {},
    context: {
      requestId: 'req-acme-cancel',
      traceId: 'trace-acme-cancel',
      tenantId,
      actorId: 'user-admin',
    },
  });

  assert.deepEqual(response, { id: jobId, status: 'cancelled' });
  assert.equal(received?.[0], tenantId);
  assert.equal(received?.[1], jobId);
  assert.equal(received?.[3], '用户请求取消 ACME 续签任务');
});
