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

export function assertPluginGcacCompatibility(pluginId: string, minimumVersion: string | undefined): void {
  const requiredVersion = normalizeMinimumGcacVersion(minimumVersion);
  if (compareSemVer(GCAC_VERSION, requiredVersion) >= 0) return;
  throw new AppError('VALIDATION_FAILED', '插件要求更高版本的 GCAC，当前版本不兼容', {
    pluginId,
    currentGcacVersion: GCAC_VERSION,
    minGcacVersion: requiredVersion,
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
