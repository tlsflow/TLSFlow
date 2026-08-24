import type { UnifiedPluginManifestV1 } from '../dto/unified-plugins.dto.js';

export interface PluginCompatibilityContext {
  productFamily?: string;
  frameworkType?: string;
  targetType?: string;
  managementMethod?: 'AGENT' | 'PLUGIN' | 'MANUAL';
  executionLocation: 'AGENT' | 'CONTROL_PLANE' | 'GATEWAY';
  artifactContract?: string;
}

export interface PluginCompatibilityResult {
  compatible: boolean;
  reasons: Array<{ dimension: keyof PluginCompatibilityContext | 'compatibilityContract'; expected: string[]; actual?: string }>;
}

export function evaluatePluginCompatibility(manifest: UnifiedPluginManifestV1, context: PluginCompatibilityContext): PluginCompatibilityResult {
  const rules = manifest.compatibility;
  if (!rules || !hasTerminalCompatibilityRules(rules)) {
    return manifest.scope === 'MANAGED' || manifest.scope === 'BOTH'
      ? { compatible: false, reasons: [{ dimension: 'compatibilityContract', expected: ['gcac.plugin-manifest/v1 compatibility'], actual: undefined }] }
      : { compatible: true, reasons: [] };
  }
  const reasons: PluginCompatibilityResult['reasons'] = [];
  check('productFamily', rules.productFamilies, context.productFamily, reasons);
  check('frameworkType', rules.frameworkTypes, context.frameworkType, reasons);
  check('targetType', rules.targetTypes, context.targetType, reasons);
  check('managementMethod', rules.managementMethods, context.managementMethod, reasons);
  check('executionLocation', rules.executionLocations, context.executionLocation, reasons);
  check('artifactContract', rules.artifactContracts, context.artifactContract, reasons);
  return { compatible: reasons.length === 0, reasons };
}

function hasTerminalCompatibilityRules(rules: UnifiedPluginManifestV1['compatibility']): boolean {
  if (!rules) return false;
  return [
    rules.productFamilies,
    rules.frameworkTypes,
    rules.targetTypes,
    rules.managementMethods,
    rules.executionLocations,
    rules.artifactContracts,
  ].some((values) => values && values.length > 0);
}

function check(
  dimension: keyof PluginCompatibilityContext,
  expected: readonly string[] | undefined,
  actual: string | undefined,
  reasons: PluginCompatibilityResult['reasons'],
): void {
  if (!expected || expected.length === 0) return;
  const matches = actual && (dimension === 'productFamily'
    ? expected.some((item) => normalizeProductFamily(item) === normalizeProductFamily(actual))
    : expected.includes(actual));
  if (matches) return;
  reasons.push({ dimension, expected: [...expected], actual });
}

function normalizeProductFamily(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
