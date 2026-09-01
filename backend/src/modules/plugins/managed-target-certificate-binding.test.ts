import assert from 'node:assert/strict';
import test from 'node:test';
import { findManagedTargetCertificateBinding } from './application/managed-target-plugin-query.service.js';

test('受管目标证书绑定排序兼容 PostgreSQL 返回的 Date 时间值', async () => {
  const older = {
    id: 'binding-older',
    managedTargetId: 'target-1',
    updatedAt: new Date('2026-08-30T14:00:00.000Z'),
  };
  const newer = {
    id: 'binding-newer',
    managedTargetId: 'target-1',
    updatedAt: new Date('2026-08-30T15:00:00.000Z'),
  };
  const result = await findManagedTargetCertificateBinding({
    listCertificateBindings: async () => ({ items: [older, newer], page: 1, pageSize: 5000, total: 2 }),
  } as never, 'tenant-1', 'target-1');

  assert.equal(result?.id, 'binding-newer');
});
