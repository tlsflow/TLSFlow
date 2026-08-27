import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginCapabilityDescriptor, UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';
import {
  cloudAccountOnboardingProtocol,
  type CloudAccountOnboardingRecipeV2,
  type CloudAccountOnboardingRecipeValidationContext,
} from './cloud-account-onboarding-recipe.dto.js';

const keys = new Set(['protocol', 'assetKind', 'providerKey', 'display', 'platformMetadata', 'credentialContractResource', 'capabilities', 'submit', 'projection', 'defaults']);

export function validateCloudAccountOnboardingRecipe(
  input: unknown,
  context: CloudAccountOnboardingRecipeValidationContext,
): CloudAccountOnboardingRecipeV2 {
  const value = record(input, 'recipe');
  known(value, keys, 'recipe');
  if (value.protocol !== cloudAccountOnboardingProtocol) invalid('recipe.protocol', '仅支持 gcac.cloud-account-onboarding/v2');
  if (value.assetKind !== 'CLOUD_ACCOUNT') invalid('recipe.assetKind', '必须是 CLOUD_ACCOUNT');
  const providerKey = identifier(value.providerKey, 'recipe.providerKey');
  if (context.manifest.pluginId !== providerKey) invalid('recipe.providerKey', '必须与 Manifest pluginId 一致');
  const display = record(value.display, 'recipe.display');
  known(display, new Set(['nameKey', 'descriptionKey', 'logoResource']), 'recipe.display');
  const platformMetadata = validatePlatformMetadata(value.platformMetadata);
  const credentialContractResource = resource(value.credentialContractResource, 'recipe.credentialContractResource');
  if (!Object.values(context.manifest.resources.credentialContracts ?? {}).includes(credentialContractResource)) invalid('recipe.credentialContractResource', '凭据合同资源未在 Manifest 声明');
  const capabilities = record(value.capabilities, 'recipe.capabilities');
  known(capabilities, new Set(['connectionTest', 'discover']), 'recipe.capabilities');
  const connectionTest = capability(capabilities.connectionTest, 'recipe.capabilities.connectionTest', context.manifest.capabilities);
  const discover = capability(capabilities.discover, 'recipe.capabilities.discover', context.manifest.capabilities);
  const submit = record(value.submit, 'recipe.submit');
  known(submit, new Set(['target', 'scopeSchema']), 'recipe.submit');
  if (submit.target !== 'CLOUD_ACCOUNT_ASSET') invalid('recipe.submit.target', '必须是 CLOUD_ACCOUNT_ASSET');
  const projection = record(value.projection, 'recipe.projection');
  known(projection, new Set(['apiVersion', 'resourceMapping']), 'recipe.projection');
  if (projection.apiVersion !== 'gcac.cloud-service/v1') invalid('recipe.projection.apiVersion', '必须是 gcac.cloud-service/v1');
  const defaults = value.defaults === undefined ? undefined : record(value.defaults, 'recipe.defaults');
  if (defaults) {
    known(defaults, new Set(['request']), 'recipe.defaults');
    if (defaults.request !== undefined) record(defaults.request, 'recipe.defaults.request');
  }
  return {
    protocol: cloudAccountOnboardingProtocol,
    assetKind: 'CLOUD_ACCOUNT',
    providerKey,
    display: {
      nameKey: locale(display.nameKey, 'recipe.display.nameKey'),
      ...(display.descriptionKey === undefined ? {} : { descriptionKey: locale(display.descriptionKey, 'recipe.display.descriptionKey') }),
      ...(display.logoResource === undefined ? {} : { logoResource: resource(display.logoResource, 'recipe.display.logoResource') }),
    },
    platformMetadata,
    credentialContractResource,
    capabilities: { connectionTest, discover },
    submit: { target: 'CLOUD_ACCOUNT_ASSET', scopeSchema: identifier(submit.scopeSchema, 'recipe.submit.scopeSchema') },
    projection: { apiVersion: 'gcac.cloud-service/v1', resourceMapping: identifier(projection.resourceMapping, 'recipe.projection.resourceMapping') },
    ...(defaults ? { defaults: { ...(defaults.request === undefined ? {} : { request: structuredClone(defaults.request) }) } } : {}),
  };
}

function validatePlatformMetadata(input: unknown): CloudAccountOnboardingRecipeV2['platformMetadata'] {
  const value = record(input, 'recipe.platformMetadata');
  known(value, new Set(['capabilityVersion', 'compatibilityKeys', 'requiredInformationKeys']), 'recipe.platformMetadata');
  const capabilityVersion = text(value.capabilityVersion, 'recipe.platformMetadata.capabilityVersion');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(capabilityVersion)) invalid('recipe.platformMetadata.capabilityVersion', '必须是安全的能力版本标识');
  const compatibilityKeys = localeKeys(value.compatibilityKeys, 'recipe.platformMetadata.compatibilityKeys');
  const requiredInformationKeys = localeKeys(value.requiredInformationKeys, 'recipe.platformMetadata.requiredInformationKeys');
  if (compatibilityKeys.length === 0) invalid('recipe.platformMetadata.compatibilityKeys', '至少声明一项云产品兼容性');
  if (requiredInformationKeys.length === 0) invalid('recipe.platformMetadata.requiredInformationKeys', '至少声明一项接入前置信息');
  return { capabilityVersion, compatibilityKeys, requiredInformationKeys };
}

function localeKeys(input: unknown, path: string): string[] {
  if (!Array.isArray(input)) invalid(path, '必须是数组');
  const values = input.map((item, index) => locale(item, `${path}[${index}]`));
  if (new Set(values).size !== values.length) invalid(path, '不能包含重复 Locale key');
  return values;
}

function capability(input: unknown, path: string, declared: UnifiedPluginCapabilityDescriptor[]): string {
  const key = identifier(input, path);
  const descriptor = declared.find((item) => item.key === key);
  if (!descriptor) invalid(path, '能力未在 Manifest 声明', { capabilityKey: key });
  if (descriptor!.riskLevel !== 'LOW' || !descriptor!.executionLocations.includes('CONTROL_PLANE')) invalid(path, '云账号连接与发现必须是控制面低风险能力');
  return key;
}
function record(input: unknown, path: string): Record<string, any> { if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(path, '必须是对象'); return input as Record<string, any>; }
function known(value: Record<string, any>, allowed: Set<string>, path: string): void { const unknown = Object.keys(value).filter((key) => !allowed.has(key)); if (unknown.length) invalid(path, '包含未知字段', { unknown }); }
function text(input: unknown, path: string): string { if (typeof input !== 'string' || !input.trim()) invalid(path, '必须是非空字符串'); return input.trim(); }
function identifier(input: unknown, path: string): string { const value = text(input, path); if (!/^[A-Za-z0-9._:/-]{1,512}$/.test(value)) invalid(path, '标识符格式无效'); return value; }
function locale(input: unknown, path: string): string { const value = text(input, path); if (!/^[A-Za-z0-9_.-]+$/.test(value)) invalid(path, 'Locale key 格式无效'); return value; }
function resource(input: unknown, path: string): string { const value = text(input, path).replaceAll('\\', '/'); if (value.startsWith('/') || value.includes('../') || value.includes('://')) invalid(path, '资源路径不安全'); return value; }
function invalid(path: string, message: string, details: Record<string, unknown> = {}): never { throw new AppError('VALIDATION_FAILED', `云账号接入配方无效：${message}`, { code: 'CLOUD_ACCOUNT_ONBOARDING_RECIPE_INVALID', path, ...details }); }
