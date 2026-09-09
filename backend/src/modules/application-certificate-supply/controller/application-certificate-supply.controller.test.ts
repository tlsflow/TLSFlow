import assert from 'node:assert/strict';
import test from 'node:test';
import { Router } from '../../../common/http/router.js';
import { ApplicationCertificateSupplyController } from './application-certificate-supply.controller.js';

const context = {
  requestId: 'req_certificate_supply_controller',
  traceId: 'trace_certificate_supply_controller',
  tenantId: 'tenant-controller',
  actorId: 'operator-controller',
};

test('应用证书供应策略注册三个租户隔离路由', async () => {
  const calls: Array<{ method: string; tenantId: string; applicationAssetId: string }> = [];
  const service = {
    get: async (tenantId: string, applicationAssetId: string) => {
      calls.push({ method: 'get', tenantId, applicationAssetId });
      return { applicationAssetId, primaryDomain: 'app.example.test', certificateCandidates: [], providers: {}, capability: {}, readiness: {} };
    },
    update: async (tenantId: string, applicationAssetId: string) => {
      calls.push({ method: 'update', tenantId, applicationAssetId });
      return { applicationAssetId, primaryDomain: 'app.example.test', certificateCandidates: [], providers: {}, capability: {}, readiness: {} };
    },
    preview: async (tenantId: string, applicationAssetId: string) => {
      calls.push({ method: 'preview', tenantId, applicationAssetId });
      return { applicationAssetId, primaryDomain: 'app.example.test', certificateCandidates: [], providers: {}, capability: {}, readiness: {} };
    },
  };
  const router = new Router();
  new ApplicationCertificateSupplyController(undefined, service as never).register(router);

  const getRoute = router.match('GET', '/api/v1/application-assets/app-1/certificate-supply-policy');
  const putRoute = router.match('PUT', '/api/v1/application-assets/app-1/certificate-supply-policy');
  const previewRoute = router.match('POST', '/api/v1/application-assets/app-1/certificate-supply-policy/preview');
  assert.ok(getRoute);
  assert.ok(putRoute);
  assert.ok(previewRoute);

  await getRoute.handler({ method: 'GET', path: '/api/v1/application-assets/app-1/certificate-supply-policy', query: {}, headers: {}, body: {}, context });
  await putRoute.handler({ method: 'PUT', path: '/api/v1/application-assets/app-1/certificate-supply-policy', query: {}, headers: {}, body: { supplyMode: 'manual' }, context });
  await previewRoute.handler({ method: 'POST', path: '/api/v1/application-assets/app-1/certificate-supply-policy/preview', query: {}, headers: {}, body: { supplyMode: 'manual' }, context });

  assert.deepEqual(calls, [
    { method: 'get', tenantId: 'tenant-controller', applicationAssetId: 'app-1' },
    { method: 'update', tenantId: 'tenant-controller', applicationAssetId: 'app-1' },
    { method: 'preview', tenantId: 'tenant-controller', applicationAssetId: 'app-1' },
  ]);
});

test('应用证书供应策略接口拒绝不支持的供应方式', async () => {
  const router = new Router();
  new ApplicationCertificateSupplyController(undefined, { get: async () => ({}), update: async () => ({}), preview: async () => ({}) } as never).register(router);
  const route = router.match('POST', '/api/v1/application-assets/app-1/certificate-supply-policy/preview');
  assert.ok(route);
  await assert.rejects(async () => route.handler({
    method: 'POST',
    path: '/api/v1/application-assets/app-1/certificate-supply-policy/preview',
    query: {},
    headers: {},
    body: { supplyMode: 'automatic' },
    context,
  }));
});

test('专属证书部署把每次请求的幂等键传给新会话任务', async () => {
  let received: Record<string, unknown> | undefined;
  const router = new Router();
  new ApplicationCertificateSupplyController(undefined, {
    get: async () => ({}),
    update: async () => ({}),
    preview: async () => ({}),
    enqueueDedicatedDeployment: async (input: Record<string, unknown>) => { received = input; return { id: 'task-new-session' }; },
  } as never).register(router);
  const route = router.match('POST', '/api/v1/application-assets/app-1/certificate-supply-policy/deploy');
  assert.ok(route);

  await route.handler({
    method: 'POST',
    path: '/api/v1/application-assets/app-1/certificate-supply-policy/deploy',
    query: {},
    headers: { 'x-idempotency-key': 'deploy-session-header' },
    body: {},
    context,
  });

  assert.equal(received?.idempotencyKey, 'deploy-session-header');
  assert.equal(received?.applicationAssetId, 'app-1');
});
