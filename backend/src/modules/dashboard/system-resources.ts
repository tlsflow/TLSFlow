import { execFileSync } from 'node:child_process';
import os from 'node:os';
import type { DashboardSystemResources } from './schema/dashboard.schema.js';

interface CpuSnapshot {
  idle: number;
  total: number;
}

interface SystemResourceOptions {
  /** 为测试或嵌入式运行时提供可替换的系统采样器。 */
  readonly platform?: () => NodeJS.Platform;
  readonly totalMemory?: () => number;
  readonly freeMemory?: () => number;
  readonly readDarwinVmStat?: () => string;
}

// 模块初始化即记录一次基线，通常可在首个总览请求时得到有效采样窗口。
let previousCpuSnapshot = readCpuSnapshot();

/**
 * 读取仪表盘所在后端主机的资源使用率。
 * CPU 使用率基于两次采样之间的累计 CPU 时间差，采样窗口不足时返回 null。
 */
export function readDashboardSystemResources(options: SystemResourceOptions = {}): DashboardSystemResources {
  const currentCpuSnapshot = readCpuSnapshot();
  const cpuUsage = calculateCpuUsage(previousCpuSnapshot, currentCpuSnapshot);
  previousCpuSnapshot = currentCpuSnapshot;

  const totalMemory = Math.max(0, (options.totalMemory ?? os.totalmem)());
  const freeMemory = clampMemory(
    readAvailableMemory(totalMemory, options),
    totalMemory,
  );
  const memoryUsage = totalMemory > 0
    ? clampPercentage(((totalMemory - freeMemory) / totalMemory) * 100)
    : 0;

  return { cpuUsage, memoryUsage };
}

function readAvailableMemory(totalMemory: number, options: SystemResourceOptions): number {
  if ((options.platform ?? os.platform)() === 'darwin') {
    try {
      const rawOutput = (options.readDarwinVmStat ?? readDarwinVmStat)();
      const reusableMemory = parseDarwinReusableMemoryBytes(rawOutput);
      if (reusableMemory !== null) return reusableMemory;
    } catch {
      // vm_stat 不可用时回退到 Node 的通用指标，避免仪表盘接口失败。
    }
  }

  return (options.freeMemory ?? os.freemem)();
}

function readDarwinVmStat(): string {
  return execFileSync('vm_stat', [], { encoding: 'utf8' });
}

/**
 * macOS 的 os.freemem() 只反映 free 页面，不能代表系统可以立即回收的内存。
 * 活动监视器会把 inactive、speculative 和 purgeable 页面也计入可用内存。
 */
function parseDarwinReusableMemoryBytes(rawOutput: string): number | null {
  const pageSizeMatch = rawOutput.match(/page size of (\d+) bytes/i);
  if (!pageSizeMatch) return null;

  const pageSize = Number.parseInt(pageSizeMatch[1] ?? '', 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;

  const pageCounts = ['Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable']
    .map((label) => readVmStatPageCount(rawOutput, label));
  if (pageCounts.every((count) => count === null)) return null;

  const reusablePageCount = pageCounts.reduce<number>((sum, count) => sum + (count ?? 0), 0);

  return reusablePageCount * pageSize;
}

function readVmStatPageCount(rawOutput: string, label: string): number | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rawOutput.match(new RegExp(`${escapedLabel}:\\s+(\\d+)\\.`, 'i'));
  if (!match) return null;

  const count = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function clampMemory(value: number, totalMemory: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), totalMemory);
}

function readCpuSnapshot(): CpuSnapshot {
  return os.cpus().reduce<CpuSnapshot>((snapshot, cpu) => {
    const times = cpu.times;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return {
      idle: snapshot.idle + times.idle,
      total: snapshot.total + total,
    };
  }, { idle: 0, total: 0 });
}

function calculateCpuUsage(previous: CpuSnapshot, current: CpuSnapshot): number | null {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return null;
  return clampPercentage((1 - (idleDelta / totalDelta)) * 100);
}

function clampPercentage(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}
