import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { UserEntity } from '../../persistence/entities/rbac.entity.js';
import { PgTenantRepository } from './repository/tenant.repository.js';
import { TenantHierarchyService } from './domain/tenant.domain-service.js';

async function createService() {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'tenant-domain-test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const auditEvents: unknown[] = [];
  const audit = {
    write: async (event: unknown) => {
      auditEvents.push(event);
      return {};
    },
  };
  return {
    db,
    service: new TenantHierarchyService(new PgTenantRepository(db), audit as never),
    auditEvents,
  };
}

async function seedUser(db: PgliteDatabase, id: string): Promise<void> {
  const users = new PgDocumentRepository<UserEntity>(db, 'security.users');
  await users.create({
    id,
    username: id,
    displayName: id,
    status: 'active',
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  });
}

describe('TenantHierarchyService', () => {
  it('只允许 GROUP -> COMPANY，并拒绝 COMPANY 父节点和停用父节点', async () => {
    const { service } = await createService();
    const group = await service.createTenant({
      name: '集团 A',
      code: 'group-a',
      type: 'GROUP',
      actorId: 'user_admin',
    });
    const company = await service.createTenant({
      name: '分子公司 A',
      code: 'company-a',
      type: 'COMPANY',
      parentId: group.id,
      actorId: 'user_admin',
    });

    await assert.rejects(
      service.setStatus(group.id, 'SUSPENDED'),
      { errorCode: 'TENANT_PARENT_INVALID' },
    );

    await assert.rejects(
      service.createTenant({
        name: '非法分子公司',
        code: 'company-child',
        type: 'COMPANY',
        parentId: company.id,
        actorId: 'user_admin',
      }),
      { errorCode: 'TENANT_PARENT_INVALID' },
    );

    const suspendedGroup = await service.createTenant({
      name: '停用集团',
      code: 'suspended-group',
      type: 'GROUP',
      actorId: 'user_admin',
    });
    await service.setStatus(suspendedGroup.id, 'SUSPENDED');
    await assert.rejects(
      service.createTenant({
        name: '停用父节点下的公司',
        code: 'suspended-company',
        type: 'COMPANY',
        parentId: suspendedGroup.id,
        actorId: 'user_admin',
      }),
      { errorCode: 'TENANT_PARENT_INVALID' },
    );

    assert.equal(company.parentId, group.id);
  });

  it('拒绝会形成循环的父子关系', async () => {
    const { service } = await createService();
    const group = await service.createTenant({
      name: '循环测试集团',
      code: 'cycle-group',
      type: 'GROUP',
      actorId: 'user_admin',
    });
    const company = await service.createTenant({
      name: '循环测试公司',
      code: 'cycle-company',
      type: 'COMPANY',
      parentId: group.id,
      actorId: 'user_admin',
    });

    await assert.rejects(
      service.setParent(group.id, company.id),
      { errorCode: 'TENANT_CYCLE_DETECTED' },
    );
  });

  it('支持多租户成员、重复保护、撤销、状态过滤和审计', async () => {
    const { db, service, auditEvents } = await createService();
    await seedUser(db, 'user_multi_tenant');

    const defaultTenant = (await service.listTenants()).find((tenant) => tenant.code === 'default');
    assert.ok(defaultTenant);
    const secondGroup = await service.createTenant({
      name: '第二集团',
      code: 'second-group',
      type: 'GROUP',
      actorId: 'user_admin',
    });

    const first = await service.addMembership({
      subjectType: 'user',
      subjectId: 'user_multi_tenant',
      tenantId: defaultTenant.id,
      membershipType: 'admin',
      actorId: 'user_admin',
    });
    const second = await service.addMembership({
      subjectType: 'user',
      subjectId: 'user_multi_tenant',
      tenantId: secondGroup.id,
      membershipType: 'member',
      actorId: 'user_admin',
    });

    assert.notEqual(first.tenantId, second.tenantId);
    await assert.rejects(
      service.addMembership({
        subjectType: 'user',
        subjectId: 'user_multi_tenant',
        tenantId: defaultTenant.id,
        membershipType: 'admin',
        actorId: 'user_admin',
      }),
      { errorCode: 'RESOURCE_ALREADY_EXISTS' },
    );

    await service.revokeMembership(first.id, 'user_admin', '2026-08-05T01:00:00.000Z');
    const active = await service.listMemberships({
      subjectType: 'user',
      subjectId: 'user_multi_tenant',
      status: 'ACTIVE',
    });
    assert.deepEqual(active.map((item) => item.id), [second.id]);

    const revoked = await service.listMemberships({
      subjectType: 'user',
      subjectId: 'user_multi_tenant',
      status: 'REVOKED',
    });
    assert.deepEqual(revoked.map((item) => item.id), [first.id]);
    assert.equal(auditEvents.length, 3);
  });
});
