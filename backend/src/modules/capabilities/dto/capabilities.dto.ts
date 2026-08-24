import type { PageResponse } from '../../../shared/dto/page-response.js';
import type {
  CapabilityConstraint,
  CapabilityDeclaration,
  CapabilityDefinition,
  CapabilityEvidence,
  CapabilityMatchContext,
  CapabilityMatchResult,
  CapabilityParameterMap,
  CapabilityRequirement,
  CompatibilityEvaluation,
  ManualCapabilityDeclarationInput,
} from '../../../shared/contracts/capability-contracts.js';
import type {
  CapabilityDeclarationSource,
  CapabilityDeclarationStatus,
  CapabilityOwnerType,
  CapabilityRiskLevel,
  CapabilityTargetType,
} from '../../../shared/enums/core.enums.js';

export interface CapabilityDefinitionDto extends CapabilityDefinition {}

export interface CreateCapabilityDeclarationDto {
  tenantId: string;
  targetType: CapabilityTargetType;
  targetId: string;
  capabilityKey: string;
  value: unknown;
  parameters?: CapabilityParameterMap;
  source: Exclude<CapabilityDeclarationSource, 'manual'>;
  confidence: number;
  evidence?: CapabilityEvidence;
  detectedAt?: string;
  expiresAt?: string;
  status?: CapabilityDeclarationStatus;
  createdBy?: string;
  auditRef?: string;
}

export interface CreateManualCapabilityDeclarationDto extends ManualCapabilityDeclarationInput {}

export interface CapabilityDeclarationDto extends CapabilityDeclaration {}

export interface CapabilityDeclarationListQueryDto {
  tenantId: string;
  targetType?: CapabilityTargetType;
  targetId?: string;
  capabilityKey?: string;
  includeInactive?: boolean;
}

export interface CreateCapabilityRequirementDto {
  id?: string;
  ownerType: CapabilityOwnerType;
  ownerId: string;
  requiredAll: CapabilityConstraint[];
  optional?: CapabilityConstraint[];
  anyOfGroups?: CapabilityConstraint[][];
  forbidden?: CapabilityConstraint[];
  minConfidence?: number;
  allowManual?: boolean;
  riskLevel: CapabilityRiskLevel;
}

export interface CapabilityRequirementDto extends CapabilityRequirement {}

export interface MatchCapabilityRequirementDto {
  requirement: CapabilityRequirement;
  declarations: CapabilityDeclaration[];
  context?: CapabilityMatchContext;
}

export interface CapabilityMatchResultDto extends CapabilityMatchResult {}

export interface EvaluateCompatibilityDto {
  tenantId: string;
  targetType: CapabilityTargetType;
  targetId: string;
  declarations: CapabilityDeclaration[];
  criticalCapabilityKeys?: string[];
  sourceSnapshotId?: string;
}

export interface CompatibilityEvaluationDto extends CompatibilityEvaluation {}

export type CapabilityDefinitionPageDto = PageResponse<CapabilityDefinitionDto>;
export type CapabilityDeclarationPageDto = PageResponse<CapabilityDeclarationDto>;
export type CapabilityRequirementPageDto = PageResponse<CapabilityRequirementDto>;
