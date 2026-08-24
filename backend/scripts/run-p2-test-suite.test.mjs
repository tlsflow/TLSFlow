import assert from 'node:assert/strict';
import test from 'node:test';

import { p2TestEntries, resolveEntry, validateP2TestEntries } from './run-p2-test-suite.mjs';

test('P2 显式测试清单覆盖四个插件批次、开发切换和故障矩阵', () => {
  assert.deepEqual(validateP2TestEntries(), []);
  assert.ok(p2TestEntries.length >= 30);
  assert.equal(p2TestEntries.some((entry) => entry.id === 'cloud-batch'), true);
  assert.equal(p2TestEntries.some((entry) => entry.id === 'web-app-batch'), true);
  assert.equal(p2TestEntries.some((entry) => entry.id === 'ca-batch'), true);
  assert.equal(p2TestEntries.filter((entry) => entry.id.startsWith('device-')).length, 3);
  assert.equal(p2TestEntries.some((entry) => entry.id === 'development-database-cutover'), true);
  assert.equal(p2TestEntries.some((entry) => entry.id === 'fault-matrix-contract'), true);
  assert.equal(new Set(p2TestEntries.flatMap((entry) => entry.pluginIds ?? [])).size, 17);
  assert.equal(p2TestEntries.filter((entry) => entry.pluginIds).reduce((count, entry) => count + entry.pluginIds.length, 0), 17);
});

test('P2 显式测试清单拒绝重复标识和缺少必要批次', () => {
  const duplicate = structuredClone(p2TestEntries);
  duplicate[1].id = duplicate[0].id;
  assert.match(validateP2TestEntries(duplicate).join('\n'), /重复/);

  const missingBatch = p2TestEntries.filter((entry) => entry.id !== 'cloud-batch');
  assert.match(validateP2TestEntries(missingBatch).join('\n'), /cloud/);
});

test('Windows npm 条目通过 shell 启动批处理入口', () => {
  const resolved = resolveEntry({ id: 'npm', kind: 'npm', cwd: 'backend', args: ['run', 'build'] }, { root: 'dist' });
  if (process.platform === 'win32') assert.equal(resolved.shell, true);
});
