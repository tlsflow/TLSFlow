import { newId } from '../../../shared/id.js';
import { AppError } from '../../../common/errors/app-error.js';
import { AutomationsDomainService } from '../domain/automations.domain-service.js';
import { nextAutomationRunAt } from '../domain/automation-schedule.js';
import type { AutomationConfigurationDto, AutomationRunDto, AutomationStatus, CreateAutomationInput, UpdateAutomationInput } from '../dto/automations.dto.js';
import type { AutomationPreviewDto } from '../dto/automations.dto.js';
import type { AutomationTargetSelector } from './automation-target-selector.js';
import { AutomationsRepository } from '../repository/automations.repository.js';
import type { AutomationEntity, AutomationVersionEntity } from '../schema/automations.schema.js';

export class AutomationsApplicationService {
  constructor(
    private readonly repository = new AutomationsRepository(),
    private readonly domain = new AutomationsDomainService(),
    private readonly clock: () => Date = () => new Date(),
    private readonly targetSelector?: AutomationTargetSelector,
  ) {}

  getRepository(): AutomationsRepository {
    return this.repository;
  }

  listRuns(tenantId: string, automationId?: string) { return this.repository.listRuns(tenantId, automationId); }
  getRun(tenantId: string, runId: string) { return this.repository.getRun(runId, tenantId); }
  listRunTargets(tenantId: string, runId: string) { return this.repository.listRunTargets(runId, tenantId); }
  listRunActionResults(tenantId: string, runId: string) { return this.repository.listActionResults(runId, tenantId); }

  async preview(tenantId: string, actorId: string, id: string, page?: number, pageSize?: number): Promise<AutomationPreviewDto> {
    if (!this.targetSelector) throw new Error('automation target selector is not configured');
    const automation = await this.repository.getAutomationOrThrow(id, tenantId);
    const version = await this.repository.getVersion(id, automation.currentVersion, tenantId);
    if (!version) throw new Error(`automation version missing: ${id}@${automation.currentVersion}`);
    return this.targetSelector.preview({
      tenantId, actorId, automationId: id, automationVersion: version.version, configurationChecksum: version.checksum,
      selector: version.targetSelector, guardrails: version.guardrails, page, pageSize,
    });
  }

  async createOnDemandRun(tenantId: string, actorId: string, id: string, idempotencyKey: string, expectedVersion: number, options: { triggerType?: 'on_demand' | 'schedule'; scheduledAt?: string } = {}): Promise<AutomationRunDto> {
    const existing = await this.repository.findRunByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;
    const automation = await this.repository.getAutomationOrThrow(id, tenantId);
    this.domain.assertVersion(automation, expectedVersion);
    if (automation.status === 'deleted' || (automation.status === 'disabled' && !(await this.repository.getVersion(id, automation.currentVersion, tenantId))?.guardrails.allowManualWhenDisabled)) {
      throw new Error('automation is not available for manual execution');
    }
    const version = await this.repository.getVersion(id, automation.currentVersion, tenantId);
    if (!version) throw new Error(`automation version missing: ${id}@${automation.currentVersion}`);
    if (!this.targetSelector) throw new Error('automation target selector is not configured');
    const preview = await this.targetSelector.preview({
      tenantId, actorId, automationId: id, automationVersion: version.version, configurationChecksum: version.checksum,
      selector: version.targetSelector, guardrails: version.guardrails,
    });
    if (version.guardrails.requirePreview && preview.previewId.length === 0) throw new Error('automation preview is required');
    const now = this.clock().toISOString();
    const executableTargets = preview.items.filter((item) => item.executable);
    const targetSummary = { total: executableTargets.length, pending: executableTargets.length, running: 0, waitingApproval: 0, succeeded: 0, failed: 0, skipped: preview.excludedCount, cancelled: 0 };
    const run = {
      id: newId('arun'), tenantId, automationId: id, automationVersion: version.version, automationNameSnapshot: automation.name,
      triggerType: options.triggerType ?? 'on_demand', scheduledAt: options.scheduledAt, idempotencyKey, status: 'queued' as const, targetSummary,
      actionTypes: version.actions.slice().sort((left, right) => left.position - right.position).map((action) => action.type),
      environmentSnapshots: [...new Set(executableTargets.map((item) => item.target.environment).filter((item): item is string => Boolean(item)))],
      createdBy: actorId, createdAt: now,
    };
    await this.repository.transaction(async (repository) => {
      await repository.createRun(run);
      await Promise.all(executableTargets.map((item, index) => repository.createRunTarget({
        id: newId('art'), tenantId, runId: run.id, sequenceNo: index + 1, targetSnapshot: item.target,
        environmentSnapshot: item.target.environment, actionTypes: run.actionTypes, status: 'pending', notificationRequestIds: [], createdAt: now, updatedAt: now,
      })));
    });
    return run;
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
        ...(input.configuration && current.status === 'active' ? { nextRunAt: nextAutomationRunAt(configuration.trigger, this.clock()) } : {}),
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
    const patch: Partial<AutomationEntity> = { status, updatedAt: this.clock().toISOString() };
    if (status === 'active') {
      const version = await this.repository.getVersion(id, current.currentVersion, tenantId);
      if (version?.trigger.type === 'once' && new Date(version.trigger.runAt) <= this.clock()) {
        throw new AppError('VALIDATION_FAILED', '一次性执行时间必须晚于当前时间', { runAt: version.trigger.runAt });
      }
      if (version) patch.nextRunAt = nextAutomationRunAt(version.trigger, this.clock());
    } else if (status === 'disabled') {
      patch.nextRunAt = undefined;
    }
    return this.repository.updateAutomation(id, tenantId, patch);
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
