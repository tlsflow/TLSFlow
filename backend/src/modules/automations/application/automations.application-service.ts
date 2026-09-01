import { newId } from '../../../shared/id.js';
import { AppError } from '../../../common/errors/app-error.js';
import { enqueueTaskBestEffort, type TaskEnqueuer } from '../../tasks/task-enqueue.js';
import { AutomationsDomainService } from '../domain/automations.domain-service.js';
import { nextAutomationRunAt } from '../domain/automation-schedule.js';
import type { AutomationConfigurationDto, AutomationExternalExecutionMode, AutomationPreviewDto, AutomationPreviewTargetDto, AutomationRunDto, AutomationRunExecutionOptionsDto, AutomationStatus, AutomationTriggerContextDto, CreateAutomationInput, UpdateAutomationInput } from '../dto/automations.dto.js';
import { AutomationsRepository } from '../repository/automations.repository.js';
import type { AutomationEntity, AutomationVersionEntity } from '../schema/automations.schema.js';
import { AutomationFilterEvaluator } from './automation-filter-evaluator.js';
import { AutomationTargetResolverRegistry, type AutomationTargetResolverInput } from './automation-target-resolver.registry.js';
import { AutomationTriggerRegistry } from './automation-trigger-registry.js';
import { buildAutomationTaskResourceSummary } from './automation-task-progress.js';

export interface AutomationsApplicationOptions {
  triggerRegistry?: AutomationTriggerRegistry;
  filterEvaluator?: AutomationFilterEvaluator;
  resolverRegistry?: AutomationTargetResolverRegistry;
  tasks?: TaskEnqueuer;
}

export class AutomationsApplicationService {
  private readonly triggerRegistry: AutomationTriggerRegistry;
  private readonly filterEvaluator: AutomationFilterEvaluator;
  private readonly resolverRegistry: AutomationTargetResolverRegistry;
  private readonly tasks?: TaskEnqueuer;

  constructor(
    private readonly repository = new AutomationsRepository(),
    private readonly domain = new AutomationsDomainService(),
    private readonly clock: () => Date = () => new Date(),
    options: AutomationsApplicationOptions = {},
  ) {
    this.triggerRegistry = options.triggerRegistry ?? new AutomationTriggerRegistry();
    this.filterEvaluator = options.filterEvaluator ?? new AutomationFilterEvaluator();
    this.resolverRegistry = options.resolverRegistry ?? new AutomationTargetResolverRegistry();
    this.tasks = options.tasks;
  }

  getRepository(): AutomationsRepository {
    return this.repository;
  }

  listRuns(tenantId: string, automationId?: string) { return this.repository.listRuns(tenantId, automationId); }
  getRun(tenantId: string, runId: string) { return this.repository.getRun(runId, tenantId); }
  listRunTargets(tenantId: string, runId: string) { return this.repository.listRunTargets(runId, tenantId); }
  listRunActionResults(tenantId: string, runId: string) { return this.repository.listActionResults(runId, tenantId); }
  listDeliveries(tenantId: string, automationId?: string) { return this.repository.listDeliveries(tenantId, automationId); }

  async preview(
    tenantId: string,
    actorId: string,
    id: string,
    page?: number,
    pageSize?: number,
    triggerContext?: AutomationTriggerContextDto,
    options: { allowCertificateDowngrade?: boolean } = {},
  ): Promise<AutomationPreviewDto> {
    const automation = await this.repository.getAutomationOrThrow(id, tenantId);
    const version = await this.repository.getVersion(id, automation.currentVersion, tenantId);
    if (!version) throw new Error(`automation version missing: ${id}@${automation.currentVersion}`);
    const items = await this.resolveTargets({
      tenantId,
      actorId,
      triggerContext,
      allowCertificateDowngrade: options.allowCertificateDowngrade === true,
      guardrails: version.guardrails,
      resolver: this.effectiveResolver(version.targetResolver, version.filters ?? []),
      filters: version.filters ?? [],
      page,
      pageSize,
    });
    return this.toPreview({
      automationId: id,
      automationVersion: version.version,
      configurationChecksum: version.checksum,
      guardrails: version.guardrails,
      items,
      page,
      pageSize,
    });
  }

  async createOnDemandRun(
    tenantId: string,
    actorId: string,
    id: string,
    idempotencyKey: string,
    expectedVersion: number,
    options: {
      triggerType?: 'on_demand' | 'schedule';
      scheduledAt?: string;
      triggerContext?: AutomationTriggerContextDto;
      executionOptions?: AutomationRunExecutionOptionsDto;
      allowCertificateDowngrade?: boolean;
      confirmCertificateDowngrade?: boolean;
      externalExecutionMode?: AutomationExternalExecutionMode;
    } = {},
  ): Promise<AutomationRunDto> {
    const existing = await this.repository.findRunByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;
    const automation = await this.repository.getAutomationOrThrow(id, tenantId);
    this.domain.assertVersion(automation, expectedVersion);
    const version = await this.requireRunnableVersion(tenantId, automation, { allowDisabledManual: true });
    const resolver = this.effectiveResolver(version.targetResolver, version.filters ?? []);
    if (version.trigger.type === 'certificate_version_created' && !options.triggerContext?.certificateVersionId) {
      throw new AppError('VALIDATION_FAILED', '证书新版本事件自动化手动执行时必须选择证书版本');
    }
    const isManualRun = (options.triggerType ?? 'on_demand') === 'on_demand';
    const allowCertificateDowngrade = isManualRun && options.allowCertificateDowngrade === true;
    const preview = await this.resolveTargets({
      tenantId,
      actorId,
      triggerContext: options.triggerContext,
      allowCertificateDowngrade,
      guardrails: version.guardrails,
      resolver,
      filters: version.filters ?? [],
    });
    const executableDowngradeCount = preview.filter((item) => item.executable && item.target.certificateVersionImpact === 'downgrade').length;
    if (!isManualRun && executableDowngradeCount > 0) {
      throw new AppError('VALIDATION_FAILED', '自动触发不允许降低证书有效期', { executableDowngradeCount });
    }
    if (executableDowngradeCount > 0 && !options.confirmCertificateDowngrade) {
      throw new AppError('VALIDATION_FAILED', '证书有效期降级必须二次确认', { executableDowngradeCount });
    }
    const externalExecutionMode = options.externalExecutionMode;
    // 中文说明：executionMode=approval 仅作为历史配置兼容字段读取；企业审批在外部系统完成，
    // 自动化运行本身永远以直接执行方式落库，不再创建内部 Approval。
    const executionVersion = { ...version, guardrails: { ...version.guardrails, requireApproval: false }, approvalStage: undefined };
    const run = await this.persistRunFromTargets({
      tenantId,
      actorId,
      automation,
      version: executionVersion,
      triggerType: options.triggerType ?? 'on_demand',
      scheduledAt: options.scheduledAt,
      idempotencyKey,
      triggerContext: options.triggerContext
        ? { ...options.triggerContext, ...(externalExecutionMode ? { externalExecutionMode } : {}) }
        : (externalExecutionMode ? { externalExecutionMode } : undefined),
      executionOptions: options.executionOptions,
      items: preview,
    });
    const triggerSource = options.triggerContext?.sourceType === 'external_api'
      ? 'automation.external_api'
      : options.externalExecutionMode === undefined
      ? (options.triggerType === 'schedule' ? 'automation.scheduler' : 'automation.manual')
      : 'automation.manual';
    this.enqueueRunTask(run, actorId, triggerSource);
    return run;
  }

  async createRunFromTrigger(input: {
    tenantId: string;
    actorId: string;
    automationId: string;
    idempotencyKey: string;
    triggerType: AutomationRunDto['triggerType'];
    triggerContext: AutomationTriggerContextDto;
    deliveryId?: string;
  }): Promise<{ run?: AutomationRunDto; items: AutomationPreviewTargetDto[] }> {
    const existing = await this.repository.findRunByIdempotencyKey(input.tenantId, input.idempotencyKey);
    if (existing) return { run: existing, items: [] };
    const automation = await this.repository.getAutomationOrThrow(input.automationId, input.tenantId);
    const version = await this.requireRunnableVersion(input.tenantId, automation, { allowDisabledManual: false });
    if (!this.triggerRegistry.matchesContext(version.trigger, input.triggerContext)) return { items: [] };
    const items = await this.resolveTargets({
      tenantId: input.tenantId,
      actorId: input.actorId,
      triggerContext: input.triggerContext,
      guardrails: version.guardrails,
      resolver: this.effectiveResolver(version.targetResolver, version.filters ?? []),
      filters: version.filters ?? [],
    });
    const executable = items.filter((item) => item.executable);
    if (executable.length === 0) return { items };
    const run = await this.persistRunFromTargets({
      tenantId: input.tenantId,
      actorId: input.actorId,
      automation,
      version,
      triggerType: input.triggerType,
      idempotencyKey: input.idempotencyKey,
      triggerContext: {
        ...structuredClone(input.triggerContext),
        deliveryId: input.deliveryId,
      },
      deliveryId: input.deliveryId,
      items,
    });
    // 必须使用审批状态已经写回后的 run，否则任务会永久停留在 queued，审批人也无法看到待审批标识。
    this.enqueueRunTask(run, input.actorId, 'automation.event');
    return { run, items };
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
      id: newId('aut'),
      tenantId,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      status: 'draft',
      currentVersion: 1,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const configuration = this.configurationFromInput(input);
    const version = this.domain.createVersion({ tenantId, automationId: definition.id, version: 1, configuration, actorId, now });
    await this.repository.transaction(async (repository) => {
      await repository.createAutomation(definition);
      await repository.createVersion(version);
    });
    return { ...definition, configuration: this.configurationFromVersion(version) };
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
        const createdVersion = this.domain.createVersion({ tenantId, automationId: id, version: nextVersionNumber, configuration: input.configuration, actorId, now: this.clock().toISOString() });
        configuration = this.configurationFromVersion(createdVersion);
        await repository.createVersion(createdVersion);
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
      name: `${source.name} Copy`,
      description: source.description,
      ...structuredClone(source.configuration),
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
    return {
      trigger: structuredClone(input.trigger),
      externalApi: structuredClone(input.externalApi),
      filters: structuredClone(input.filters ?? []),
      targetResolver: structuredClone(input.targetResolver),
      approvalStage: structuredClone(input.approvalStage),
      actions: structuredClone(input.actions),
      guardrails: structuredClone(input.guardrails),
    };
  }

  private configurationFromVersion(version: AutomationVersionEntity): AutomationConfigurationDto {
    return {
      trigger: structuredClone(version.trigger),
      externalApi: structuredClone(version.externalApi),
      filters: structuredClone(version.filters ?? []),
      targetResolver: structuredClone(version.targetResolver),
      approvalStage: structuredClone(version.approvalStage),
      actions: structuredClone(version.actions),
      guardrails: structuredClone(version.guardrails),
    };
  }

  private async requireRunnableVersion(tenantId: string, automation: AutomationEntity, options: { allowDisabledManual: boolean }): Promise<AutomationVersionEntity> {
    if (automation.status === 'deleted') throw new Error('automation is not available for execution');
    const version = await this.repository.getVersion(automation.id, automation.currentVersion, tenantId);
    if (!version) throw new Error(`automation version missing: ${automation.id}@${automation.currentVersion}`);
    if (automation.status === 'disabled' && !(options.allowDisabledManual && version.guardrails.allowManualWhenDisabled)) {
      throw new Error('automation is not available for manual execution');
    }
    return version;
  }

  private async resolveTargets(input: AutomationTargetResolverInput & { filters: NonNullable<AutomationConfigurationDto['filters']> }): Promise<AutomationPreviewTargetDto[]> {
    const filters = input.resolver.type === 'certificate_version_targets'
      ? input.filters.filter((filter) => filter.field !== 'event.domains' && filter.field !== 'target.assetId')
      : input.filters;
    const eventFilters = filters.filter((filter) => filter.field.startsWith('event.'));
    if (eventFilters.length > 0) {
      const eventMatch = this.filterEvaluator.evaluate(eventFilters, { event: input.triggerContext });
      if (!eventMatch.matched) return [];
    }
    const items = await this.resolverRegistry.resolve(input);
    return items.map((item) => {
      if (!item.executable) return item;
      const matched = this.filterEvaluator.evaluate(filters, { event: input.triggerContext, target: item.target });
      return matched.matched ? item : { ...item, executable: false, excludedReason: 'filter_not_matched' };
    });
  }

  private effectiveResolver(
    resolver: NonNullable<AutomationVersionEntity['targetResolver']>,
    filters: NonNullable<AutomationConfigurationDto['filters']>,
  ): NonNullable<AutomationVersionEntity['targetResolver']> {
    if (resolver.type !== 'certificate_version_targets' || resolver.assetIds?.length) return resolver;
    const assetIds = filters
      .filter((filter) => filter.field === 'target.assetId')
      .flatMap((filter) => Array.isArray(filter.value) ? filter.value : [])
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return assetIds.length > 0 ? { ...resolver, assetIds: [...new Set(assetIds)] } : resolver;
  }

  private toPreview(input: {
    automationId: string;
    automationVersion: number;
    configurationChecksum: string;
    guardrails: AutomationConfigurationDto['guardrails'];
    items: AutomationPreviewTargetDto[];
    page?: number;
    pageSize?: number;
  }): AutomationPreviewDto {
    const limited = input.items.slice(0, input.guardrails.maxTargetsPerRun);
    const excludedReasons: Record<string, number> = {};
    for (const item of limited) {
      if (item.excludedReason) excludedReasons[item.excludedReason] = (excludedReasons[item.excludedReason] ?? 0) + 1;
    }
    const impactItems = limited.filter((item) => item.target.certificateVersionImpact);
    const page = input.page ?? 1;
    const size = Math.min(input.pageSize ?? 50, 200);
    const start = (page - 1) * size;
    return {
      previewId: `${input.automationId}:${input.automationVersion}:${input.configurationChecksum}`,
      automationId: input.automationId,
      automationVersion: input.automationVersion,
      configurationChecksum: input.configurationChecksum,
      totalMatched: limited.length,
      executableCount: limited.filter((item) => item.executable).length,
      excludedCount: limited.filter((item) => !item.executable).length,
      excludedReasons,
      page,
      pageSize: size,
      items: limited.slice(start, start + size),
      ...(impactItems.length > 0 ? {
        versionImpactSummary: {
          total: impactItems.length,
          upgrade: impactItems.filter((item) => item.target.certificateVersionImpact === 'upgrade').length,
          same: impactItems.filter((item) => item.target.certificateVersionImpact === 'same').length,
          downgrade: impactItems.filter((item) => item.target.certificateVersionImpact === 'downgrade').length,
          missingCurrent: impactItems.filter((item) => item.target.certificateVersionImpact === 'missing_current').length,
        },
      } : {}),
    };
  }

  private async persistRunFromTargets(input: {
    tenantId: string;
    actorId: string;
    automation: AutomationEntity;
    version: AutomationVersionEntity;
    triggerType: AutomationRunDto['triggerType'];
    idempotencyKey: string;
    scheduledAt?: string;
    triggerContext?: AutomationTriggerContextDto;
    executionOptions?: AutomationRunExecutionOptionsDto;
    deliveryId?: string;
    items: AutomationPreviewTargetDto[];
  }): Promise<AutomationRunDto> {
    if (input.version.guardrails.requirePreview && input.items.length === 0) throw new Error('automation preview is required');
    const now = this.clock().toISOString();
    const limited = input.items.slice(0, input.version.guardrails.maxTargetsPerRun);
    const executableTargets = limited.filter((item) => item.executable);
    const excludedReasons: Record<string, number> = {};
    for (const item of limited.filter((candidate) => !candidate.executable && candidate.excludedReason)) {
      excludedReasons[item.excludedReason!] = (excludedReasons[item.excludedReason!] ?? 0) + 1;
    }
    const triggerContext = input.triggerContext
      ? {
        ...structuredClone(input.triggerContext),
        totalMatched: limited.length,
        executableCount: executableTargets.length,
        excludedCount: limited.length - executableTargets.length,
        excludedReasons,
      }
      : undefined;
    const targetSummary = {
      total: executableTargets.length,
      pending: executableTargets.length,
      running: 0,
      waitingApproval: 0,
      succeeded: 0,
      failed: 0,
      skipped: limited.length - executableTargets.length,
      cancelled: 0,
    };
    const run = {
      id: newId('arun'),
      tenantId: input.tenantId,
      automationId: input.automation.id,
      automationVersion: input.version.version,
      automationNameSnapshot: input.automation.name,
      triggerType: input.triggerType,
      scheduledAt: input.scheduledAt,
      idempotencyKey: input.idempotencyKey,
      triggerContext,
      executionOptions: input.executionOptions ? structuredClone(input.executionOptions) : undefined,
      deliveryId: input.deliveryId,
      status: 'queued' as const,
      targetSummary,
      actionTypes: input.version.actions.slice().sort((left, right) => left.position - right.position).map((action) => action.type),
      environmentSnapshots: [...new Set(executableTargets.map((item) => item.target.environment).filter((item): item is string => Boolean(item)))],
      createdBy: input.actorId,
      createdAt: now,
    };
    await this.repository.transaction(async (repository) => {
      await repository.createRun(run);
      await Promise.all(executableTargets.map((item, index) => repository.createRunTarget({
        id: newId('art'),
        tenantId: input.tenantId,
        runId: run.id,
        sequenceNo: index + 1,
        targetSnapshot: item.target,
        environmentSnapshot: item.target.environment,
        actionTypes: run.actionTypes,
        status: 'pending',
        notificationRequestIds: [],
        createdAt: now,
        updatedAt: now,
      })));
    });
    return run;
  }

  private enqueueRunTask(run: AutomationRunDto, actorId: string, triggerSource: string): void {
    enqueueTaskBestEffort(this.tasks, {
      tenantId: run.tenantId,
      taskType: 'AUTOMATION_RUN',
      requestedBy: actorId,
      triggerSource,
      idempotencyKey: `automation-run:${run.id}`,
      resourceSummary: buildAutomationTaskResourceSummary(run),
      payload: {
        runId: run.id,
        automationId: run.automationId,
        automationName: run.automationNameSnapshot,
      },
      resourceRefs: [{ resourceType: 'automationRun', resourceId: run.id }],
    });
  }
}
