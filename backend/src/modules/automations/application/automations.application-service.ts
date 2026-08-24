import { newId } from '../../../shared/id.js';
import { AutomationsDomainService } from '../domain/automations.domain-service.js';
import type { AutomationConfigurationDto, AutomationStatus, CreateAutomationInput, UpdateAutomationInput } from '../dto/automations.dto.js';
import { AutomationsRepository } from '../repository/automations.repository.js';
import type { AutomationEntity, AutomationVersionEntity } from '../schema/automations.schema.js';

export class AutomationsApplicationService {
  constructor(
    private readonly repository = new AutomationsRepository(),
    private readonly domain = new AutomationsDomainService(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getRepository(): AutomationsRepository {
    return this.repository;
  }

  async list(tenantId: string): Promise<Array<AutomationEntity & { configuration: AutomationConfigurationDto }>> {
    const definitions = await this.repository.listAutomations(tenantId);
    return Promise.all(definitions.map((definition) => this.withConfiguration(definition)));
  }

  async get(tenantId: string, id: string): Promise<AutomationEntity & { configuration: AutomationConfigurationDto; versions: AutomationVersionEntity[] }> {
    const definition = await this.repository.getAutomationOrThrow(id, tenantId);
    const versions = await this.repository.listVersions(id, tenantId);
    return { ...await this.withConfiguration(definition), versions };
  }

  async create(tenantId: string, actorId: string, input: CreateAutomationInput): Promise<AutomationEntity & { configuration: AutomationConfigurationDto }> {
    const now = this.clock().toISOString();
    const definition: AutomationEntity = {
      id: newId('aut'), tenantId, name: input.name.trim(), description: input.description?.trim() || undefined,
      status: 'draft', currentVersion: 1, createdBy: actorId, createdAt: now, updatedAt: now, version: 1,
    };
    const configuration = this.configurationFromInput(input);
    const version = this.domain.createVersion({ tenantId, automationId: definition.id, version: 1, configuration, actorId, now });
    await this.repository.transaction(async (repository) => {
      await repository.createAutomation(definition);
      await repository.createVersion(version);
    });
    return { ...definition, configuration };
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateAutomationInput): Promise<AutomationEntity & { configuration: AutomationConfigurationDto }> {
    return this.repository.transaction(async (repository) => {
      const current = await repository.getAutomationOrThrow(id, tenantId);
      this.domain.assertVersion(current, input.expectedVersion);
      const currentVersion = await repository.getVersion(id, current.currentVersion, tenantId);
      if (!currentVersion) throw new Error(`automation version missing: ${id}@${current.currentVersion}`);
      let nextVersionNumber = current.currentVersion;
      let configuration = this.configurationFromVersion(currentVersion);
      if (input.configuration) {
        nextVersionNumber += 1;
        configuration = structuredClone(input.configuration);
        await repository.createVersion(this.domain.createVersion({ tenantId, automationId: id, version: nextVersionNumber, configuration, actorId, now: this.clock().toISOString() }));
      }
      const updated = await repository.updateAutomation(id, tenantId, {
        name: input.name?.trim() || current.name,
        description: input.description === undefined ? current.description : input.description.trim() || undefined,
        currentVersion: nextVersionNumber,
        updatedAt: this.clock().toISOString(),
      });
      return { ...updated, configuration };
    });
  }

  async copy(tenantId: string, actorId: string, id: string): Promise<AutomationEntity & { configuration: AutomationConfigurationDto }> {
    const source = await this.get(tenantId, id);
    return this.create(tenantId, actorId, {
      name: `${source.name} Copy`, description: source.description, ...structuredClone(source.configuration),
    });
  }

  enable(tenantId: string, id: string, expectedVersion: number) {
    return this.transition(tenantId, id, expectedVersion, 'active');
  }

  disable(tenantId: string, id: string, expectedVersion: number) {
    return this.transition(tenantId, id, expectedVersion, 'disabled');
  }

  async delete(tenantId: string, id: string, expectedVersion: number): Promise<AutomationEntity> {
    const current = await this.repository.getAutomationOrThrow(id, tenantId);
    this.domain.assertVersion(current, expectedVersion);
    this.domain.assertTransition(current.status, 'deleted');
    const now = this.clock().toISOString();
    return this.repository.updateAutomation(id, tenantId, { status: 'deleted', deletedAt: now, updatedAt: now, nextRunAt: undefined });
  }

  private async transition(tenantId: string, id: string, expectedVersion: number, status: AutomationStatus): Promise<AutomationEntity> {
    const current = await this.repository.getAutomationOrThrow(id, tenantId);
    this.domain.assertVersion(current, expectedVersion);
    this.domain.assertTransition(current.status, status);
    return this.repository.updateAutomation(id, tenantId, { status, updatedAt: this.clock().toISOString() });
  }

  private async withConfiguration(definition: AutomationEntity): Promise<AutomationEntity & { configuration: AutomationConfigurationDto }> {
    const version = await this.repository.getVersion(definition.id, definition.currentVersion, definition.tenantId);
    if (!version) throw new Error(`automation version missing: ${definition.id}@${definition.currentVersion}`);
    return { ...definition, configuration: this.configurationFromVersion(version) };
  }

  private configurationFromInput(input: CreateAutomationInput): AutomationConfigurationDto {
    return { trigger: structuredClone(input.trigger), targetSelector: structuredClone(input.targetSelector), actions: structuredClone(input.actions), guardrails: structuredClone(input.guardrails) };
  }

  private configurationFromVersion(version: AutomationVersionEntity): AutomationConfigurationDto {
    return { trigger: structuredClone(version.trigger), targetSelector: structuredClone(version.targetSelector), actions: structuredClone(version.actions), guardrails: structuredClone(version.guardrails) };
  }
}
