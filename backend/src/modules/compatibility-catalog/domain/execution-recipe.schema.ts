import { AdapterKinds, type AdapterComposition } from '../../../shared/contracts/adapter-contracts.js';
import {
  EXECUTION_RECIPE_API_VERSION,
  type ExecutionRecipe,
} from '../../../shared/contracts/compatibility-governance-contracts.js';
import { CapabilitiesDomainService } from '../../capabilities/domain/capabilities.domain-service.js';
import {
  assertKnownKeys,
  invalid,
  optionalIsoDate,
  requireBoolean,
  requireIdentifier,
  requireRecord,
  requireString,
  requireStringArray,
  requireVersion,
} from './compatibility-governance.schema-utils.js';

const errorCode = 'COMPATIBILITY_RECIPE_INVALID' as const;
const capabilities = new CapabilitiesDomainService();

export function parseExecutionRecipe(input: unknown): ExecutionRecipe {
  const value = requireRecord(input, 'Execution Recipe', errorCode);
  assertKnownKeys(value, [
    'apiVersion', 'recipeId', 'version', 'actionType', 'operationSchemaVersion', 'requires', 'composition',
    'rollbackRequired', 'verificationRequired', 'conflictsWith', 'deprecatedAt',
  ], errorCode);
  if (value.apiVersion !== EXECUTION_RECIPE_API_VERSION) invalid(errorCode, 'apiVersion 只支持 gcac.execution-recipe/v1');
  const composition = parseComposition(value.composition);
  if (Object.keys(composition).length === 0) invalid(errorCode, 'composition 不得为空');
  return {
    apiVersion: EXECUTION_RECIPE_API_VERSION,
    recipeId: requireIdentifier(value, 'recipeId', errorCode),
    version: requireVersion(value, 'version', errorCode),
    actionType: requireString(value, 'actionType', errorCode),
    operationSchemaVersion: requireVersion(value, 'operationSchemaVersion', errorCode),
    requires: capabilities.normalizeRequirement(value.requires as ExecutionRecipe['requires']),
    composition,
    rollbackRequired: requireBoolean(value, 'rollbackRequired', errorCode),
    verificationRequired: requireBoolean(value, 'verificationRequired', errorCode),
    conflictsWith: requireStringArray(value, 'conflictsWith', errorCode),
    deprecatedAt: optionalIsoDate(value, 'deprecatedAt', errorCode),
  };
}

function parseComposition(input: unknown): AdapterComposition {
  const value = requireRecord(input, 'composition', errorCode);
  const result: AdapterComposition = {};
  for (const [kind, adapterId] of Object.entries(value)) {
    if (!AdapterKinds.includes(kind as (typeof AdapterKinds)[number])) invalid(errorCode, `composition 包含未知适配器类型 ${kind}`);
    if (typeof adapterId !== 'string' || adapterId.trim() === '') invalid(errorCode, `composition.${kind} 必须是适配器 ID`);
    result[kind as (typeof AdapterKinds)[number]] = adapterId;
  }
  return result;
}
