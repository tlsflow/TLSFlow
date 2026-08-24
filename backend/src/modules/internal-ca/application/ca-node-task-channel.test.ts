import assert from 'node:assert/strict';
import test from 'node:test';
import { CaNodeTaskChannel } from './ca-node-task-channel.js';

test('CA Node 任务通道仅通知对应 Provider 的在线连接', () => {
  const channel = new CaNodeTaskChannel();
  let firstProviderNotifications = 0;
  let secondProviderNotifications = 0;
  const unsubscribe = channel.subscribe('provider-1', () => { firstProviderNotifications += 1; });
  channel.subscribe('provider-2', () => { secondProviderNotifications += 1; });

  channel.notify('provider-1');
  assert.equal(firstProviderNotifications, 1);
  assert.equal(secondProviderNotifications, 0);

  unsubscribe();
  channel.notify('provider-1');
  assert.equal(firstProviderNotifications, 1);
});
