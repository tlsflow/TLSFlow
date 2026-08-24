import {
  RUNTIME_BASELINE_API_VERSION,
  RuntimeOsFamilies,
  type RuntimeBaseline,
  type RuntimeVersionRequirement,
} from '../../../shared/contracts/compatibility-governance-contracts.js';
import {
  assertKnownKeys,
  invalid,
  optionalIsoDate,
  requireEnum,
  requireIdentifier,
  requireRecord,
  requireString,
  requireStringArray,
  requireVersion,
} from './compatibility-governance.schema-utils.js';

const errorCode = 'COMPATIBILITY_BASELINE_INVALID' as const;

export function parseRuntimeBaseline(input: unknown): RuntimeBaseline {
  const value = requireRecord(input, 'Runtime Baseline', errorCode);
  assertKnownKeys(value, [
    'apiVersion', 'baselineId', 'version', 'agentProductLine', 'osFamily', 'architectures',
    'runtimeRequirements', 'securityRequirements', 'installationCapabilities', 'unsupportedBoundaries', 'deprecatedAt',
  ], errorCode);
  if (value.apiVersion !== RUNTIME_BASELINE_API_VERSION) invalid(errorCode, 'apiVersion 只支持 gcac.runtime-baseline/v1');
  const runtimeRequirements = value.runtimeRequirements;
  if (!Array.isArray(runtimeRequirements) || runtimeRequirements.length === 0) invalid(errorCode, 'runtimeRequirements 必须是非空数组');
  return {
    apiVersion: RUNTIME_BASELINE_API_VERSION,
    baselineId: requireIdentifier(value, 'baselineId', errorCode),
    version: requireVersion(value, 'version', errorCode),
    agentProductLine: requireIdentifier(value, 'agentProductLine', errorCode),
    osFamily: requireEnum(value, 'osFamily', RuntimeOsFamilies, errorCode),
    architectures: requireStringArray(value, 'architectures', errorCode, false).sort(),
    runtimeRequirements: runtimeRequirements.map(parseRuntimeRequirement),
    securityRequirements: requireStringArray(value, 'securityRequirements', errorCode),
    installationCapabilities: requireStringArray(value, 'installationCapabilities', errorCode, false),
    unsupportedBoundaries: requireStringArray(value, 'unsupportedBoundaries', errorCode),
    deprecatedAt: optionalIsoDate(value, 'deprecatedAt', errorCode),
  };
}

function parseRuntimeRequirement(input: unknown): RuntimeVersionRequirement {
  const value = requireRecord(input, 'runtimeRequirements item', errorCode);
  assertKnownKeys(value, ['name', 'operator', 'value', 'values'], errorCode);
  const operator = requireEnum(value, 'operator', ['equals', 'at_least', 'one_of'] as const, errorCode);
  const requirement: RuntimeVersionRequirement = {
    name: requireString(value, 'name', errorCode),
    operator,
  };
  if (operator === 'one_of') {
    requirement.values = requireStringArray(value, 'values', errorCode, false);
  } else {
    requirement.value = requireString(value, 'value', errorCode);
  }
  return requirement;
}
