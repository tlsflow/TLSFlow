import type { PageQuery } from '../../../common/pagination/pagination.js';
import { createModuleMetadata } from '../../placeholder-module.js';
import type {
  CapabilityDeclaration,
  CapabilityMatchContext,
  CapabilityRequirement,
} from '../../../shared/contracts/capability-contracts.js';
import type { CapabilityTargetType } from '../../../shared/enums/core.enums.js';
import { CapabilitiesDomainService } from '../domain/capabilities.domain-service.js';
import { PgCapabilitiesRepository, type CapabilitiesRepository } from '../repository/capabilities.repository.js';
import type {
  CreateCapabilityDeclarationDto,
  CreateCapabilityRequirementDto,
  CreateManualCapabilityDeclarationDto,
  EvaluateCompatibilityDto,
} from '../dto/capabilities.dto.js';

export class CapabilitiesApplicationService {
  constructor(
    private readonly repository: CapabilitiesRepository = new PgCapabilitiesRepository(),
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

  async createDeclaration(input: CreateCapabilityDeclarationDto) {
    return this.repository.saveDeclaration(this.domain.normalizeDeclaration({ ...input, status: input.status ?? 'active', parameters: input.parameters ?? {} }));
  }

  async createManualDeclaration(input: CreateManualCapabilityDeclarationDto) {
    return this.repository.saveDeclaration(this.domain.normalizeManualDeclaration(input));
  }

  async listDeclarations(tenantId: string, query: PageQuery) {
    return this.repository.listDeclarations(tenantId, query);
  }

  async findDeclarations(tenantId: string, targetType: CapabilityTargetType, targetId: string) {
    return this.repository.findDeclarations(tenantId, targetType, targetId);
  }

  async registerRequirement(input: CreateCapabilityRequirementDto) {
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

  async listRequirements(query: PageQuery) {
    return this.repository.listRequirements(query);
  }

  matchRequirement(requirement: CapabilityRequirement, declarations: CapabilityDeclaration[], context?: CapabilityMatchContext) {
    return this.domain.matchRequirement(requirement, declarations, context);
  }

  async evaluateCompatibility(input: EvaluateCompatibilityDto) {
    const evaluation = this.domain.evaluateCompatibility(input);
    return this.repository.saveCompatibilityEvaluation(evaluation);
  }

  async getCompatibilityEvaluation(targetType: CapabilityTargetType, targetId: string) {
    return this.repository.getCompatibilityEvaluation(targetType, targetId);
  }

  getRepository(): CapabilitiesRepository {
    return this.repository;
  }
}
