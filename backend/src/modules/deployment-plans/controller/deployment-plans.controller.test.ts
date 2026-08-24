import assert from 'node:assert/strict';
import test from 'node:test';
import { Router } from '../../../common/http/router.js';
import { DeploymentPlansController } from './deployment-plans.controller.js';

const context = {
  requestId: 'req_deployment_legacy_entry',
  traceId: 'trace_deployment_legacy_entry',
  tenantId: 'tenant_deployment_legacy_entry',
  actorId: 'operator_deployment_legacy_entry',
};

function createRoute() {
  const router = new Router();
  new DeploymentPlansController({} as never).register(router);
  const route = router.match('POST', '/api/v1/deployment-plans');
  assert.ok(route);
  return route;
}

function request(target: Record<string, unknown>) {
  return {
    method: 'POST',
    path: '/api/v1/deployment-plans',
    query: {},
    headers: {},
    body: {
      name: 'legacy-entry-rejection',
      idempotencyKey: 'idem_legacy_entry_rejection',
      targets: [target],
    },
    context,
  };
}

test('部署控制器拒绝不受支持的执行类型', async () => {
  const route = createRoute();
  for (const executorType of ['SCRIPT_PACKAGE', 'MANUAL', 'MONITOR_ONLY', 'SSH', 'CURL', 'WINRM', 'SMB_WMI']) {
    await assert.rejects(async () => await route.handler(request({
      certificateBindingId: 'binding_legacy',
      executorType,
    })), { errorCode: 'VALIDATION_FAILED' });
  }
});

test('部署控制器拒绝 fallbackSuggestions 旧字段，不再静默过滤后创建计划', async () => {
  const route = createRoute();
  for (const fallback of ['script_package', 'manual', 'monitor_only', 'gateway_required']) {
    await assert.rejects(async () => await route.handler(request({
      certificateBindingId: 'binding_legacy_fallback',
      executorType: 'AGENT',
      fallbackSuggestions: [fallback],
    })), { errorCode: 'VALIDATION_FAILED' });
  }
});

test('部署控制器拒绝不受支持的 Gateway 通道', async () => {
  const route = createRoute();
  await assert.rejects(async () => await route.handler(request({
    certificateBindingId: 'binding_legacy_gateway',
    executorType: 'GATEWAY_FORWARD',
    adapter: 'ssh',
  })), { errorCode: 'VALIDATION_FAILED' });
});

test('部署控制器注册按应用资产查询部署记录接口', () => {
  const router = new Router();
  new DeploymentPlansController({} as never).register(router);
  assert.ok(router.match('GET', '/api/v1/deployment-plans/by-application-asset'));
});

test('应用资产创建入口接受 reuseDraft，保持历史请求未传该字段时的兼容性', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const router = new Router();
  new DeploymentPlansController({
    createFromApplicationAsset: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { id: 'plan_new' };
    },
  } as never).register(router);
  const route = router.match('POST', '/api/v1/deployment-plans/from-application-asset');
  assert.ok(route);

  await route.handler({
    method: 'POST',
    path: '/api/v1/deployment-plans/from-application-asset',
    query: {},
    headers: {},
    body: { applicationAssetId: 'asset_1', reuseDraft: false, idempotencyKey: 'idem_reuse_draft_false' },
    context,
  });
  await route.handler({
    method: 'POST',
    path: '/api/v1/deployment-plans/from-application-asset',
    query: {},
    headers: {},
    body: { applicationId: 'asset_legacy', idempotencyKey: 'idem_legacy_compatibility' },
    context,
  });

  assert.equal(calls[0]?.applicationAssetId, 'asset_1');
  assert.equal(calls[0]?.reuseDraft, false);
  assert.equal(calls[1]?.applicationAssetId, 'asset_legacy');
  assert.equal(calls[1]?.reuseDraft, undefined);
});
