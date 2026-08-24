import { compareSemVer, isSemVer, satisfiesSemVerRange } from '../../../common/version.js';
import type { UnifiedPluginCapabilityDescriptor, UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';

export type PluginCompatibilityStatus = 'COMPATIBLE' | 'INCOMPATIBLE' | 'UNKNOWN';

export interface PluginCompatibilityContext {
  productFamily?: string;
  productVersion?: string;
  frameworkType?: string;
  targetType?: string;
  managementMethod?: 'AGENT' | 'PLUGIN' | 'MANUAL';
  executionLocation: 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';
  artifactContract?: string;
  hostVersion?: string;
  hostFeatures?: string[];
  runtimeVersions?: Partial<Record<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY', string>>;
}

export interface PluginCompatibilityReason {
  dimension: keyof PluginCompatibilityContext | 'compatibilityContract' | 'hostFeature' | 'targetVersion' | 'runtimeVersion';
  expected: string[];
  actual?: string;
  severity?: 'BLOCKING' | 'UNKNOWN';
}

export interface PluginCompatibilityResult {
  compatible: boolean;
  status?: PluginCompatibilityStatus;
  reasons: PluginCompatibilityReason[];
  evaluatedAt?: string;
  capabilityKey?: string;
  inputs?: Pick<PluginCompatibilityContext, 'productFamily' | 'productVersion' | 'executionLocation' | 'hostVersion' | 'hostFeatures' | 'runtimeVersions'>;
}

/**
 * 评估插件级旧规则与指定能力级规则。版本未知永远不会被当成已兼容；
 * 低风险能力允许以 UNKNOWN 返回供调用方试探，高风险能力则直接阻止。
 */
export function evaluatePluginCompatibility(
  manifest: UnifiedPluginManifestV1,
  context: PluginCompatibilityContext,
  capability?: UnifiedPluginCapabilityDescriptor,
): PluginCompatibilityResult {
  const reasons: PluginCompatibilityReason[] = [];
  const rules = manifest.compatibility;
  if (!rules || !hasTerminalCompatibilityRules(rules)) {
    if ((manifest.scope === 'MANAGED' || manifest.scope === 'BOTH') && !capability?.compatibility) {
      reasons.push({ dimension: 'compatibilityContract', expected: ['gcac.plugin-manifest/v1 compatibility'] });
    }
  } else {
    check('productFamily', rules.productFamilies, context.productFamily, reasons);
    check('frameworkType', rules.frameworkTypes, context.frameworkType, reasons);
    check('targetType', rules.targetTypes, context.targetType, reasons);
    check('managementMethod', rules.managementMethods, context.managementMethod, reasons);
    check('executionLocation', rules.executionLocations, context.executionLocation, reasons);
    check('artifactContract', rules.artifactContracts, context.artifactContract, reasons);
  }
  if (capability?.compatibility) evaluateCapabilityCompatibility(capability, context, reasons);
  const hasIncompatibility = reasons.some((reason) => reason.severity !== 'UNKNOWN');
  const hasUnknown = reasons.some((reason) => reason.severity === 'UNKNOWN');
  const allowUnknown = capability?.riskLevel === 'LOW';
  const status: PluginCompatibilityStatus = hasIncompatibility
    ? 'INCOMPATIBLE'
    : hasUnknown
      ? 'UNKNOWN'
      : 'COMPATIBLE';
  return {
    compatible: !hasIncompatibility && (!hasUnknown || allowUnknown),
    status,
    reasons,
    evaluatedAt: new Date().toISOString(),
    ...(capability ? { capabilityKey: capability.key } : {}),
    inputs: {
      productFamily: context.productFamily,
      productVersion: context.productVersion,
      executionLocation: context.executionLocation,
      hostVersion: context.hostVersion,
      hostFeatures: context.hostFeatures,
      runtimeVersions: context.runtimeVersions,
    },
  };
}

function evaluateCapabilityCompatibility(
  capability: UnifiedPluginCapabilityDescriptor,
  context: PluginCompatibilityContext,
  reasons: PluginCompatibilityReason[],
): void {
  const rules = capability.compatibility;
  if (!rules) return;
  if (rules.host?.minVersion) {
    if (!isKnownVersion(context.hostVersion)) reasons.push({ dimension: 'hostVersion', expected: [`>=${rules.host.minVersion}`], actual: context.hostVersion, severity: 'UNKNOWN' });
    else if (compareSemVer(context.hostVersion, rules.host.minVersion) < 0) reasons.push({ dimension: 'hostVersion', expected: [`>=${rules.host.minVersion}`], actual: context.hostVersion });
  }
  for (const feature of rules.host?.requiredFeatures ?? []) {
    if (!context.hostFeatures) reasons.push({ dimension: 'hostFeature', expected: [feature], severity: 'UNKNOWN' });
    else if (!context.hostFeatures.includes(feature)) reasons.push({ dimension: 'hostFeature', expected: [feature], actual: context.hostFeatures.join(',') });
  }
  if (rules.targets && rules.targets.length > 0) {
    const targetRules = rules.targets.filter((rule) => rule.productFamily === context.productFamily);
    if (targetRules.length === 0) {
      reasons.push({ dimension: 'productFamily', expected: rules.targets.map((rule) => rule.productFamily), actual: context.productFamily });
    } else if (!isKnownVersion(context.productVersion)) {
      reasons.push({ dimension: 'targetVersion', expected: targetRules.map((rule) => rule.versionRange), actual: context.productVersion, severity: 'UNKNOWN' });
    } else if (!targetRules.some((rule) => satisfiesSemVerRange(context.productVersion!, rule.versionRange))) {
      reasons.push({ dimension: 'targetVersion', expected: targetRules.map((rule) => rule.versionRange), actual: context.productVersion });
    }
  }
  const executionRule = rules.execution?.find((rule) => rule.location === context.executionLocation);
  if (executionRule?.minRuntimeVersion) {
    const runtimeVersion = context.runtimeVersions?.[context.executionLocation];
    if (!isKnownVersion(runtimeVersion)) reasons.push({ dimension: 'runtimeVersion', expected: [`>=${executionRule.minRuntimeVersion}`], actual: runtimeVersion, severity: 'UNKNOWN' });
    else if (compareSemVer(runtimeVersion, executionRule.minRuntimeVersion) < 0) reasons.push({ dimension: 'runtimeVersion', expected: [`>=${executionRule.minRuntimeVersion}`], actual: runtimeVersion });
  }
}

function hasTerminalCompatibilityRules(rules: UnifiedPluginManifestV1['compatibility']): boolean {
  if (!rules) return false;
  return [rules.productFamilies, rules.frameworkTypes, rules.targetTypes, rules.managementMethods, rules.executionLocations, rules.artifactContracts]
    .some((values) => values && values.length > 0);
}

function check(
  dimension: keyof PluginCompatibilityContext,
  expected: readonly string[] | undefined,
  actual: string | undefined,
  reasons: PluginCompatibilityReason[],
): void {
  if (!expected || expected.length === 0) return;
  if (actual && expected.includes(actual)) return;
  reasons.push({ dimension, expected: [...expected], actual });
}

function isKnownVersion(value: string | undefined): value is string {
  return isSemVer(value);
}
