import {
  CompatibilityCatalogError,
  AdapterKinds,
  type AdapterComposition,
} from '../../../shared/contracts/adapter-contracts.js';
import {
  COMPATIBILITY_PROFILE_API_VERSION,
  CompatibilitySupportLevels,
  type CompatibilityAutomationLevel,
  type CompatibilityEvidence,
  type CompatibilityEvidenceStatus,
  type CompatibilityEvidenceType,
  type CompatibilityProfile,
} from '../../../shared/contracts/compatibility-profile-contracts.js';
import { CapabilitiesDomainService } from '../../capabilities/domain/capabilities.domain-service.js';

const capabilities = new CapabilitiesDomainService();
const automationLevels = ['full', 'assisted', 'manual', 'monitor_only'] as const satisfies readonly CompatibilityAutomationLevel[];
const evidenceTypes = ['fixture', 'contract_test', 'integration_test', 'real_environment', 'security_review'] as const satisfies readonly CompatibilityEvidenceType[];
const evidenceStatuses = ['passed', 'failed', 'expired'] as const satisfies readonly CompatibilityEvidenceStatus[];

export function parseCompatibilityProfile(input: unknown): CompatibilityProfile {
  const value = requireRecord(input, 'Compatibility Profile');
  if (value.apiVersion !== COMPATIBILITY_PROFILE_API_VERSION) invalid('apiVersion 只支持 gcac.compatibility/v1');
  const status = requireEnum(value, 'status', CompatibilitySupportLevels);
  const composition = parseComposition(value.composition);
  const evidence = parseEvidence(value.evidence);
  if (status !== 'unsupported' && Object.keys(composition).length === 0) invalid('非 unsupported Profile 必须声明适配器组合');
  if (status !== 'unsupported' && evidence.length === 0) invalid('非 unsupported Profile 必须声明证据');
  return {
    apiVersion: COMPATIBILITY_PROFILE_API_VERSION,
    profileId: requireIdentifier(value, 'profileId'),
    version: requireVersion(value, 'version'),
    status,
    match: capabilities.normalizeRequirement(value.match as CompatibilityProfile['match']),
    composition,
    automation: requireEnum(value, 'automation', automationLevels),
    rollbackRequired: requireBoolean(value, 'rollbackRequired'),
    verificationRequired: requireBoolean(value, 'verificationRequired'),
    limitations: requireStringArray(value, 'limitations'),
    evidence,
    publishedAt: optionalIsoDate(value, 'publishedAt'),
    deprecatedAt: optionalIsoDate(value, 'deprecatedAt'),
  };
}

function parseComposition(input: unknown): AdapterComposition {
  const value = requireRecord(input, 'composition');
  const result: AdapterComposition = {};
  for (const [kind, adapterId] of Object.entries(value)) {
    if (!AdapterKinds.includes(kind as (typeof AdapterKinds)[number])) invalid(`composition 包含未知适配器类型 ${kind}`);
    if (typeof adapterId !== 'string' || adapterId.trim() === '') invalid(`composition.${kind} 必须是适配器 ID`);
    result[kind as (typeof AdapterKinds)[number]] = adapterId;
  }
  return result;
}

function parseEvidence(input: unknown): CompatibilityEvidence[] {
  if (!Array.isArray(input)) invalid('evidence 必须是数组');
  return input.map((item) => {
    const value = requireRecord(item, 'evidence item');
    return {
      evidenceId: requireIdentifier(value, 'evidenceId'),
      type: requireEnum(value, 'type', evidenceTypes),
      status: requireEnum(value, 'status', evidenceStatuses),
      reference: requireString(value, 'reference'),
      observedAt: requireIsoDate(value, 'observedAt'),
      expiresAt: optionalIsoDate(value, 'expiresAt'),
    };
  });
}

function requireRecord(input: unknown, field: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(`${field} 必须是对象`);
  return input as Record<string, unknown>;
}

function requireIdentifier(input: Record<string, unknown>, field: string): string {
  const value = requireString(input, field);
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value)) invalid(`${field} 格式无效`);
  return value;
}

function requireVersion(input: Record<string, unknown>, field: string): string {
  const value = requireString(input, field);
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(value)) invalid(`${field} 必须使用数字版本`);
  return value;
}

function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim() === '') invalid(`${field} 必须是非空字符串`);
  return value;
}

function requireBoolean(input: Record<string, unknown>, field: string): boolean {
  const value = input[field];
  if (typeof value !== 'boolean') invalid(`${field} 必须是布尔值`);
  return value;
}

function requireStringArray(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid(`${field} 必须是字符串数组`);
  return [...value];
}

function requireIsoDate(input: Record<string, unknown>, field: string): string {
  const value = requireString(input, field);
  if (Number.isNaN(Date.parse(value))) invalid(`${field} 必须是有效时间`);
  return value;
}

function optionalIsoDate(input: Record<string, unknown>, field: string): string | undefined {
  if (input[field] === undefined) return undefined;
  return requireIsoDate(input, field);
}

function requireEnum<T extends string>(input: Record<string, unknown>, field: string, values: readonly T[]): T {
  const value = input[field];
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(`${field} 不在允许范围内`);
  return value as T;
}

function invalid(message: string): never {
  throw new CompatibilityCatalogError('COMPATIBILITY_PROFILE_INVALID', message);
}
