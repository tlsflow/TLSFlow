import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { buildSessionDirectory, SessionSlotPool } from './session-process.js';

describe('Browser Runtime 会话进程分配', () => {
  it('为并发会话分配独立槽位并在释放后复用', () => {
    const pool = new SessionSlotPool(2);
    assert.equal(pool.allocate('session-a'), 0);
    assert.equal(pool.allocate('session-b'), 1);
    assert.equal(pool.activeCount, 2);
    assert.throws(() => pool.allocate('session-c'), /容量已耗尽/);

    pool.release(0, 'session-a');
    assert.equal(pool.allocate('session-c'), 0);
    assert.equal(pool.activeCount, 2);
  });

  it('会话目录始终位于固定根目录且不同原始 ID 不会碰撞', () => {
    const root = resolve('runtime-test-sessions');
    const first = buildSessionDirectory(root, 'tenant/session');
    const second = buildSessionDirectory(root, 'tenant:session');
    assert.ok(first.startsWith(`${root}\\`) || first.startsWith(`${root}/`));
    assert.ok(second.startsWith(`${root}\\`) || second.startsWith(`${root}/`));
    assert.notEqual(first, second);
  });
});
