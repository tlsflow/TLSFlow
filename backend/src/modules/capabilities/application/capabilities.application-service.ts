import type { PageQuery } from '../../../common/pagination/pagination.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import type {
  CapabilityDeclaration,
  CapabilityMatchContext,
  CapabilityRequirement,
} from '../../../shared/contracts/capability-contracts.js';
import type { CapabilityTargetType } from '../../../shared/enums/core.enums.js';
import { CapabilitiesDomainService } from '../domain/capabilities.domain-service.js';
import { InMemoryCapabilitiesRepository, type CapabilitiesRepository } from '../repository/capabilities.repository.js';
import type {
  CreateCapabilityDeclarationDto,
  CreateCapabilityRequirementDto,
  CreateManualCapabilityDeclarationDto,
  EvaluateCompatibilityDto,
} from '../dto/capabilities.dto.js';

export class CapabilitiesApplicationService {
  constructor(
    private readonly repository: CapabilitiesRepository = new InMemoryCapabilitiesRepository(),
    private readonly domain = new CapabilitiesDomainService(),
  ) {}

  getModuleMetadata() {
    return createModuleMetadata('capabilities', '/api/v1/capabilities', '008');
  }

  listDefinitions() {
    return this.repository.listDefinitions();
  }

  getBuiltInCapabilityKeys() {
    return this.domain.getBuiltInCapabilityKeys();
  }

  createDeclaration(input: CreateCapabilityDeclarationDto) {
    return this.repository.saveDeclaration(this.domain.normalizeDeclaration({ ...input, status: input.status ?? 'active', parameters: input.parameters ?? {} }));
  }

  createManualDeclaration(input: CreateManualCapabilityDeclarationDto) {
    return this.repository.saveDeclaration(this.domain.normalizeManualDeclaration(input));
  }

  listDeclarations(tenantId: string, query: PageQuery) {
    return this.repository.listDeclarations(tenantId, query);
  }

  findDeclarations(tenantId: string, targetType: CapabilityTargetType, targetId: string) {
    return this.repository.findDeclarations(tenantId, targetType, targetId);
  }

  registerRequirement(input: CreateCapabilityRequirementDto) {
    return this.repository.saveRequirement(this.domain.normalizeRequirement(input as CapabilityRequirement));
  }

  validateRequirement(input: CapabilityRequirement): CapabilityRequirement {
    return this.domain.normalizeRequirement(input);
  }

  validateCapabilityContract(input: { ownerType: CapabilityRequirement['ownerType']; ownerId: string; requirements: CapabilityRequirement[] }) {
    return {
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      requirements: input.requirements.map((requirement) => this.validateRequirement({
        ...requirement,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
      })),
    };
  }

  listRequirements(query: PageQuery) {
    return this.repository.listRequirements(query);
  }

  matchRequirement(requirement: CapabilityRequirement, declarations: CapabilityDeclaration[], context?: CapabilityMatchContext) {
    return this.domain.matchRequirement(requirement, declarations, context);
  }

  evaluateCompatibility(input: EvaluateCompatibilityDto) {
    const evaluation = this.domain.evaluateCompatibility(input);
    return this.repository.saveCompatibilityEvaluation(evaluation);
  }

  getCompatibilityEvaluation(targetType: CapabilityTargetType, targetId: string) {
    return this.repository.getCompatibilityEvaluation(targetType, targetId);
  }

  getRepository(): CapabilitiesRepository {
    return this.repository;
  }
}
