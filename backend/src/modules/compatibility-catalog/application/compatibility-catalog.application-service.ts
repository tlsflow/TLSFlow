import { resolve } from 'node:path';
import type { CompatibilityProfile, CompatibilitySupportLevel } from '../../../shared/contracts/compatibility-profile-contracts.js';
import { buildCompatibilityMatrix } from '../domain/compatibility-matrix.js';
import { projectCompatibilityProfileV2 } from '../domain/compatibility-profile-v2.projection.js';
import { loadCompatibilityCatalog } from '../infrastructure/compatibility-catalog.loader.js';

type CompatibilityMatrixItem = ReturnType<typeof buildCompatibilityMatrix>[number];

export type PublishedCompatibilityRow = CompatibilityMatrixItem & {
  declaredStatus: CompatibilitySupportLevel;
  effectiveStatus: CompatibilitySupportLevel;
  evidenceStatus: 'current' | 'expired' | 'failed';
  reasonCodes: string[];
  lastVerifiedAt?: string;
  baselineRef?: string;
  recipeRefs?: string[];
  certificationRefs?: string[];
};

export interface PublishedCompatibilityCatalog {
  schemaVersion: 'gcac.compatibility-catalog/v1';
  generatedAt: string;
  items: PublishedCompatibilityRow[];
}

export class CompatibilityCatalogApplicationService {
  constructor(private readonly compatibilityRoot = process.env.GCAC_COMPATIBILITY_ROOT ?? resolve(process.cwd(), '..', 'compatibility')) {}

  list(now = new Date()): PublishedCompatibilityCatalog {
    const catalog = loadCompatibilityCatalog(this.compatibilityRoot);
    if (catalog.profilesV2.length > 0) {
      return {
        schemaVersion: 'gcac.compatibility-catalog/v1',
        generatedAt: now.toISOString(),
        items: catalog.profilesV2.map((profile) => {
          const projected = projectCompatibilityProfileV2(profile, catalog.governance, now);
          return {
            profileId: projected.profileId,
            version: projected.version,
            status: projected.status,
            declaredStatus: projected.declaredStatus,
            effectiveStatus: projected.effectiveStatus,
            evidenceStatus: projected.evidenceStatus,
            automation: projected.automation,
            composition: projected.composition,
            rollbackRequired: projected.rollbackRequired,
            verificationRequired: projected.verificationRequired,
            limitations: projected.limitations,
            evidenceReferences: projected.evidenceReferences,
            reasonCodes: projected.reasonCodes,
            lastVerifiedAt: projected.lastVerifiedAt,
            baselineRef: projected.baselineRef,
            recipeRefs: projected.recipeRefs,
            certificationRefs: projected.certificationRefs,
          } satisfies PublishedCompatibilityRow;
        }),
      };
    }
    const profiles = new Map(catalog.profiles.map((profile) => evaluateProfile(profile, now)));
    return {
      schemaVersion: 'gcac.compatibility-catalog/v1',
      generatedAt: now.toISOString(),
      items: buildCompatibilityMatrix(catalog.profiles).map((row) => {
        const evaluation = profiles.get(row.profileId + '@' + row.version);
        if (!evaluation) throw new Error(`Compatibility Profile 状态投影不存在：${row.profileId}@${row.version}`);
        return { ...row, ...evaluation } satisfies PublishedCompatibilityRow;
      }),
    };
  }
}

function evaluateProfile(profile: CompatibilityProfile, now: Date) {
  const failed = profile.evidence.some((item) => item.status === 'failed');
  const expired = profile.evidence.some((item) => item.status === 'expired' || (item.expiresAt !== undefined && Date.parse(item.expiresAt) <= now.getTime()));
  const reasonCodes = failed ? ['COMPATIBILITY_EVIDENCE_FAILED'] : expired ? ['COMPATIBILITY_EVIDENCE_EXPIRED'] : [];
  const effectiveStatus = failed || expired ? downgrade(profile.status) : profile.status;
  const observedTimes = profile.evidence.map((item) => Date.parse(item.observedAt)).filter(Number.isFinite);
  return [profile.profileId + '@' + profile.version, {
    declaredStatus: profile.status,
    effectiveStatus,
    status: effectiveStatus,
    evidenceStatus: failed ? 'failed' : expired ? 'expired' : 'current',
    reasonCodes,
    lastVerifiedAt: observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : undefined,
  }] as const;
}

function downgrade(status: CompatibilitySupportLevel): CompatibilitySupportLevel {
  if (status === 'unsupported' || status === 'experimental' || status === 'legacy') return status;
  return 'experimental';
}
