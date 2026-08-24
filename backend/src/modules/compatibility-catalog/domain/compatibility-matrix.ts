import type { AdapterComposition } from '../../../shared/contracts/adapter-contracts.js';
import type {
  CompatibilityAutomationLevel,
  CompatibilityProfile,
  CompatibilitySupportLevel,
} from '../../../shared/contracts/compatibility-profile-contracts.js';

export interface CompatibilityMatrixRow {
  profileId: string;
  version: string;
  status: CompatibilitySupportLevel;
  automation: CompatibilityAutomationLevel;
  composition: AdapterComposition;
  rollbackRequired: boolean;
  verificationRequired: boolean;
  limitations: string[];
  evidenceReferences: string[];
}

/**
 * 矩阵只是 Profile 的稳定投影，不允许在这里补充第二套支持结论。
 */
export function buildCompatibilityMatrix(profiles: CompatibilityProfile[]): CompatibilityMatrixRow[] {
  return profiles
    .map((profile) => ({
      profileId: profile.profileId,
      version: profile.version,
      status: profile.status,
      automation: profile.automation,
      composition: { ...profile.composition },
      rollbackRequired: profile.rollbackRequired,
      verificationRequired: profile.verificationRequired,
      limitations: [...profile.limitations],
      evidenceReferences: profile.evidence.map((item) => item.reference).sort(),
    }))
    .sort((left, right) => left.profileId.localeCompare(right.profileId) || compareVersions(right.version, left.version));
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
