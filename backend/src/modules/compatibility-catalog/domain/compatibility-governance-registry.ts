import { CompatibilityCatalogError } from '../../../shared/contracts/adapter-contracts.js';
import type {
  CertificationRecord,
  CompatibilityProfileV2,
  ExecutionRecipe,
  RuntimeBaseline,
} from '../../../shared/contracts/compatibility-governance-contracts.js';

type VersionedCatalogObject = RuntimeBaseline | ExecutionRecipe | CompatibilityProfileV2;

export class CompatibilityGovernanceRegistry {
  private readonly baselines = new Map<string, RuntimeBaseline>();
  private readonly recipes = new Map<string, ExecutionRecipe>();
  private readonly certifications = new Map<string, CertificationRecord>();
  private readonly profiles = new Map<string, CompatibilityProfileV2>();

  constructor(input: {
    baselines?: RuntimeBaseline[];
    recipes?: ExecutionRecipe[];
    certifications?: CertificationRecord[];
    profiles?: CompatibilityProfileV2[];
  } = {}) {
    validateSemanticUniqueness(input.baselines ?? [], baselineSignature, 'Runtime Baseline');
    validateSemanticUniqueness(input.recipes ?? [], recipeSignature, 'Execution Recipe');
    input.baselines?.forEach((item) => registerVersioned(this.baselines, item.baselineId, item));
    input.recipes?.forEach((item) => registerVersioned(this.recipes, item.recipeId, item));
    input.certifications?.forEach((item) => registerCertification(this.certifications, item));
    input.profiles?.forEach((item) => registerVersioned(this.profiles, item.profileId, item));
  }

  listBaselines(): RuntimeBaseline[] { return sorted(this.baselines); }
  listRecipes(): ExecutionRecipe[] { return sorted(this.recipes); }
  listCertifications(): CertificationRecord[] { return [...this.certifications.values()].sort((left, right) => left.recordId.localeCompare(right.recordId)); }
  listProfiles(): CompatibilityProfileV2[] { return sorted(this.profiles); }

  getBaseline(reference: string): RuntimeBaseline { return requireReference(this.baselines, reference, 'COMPATIBILITY_BASELINE_NOT_FOUND'); }
  getRecipe(reference: string): ExecutionRecipe { return requireReference(this.recipes, reference, 'COMPATIBILITY_RECIPE_NOT_FOUND'); }
  getCertification(recordId: string): CertificationRecord {
    const record = this.certifications.get(recordId);
    if (!record) throw new CompatibilityCatalogError('COMPATIBILITY_CERTIFICATION_NOT_FOUND', `认证记录不存在：${recordId}`, { recordId });
    return record;
  }

  validateReferences(adapterIds: ReadonlySet<string>): void {
    for (const recipe of this.recipes.values()) {
      for (const adapterId of Object.values(recipe.composition)) {
        if (adapterId && !adapterIds.has(adapterId)) {
          throw new CompatibilityCatalogError('ADAPTER_NOT_FOUND', `Recipe 引用了未知适配器：${adapterId}`, { recipeId: recipe.recipeId, adapterId });
        }
      }
    }
    for (const certification of this.certifications.values()) {
      this.getBaseline(certification.baselineRef);
      const recipe = this.getRecipe(certification.recipeRef);
      if (!sameComposition(recipe.composition, certification.resolvedComposition)) {
        throw new CompatibilityCatalogError('COMPATIBILITY_CERTIFICATION_ARTIFACT_MISMATCH', '认证记录的解析组合与 Recipe 不一致', {
          recordId: certification.recordId,
          recipeRef: certification.recipeRef,
        });
      }
      if (certification.supersedes && !this.certifications.has(certification.supersedes)) {
        throw new CompatibilityCatalogError('COMPATIBILITY_CERTIFICATION_NOT_FOUND', `supersedes 记录不存在：${certification.supersedes}`);
      }
    }
    for (const profile of this.profiles.values()) {
      this.getBaseline(profile.baselineRef);
      profile.recipeRefs.forEach((reference) => this.getRecipe(reference));
      profile.certificationRefs.forEach((reference) => this.getCertification(reference));
    }
  }
}

function registerVersioned<T extends VersionedCatalogObject>(target: Map<string, T>, stableId: string, item: T): void {
  const reference = `${stableId}@${item.version}`;
  if (target.has(reference)) throw new CompatibilityCatalogError('COMPATIBILITY_CATALOG_INVALID', `兼容性对象重复注册：${reference}`, { reference });
  target.set(reference, item);
}

function registerCertification(target: Map<string, CertificationRecord>, item: CertificationRecord): void {
  if (target.has(item.recordId)) throw new CompatibilityCatalogError('COMPATIBILITY_CATALOG_INVALID', `认证记录重复注册：${item.recordId}`, { recordId: item.recordId });
  target.set(item.recordId, item);
}

function requireReference<T>(target: Map<string, T>, reference: string, errorCode: 'COMPATIBILITY_BASELINE_NOT_FOUND' | 'COMPATIBILITY_RECIPE_NOT_FOUND'): T {
  const item = target.get(reference);
  if (item) return item;
  const stableId = reference.split('@')[0];
  const availableVersions = [...target.keys()].filter((key) => key.startsWith(`${stableId}@`));
  if (availableVersions.length > 0) {
    throw new CompatibilityCatalogError('COMPATIBILITY_REFERENCE_VERSION_UNSUPPORTED', `引用版本不存在：${reference}`, { reference, availableVersions });
  }
  throw new CompatibilityCatalogError(errorCode, `引用对象不存在：${reference}`, { reference });
}

function sorted<T extends VersionedCatalogObject>(target: Map<string, T>): T[] {
  return [...target.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, item]) => item);
}

function sameComposition(left: Record<string, string | undefined>, right: Record<string, string | undefined>): boolean {
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined).sort();
  const rightEntries = Object.entries(right).filter(([, value]) => value !== undefined).sort();
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function validateSemanticUniqueness<T>(items: T[], signature: (item: T) => string, label: string): void {
  const signatures = new Map<string, number>();
  for (const item of items) {
    const value = signature(item);
    signatures.set(value, (signatures.get(value) ?? 0) + 1);
  }
  const duplicate = [...signatures.entries()].find(([, count]) => count > 1);
  if (duplicate) {
    throw new CompatibilityCatalogError('COMPATIBILITY_CATALOG_INVALID', `${label} 存在语义重复定义`, { signature: duplicate[0] });
  }
}

function baselineSignature(item: RuntimeBaseline): string {
  return stableJson({
    agentProductLine: item.agentProductLine,
    osFamily: item.osFamily,
    architectures: [...item.architectures].sort(),
    runtimeRequirements: [...item.runtimeRequirements].sort((left, right) => left.name.localeCompare(right.name)),
    securityRequirements: [...item.securityRequirements].sort(),
    installationCapabilities: [...item.installationCapabilities].sort(),
    unsupportedBoundaries: [...item.unsupportedBoundaries].sort(),
  });
}

function recipeSignature(item: ExecutionRecipe): string {
  return stableJson({
    actionType: item.actionType,
    operationSchemaVersion: item.operationSchemaVersion,
    requires: {
      ...item.requires,
      id: undefined,
      ownerId: undefined,
      requiredAll: [...item.requires.requiredAll].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey)),
      optional: [...item.requires.optional].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey)),
      forbidden: [...item.requires.forbidden].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey)),
    },
    composition: item.composition,
    rollbackRequired: item.rollbackRequired,
    verificationRequired: item.verificationRequired,
    conflictsWith: [...item.conflictsWith].sort(),
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
