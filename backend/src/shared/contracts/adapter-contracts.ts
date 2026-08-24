import type {
  CapabilityDeclaration,
  CapabilityGap,
  CapabilityMatchResult,
  CapabilityRequirement,
  DegradationSuggestion,
} from './capability-contracts.js';
import type { CapabilityRiskLevel } from '../enums/core.enums.js';

export const ADAPTER_MANIFEST_API_VERSION = 'gcac.adapter/v1' as const;

export const AdapterKinds = [
  'product',
  'certificate_store',
  'artifact_codec',
  'service_controller',
  'transport',
  'verifier',
  'rollback',
] as const;

export type AdapterKind = (typeof AdapterKinds)[number];

export interface AdapterManifest {
  apiVersion: typeof ADAPTER_MANIFEST_API_VERSION;
  adapterId: string;
  version: string;
  kind: AdapterKind;
  consumes: string[];
  produces: string[];
  requirements: CapabilityRequirement;
  conflicts: CapabilityRequirement['forbidden'];
  priority: number;
  riskLevel: CapabilityRiskLevel;
  supportedOperationSchemas: string[];
  deprecated?: boolean;
  replacedBy?: string;
}

export type AdapterComposition = Partial<Record<AdapterKind, string>>;

export interface AdapterResolutionEvidence {
  adapterId?: string;
  kind?: AdapterKind;
  code: string;
  message: string;
  capabilityMatch?: CapabilityMatchResult;
}

export interface AdapterResolutionRequest {
  actionSchemaVersion: string;
  declarations: CapabilityDeclaration[];
  requiredKinds: AdapterKind[];
  composition?: AdapterComposition;
}

export interface AdapterConflict {
  kind: AdapterKind;
  adapterIds: string[];
  reason: string;
}

export interface AdapterResolutionResult {
  status: 'resolved' | 'blocked' | 'ambiguous';
  selected: Partial<Record<AdapterKind, AdapterManifest>>;
  missingCapabilities: CapabilityGap[];
  conflicts: AdapterConflict[];
  evidence: AdapterResolutionEvidence[];
  fallbackSuggestions: DegradationSuggestion[];
}

export const CompatibilityCatalogErrorCodes = [
  'ADAPTER_MANIFEST_INVALID',
  'ADAPTER_REGISTRATION_CONFLICT',
  'ADAPTER_NOT_FOUND',
  'ADAPTER_RESOLUTION_AMBIGUOUS',
  'COMPATIBILITY_PROFILE_INVALID',
  'COMPATIBILITY_PROFILE_UNSUPPORTED',
  'COMPATIBILITY_CATALOG_INVALID',
] as const;

export type CompatibilityCatalogErrorCode = (typeof CompatibilityCatalogErrorCodes)[number];

export class CompatibilityCatalogError extends Error {
  constructor(
    public readonly errorCode: CompatibilityCatalogErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'CompatibilityCatalogError';
  }
}
