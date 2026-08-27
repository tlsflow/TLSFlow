import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { ResourceDescriptor } from '../../shared/security-types.js';
import {
  assertCaOperationsPermission,
  caOperationsPermissionActions,
  caOperationsResource,
  writeCaOperationsAudit,
} from './ca-operations.security.js';

test('CA 运营权限动作与通用证书导入权限隔离', () => {
  assert.deepEqual(caOperationsPermissionActions, [
    'ca.operations.read', 'ca.request.approve',
    'ca.request.retry', 'ca.certificate.revoke', 'ca.crl.publish', 'ca.template.mapping.read',
    'ca.template.mapping.manage', 'ca.provider.manage', 'ca.authority.manage',
  ]);
  assert.equal(caOperationsPermissionActions.includes('certificate.import' as never), false);
});

test('CA 运营资源范围统一携带租户、信任域、CA、Provider 和资源标识', async () => {
  const scope = {
    tenantId: 'tenant-1', trustDomainId: 'trust-1', caId: 'ca-1', providerId: 'provider-1',
    resourceType: 'caOperation', resourceId: 'request:2',
  };
  const resource = caOperationsResource(scope);
  assert.deepEqual(resource, {
    type: 'caOperation', id: 'request:2',
    scope: { ...scope },
  });

  let granted: { action: string; scope: ResourceDescriptor['scope'] } | undefined;
  await assertCaOperationsPermission({
    async assertCan(_subject, action, target) {
      granted = { action, scope: target.scope };
    },
  }, { id: 'user-1', type: 'user' }, 'ca.operations.read', scope);
  assert.deepEqual(granted, { action: 'ca.operations.read', scope });
});

test('CA 高风险审计必须携带范围且要求审计失败关闭', async () => {
  let written: Record<string, unknown> | undefined;
  await writeCaOperationsAudit({
    async write(input) {
      written = input as unknown as Record<string, unknown>;
    },
  }, {
    eventType: AUDIT_EVENT_TYPES.CA_OPERATIONS_RECORD_READ,
    actor: { id: 'user-1', type: 'user' }, action: 'ca.operations.read', result: 'success', riskLevel: 'high',
    scope: { tenantId: 'tenant-1', caId: 'ca-1', providerId: 'provider-1', resourceType: 'caOperation', resourceId: 'request:1' },
    detail: { objectType: 'request' },
  });
  assert.deepEqual(written, {
    eventType: 'ca.operations.record.read', actorType: 'user', actorId: 'user-1', action: 'ca.operations.read',
    resourceType: 'caOperation', resourceId: 'request:1', result: 'success', riskLevel: 'high',
    detail: { tenantId: 'tenant-1', trustDomainId: undefined, caId: 'ca-1', providerId: 'provider-1', objectType: 'request' },
    context: undefined, failClosed: true,
  });
});
