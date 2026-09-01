import assert from 'node:assert/strict';
import test from 'node:test';
import { compareUnifiedAssets, getAssetsRouteContracts, isObjectAllowed, matchesUnifiedAssetFilter, projectDeviceAsset, projectServiceAsset } from './assets.controller.js';

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

test('统一资产详情和动作路由属于资产合同', () => {
  const routes = getAssetsRouteContracts();
  assert.equal(routes.some((route) => route.operationId === 'getAssetDetail' && route.path === '/api/v1/assets/detail'), true);
  const action = routes.find((route) => route.operationId === 'executeAssetAction');
  assert.equal(action?.path, '/api/v1/assets/actions');
  assert.deepEqual(action?.requestSchema?.required, ['assetRef', 'action']);
});
