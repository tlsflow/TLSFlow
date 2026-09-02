import assert from 'node:assert/strict';
import test from 'node:test';

import { generateOpenApiDocument } from '../../common/openapi/openapi-generator.js';
import { getAssetsRouteContracts } from './controller/assets.controller.js';

test('SiteAsset OpenAPI 请求合同声明 configPath 且不承载密码', () => {
  const routes = getAssetsRouteContracts();
  const create = routes.find((route) => route.operationId === 'createSiteAsset');
  const update = routes.find((route) => route.operationId === 'updateSiteAsset');
  assert.ok(create?.requestSchema);
  assert.ok(update?.requestSchema);

  for (const [name, schema] of [['create', create.requestSchema], ['update', update.requestSchema]] as const) {
    assert.equal(schema?.type, 'object', `${name} 请求必须是对象`);
    assert.equal(schema?.additionalProperties, false, `${name} 请求必须拒绝未声明字段`);
    assert.equal(schema?.properties?.configPath?.type, 'string');
    assert.match(schema?.properties?.configPath?.description ?? '', /不承载密码/);
    assert.equal(schema?.properties?.keystorePassword, undefined, `${name} 合同不得接受密码字段`);
  }
  assert.deepEqual(create.requestSchema?.required, ['frameworkInstanceId', 'discoveryProviderKey', 'siteType', 'siteName', 'siteKey']);
  assert.deepEqual(update.requestSchema?.required, ['id']);

  const document = generateOpenApiDocument(routes, new Date('2026-08-27T00:00:00.000Z'));
  const operation = (document.paths['/api/v1/site-assets'] as Record<string, any>).post;
  assert.equal(operation.requestBody.content['application/json'].schema.properties.configPath.type, 'string');
});

test('Application 编辑使用独立轻量详情路由', () => {
  const routes = getAssetsRouteContracts();
  const editDetail = routes.find((route) => route.operationId === 'getApplicationEditDetail');
  const deploymentDetail = routes.find((route) => route.operationId === 'getApplicationDeploymentDetail');
  assert.equal(editDetail?.method, 'GET');
  assert.equal(editDetail?.path, '/api/v1/applications/edit-detail');
  assert.equal(deploymentDetail?.method, 'GET');
  assert.equal(deploymentDetail?.path, '/api/v1/applications/deployment-detail');
  assert.equal(routes.some((route) => route.operationId === 'getApplicationDetail'), true);
});
