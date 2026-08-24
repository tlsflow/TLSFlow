import assert from 'node:assert/strict';
import test from 'node:test';
import { Router } from '../../../common/http/router.js';
import { ApplicationOnboardingController } from './application-onboarding.controller.js';

const context = {
  requestId: 'req_application_onboarding_controller',
  traceId: 'trace_application_onboarding_controller',
  tenantId: 'tenant-1',
  actorId: 'user-1',
};

test('创建接入会话读取前端统一发送的 X-Idempotency-Key', async () => {
  const calls: Array<{ tenantId: string; actorId: string; platformKey: string; idempotencyKey: string }> = [];
  const service = {
    createSession: async (tenantId: string, actorId: string, input: { platformKey: string; idempotencyKey: string }) => {
      calls.push({ tenantId, actorId, ...input });
      return { id: 'session-new', state: 'PLATFORM_SELECTED', stateVersion: 1 };
    },
  };
  const router = new Router();
  new ApplicationOnboardingController(service as never).register(router);
  const route = router.match('POST', '/api/v1/application-onboarding/sessions');
  assert.ok(route);

  const response = await route.handler({
    method: 'POST',
    path: '/api/v1/application-onboarding/sessions',
    query: {},
    headers: { 'x-idempotency-key': 'onboarding_session_unique' },
    body: { platformKey: 'iis' },
    context,
  });

  assert.deepEqual(calls, [{
    tenantId: 'tenant-1',
    actorId: 'user-1',
    platformKey: 'iis',
    idempotencyKey: 'onboarding_session_unique',
  }]);
  assert.deepEqual(response, {
    statusCode: 201,
    body: { id: 'session-new', state: 'PLATFORM_SELECTED', stateVersion: 1 },
  });
});

test('创建接入会话缺少幂等键时失败关闭，不再复用用户和平台固定键', async () => {
  const router = new Router();
  new ApplicationOnboardingController({ createSession: async () => ({}) } as never).register(router);
  const route = router.match('POST', '/api/v1/application-onboarding/sessions');
  assert.ok(route);

  await assert.rejects(
    async () => await route.handler({
      method: 'POST',
      path: '/api/v1/application-onboarding/sessions',
      query: {},
      headers: {},
      body: { platformKey: 'iis' },
      context,
    }),
    (error: unknown) => error instanceof Error
      && error.message === '创建接入会话必须提供 X-Idempotency-Key',
  );
});

test('证书选项接口按查询参数透传证书资产 ID 并返回资产与版本', async () => {
  const calls: Array<{ id: string; certificateAssetId?: string }> = [];
  const service = {
    certificateOptions: async (tenantId: string, id: string, certificateAssetId?: string) => {
      calls.push({ id, certificateAssetId });
      return { assets: [{ id: 'cert-1' }], versions: certificateAssetId ? [{ id: 'version-1' }] : [] };
    },
  };
  const router = new Router();
  new ApplicationOnboardingController(service as never).register(router);
  const route = router.match('GET', '/api/v1/application-onboarding/sessions/session-1/certificate-options');
  assert.ok(route);

  const response = await route.handler({
    method: 'GET',
    path: '/api/v1/application-onboarding/sessions/session-1/certificate-options',
    query: { certificateAssetId: 'cert-1' },
    headers: {},
    body: {},
    context,
  });

  assert.deepEqual(calls, [{ id: 'session-1', certificateAssetId: 'cert-1' }]);
  assert.deepEqual(response, { assets: [{ id: 'cert-1' }], versions: [{ id: 'version-1' }] });
});
