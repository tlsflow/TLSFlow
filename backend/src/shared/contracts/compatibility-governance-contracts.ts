import type { AdapterComposition } from './adapter-contracts.js';
import type { CapabilityRequirement } from './capability-contracts.js';
import type {
  CompatibilityAutomationLevel,
  CompatibilitySupportLevel,
} from './compatibility-profile-contracts.js';

export const RUNTIME_BASELINE_API_VERSION = 'gcac.runtime-baseline/v1' as const;
export const EXECUTION_RECIPE_API_VERSION = 'gcac.execution-recipe/v1' as const;
export const CERTIFICATION_RECORD_API_VERSION = 'gcac.certification-record/v1' as const;
export const COMPATIBILITY_PROFILE_V2_API_VERSION = 'gcac.compatibility/v2' as const;

export const RuntimeOsFamilies = ['windows', 'linux', 'gateway'] as const;
export type RuntimeOsFamily = (typeof RuntimeOsFamilies)[number];

export interface RuntimeVersionRequirement {
  name: string;
  operator: 'equals' | 'at_least' | 'one_of';
  value?: string;
  values?: string[];
}

export interface RuntimeBaseline {
  apiVersion: typeof RUNTIME_BASELINE_API_VERSION;
  baselineId: string;
  version: string;
  agentProductLine: string;
  osFamily: RuntimeOsFamily;
  architectures: string[];
  runtimeRequirements: RuntimeVersionRequirement[];
  securityRequirements: string[];
  installationCapabilities: string[];
  unsupportedBoundaries: string[];
  deprecatedAt?: string;
}

export interface ExecutionRecipe {
  apiVersion: typeof EXECUTION_RECIPE_API_VERSION;
  recipeId: string;
  version: string;
  actionType: string;
  operationSchemaVersion: string;
  requires: CapabilityRequirement;
  composition: AdapterComposition;
  rollbackRequired: boolean;
  verificationRequired: boolean;
  conflictsWith: string[];
  deprecatedAt?: string;
}

export const CertificationRecordStatuses = ['passed', 'failed', 'expired'] as const;
export type CertificationRecordStatus = (typeof CertificationRecordStatuses)[number];

export interface CertificationEnvironment {
  osName: string;
  osVersion: string;
  kernelOrBuild: string;
  architecture: string;
  serviceModel: string;
  privilegeMode: string;
  securityModule: string;
  securityMode: string;
  productName: string;
  productVersion: string;
  certificateFormat: string;
  transport: string;
}

export interface CertificationAgentArtifact {
  productLine: string;
  version: string;
  revision: string;
  sha256: string;
  signatureVerified: boolean;
  vcsModified: boolean;
}

export interface CertificationTestResult {
  testId: string;
  category: 'contract' | 'integration' | 'real_environment' | 'security' | 'recovery';
  status: 'passed' | 'failed' | 'blocked';
  reference: string;
}

export interface CertificationRecord {
  apiVersion: typeof CERTIFICATION_RECORD_API_VERSION;
  recordId: string;
  baselineRef: string;
  recipeRef: string;
  environment: CertificationEnvironment;
  agentArtifact: CertificationAgentArtifact;
  resolvedComposition: AdapterComposition;
  testSuite: string;
  results: CertificationTestResult[];
  status: CertificationRecordStatus;
  observedAt: string;
  expiresAt?: string;
  evidenceReferences: string[];
  supersedes?: string;
}

export interface CompatibilityProfileV2 {
  apiVersion: typeof COMPATIBILITY_PROFILE_V2_API_VERSION;
  profileId: string;
  version: string;
  baselineRef: string;
  recipeRefs: string[];
  certificationRefs: string[];
  declaredStatus: CompatibilitySupportLevel;
  automation: CompatibilityAutomationLevel;
  limitations: string[];
  publishedAt?: string;
  deprecatedAt?: string;
}
