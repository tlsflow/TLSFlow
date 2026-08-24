import { resolve } from 'node:path';
import type { CompatibilityProfile, CompatibilitySupportLevel } from '../../../shared/contracts/compatibility-profile-contracts.js';
import { buildCompatibilityMatrix } from '../domain/compatibility-matrix.js';
import { loadCompatibilityCatalog } from '../infrastructure/compatibility-catalog.loader.js';

type CompatibilityMatrixItem = ReturnType<typeof buildCompatibilityMatrix>[number];

export type PublishedCompatibilityRow = CompatibilityMatrixItem & {
  declaredStatus: CompatibilitySupportLevel;
  effectiveStatus: CompatibilitySupportLevel;
  evidenceStatus: 'current' | 'expired' | 'failed';
  reasonCodes: string[];
  lastVerifiedAt?: string;
};

export class CompatibilityCatalogApplicationService {
  constructor(private readonly compatibilityRoot = process.env.GCAC_COMPATIBILITY_ROOT ?? resolve(process.cwd(), '..', 'compatibility')) {}

  list(now = new Date()) {
    const catalog = loadCompatibilityCatalog(this.compatibilityRoot);
    const profiles = new Map(catalog.profiles.map((profile) => evaluateProfile(profile, now)));
    return {
      schemaVersion: 'gcac.compatibility-catalog/v1',
      generatedAt: now.toISOString(),
      items: buildCompatibilityMatrix(catalog.profiles).map((row) => ({ ...row, ...profiles.get(row.profileId + '@' + row.version) })),
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
