import assert from 'node:assert/strict';
import test from 'node:test';
import { ResourceAuthorizationScopeResolver } from './resource-authorization-scope.resolver.js';

test('资源父级登记和授权范围解析保持 deny-first 输入边界', async () => {
  const resolver = new ResourceAuthorizationScopeResolver({
    buildAuthorizedQuery: async (_subject, objectType) => objectType === 'service_asset'
      ? { unrestricted: false, empty: false, objectIds: ['asset-1', 'asset-1'] }
      : { unrestricted: false, empty: true, objectIds: [] },
    can: async (_subject, _access, object) => ({
      allowed: object.objectId === 'asset-1',
      accessLevel: 'read',
      action: 'read',
      reason: 'test',
      matchedBindings: [], matchedObjectSets: [], matchedActions: [], requiresApproval: false,
    }),
  });
  const subject = { id: 'u1', type: 'user' as const, scope: { tenantId: 'tenant-a' } };
  assert.deepEqual(await resolver.parentObjectIds(subject, 'monitor_probe_result', 'read'), ['asset-1']);
  assert.deepEqual(await resolver.parentObjectIdMap(subject, 'monitor_risk', 'read'), {
    service_asset: ['asset-1'], certificate_asset: [], certificate_binding: [], execution_run: [], host: [],
  });
  assert.equal(await resolver.isAllowed(subject, 'monitor_probe_result', 'read', { serviceAssetId: 'asset-1' }, 'tenant-a'), true);
  assert.equal(await resolver.isAllowed(subject, 'monitor_probe_result', 'read', {}, 'tenant-a'), false);
  assert.throws(() => resolver.require('unknown_resource'), /未登记资源父级归属/);
});
