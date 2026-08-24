import { AppError } from '../../../common/errors/app-error.js';
import { CertificateFormats } from '../../../shared/enums/core.enums.js';
import { PluginCapabilityRegistry } from '../../plugins/capabilities/plugin-capability.registry.js';
import type { UnifiedPluginCapabilityDescriptor } from '../../plugins/dto/unified-plugins.dto.js';
import {
  applicationOnboardingRecipeProtocol,
  type ApplicationOnboardingRecipeV1,
  type ApplicationOnboardingRecipeValidationContext,
} from './application-onboarding-recipe.dto.js';

const recipeKeys = new Set([
  'protocol', 'platformKey', 'displayNameKey', 'supportStatus', 'deploymentMode', 'deviceResourceType', 'deviceSelection', 'newDeviceOnboarding',
  'platformMetadata', 'forms', 'capabilities', 'targetProjection', 'certificate', 'commit',
]);
const platformMetadataKeys = new Set(['capabilityVersion', 'compatibilityKeys', 'requiredInformationKeys']);
const newDeviceOnboardingAgentKeys = new Set(['kind', 'platformKey', 'platformKeys']);
const newDeviceOnboardingPluginKeys = new Set(['kind', 'pluginId']);
const formKeys = new Set(['device', 'advanced']);
const capabilityKeys = new Set(['connectionTest', 'identity', 'discovery', 'workflowExecution']);
const targetProjectionKeys = new Set(['targetType', 'frameworkTypes', 'displayFields', 'identityFields', 'selectableWhen']);
const certificateKeys = new Set(['acceptedFormats', 'requiredArtifacts', 'defaultVersion']);
const commitKeys = new Set(['executionSource', 'inputContract']);
const identifierPattern = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
const valuePathPattern = /^[A-Za-z][A-Za-z0-9_.[\]-]{0,255}$/;
const inputContractPattern = /^[A-Za-z][A-Za-z0-9_.:/-]{0,127}$/;
const capabilityVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const resourcePathPattern = /^[^/\\][^\0]*$/;
const executableExtensionPattern = /\.(?:[cm]?js|ts|tsx|vue|ps1|sh|bat|cmd|exe|dll|so|dylib)$/i;
const selectableWhenPattern = /^(?:always|[A-Za-z][A-Za-z0-9_.[\]-]{0,255}(?:\s*(?:===|!==|==|!=)\s*(?:true|false|null|-?\d{1,20}|"(?:[^"\\]|\\.){0,128}"|'(?:[^'\\]|\\.){0,128}'))?)$/;
const stableTargetIdentityFields = ['managedTargetId', 'configFingerprint'] as const;

/**
 * 校验插件接入配方。配方是声明式资源，不能借此引入新的宿主步骤或可执行代码。
 */
export function validateApplicationOnboardingRecipe(
  input: unknown,
  context: ApplicationOnboardingRecipeValidationContext,
  capabilityRegistry: PluginCapabilityRegistry = new PluginCapabilityRegistry(),
): ApplicationOnboardingRecipeV1 {
  const value = record(input, 'recipe');
  assertKnownKeys(value, recipeKeys, 'recipe');
  if (value.protocol !== applicationOnboardingRecipeProtocol) {
    invalid('recipe.protocol', '仅支持 gcac.application-onboarding/v1');
  }

  const deploymentMode = enumValue(value.deploymentMode, ['MANAGED_TARGET', 'DIRECT_WORKFLOW'] as const, 'recipe.deploymentMode');
  const deviceSelection = enumValue(value.deviceSelection, ['EXISTING_OR_NEW', 'EXISTING_ONLY', 'NONE'] as const, 'recipe.deviceSelection');
  const deviceResourceType = optionalIdentifier(value.deviceResourceType, 'recipe.deviceResourceType');
  const platformMetadata = validatePlatformMetadata(value.platformMetadata);
  const newDeviceOnboarding = validateNewDeviceOnboarding(value.newDeviceOnboarding);
  const forms = validateForms(value.forms, context, deploymentMode, deviceSelection);
  const capabilities = validateCapabilities(value.capabilities, context.manifest.capabilities, capabilityRegistry);
  const targetProjection = validateTargetProjection(value.targetProjection);
  const certificate = validateCertificate(value.certificate);
  const commit = validateCommit(value.commit);

  if (deploymentMode === 'MANAGED_TARGET') {
    if (!deviceResourceType) invalid('recipe.deviceResourceType', 'MANAGED_TARGET 配方必须声明设备资源类型');
    if (deviceSelection === 'NONE') invalid('recipe.deviceSelection', 'MANAGED_TARGET 配方不能跳过设备选择');
    if (deviceSelection === 'EXISTING_OR_NEW' && newDeviceOnboarding?.kind !== 'AGENT_INSTALL' && !forms.device) {
      invalid('recipe.forms.device', '允许新增设备时必须引用设备表单资源');
    }
    if (capabilities.workflowExecution) invalid('recipe.capabilities.workflowExecution', 'MANAGED_TARGET 配方不能声明工作流执行能力');
    if (commit.executionSource !== 'PLUGIN') invalid('recipe.commit.executionSource', 'MANAGED_TARGET 配方必须使用 PLUGIN 执行来源');
  } else {
    if (deviceResourceType !== undefined) invalid('recipe.deviceResourceType', 'DIRECT_WORKFLOW 配方不能声明设备资源类型');
    if (forms.device !== undefined) invalid('recipe.forms.device', 'DIRECT_WORKFLOW 配方不能引用设备表单');
    if (!capabilities.workflowExecution) invalid('recipe.capabilities.workflowExecution', 'DIRECT_WORKFLOW 配方必须声明工作流执行能力');
    if (commit.executionSource !== 'WORKFLOW') invalid('recipe.commit.executionSource', 'DIRECT_WORKFLOW 配方必须使用 WORKFLOW 执行来源');
  }
  if (newDeviceOnboarding && deviceSelection !== 'EXISTING_OR_NEW') {
    invalid('recipe.newDeviceOnboarding', '只有允许选择已有或新增设备的配方可以声明新建设备入口');
  }

  return {
    protocol: applicationOnboardingRecipeProtocol,
    platformKey: identifier(value.platformKey, 'recipe.platformKey'),
    displayNameKey: localeKey(value.displayNameKey, 'recipe.displayNameKey'),
    ...(platformMetadata ? { platformMetadata } : {}),
    supportStatus: value.supportStatus === undefined
      ? 'SUPPORTED'
      : enumValue(value.supportStatus, ['SUPPORTED', 'IN_REVIEW'] as const, 'recipe.supportStatus'),
    deploymentMode,
    ...(deviceResourceType ? { deviceResourceType } : {}),
    deviceSelection,
    ...(newDeviceOnboarding ? { newDeviceOnboarding } : {}),
    forms,
    capabilities,
    targetProjection,
    certificate,
    commit,
  };
}

function validateNewDeviceOnboarding(input: unknown): ApplicationOnboardingRecipeV1['newDeviceOnboarding'] {
  if (input === undefined) return undefined;
  const value = record(input, 'recipe.newDeviceOnboarding');
  const kind = enumValue(value.kind, ['AGENT_INSTALL', 'PLUGIN_MANAGED'] as const, 'recipe.newDeviceOnboarding.kind');
  if (kind === 'AGENT_INSTALL') {
    assertKnownKeys(value, newDeviceOnboardingAgentKeys, 'recipe.newDeviceOnboarding');
    if (value.platformKey !== undefined && value.platformKeys !== undefined) {
      invalid('recipe.newDeviceOnboarding', 'platformKey 与 platformKeys 不能同时声明');
    }
    if (value.platformKeys !== undefined) {
      const platformKeys = array(value.platformKeys, 'recipe.newDeviceOnboarding.platformKeys')
        .map((item, index) => identifier(item, `recipe.newDeviceOnboarding.platformKeys[${index}]`));
      if (platformKeys.length === 0) invalid('recipe.newDeviceOnboarding.platformKeys', '至少声明一个 Agent 平台');
      assertUnique(platformKeys, 'recipe.newDeviceOnboarding.platformKeys');
      return { kind, platformKeys };
    }
    return { kind, platformKey: identifier(value.platformKey, 'recipe.newDeviceOnboarding.platformKey') };
  }
  assertKnownKeys(value, newDeviceOnboardingPluginKeys, 'recipe.newDeviceOnboarding');
  return { kind, pluginId: identifier(value.pluginId, 'recipe.newDeviceOnboarding.pluginId') };
}

function validatePlatformMetadata(input: unknown): ApplicationOnboardingRecipeV1['platformMetadata'] {
  if (input === undefined) return undefined;
  const value = record(input, 'recipe.platformMetadata');
  assertKnownKeys(value, platformMetadataKeys, 'recipe.platformMetadata');
  const capabilityVersion = text(value.capabilityVersion, 'recipe.platformMetadata.capabilityVersion');
  if (!capabilityVersionPattern.test(capabilityVersion)) {
    invalid('recipe.platformMetadata.capabilityVersion', '必须是安全的能力版本标识');
  }
  const compatibilityKeys = uniqueLocaleKeys(value.compatibilityKeys, 'recipe.platformMetadata.compatibilityKeys');
  const requiredInformationKeys = uniqueLocaleKeys(value.requiredInformationKeys, 'recipe.platformMetadata.requiredInformationKeys');
  if (compatibilityKeys.length === 0) invalid('recipe.platformMetadata.compatibilityKeys', '至少声明一项平台兼容性');
  if (requiredInformationKeys.length === 0) invalid('recipe.platformMetadata.requiredInformationKeys', '至少声明一项接入前置信息');
  return { capabilityVersion, compatibilityKeys, requiredInformationKeys };
}

function validateForms(
  input: unknown,
  context: ApplicationOnboardingRecipeValidationContext,
  deploymentMode: ApplicationOnboardingRecipeV1['deploymentMode'],
  deviceSelection: ApplicationOnboardingRecipeV1['deviceSelection'],
): ApplicationOnboardingRecipeV1['forms'] {
  const value = record(input, 'recipe.forms');
  assertKnownKeys(value, formKeys, 'recipe.forms');
  const device = optionalFormResource(value.device, context, 'recipe.forms.device');
  const advanced = optionalFormResource(value.advanced, context, 'recipe.forms.advanced');
  if (deploymentMode === 'MANAGED_TARGET' && deviceSelection === 'EXISTING_ONLY' && device !== undefined) {
    // 已有设备路径可以携带同一平台的高级编辑表单，但设备表单不是必需项。
  }
  return {
    ...(device ? { device } : {}),
    ...(advanced ? { advanced } : {}),
  };
}

function optionalFormResource(
  input: unknown,
  context: ApplicationOnboardingRecipeValidationContext,
  path: string,
): string | undefined {
  if (input === undefined) return undefined;
  const resourcePath = resourcePathValue(input, path);
  const declared = Object.values(context.manifest.resources.forms ?? {});
  if (!declared.includes(resourcePath)) {
    invalid(path, '表单引用未在 Manifest resources.forms 中声明', { resourcePath });
  }
  return resourcePath;
}

function validateCapabilities(
  input: unknown,
  declaredCapabilities: UnifiedPluginCapabilityDescriptor[],
  capabilityRegistry: PluginCapabilityRegistry,
): ApplicationOnboardingRecipeV1['capabilities'] {
  const value = record(input, 'recipe.capabilities');
  assertKnownKeys(value, capabilityKeys, 'recipe.capabilities');
  const declared = new Map(declaredCapabilities.map((item) => [item.key, item]));
  const connectionTest = capabilityReference(value.connectionTest, 'recipe.capabilities.connectionTest', declared, capabilityRegistry);
  const discovery = capabilityReference(value.discovery, 'recipe.capabilities.discovery', declared, capabilityRegistry);
  const identity = optionalCapabilityReference(value.identity, 'recipe.capabilities.identity', declared, capabilityRegistry);
  const workflowExecution = optionalCapabilityReference(value.workflowExecution, 'recipe.capabilities.workflowExecution', declared, capabilityRegistry);
  return {
    connectionTest,
    discovery,
    ...(identity ? { identity } : {}),
    ...(workflowExecution ? { workflowExecution } : {}),
  };
}

function capabilityReference(
  input: unknown,
  path: string,
  declared: Map<string, UnifiedPluginCapabilityDescriptor>,
  capabilityRegistry: PluginCapabilityRegistry,
): string {
  const key = identifier(input, path);
  const descriptor = declared.get(key);
  if (!descriptor) invalid(path, '配方引用了 Manifest 未声明的能力', { capabilityKey: key });
  capabilityRegistry.validate(descriptor!);
  return key;
}

function optionalCapabilityReference(
  input: unknown,
  path: string,
  declared: Map<string, UnifiedPluginCapabilityDescriptor>,
  capabilityRegistry: PluginCapabilityRegistry,
): string | undefined {
  return input === undefined ? undefined : capabilityReference(input, path, declared, capabilityRegistry);
}

function validateTargetProjection(input: unknown): ApplicationOnboardingRecipeV1['targetProjection'] {
  const value = record(input, 'recipe.targetProjection');
  assertKnownKeys(value, targetProjectionKeys, 'recipe.targetProjection');
  const frameworkTypes = value.frameworkTypes === undefined
    ? undefined
    : uniqueTokens(value.frameworkTypes, 'recipe.targetProjection.frameworkTypes');
  if (frameworkTypes !== undefined && frameworkTypes.length === 0) {
    invalid('recipe.targetProjection.frameworkTypes', '至少声明一个 Framework 类型');
  }
  const displayFields = uniqueValuePaths(value.displayFields, 'recipe.targetProjection.displayFields');
  if (displayFields.length === 0) invalid('recipe.targetProjection.displayFields', '至少声明一个业务展示字段');
  const identityFields = uniqueValuePaths(value.identityFields, 'recipe.targetProjection.identityFields');
  if (identityFields.length === 0) invalid('recipe.targetProjection.identityFields', '至少声明一个稳定身份字段');
  for (const required of stableTargetIdentityFields) {
    if (!identityFields.includes(required)) {
      invalid('recipe.targetProjection.identityFields', `必须包含稳定字段 ${required}`);
    }
  }
  const selectableWhen = selectableExpression(value.selectableWhen, 'recipe.targetProjection.selectableWhen');
  return {
    targetType: identifier(value.targetType, 'recipe.targetProjection.targetType'),
    ...(frameworkTypes ? { frameworkTypes } : {}),
    displayFields,
    identityFields,
    selectableWhen,
  };
}

function validateCertificate(input: unknown): ApplicationOnboardingRecipeV1['certificate'] {
  const value = record(input, 'recipe.certificate');
  assertKnownKeys(value, certificateKeys, 'recipe.certificate');
  const acceptedFormats = uniqueTokens(value.acceptedFormats, 'recipe.certificate.acceptedFormats');
  if (acceptedFormats.length === 0) invalid('recipe.certificate.acceptedFormats', '至少声明一种证书格式');
  // 证书格式码是宿主与插件共享的标准规范：插件只能从宿主可提供的格式中选取，
  // 与证书版本产物配置（certificateFormats）一一对应，避免声明宿主不存在的格式。
  const supportedFormats = CertificateFormats as readonly string[];
  for (const format of acceptedFormats) {
    if (!supportedFormats.includes(format)) {
      invalid('recipe.certificate.acceptedFormats', `证书格式必须来自宿主标准格式码：${supportedFormats.join(' / ')}`);
    }
  }
  const requiredArtifacts = uniqueTokens(value.requiredArtifacts, 'recipe.certificate.requiredArtifacts');
  if (requiredArtifacts.length === 0) invalid('recipe.certificate.requiredArtifacts', '至少声明一种证书制品');
  const defaultVersion = enumValue(value.defaultVersion, ['LATEST_VALID'] as const, 'recipe.certificate.defaultVersion');
  return { acceptedFormats, requiredArtifacts, defaultVersion };
}

function validateCommit(input: unknown): ApplicationOnboardingRecipeV1['commit'] {
  const value = record(input, 'recipe.commit');
  assertKnownKeys(value, commitKeys, 'recipe.commit');
  return {
    executionSource: enumValue(value.executionSource, ['PLUGIN', 'WORKFLOW'] as const, 'recipe.commit.executionSource'),
    inputContract: contractIdentifier(value.inputContract, 'recipe.commit.inputContract'),
  };
}

function uniqueValuePaths(input: unknown, path: string): string[] {
  const values = array(input, path).map((item, index) => valuePath(item, `${path}.${index}`));
  assertUnique(values, path);
  return values;
}

function uniqueTokens(input: unknown, path: string): string[] {
  const values = array(input, path).map((item, index) => identifier(item, `${path}.${index}`));
  assertUnique(values, path);
  return values;
}

function uniqueLocaleKeys(input: unknown, path: string): string[] {
  const values = array(input, path).map((item, index) => localeKey(item, `${path}.${index}`));
  assertUnique(values, path);
  return values;
}

function selectableExpression(input: unknown, path: string): string {
  const value = text(input, path);
  if (value.length > 256 || !selectableWhenPattern.test(value) || /(?:https?:|javascript:|data:|[;{}()`]|=>|\/\/|\/\*)/i.test(value)) {
    invalid(path, '只能使用受限的声明式可选条件，不能包含脚本或 URL');
  }
  return value;
}

function resourcePathValue(input: unknown, path: string): string {
  const value = text(input, path).replaceAll('\\', '/');
  if (!resourcePathPattern.test(value) || value.startsWith('/') || value.split('/').includes('..') || value.includes('://') || executableExtensionPattern.test(value)) {
    invalid(path, '资源引用路径不安全或包含可执行代码');
  }
  return value;
}

function contractIdentifier(input: unknown, path: string): string {
  const value = text(input, path);
  if (!inputContractPattern.test(value) || /(?:https?:|javascript:|data:)/i.test(value)) {
    invalid(path, 'inputContract 必须是已登记的协议标识，不能是 URL');
  }
  return value;
}

function valuePath(input: unknown, path: string): string {
  const value = text(input, path);
  if (!valuePathPattern.test(value) || /(?:https?:|javascript:|data:)/i.test(value)) invalid(path, '字段路径无效');
  return value;
}

function localeKey(input: unknown, path: string): string {
  const value = text(input, path);
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) invalid(path, '必须是合法 i18n key');
  return value;
}

function identifier(input: unknown, path: string): string {
  const value = text(input, path);
  if (!identifierPattern.test(value) || /(?:https?:|javascript:|data:)/i.test(value)) invalid(path, '标识符格式无效');
  return value;
}

function optionalIdentifier(input: unknown, path: string): string | undefined {
  return input === undefined ? undefined : identifier(input, path);
}

function assertUnique(values: string[], path: string): void {
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length > 0) invalid(path, '不允许重复字段', { duplicates: [...new Set(duplicates)] });
}

function assertKnownKeys(recordValue: Record<string, unknown>, allowed: Set<string>, path: string): void {
  const unknown = Object.keys(recordValue).filter((key) => !allowed.has(key));
  if (unknown.length > 0) invalid(path, '包含未知字段', { unknown });
}

function record(input: unknown, path: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid(path, '必须是对象');
  return input as Record<string, unknown>;
}

function array(input: unknown, path: string): unknown[] {
  if (!Array.isArray(input)) invalid(path, '必须是数组');
  return input;
}

function text(input: unknown, path: string): string {
  if (typeof input !== 'string' || input.trim() === '') invalid(path, '必须是非空字符串');
  return input.trim();
}

function enumValue<T extends string>(input: unknown, values: readonly T[], path: string): T {
  if (typeof input !== 'string' || !values.includes(input as T)) invalid(path, `必须是 ${values.join('、')} 之一`);
  return input as T;
}

function invalid(path: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AppError('VALIDATION_FAILED', `接入配方无效：${message}`, { code: 'ONBOARDING_RECIPE_INVALID', path, ...details });
}
