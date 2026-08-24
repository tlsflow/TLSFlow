import type { CapabilityRequirement } from './capability-contracts.js';
import type { AdapterComposition } from './adapter-contracts.js';

export const COMPATIBILITY_PROFILE_API_VERSION = 'gcac.compatibility/v1' as const;

export const CompatibilitySupportLevels = [
  'certified',
  'supported',
  'compatible',
  'experimental',
  'legacy',
  'unsupported',
] as const;

export type CompatibilitySupportLevel = (typeof CompatibilitySupportLevels)[number];
export type CompatibilityAutomationLevel = 'full' | 'assisted' | 'manual' | 'monitor_only';
export type CompatibilityEvidenceType = 'fixture' | 'contract_test' | 'integration_test' | 'real_environment' | 'security_review';
export type CompatibilityEvidenceStatus = 'passed' | 'failed' | 'expired';

export interface CompatibilityEvidence {
  evidenceId: string;
  type: CompatibilityEvidenceType;
  status: CompatibilityEvidenceStatus;
  reference: string;
  observedAt: string;
  expiresAt?: string;
}

export interface CompatibilityProfile {
  apiVersion: typeof COMPATIBILITY_PROFILE_API_VERSION;
  profileId: string;
  version: string;
  status: CompatibilitySupportLevel;
  match: CapabilityRequirement;
  composition: AdapterComposition;
  automation: CompatibilityAutomationLevel;
  rollbackRequired: boolean;
  verificationRequired: boolean;
  limitations: string[];
  evidence: CompatibilityEvidence[];
  publishedAt?: string;
  deprecatedAt?: string;
}
