import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { PluginResourceLockService } from './application/plugin-resource-lock.service.js';

async function fixture() {
  const db = new PgliteDatabase();
  await db.exec(await readFile(join(process.cwd(), 'src/database/migrations/20260724000800_plugin_workflow_recovery.sql'), 'utf8'));
  let now = new Date('2026-07-24T00:00:00.000Z');
  return { service: new PluginResourceLockService(db, () => now), advance: (seconds: number) => { now = new Date(now.getTime() + seconds * 1000); } };
}

describe('PluginResourceLockService', () => {
  it('同设备写锁互斥，跨租户和不同设备不冲突', async () => {
    const { service } = await fixture();
    const first = await service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:device:device-1', mode: 'WRITE', ownerRunId: 'run-1', ownerStepId: 'step-1', ttlSeconds: 30 });
    await assert.rejects(() => service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:device:device-1', mode: 'WRITE', ownerRunId: 'run-2', ownerStepId: 'step-2', ttlSeconds: 30 }), /资源锁冲突/);
    await service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:device:device-2', mode: 'WRITE', ownerRunId: 'run-2', ownerStepId: 'step-2', ttlSeconds: 30 });
    await service.acquire({ tenantId: 'tenant-b', resourceKey: 'tenant:tenant-b:device:device-1', mode: 'WRITE', ownerRunId: 'run-3', ownerStepId: 'step-3', ttlSeconds: 30 });
    await service.release({ tenantId: first.tenantId, lockId: first.id, ownerRunId: first.ownerRunId, ownerStepId: first.ownerStepId });
  });

  it('读锁可共享但会阻塞写锁', async () => {
    const { service } = await fixture();
    await service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:device:device-1', mode: 'READ', ownerRunId: 'run-1', ownerStepId: 'step-1', ttlSeconds: 30 });
    await service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:device:device-1', mode: 'READ', ownerRunId: 'run-2', ownerStepId: 'step-2', ttlSeconds: 30 });
    await assert.rejects(() => service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:device:device-1', mode: 'WRITE', ownerRunId: 'run-3', ownerStepId: 'step-3', ttlSeconds: 30 }), /资源锁冲突/);
  });

  it('过期后可重新获取并递增 fencing token，续租校验所有者', async () => {
    const { service, advance } = await fixture();
    const first = await service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:standalone:target-1', mode: 'WRITE', ownerRunId: 'run-1', ownerStepId: 'step-1', ttlSeconds: 5 });
    advance(6);
    const second = await service.acquire({ tenantId: 'tenant-a', resourceKey: 'tenant:tenant-a:standalone:target-1', mode: 'WRITE', ownerRunId: 'run-2', ownerStepId: 'step-2', ttlSeconds: 5 });
    assert.ok(second.fencingToken > first.fencingToken);
    await assert.rejects(() => service.renew({ tenantId: 'tenant-a', lockId: second.id, ownerRunId: 'wrong', ownerStepId: 'step-2', ttlSeconds: 5 }), /所有者不匹配/);
  });

  it('拒绝插件自定义任意全局锁键', async () => {
    const { service } = await fixture();
    await assert.rejects(() => service.acquire({ tenantId: 'tenant-a', resourceKey: 'global:all-devices', mode: 'WRITE', ownerRunId: 'run-1', ownerStepId: 'step-1', ttlSeconds: 30 }), /受限格式/);
  });
});
