import assert from 'node:assert/strict';
import test from 'node:test';
import { CaNodeTaskChannel } from './ca-node-task-channel.js';

test('CA Node 任务通道同时按租户和 Provider 隔离通知', () => {
  const channel = new CaNodeTaskChannel();
  let firstProviderNotifications = 0;
  let secondProviderNotifications = 0;
  let siblingTenantNotifications = 0;
  const unsubscribe = channel.subscribe('tenant-a', 'provider-1', () => { firstProviderNotifications += 1; });
  channel.subscribe('tenant-a', 'provider-2', () => { secondProviderNotifications += 1; });
  channel.subscribe('tenant-b', 'provider-1', () => { siblingTenantNotifications += 1; });

  channel.notify('tenant-a', 'provider-1');
  assert.equal(firstProviderNotifications, 1);
  assert.equal(secondProviderNotifications, 0);
  assert.equal(siblingTenantNotifications, 0);

  unsubscribe();
  channel.notify('tenant-a', 'provider-1');
  assert.equal(firstProviderNotifications, 1);
});
