import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAuthorizationFilter } from '../../../common/pagination/pagination.js';
import { compareUnifiedAssets, getAssetsRouteContracts, isObjectAllowed, matchesUnifiedAssetFilter, normalizeReadAuthorization, projectDeviceAsset, projectServiceAsset } from './assets.controller.js';

test('统一资产投影为设备和云服务提供稳定 assetRef 与通用动作', () => {
  const device = projectDeviceAsset({
    id: 'device-1', displayName: '服务器', category: 'SERVER', productFamily: 'agent_host', managementMethod: 'AGENT',
    health: 'HEALTHY', sourceStatus: 'ACTIVE', applicationAssetCount: 0, capabilities: [], extensionType: 'AGENT',
  }, true);
  const cloud = projectServiceAsset({ id: 'cloud-1', displayName: 'CDN', address: 'cdn.example.com', status: 'ACTIVE' }, true);
  assert.deepEqual(device.assetRef, { rootType: 'DEVICE', id: 'device-1' });
  assert.deepEqual(cloud.assetRef, { rootType: 'SERVICE_ASSET', id: 'cloud-1' });
  assert.deepEqual(device.availableActions, ['VIEW', 'EDIT', 'DELETE']);
  assert.deepEqual(cloud.availableActions, ['VIEW', 'EDIT', 'DELETE']);
});

test('统一资产筛选和排序不依赖前端拼表', () => {
  const cloud = projectServiceAsset({ id: 'cloud-1', displayName: 'CDN', address: 'cdn.example.com', status: 'ACTIVE' }, false);
  assert.equal(matchesUnifiedAssetFilter(cloud, { category: 'CLOUD', managementMethod: 'PLUGIN' }), true);
  assert.equal(matchesUnifiedAssetFilter(cloud, { category: 'SERVER' }), false);
  assert.equal(compareUnifiedAssets({ displayName: 'B' }, { displayName: 'A' }, { field: 'displayName', direction: 'asc' }) > 0, true);
});

test('统一资产对象 deny 优先于 allow，空授权不会放行对象', () => {
  assert.equal(isObjectAllowed({ unrestricted: true, deniedObjectIds: ['device-1'] }, 'device-1'), false);
  assert.equal(isObjectAllowed({ objectIds: ['device-1'], deniedObjectIds: ['device-1'] }, 'device-1'), false);
  assert.equal(isObjectAllowed({ empty: true }, 'device-1'), false);
  assert.equal(isObjectAllowed({ unrestricted: true }, 'device-1'), true);
});

test('全局读取权限下的空对象授权不应把设备列表裁剪为空', () => {
  const normalized = normalizeReadAuthorization({ empty: true }, true);
  assert.equal(normalized?.unrestricted, true);
  assert.equal(normalized?.empty, false);
  assert.deepEqual(normalized?.objectIds, undefined);
});

test('显式对象拒绝不能被全局读取权限的归一化覆盖', () => {
  const normalized = normalizeReadAuthorization({ empty: true, deniedObjectIds: ['device-1'] }, true);
  assert.equal(normalized?.unrestricted, true);
  assert.deepEqual(normalized?.deniedObjectIds, ['device-1']);
  assert.equal(isObjectAllowed(normalized, 'device-1'), false);
  const visible = applyAuthorizationFilter([{ id: 'device-1' }, { id: 'device-2' }], {
    page: 1,
    pageSize: 20,
    filter: {},
    authorization: { ...normalized, objectIdField: 'id' },
  });
  assert.deepEqual(visible.map((item) => item.id), ['device-2']);
});

test('全局授权带 SYSTEM 所有权标签时仍允许租户内无 ownerType 的设备摘要', () => {
  const visible = applyAuthorizationFilter([{ id: 'device-1' }, { id: 'device-2' }], {
    page: 1,
    pageSize: 20,
    filter: {},
    authorization: {
      unrestricted: true,
      empty: false,
      ownerTypes: ['SYSTEM'],
      objectIds: [],
      dynamicConditions: [{}],
      deniedObjectIds: ['device-2'],
    },
  });
  assert.deepEqual(visible.map((item) => item.id), ['device-1']);
});

test('统一资产详情和动作路由属于资产合同', () => {
  const routes = getAssetsRouteContracts();
  assert.equal(routes.some((route) => route.operationId === 'getAssetDetail' && route.path === '/api/v1/assets/detail'), true);
  const action = routes.find((route) => route.operationId === 'executeAssetAction');
  assert.equal(action?.path, '/api/v1/assets/actions');
  assert.deepEqual(action?.requestSchema?.required, ['assetRef', 'action']);
});
