import { readFileSync } from 'node:fs';
import { AppError } from './errors/app-error.js';

interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const semVerPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const legacyMinimumVersion = '0.0.0';

export const GCAC_VERSION = loadGcacVersion();

export interface PluginGcacCompatibilityResult {
  compatible: boolean;
  currentGcacVersion: string;
  minGcacVersion: string;
}

export type SemVerRangeOperator = '>=' | '>' | '<=' | '<' | '=';

export interface SemVerRangeClause {
  operator: SemVerRangeOperator;
  version: string;
}

/** 解析插件声明的简单 SemVer 范围，例如 ">=2.11.0 <3.0.0"。 */
export function parseSemVerRange(value: string): SemVerRangeClause[] {
  const normalized = value.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', '版本范围不能为空', { versionRange: value });
  const clauses = normalized.split(/\s+/).map((token) => {
    const match = /^(>=|<=|>|<|=)?(.*)$/.exec(token);
    const operator = (match?.[1] ?? '=') as SemVerRangeOperator;
    const version = match?.[2] ?? '';
    parseSemVer(version);
    return { operator, version };
  });
  if (clauses.length === 0) throw new AppError('VALIDATION_FAILED', '版本范围无效', { versionRange: value });
  return clauses;
}

export function isSemVerRange(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    parseSemVerRange(value);
    return true;
  } catch {
    return false;
  }
}

/** 判断输入是否为可比较的完整 SemVer；未知或非法版本不会抛出异常。 */
export function isSemVer(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    parseSemVer(value);
    return true;
  } catch {
    return false;
  }
}

export function satisfiesSemVerRange(version: string, range: string): boolean {
  return parseSemVerRange(range).every((clause) => {
    const comparison = compareSemVer(version, clause.version);
    switch (clause.operator) {
      case '>=': return comparison >= 0;
      case '>': return comparison > 0;
      case '<=': return comparison <= 0;
      case '<': return comparison < 0;
      default: return comparison === 0;
    }
  });
}

export function normalizeMinimumGcacVersion(value: unknown): string {
  if (value === undefined) return legacyMinimumVersion;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_FAILED', 'minGcacVersion 必须是 SemVer 字符串', { field: 'minGcacVersion' });
  }
  return parseSemVer(value).value;
}

export function compareSemVer(left: string, right: string): number {
  const leftVersion = parseSemVer(left);
  const rightVersion = parseSemVer(right);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (leftVersion[key] !== rightVersion[key]) return leftVersion[key] > rightVersion[key] ? 1 : -1;
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

/**
 * 计算插件声明的最低宿主版本是否满足当前 GCAC 版本。
 * 缺少字段的历史插件按 0.0.0 处理，保持已有插件可继续运行。
 */
export function evaluatePluginGcacCompatibility(minimumVersion: string | undefined): PluginGcacCompatibilityResult {
  const requiredVersion = normalizeMinimumGcacVersion(minimumVersion);
  return {
    compatible: compareSemVer(GCAC_VERSION, requiredVersion) >= 0,
    currentGcacVersion: GCAC_VERSION,
    minGcacVersion: requiredVersion,
  };
}

export function assertPluginGcacCompatibility(pluginId: string, minimumVersion: string | undefined): void {
  const compatibility = evaluatePluginGcacCompatibility(minimumVersion);
  if (compatibility.compatible) return;
  throw new AppError('VALIDATION_FAILED', '插件要求更高版本的 GCAC，当前版本不兼容', {
    pluginId,
    currentGcacVersion: compatibility.currentGcacVersion,
    minGcacVersion: compatibility.minGcacVersion,
  });
}

function loadGcacVersion(): string {
  const configuredVersion = process.env.GCAC_VERSION?.trim();
  const version = configuredVersion || readFileSync(new URL('../../../version', import.meta.url), 'utf8').trim();
  return parseSemVer(version).value;
}

function parseSemVer(value: string): ParsedSemVer & { value: string } {
  const normalized = value.trim();
  const match = semVerPattern.exec(normalized);
  const prerelease = match?.[4]?.split('.') ?? [];
  if (!match || prerelease.some((identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'))) {
    throw new AppError('VALIDATION_FAILED', '版本号不是有效的 SemVer', { version: value });
  }
  return {
    value: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }
  return 0;
}
