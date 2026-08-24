import {
  COMPATIBILITY_PROFILE_V2_API_VERSION,
  type CompatibilityProfileV2,
} from '../../../shared/contracts/compatibility-governance-contracts.js';
import {
  CompatibilitySupportLevels,
  type CompatibilityAutomationLevel,
} from '../../../shared/contracts/compatibility-profile-contracts.js';
import {
  assertKnownKeys,
  invalid,
  optionalIsoDate,
  requireEnum,
  requireIdentifier,
  requireRecord,
  requireReference,
  requireStringArray,
  requireVersion,
} from './compatibility-governance.schema-utils.js';

const errorCode = 'COMPATIBILITY_PROFILE_INVALID' as const;
const automationLevels = ['full', 'assisted', 'manual', 'monitor_only'] as const satisfies readonly CompatibilityAutomationLevel[];

export function parseCompatibilityProfileV2(input: unknown): CompatibilityProfileV2 {
  const value = requireRecord(input, 'Compatibility Profile v2', errorCode);
  assertKnownKeys(value, [
    'apiVersion', 'profileId', 'version', 'baselineRef', 'recipeRefs', 'certificationRefs', 'declaredStatus',
    'automation', 'limitations', 'publishedAt', 'deprecatedAt',
  ], errorCode);
  if (value.apiVersion !== COMPATIBILITY_PROFILE_V2_API_VERSION) invalid(errorCode, 'apiVersion 只支持 gcac.compatibility/v2');
  const declaredStatus = requireEnum(value, 'declaredStatus', CompatibilitySupportLevels, errorCode);
  const recipeRefs = requireVersionedReferences(value, 'recipeRefs', declaredStatus === 'unsupported');
  const certificationRefs = requireIdentifiers(value, 'certificationRefs', declaredStatus === 'unsupported');
  return {
    apiVersion: COMPATIBILITY_PROFILE_V2_API_VERSION,
    profileId: requireIdentifier(value, 'profileId', errorCode),
    version: requireVersion(value, 'version', errorCode),
    baselineRef: requireReference(value, 'baselineRef', errorCode),
    recipeRefs,
    certificationRefs,
    declaredStatus,
    automation: requireEnum(value, 'automation', automationLevels, errorCode),
    limitations: requireStringArray(value, 'limitations', errorCode),
    publishedAt: optionalIsoDate(value, 'publishedAt', errorCode),
    deprecatedAt: optionalIsoDate(value, 'deprecatedAt', errorCode),
  };
}

function requireVersionedReferences(value: Record<string, unknown>, key: string, allowEmpty: boolean): string[] {
  const items = value[key];
  if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) invalid(errorCode, `${key} 必须是引用数组`);
  if (!allowEmpty && items.length === 0) invalid(errorCode, `${key} 不得为空`);
  const references = items.map((_, index) => requireReference({ value: items[index] }, 'value', errorCode));
  if (new Set(references).size !== references.length) invalid(errorCode, `${key} 不得重复`);
  return references.sort();
}

function requireIdentifiers(value: Record<string, unknown>, key: string, allowEmpty: boolean): string[] {
  const items = value[key];
  if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) invalid(errorCode, `${key} 必须是标识符数组`);
  if (!allowEmpty && items.length === 0) invalid(errorCode, `${key} 不得为空`);
  const identifiers = items.map((_, index) => requireIdentifier({ value: items[index] }, 'value', errorCode));
  if (new Set(identifiers).size !== identifiers.length) invalid(errorCode, `${key} 不得重复`);
  return identifiers.sort();
}
