import assert from 'node:assert/strict';
import test from 'node:test';
import { readDashboardSystemResources } from './system-resources.js';

test('仪表盘主机资源采样只返回 CPU 和内存百分比', () => {
  const first = readDashboardSystemResources();
  const second = readDashboardSystemResources();

  assert.deepEqual(Object.keys(first).sort(), ['cpuUsage', 'memoryUsage']);
  assert.ok(first.cpuUsage === null || (first.cpuUsage >= 0 && first.cpuUsage <= 100));
  assert.ok(first.memoryUsage >= 0 && first.memoryUsage <= 100);
  assert.ok(second.cpuUsage === null || (second.cpuUsage >= 0 && second.cpuUsage <= 100));
  assert.ok(second.memoryUsage >= 0 && second.memoryUsage <= 100);
});

test('macOS 内存使用率会把 vm_stat 中可回收页面计入可用内存', () => {
  const resources = readDashboardSystemResources({
    platform: () => 'darwin',
    totalMemory: () => 16 * 1024,
    freeMemory: () => 128,
    readDarwinVmStat: () => `Mach Virtual Memory Statistics: (page size of 1024 bytes)
Pages free:                                       1.
Pages inactive:                                   1.
Pages speculative:                                1.
Pages purgeable:                                  0.
Pages wired down:                              1024.
`,
  });

  assert.equal(resources.memoryUsage, 81);
});

test('macOS vm_stat 无法读取时会回退到 Node 通用内存指标', () => {
  const resources = readDashboardSystemResources({
    platform: () => 'darwin',
    totalMemory: () => 16 * 1024,
    freeMemory: () => 6 * 1024,
    readDarwinVmStat: () => {
      throw new Error('vm_stat unavailable');
    },
  });

  assert.equal(resources.memoryUsage, 63);
});

test('macOS vm_stat 格式不完整时会回退到 Node 通用内存指标', () => {
  const resources = readDashboardSystemResources({
    platform: () => 'darwin',
    totalMemory: () => 16 * 1024,
    freeMemory: () => 6 * 1024,
    readDarwinVmStat: () => 'Mach Virtual Memory Statistics: (page size of 1024 bytes)\n',
  });

  assert.equal(resources.memoryUsage, 63);
});
