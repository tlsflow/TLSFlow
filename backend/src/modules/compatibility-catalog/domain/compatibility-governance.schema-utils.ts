import { CompatibilityCatalogError, type CompatibilityCatalogErrorCode } from '../../../shared/contracts/adapter-contracts.js';

export function requireRecord(input: unknown, label: string, errorCode: CompatibilityCatalogErrorCode): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) invalid(errorCode, `${label} 必须是对象`);
  return input as Record<string, unknown>;
}

export function requireString(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode): string {
  const result = value[key];
  if (typeof result !== 'string' || result.trim() === '') invalid(errorCode, `${key} 必须是非空字符串`);
  return result;
}

export function requireIdentifier(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode): string {
  const result = requireString(value, key, errorCode);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(result)) invalid(errorCode, `${key} 必须是稳定小写标识符`);
  return result;
}

export function requireVersion(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode): string {
  const result = requireString(value, key, errorCode);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(result)) invalid(errorCode, `${key} 必须是语义版本`);
  return result;
}

export function requireReference(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode): string {
  const result = requireString(value, key, errorCode);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+@\d+\.\d+(?:\.\d+)?$/.test(result)) invalid(errorCode, `${key} 必须使用 stable-id@version 精确引用`);
  return result;
}

export function requireStringArray(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode, allowEmpty = true): string[] {
  const result = value[key];
  if (!Array.isArray(result) || result.some((item) => typeof item !== 'string' || item.trim() === '')) invalid(errorCode, `${key} 必须是字符串数组`);
  if (!allowEmpty && result.length === 0) invalid(errorCode, `${key} 不得为空`);
  if (new Set(result).size !== result.length) invalid(errorCode, `${key} 不得包含重复值`);
  return [...result];
}

export function requireBoolean(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode): boolean {
  const result = value[key];
  if (typeof result !== 'boolean') invalid(errorCode, `${key} 必须是布尔值`);
  return result;
}

export function requireEnum<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[], errorCode: CompatibilityCatalogErrorCode): T {
  const result = requireString(value, key, errorCode);
  if (!allowed.includes(result as T)) invalid(errorCode, `${key} 必须是 ${allowed.join(', ')}`);
  return result as T;
}

export function requireIsoDate(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode): string {
  const result = requireString(value, key, errorCode);
  if (!Number.isFinite(Date.parse(result))) invalid(errorCode, `${key} 必须是 ISO 时间`);
  return result;
}

export function optionalIsoDate(value: Record<string, unknown>, key: string, errorCode: CompatibilityCatalogErrorCode): string | undefined {
  if (value[key] === undefined) return undefined;
  return requireIsoDate(value, key, errorCode);
}

export function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], errorCode: CompatibilityCatalogErrorCode): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) invalid(errorCode, `包含未知字段：${unknown.sort().join(', ')}`);
}

export function invalid(errorCode: CompatibilityCatalogErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new CompatibilityCatalogError(errorCode, message, details);
}
