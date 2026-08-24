import { CompatibilityCatalogError, type AdapterComposition } from '../../../shared/contracts/adapter-contracts.js';
import type {
  CertificationRecord,
  CompatibilityProfileV2,
  ExecutionRecipe,
  RuntimeBaseline,
} from '../../../shared/contracts/compatibility-governance-contracts.js';
import type {
  CompatibilityAutomationLevel,
  CompatibilityProfile,
  CompatibilitySupportLevel,
} from '../../../shared/contracts/compatibility-profile-contracts.js';
import { CompatibilityGovernanceRegistry } from './compatibility-governance-registry.js';

export interface CompatibilityProfileV2Projection {
  profileId: string;
  version: string;
  status: CompatibilitySupportLevel;
  declaredStatus: CompatibilitySupportLevel;
  effectiveStatus: CompatibilitySupportLevel;
  evidenceStatus: 'current' | 'expired' | 'failed';
  automation: CompatibilityAutomationLevel;
  composition: AdapterComposition;
  rollbackRequired: boolean;
  verificationRequired: boolean;
  limitations: string[];
  evidenceReferences: string[];
  reasonCodes: string[];
  lastVerifiedAt?: string;
  baselineRef: string;
  recipeRefs: string[];
  certificationRefs: string[];
  baseline: RuntimeBaseline;
  recipes: ExecutionRecipe[];
  certifications: CertificationRecord[];
}

export function projectCompatibilityProfileV2(
  profile: CompatibilityProfileV2,
  registry: CompatibilityGovernanceRegistry,
  now: Date,
): CompatibilityProfileV2Projection {
  const baseline = registry.getBaseline(profile.baselineRef);
  const recipes = profile.recipeRefs.map((reference) => registry.getRecipe(reference));
  const certifications = profile.certificationRefs.map((reference) => registry.getCertification(reference));
  const composition = mergeCompositions(recipes);
  const reasonCodes = evaluateReasonCodes(profile.declaredStatus, certifications, now);
  const evidenceStatus = reasonCodes.includes('COMPATIBILITY_EVIDENCE_FAILED')
    ? 'failed'
    : reasonCodes.includes('COMPATIBILITY_EVIDENCE_EXPIRED') ? 'expired' : 'current';
  const effectiveStatus = reasonCodes.length > 0 ? downgrade(profile.declaredStatus) : profile.declaredStatus;
  const observedTimes = certifications.map((record) => Date.parse(record.observedAt)).filter(Number.isFinite);
  return {
    profileId: profile.profileId,
    version: profile.version,
    status: effectiveStatus,
    declaredStatus: profile.declaredStatus,
    effectiveStatus,
    evidenceStatus,
    automation: profile.automation,
    composition,
    rollbackRequired: recipes.some((recipe) => recipe.rollbackRequired),
    verificationRequired: recipes.some((recipe) => recipe.verificationRequired),
    limitations: [...profile.limitations],
    evidenceReferences: [...new Set(certifications.flatMap((record) => record.evidenceReferences))].sort(),
    reasonCodes,
    lastVerifiedAt: observedTimes.length > 0 ? new Date(Math.max(...observedTimes)).toISOString() : undefined,
    baselineRef: profile.baselineRef,
    recipeRefs: [...profile.recipeRefs],
    certificationRefs: [...profile.certificationRefs],
    baseline,
    recipes,
    certifications,
  };
}

export function assertProfileV1V2Equivalent(
  profilesV1: CompatibilityProfile[],
  profilesV2: CompatibilityProfileV2[],
  registry: CompatibilityGovernanceRegistry,
): void {
  if (profilesV2.length === 0) return;
  const v1Index = new Map(profilesV1.map((profile) => [`${profile.profileId}@${profile.version}`, profile]));
  for (const profileV2 of profilesV2) {
    const reference = `${profileV2.profileId}@${profileV2.version}`;
    const profileV1 = v1Index.get(reference);
    if (!profileV1) continue;
    const projection = projectCompatibilityProfileV2(profileV2, registry, new Date('2026-07-21T00:00:00.000Z'));
    const differences: string[] = [];
    if (profileV1.status !== profileV2.declaredStatus) differences.push('status');
    if (profileV1.automation !== profileV2.automation) differences.push('automation');
    if (!sameJson(profileV1.composition, projection.composition)) differences.push('composition');
    if (profileV1.rollbackRequired !== projection.rollbackRequired) differences.push('rollbackRequired');
    if (profileV1.verificationRequired !== projection.verificationRequired) differences.push('verificationRequired');
    if (!sameJson([...profileV1.limitations].sort(), [...profileV2.limitations].sort())) differences.push('limitations');
    if (!sameJson(profileV1.evidence.map((item) => item.reference).sort(), projection.evidenceReferences)) differences.push('evidence');
    const recipeRequirements = projection.recipes.map((recipe) => recipe.requires);
    if (recipeRequirements.length !== 1 || !sameJson(normalizeRequirement(profileV1.match), normalizeRequirement(recipeRequirements[0]))) differences.push('match');
    if (differences.length > 0) {
      throw new CompatibilityCatalogError('COMPATIBILITY_PROFILE_V1_V2_CONFLICT', `Profile v1/v2 结论不等价：${reference}`, {
        reference,
        differences,
      });
    }
  }
}

function mergeCompositions(recipes: ExecutionRecipe[]): AdapterComposition {
  const composition: AdapterComposition = {};
  for (const recipe of recipes) {
    for (const [kind, adapterId] of Object.entries(recipe.composition)) {
      const existing = composition[kind as keyof AdapterComposition];
      if (existing && existing !== adapterId) {
        throw new CompatibilityCatalogError('COMPATIBILITY_RECIPE_AMBIGUOUS', `Profile 的多个 Recipe 对 ${kind} 给出不同适配器`, {
          kind,
          existing,
          adapterId,
        });
      }
      composition[kind as keyof AdapterComposition] = adapterId;
    }
  }
  return composition;
}

function evaluateReasonCodes(
  declaredStatus: CompatibilitySupportLevel,
  certifications: CertificationRecord[],
  now: Date,
): string[] {
  const reasons = new Set<string>();
  if (certifications.some((record) => record.status === 'failed')) reasons.add('COMPATIBILITY_EVIDENCE_FAILED');
  if (certifications.some((record) => record.status === 'expired' || (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()))) {
    reasons.add('COMPATIBILITY_EVIDENCE_EXPIRED');
  }
  if (declaredStatus === 'certified' || declaredStatus === 'supported') {
    const passedCategories = new Set(certifications.flatMap((record) => record.results.filter((result) => result.status === 'passed').map((result) => result.category)));
    const requiredCategories = declaredStatus === 'certified'
      ? ['real_environment', 'security', 'recovery']
      : ['real_environment'];
    if (requiredCategories.some((category) => !passedCategories.has(category as never))) reasons.add('COMPATIBILITY_CERTIFICATION_INSUFFICIENT');
    if (certifications.some((record) => !record.agentArtifact.signatureVerified || record.agentArtifact.vcsModified)) {
      reasons.add('COMPATIBILITY_CERTIFICATION_ARTIFACT_MISMATCH');
    }
  }
  return [...reasons].sort();
}

function downgrade(status: CompatibilitySupportLevel): CompatibilitySupportLevel {
  if (status === 'unsupported' || status === 'legacy' || status === 'experimental') return status;
  return 'experimental';
}

function normalizeRequirement(requirement: CompatibilityProfile['match']): unknown {
  return {
    ...requirement,
    requiredAll: [...requirement.requiredAll].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey)),
    optional: [...requirement.optional].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey)),
    forbidden: [...requirement.forbidden].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey)),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
