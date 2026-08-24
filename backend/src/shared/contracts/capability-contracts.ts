import type {
  CapabilityConstraintOperator,
  CapabilityDeclarationSource,
  CapabilityDeclarationStatus,
  CapabilityMatchStatus,
  CapabilityOwnerType,
  CapabilityRiskLevel,
  CapabilitySuggestionType,
  CapabilityTargetType,
  CapabilityValueType,
  CompatibilityLevel,
} from '../enums/core.enums.js';

export type CapabilityParameterValue = string | number | boolean | null | CapabilityParameterValue[] | { [key: string]: CapabilityParameterValue };
export type CapabilityParameterMap = Record<string, CapabilityParameterValue>;

export interface CapabilityDefinition {
  key: string;
  name: string;
  category: string;
  riskLevel: CapabilityRiskLevel;
  valueType: CapabilityValueType;
  description: string;
  manualAllowed: boolean;
  deprecated: boolean;
  replacedBy?: string;
  aliases: string[];
  allowedValues?: string[];
}

export interface CapabilityEvidence {
  summary: string;
  sourceDetail?: string;
  riskAcknowledgement?: string;
  confidenceReason?: string;
  details?: Record<string, unknown>;
}

export interface CapabilityDeclaration {
  id: string;
  tenantId: string;
  targetType: CapabilityTargetType;
  targetId: string;
  capabilityKey: string;
  originalCapabilityKey: string;
  value: unknown;
  parameters: CapabilityParameterMap;
  source: CapabilityDeclarationSource;
  confidence: number;
  riskLevel: CapabilityRiskLevel;
  evidence?: CapabilityEvidence;
  detectedAt?: string;
  expiresAt?: string;
  status: CapabilityDeclarationStatus;
  createdBy?: string;
  auditRef?: string;
}

export interface ManualCapabilityDeclarationInput {
  tenantId: string;
  targetType: CapabilityTargetType;
  targetId: string;
  capabilityKey: string;
  value: unknown;
  parameters?: CapabilityParameterMap;
  source: 'manual';
  confidence: number;
  evidence: CapabilityEvidence;
  expiresAt?: string;
  createdBy: string;
  auditRef: string;
}

export interface CapabilityConstraint {
  capabilityKey: string;
  operator: CapabilityConstraintOperator;
  expected?: unknown;
  scope?: Record<string, unknown>;
  reason: string;
  riskIfMissing: string;
}

export interface CapabilityRequirement {
  id: string;
  ownerType: CapabilityOwnerType;
  ownerId: string;
  requiredAll: CapabilityConstraint[];
  optional: CapabilityConstraint[];
  anyOfGroups: CapabilityConstraint[][];
  forbidden: CapabilityConstraint[];
  minConfidence: number;
  allowManual: boolean;
  riskLevel: CapabilityRiskLevel;
}

export interface CapabilityConstraintResolution {
  capabilityKey: string;
  originalCapabilityKey: string;
  operator: CapabilityConstraintOperator;
  declarationId: string;
  source: CapabilityDeclarationSource;
  confidence: number;
  manual: boolean;
  reason: string;
  expected?: unknown;
}

export interface CapabilityGap {
  capabilityKey: string;
  originalCapabilityKey: string;
  operator: CapabilityConstraintOperator;
  reason: string;
  riskIfMissing: string;
  expected?: unknown;
  scope?: Record<string, unknown>;
}

export interface CapabilityUnknown {
  capabilityKey: string;
  originalCapabilityKey: string;
  operator: CapabilityConstraintOperator;
  reason: string;
  expected?: unknown;
  blockingReason: 'unknown_definition' | 'low_confidence' | 'conflict' | 'inactive_declaration';
  candidateDeclarationIds: string[];
}

export interface CapabilityManualRisk {
  capabilityKey: string;
  declarationId: string;
  confidence: number;
  riskLevel: CapabilityRiskLevel;
  blocking: boolean;
  reason: string;
}

export interface CapabilityConflict {
  capabilityKey: string;
  declarationIds: string[];
  values: unknown[];
}

export interface DegradationSuggestion {
  type: CapabilitySuggestionType;
  title: string;
  description: string;
  requiredActions: string[];
  riskLevel: CapabilityRiskLevel;
  requiresApproval: boolean;
  blockedBy: string[];
}

export interface CapabilityMatchContext {
  targetType?: CapabilityTargetType;
  targetId?: string;
  criticalCapabilityKeys?: string[];
}

export interface CapabilityMatchResult {
  status: CapabilityMatchStatus;
  score: number;
  satisfied: CapabilityConstraintResolution[];
  missing: CapabilityGap[];
  unknown: CapabilityUnknown[];
  manualRisk: CapabilityManualRisk[];
  usedCapabilities: CapabilityConstraintResolution[];
  missingCapabilities: CapabilityGap[];
  lowConfidenceCapabilities: CapabilityUnknown[];
  conflictedCapabilities: CapabilityConflict[];
  degradationSuggestions: DegradationSuggestion[];
  compatibilityLevel: CompatibilityLevel;
  requiresApproval: boolean;
  diagnostics: {
    satisfiedCount: number;
    missingCount: number;
    unknownCount: number;
    manualRiskCount: number;
    evaluatedDeclarationCount: number;
    anyOfGroupResults: Array<{ index: number; satisfied: boolean }>;
  };
}

export interface CompatibilityEvaluation {
  targetType: CapabilityTargetType;
  targetId: string;
  level: CompatibilityLevel;
  reasonCodes: string[];
  missingForNextLevel: string[];
  evaluatedAt: string;
  sourceSnapshotId?: string;
}
