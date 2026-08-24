import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type {
  CreateWorkflowTemplateInput,
  RenameWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  UpdateWorkflowTemplateVersionNoteInput,
  WorkflowAssertion,
  WorkflowCredentialBinding,
  WorkflowConnectionBinding,
  WorkflowDslV1,
  WorkflowExtractor,
  WorkflowHttpRequest,
  WorkflowMockStepOutput,
  WorkflowProgressReporter,
  WorkflowProgressStep,
  WorkflowRenderedStep,
  WorkflowExecutorDispatcher,
  WorkflowRunResult,
  WorkflowExecutionBranch,
  WorkflowOwnerType,
  WorkflowPluginSource,
  WorkflowRuntimeInput,
  WorkflowSingleStepRunResult,
  WorkflowStage,
  WorkflowStep,
  WorkflowSshConnection,
  WorkflowTransformStep,
  WorkflowStepRuntimeInput,
  WorkflowStepRunResult,
  WorkflowTemplate,
  WorkflowTemplateVersion,
} from '../dto/workflow-templates.dto.js';
import { normalizeExtractors, workflowTemplatesSchemaRegistry } from '../schema/workflow-templates.schema.js';
import type { ResolvedConnectionV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';

interface RuntimeContext {
  values: Record<string, unknown>;
  secretPaths: Set<string>;
  outputs: Record<string, unknown>;
  connections: Record<string, WorkflowSshConnection>;
  resolvedConnections: Record<string, ResolvedConnectionV1>;
}

const defaultTransformTimeoutMs = 200;
const defaultTransformMaxInputBytes = 256 * 1024;
const defaultTransformMaxOutputBytes = 256 * 1024;

export class WorkflowTemplatesDomainService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultTemplatesRepository(): AsyncRepositoryPort<WorkflowTemplate> {
    return new PgDocumentRepository<WorkflowTemplate>(WorkflowTemplatesDomainService.defaultDb, 'workflow.templates');
  }

  private static createDefaultVersionsRepository(): AsyncRepositoryPort<WorkflowTemplateVersion> {
    return new PgDocumentRepository<WorkflowTemplateVersion>(WorkflowTemplatesDomainService.defaultDb, 'workflow.template_versions');
  }

  private readonly templates = new Map<string, WorkflowTemplate>();
  private readonly versions = new Map<string, WorkflowTemplateVersion[]>();
  private readonly ready: Promise<void>;

  constructor(
    private readonly templatesRepository: AsyncRepositoryPort<WorkflowTemplate> = WorkflowTemplatesDomainService.createDefaultTemplatesRepository(),
    private readonly versionsRepository: AsyncRepositoryPort<WorkflowTemplateVersion> = WorkflowTemplatesDomainService.createDefaultVersionsRepository(),
  ) {
    this.ready = this.rehydrate();
  }

  async createTemplate(
    input: CreateWorkflowTemplateInput,
    origin: WorkflowTemplate['origin'] = 'user',
    ownership: { ownerType?: WorkflowOwnerType; ownerId?: string; tenantId?: string } = {},
  ): Promise<{ template: WorkflowTemplate; version: WorkflowTemplateVersion }> {
    await this.ready;
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    const now = new Date().toISOString();
    const normalizedOrigin = normalizeOrigin(origin);
    const ownerType = ownership.ownerType ?? (normalizedOrigin === 'plugin_internal' ? 'SYSTEM' : 'TENANT');
    const ownerId = ownership.ownerId ?? (ownerType === 'SYSTEM' ? 'SYSTEM' : undefined);
    const template: WorkflowTemplate = {
      id: `wftpl_${randomUUID()}`,
      name: content.metadata.name,
      origin: normalizedOrigin,
      ownerType,
      ...(ownerId ? { ownerId } : {}),
      ...(ownership.tenantId ? { tenantId: ownership.tenantId } : {}),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    const version = this.createVersion(
      template.id,
      1,
      content,
      'draft',
      input.changeSummary,
      input.pluginSource ?? input.provenance,
    );
    template.currentVersionId = version.id;
    this.templates.set(template.id, template);
    this.versions.set(template.id, [version]);
    await this.templatesRepository.upsert(template);
    await this.versionsRepository.upsert(version);
    return { template: { ...template }, version: clone(version) };
  }

  async renameTemplate(input: RenameWorkflowTemplateInput): Promise<WorkflowTemplate> {
    await this.ready;
    const template = await this.getTemplateOrThrow(input.templateId);
    assertUserEditable(template);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    const name = String(input.name ?? '').trim();
    if (!name) throw new AppError('VALIDATION_FAILED', '工作流名称不能为空', { field: 'name' });
    if (name === template.name) return this.withCurrentVersionSummary(template);
    template.name = name;
    template.updatedAt = new Date().toISOString();
    this.templates.set(template.id, template);
    await this.templatesRepository.upsert(template);
    return this.withCurrentVersionSummary(template);
  }

  async createDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const template = await this.getTemplateOrThrow(input.templateId);
    assertUserEditable(template);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    return await this.appendDraftVersion(template, content, input.changeSummary, { rejectDuplicateContent: true, enforcePluginVersionIncrement: true });
  }

  async createPluginInternalDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const template = await this.getTemplateOrThrow(input.templateId);
    if (template.origin !== 'plugin_internal') {
      throw new AppError('VALIDATION_FAILED', '仅插件内部工作流允许通过插件发布器追加版本');
    }
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    return this.appendDraftVersion(template, content, input.changeSummary, { rejectDuplicateContent: true, enforcePluginVersionIncrement: true });
  }

  async updateCurrentDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const template = await this.getTemplateOrThrow(input.templateId);
    assertUserEditable(template);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    const list = this.versions.get(template.id) ?? [];
    const version = this.findEditableDraftVersion(template, list);
    if (!version) throw new AppError('VALIDATION_FAILED', 'workflow template has no draft version');
    const hash = computeWorkflowContentHash(content);
    if (list.some((item) => item.id !== version.id && item.contentHash === hash)) throw new AppError('VALIDATION_FAILED', 'duplicate workflow version content');
    assertPluginVersionIncrement(version.content, content, hash !== version.contentHash);
    version.content = clone(content);
    version.contentHash = hash;
    version.changeSummary = input.changeSummary ?? version.changeSummary;
    template.currentVersionId = version.id;
    template.status = 'draft';
    template.updatedAt = new Date().toISOString();
    this.templates.set(template.id, template);
    await this.templatesRepository.upsert(template);
    await this.versionsRepository.upsert(version);
    return clone(version);
  }

  async publishVersion(versionId: string, allowInternal = false): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const { template, version } = await this.findVersion(versionId);
    if (!allowInternal) assertUserEditable(template);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    if (version.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'version is disabled');
    const list = this.versions.get(template.id) ?? [];
    version.status = 'published';
    template.status = this.deriveTemplateStatus(list);
    template.currentVersionId = version.id;
    template.updatedAt = new Date().toISOString();
    this.templates.set(template.id, template);
    await this.templatesRepository.upsert(template);
    await this.versionsRepository.upsert(version);
    return clone(version);
  }

  async updateVersionNote(input: UpdateWorkflowTemplateVersionNoteInput): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const { template, version } = await this.findVersion(input.versionId);
    assertUserEditable(template);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    if (version.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'version is disabled');
    const note = input.changeSummary?.trim();
    version.changeSummary = note || undefined;
    await this.versionsRepository.upsert(version);
    return clone(version);
  }

  async disableTemplate(templateId: string): Promise<WorkflowTemplate> {
    await this.ready;
    const template = await this.getTemplateOrThrow(templateId);
    assertUserEditable(template);
    template.status = 'disabled';
    template.updatedAt = new Date().toISOString();
    this.templates.set(template.id, template);
    await this.templatesRepository.upsert(template);
    for (const version of this.versions.get(templateId) ?? []) {
      version.status = 'disabled';
      await this.versionsRepository.upsert(version);
    }
    return { ...template };
  }

  async listTemplates(): Promise<WorkflowTemplate[]> {
    await this.ready;
    return [...this.templates.values()]
      .filter((item) => item.status !== 'disabled')
      .map((item) => this.withCurrentVersionSummary(item));
  }

  async listVersions(templateId: string): Promise<WorkflowTemplateVersion[]> {
    await this.ready;
    await this.getTemplateOrThrow(templateId);
    return (this.versions.get(templateId) ?? []).map(clone);
  }

  async getVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    await this.ready;
    return clone((await this.findVersion(versionId)).version);
  }

  async getRuntimePublishedVersion(templateId: string): Promise<WorkflowTemplateVersion | undefined> {
    await this.ready;
    const template = await this.getTemplateOrThrow(templateId);
    const list = this.versions.get(templateId) ?? [];
    const current = list.find((item) => item.id === template.currentVersionId && item.status === 'published');
    const published = current ?? [...list]
      .filter((item) => item.status === 'published')
      .sort((left, right) => right.version - left.version)[0];
    return published ? clone(published) : undefined;
  }

  async preview(input: WorkflowRuntimeInput, reporter?: WorkflowProgressReporter): Promise<WorkflowRunResult> {
    await this.ready;
    return this.executeRuntime({ ...input, mode: 'render_only' }, undefined, reporter);
  }

  async testRun(input: WorkflowRuntimeInput): Promise<WorkflowRunResult> {
    await this.ready;
    return this.executeRuntime(input);
  }

  async runWithDispatcher(input: WorkflowRuntimeInput, dispatcher: WorkflowExecutorDispatcher, reporter?: WorkflowProgressReporter): Promise<WorkflowRunResult> {
    await this.ready;
    return this.executeRuntime(input, dispatcher, reporter);
  }

  async testStep(input: WorkflowStepRuntimeInput): Promise<WorkflowSingleStepRunResult> {
    return await this.testStepWithDispatcher(input);
  }

  async testStepWithDispatcher(input: WorkflowStepRuntimeInput, dispatcher?: WorkflowExecutorDispatcher): Promise<WorkflowSingleStepRunResult> {
    await this.ready;
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    const step = content.steps.find((item) => item.name === input.stepName) ?? content.rollback?.find((item) => item.name === input.stepName);
    if (!step) throw new AppError('RESOURCE_NOT_FOUND', 'workflow step not found', { stepName: input.stepName });
    const context = buildRuntimeContextFromResolvedInput(input);
    const runId = `wfstep_${randomUUID()}`;
    const result = await this.runStep(step, context, { ...input, templateVersionId: 'single-step-preview' }, false, runId, dispatcher);
    return {
      id: runId,
      mode: input.mode,
      plannedOnly: input.mode === 'render_only',
      renderedStep: result.rendered,
      stepResult: result.result,
      stepOutput: result.output,
      logs: result.result.logs.map((line) => maskText(line, context.secretPaths, context.values)),
    };
  }

  private async executeRuntime(input: WorkflowRuntimeInput, dispatcher?: WorkflowExecutorDispatcher, reporter?: WorkflowProgressReporter): Promise<WorkflowRunResult> {
    const version = await this.getVersion(input.templateVersionId);
    const context = buildRuntimeContextFromResolvedInput(input);
    const runId = `wfrun_${randomUUID()}`;
    const executionBranch = input.executionBranch ?? 'deploy';
    const branchSteps = resolveExecutionBranch(version.content, executionBranch, input.executionBranch === undefined);
    const orderedSteps = orderStepsByStage(branchSteps);
    const renderedSteps: WorkflowRenderedStep[] = [];
    const stepResults: WorkflowStepRunResult[] = [];
    const rollbackResults: WorkflowStepRunResult[] = [];
    const logs: string[] = [];
    const progressSteps: WorkflowProgressStep[] = orderedSteps.map((step) => ({
      name: step.name,
      type: step.type,
      stage: step.stage,
      status: 'queued',
      attempts: 0,
      assertions: [],
      logs: [],
    }));
    let failed = false;

    await reportWorkflowProgress(reporter, runId, input, progressSteps, logs, 'running');

    for (const [stepIndex, step] of orderedSteps.entries()) {
      const startedAt = new Date().toISOString();
      progressSteps[stepIndex] = { ...progressSteps[stepIndex]!, status: 'running', startedAt, attempts: 1 };
      await reportWorkflowProgress(reporter, runId, input, progressSteps, logs, 'running', step.name);
      const result = await this.runStep(step, context, input, executionBranch === 'rollback', runId, dispatcher);
      const finishedAt = new Date().toISOString();
      result.result.startedAt = startedAt;
      result.result.finishedAt = finishedAt;
      renderedSteps.push(result.rendered);
      if (executionBranch === 'rollback') rollbackResults.push(result.result);
      else stepResults.push(result.result);
      logs.push(...result.result.logs);
      progressSteps[stepIndex] = {
        name: result.result.name,
        type: result.result.type,
        stage: result.result.stage,
        status: result.result.status,
        startedAt,
        finishedAt,
        attempts: result.result.attempts,
        errorCode: result.result.errorCode,
        errorMessage: result.result.errorMessage,
        assertions: result.result.assertions,
        logs: result.result.logs,
      };
      await reportWorkflowProgress(reporter, runId, input, progressSteps, logs, result.result.status === 'failed' ? 'failed' : 'running');
      if (result.result.status === 'failed') {
        failed = true;
        break;
      }
    }

    if (input.executionBranch === undefined && failed && version.content.rollback?.length) {
      logs.push('rollback:started');
      for (const step of version.content.rollback) {
        const result = await this.runStep(step, context, input, true, runId, dispatcher);
        rollbackResults.push(result.result);
        logs.push(...result.result.logs);
        if (result.result.status === 'failed') break;
      }
    }

    const rollbackSucceeded = rollbackResults.length > 0 && rollbackResults.every((result) => result.status !== 'failed');
    const status = failed ? (rollbackSucceeded ? 'rolled_back' : 'failed') : 'success';
    await reportWorkflowProgress(reporter, runId, input, progressSteps, logs, status);
    return {
      id: runId,
      mode: input.mode,
      executionBranch,
      plannedOnly: input.mode === 'render_only',
      status,
      renderedSteps,
      stepResults,
      rollbackResults,
      logs: logs.map((line) => maskText(line, context.secretPaths, context.values)),
    };
  }

  private async runStep(step: WorkflowStep, context: RuntimeContext, input: WorkflowRuntimeInput, rollback: boolean, runId: string, dispatcher?: WorkflowExecutorDispatcher, executionName = step.name): Promise<{ rendered: WorkflowRenderedStep; result: WorkflowStepRunResult; output: unknown }> {
    const type = step.type;
    if (!evaluateCondition(step.when, context.values)) {
      return {
        rendered: { name: step.name, type, stage: step.stage, skipped: true, reason: 'condition_not_matched', preview: { skipped: true } },
        result: emptyStepResult(step, 'skipped', { skipped: true }, ['step:skipped:condition']),
        output: { skipped: true, reason: 'condition_not_matched' },
      };
    }

    if (step.type === 'foreach') {
      return await this.runForeachStep(step, context, input, rollback, runId, dispatcher);
    }

    const attempts = (step.retry?.count ?? 0) + 1;
    let last: WorkflowStepRunResult | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const transformOutput = step.type === 'transform' && input.mode !== 'render_only'
        ? await executeTransformStep(step, context.values)
        : undefined;
      const mockOutput = transformOutput ?? input.mockResponses?.[step.name] ?? defaultMockOutput(step, rollback, attempt);
      const preOutput = normalizeStepOutput(step, mockOutput);
      const plan = adaptStep(step, context, input.mode, preOutput);
      if (
        step.type === 'checkpoint'
        && step.checkpoint.requiredForRollback
        && isRecord(plan)
        && isRecord(plan.capture)
        && typeof plan.captureHash === 'string'
      ) {
        const variables = isRecord(context.values.variables) ? context.values.variables : {};
        // 受保护的 checkpoint 是同一 WorkflowVersion 回滚分支的输入快照来源。
        variables.recoverySnapshot = plan.capture;
        variables.recoverySnapshotHash = plan.captureHash;
        context.values.variables = variables;
      }
      const dispatchOutput = dispatcher && input.mode !== 'render_only' && step.type !== 'transform'
        ? await dispatcher({ runId, step: executionName === step.name ? step : { ...step, name: executionName }, renderedPlan: plan, attempt, rollback })
        : undefined;
      const structuredOutput = normalizeStepOutput(step, dispatchOutput ?? mockOutput);
      const dispatchSucceeded = dispatchOutput ? dispatchOutput.success : true;
      const extracted = input.mode === 'render_only' || !dispatchSucceeded
        ? {}
        : step.type === 'transform'
          ? readTransformOutputs(step, structuredOutput, context)
          : runExtractors(step, structuredOutput, context);
      const localValues = withCurrentStepValues(context.values, step.name, extracted);
      const finalPlan = extracted && Object.keys(extracted).length > 0
        ? adaptStep(step, { ...context, values: localValues }, input.mode, structuredOutput)
        : plan;
      const assertions = input.mode === 'render_only' || !dispatchSucceeded ? [] : evaluateAssertions(step.assert ?? [], structuredOutput, localValues);
      const success = input.mode === 'render_only' || dispatchSucceeded && assertions.every((item) => item.passed) && stepOutputSuccess(step, structuredOutput, localValues);
      const rawLogs = [
        `step:${step.name}:attempt:${attempt}:status:${success ? 'success' : 'failed'}`,
        ...(dispatchOutput?.logs ?? []),
        ...assertions
          .filter((item) => !item.passed)
          .map((item) => `assertion:${item.type}:failed:${item.message}`),
      ];
      last = {
        name: step.name,
        type,
        stage: step.stage,
        status: success ? 'success' : 'failed',
        ...(success || !dispatchOutput?.errorCode ? {} : { errorCode: dispatchOutput.errorCode }),
        ...(success || !dispatchOutput?.errorMessage ? {} : { errorMessage: dispatchOutput.errorMessage }),
        attempts: attempt,
        plan: maskUnknown(finalPlan, context.secretPaths, localValues),
        extracted: maskUnknown(extracted, context.secretPaths, localValues) as Record<string, unknown>,
        assertions,
        logs: rawLogs.map((line) => maskText(line, context.secretPaths, localValues)),
      };
      if (success || attempt === attempts) {
        for (const [key, value] of Object.entries(extracted)) context.outputs[`${step.name}.${key}`] = value;
        const snapshot = stepSnapshot(step, last, structuredOutput, extracted);
        context.values.steps = { ...(context.values.steps as Record<string, unknown>), [step.name]: snapshot };
        return {
          rendered: { name: step.name, type, stage: step.stage, request: maskUnknown(finalPlan, context.secretPaths, context.values), preview: maskUnknown(finalPlan, context.secretPaths, context.values) },
          result: last,
          output: maskUnknown(structuredOutput, context.secretPaths, context.values),
        };
      }
    }
    throw new AppError('SYSTEM_INTERNAL_ERROR', 'retry execution failed unexpectedly');
  }

  async createDraftFromPluginCapability(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const template = await this.getTemplateOrThrow(input.templateId);
    assertUserEditable(template);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    return this.appendDraftVersion(template, content, input.changeSummary, {
      rejectDuplicateContent: false,
      enforcePluginVersionIncrement: false,
      pluginSource: input.pluginSource,
    });
  }

  private async runForeachStep(
    step: Extract<WorkflowStep, { type: 'foreach' }>,
    context: RuntimeContext,
    input: WorkflowRuntimeInput,
    rollback: boolean,
    runId: string,
    dispatcher?: WorkflowExecutorDispatcher,
  ): Promise<{ rendered: WorkflowRenderedStep; result: WorkflowStepRunResult; output: unknown }> {
    const items = readPath(context.values, step.foreach.itemsPath);
    if (input.mode === 'render_only' && items === undefined && isDeferredRuntimePath(step.foreach.itemsPath, context.values)) {
      return renderDeferredForeachStep(step, context);
    }
    if (!Array.isArray(items)) {
      throw new AppError('VALIDATION_FAILED', `foreach.itemsPath 必须指向数组：${step.name} -> ${step.foreach.itemsPath}`, {
        step: step.name,
        itemsPath: step.foreach.itemsPath,
      });
    }

    const maxItems = step.foreach.maxItems ?? 100;
    if (items.length > maxItems) {
      throw new AppError('VALIDATION_FAILED', 'foreach 集合超过允许上限', {
        step: step.name,
        count: items.length,
        maxItems,
      });
    }

    const previousItem = context.values[step.foreach.itemVariable];
    const hadPreviousItem = Object.prototype.hasOwnProperty.call(context.values, step.foreach.itemVariable);
    const previousIndex = step.foreach.indexVariable ? context.values[step.foreach.indexVariable] : undefined;
    const hadPreviousIndex = step.foreach.indexVariable
      ? Object.prototype.hasOwnProperty.call(context.values, step.foreach.indexVariable)
      : false;
    const iterations: Array<{
      index: number;
      status: WorkflowStepRunResult['status'];
      steps: WorkflowStepRunResult[];
      outputs: Array<{ name: string; output: unknown; extracted: Record<string, unknown> }>;
    }> = [];
    const logs: string[] = [];
    let failedResult: WorkflowStepRunResult | undefined;

    try {
      for (const [index, item] of items.entries()) {
        context.values[step.foreach.itemVariable] = item;
        if (step.foreach.indexVariable) context.values[step.foreach.indexVariable] = index;

        const childResults: WorkflowStepRunResult[] = [];
        const childOutputs: Array<{ name: string; output: unknown; extracted: Record<string, unknown> }> = [];
        for (const childStep of step.foreach.steps) {
          const child = await this.runStep(childStep, context, input, rollback, runId, dispatcher, `${step.name}[${index}].${childStep.name}`);
          childResults.push(child.result);
          childOutputs.push({ name: childStep.name, output: child.output, extracted: child.result.extracted });
          logs.push(...child.result.logs.map((line) => `foreach:${step.name}:index:${index}:${line}`));
          if (child.result.status === 'failed') {
            failedResult = child.result;
            break;
          }
        }

        iterations.push({
          index,
          status: failedResult ? 'failed' : childResults.every((result) => result.status === 'skipped') ? 'skipped' : 'success',
          steps: childResults,
          outputs: childOutputs,
        });
        if (failedResult && !step.foreach.continueOnError) break;
        if (step.foreach.continueOnError) failedResult = undefined;
      }
    } finally {
      restoreContextValue(context.values, step.foreach.itemVariable, previousItem, hadPreviousItem);
      if (step.foreach.indexVariable) {
        restoreContextValue(context.values, step.foreach.indexVariable, previousIndex, hadPreviousIndex);
      }
    }

    const success = !failedResult;
    const plan = adaptStep(step, context, input.mode);
    const output = { count: items.length, completed: iterations.length, iterations };
    const result: WorkflowStepRunResult = {
      name: step.name,
      type: step.type,
      stage: step.stage,
      status: success ? 'success' : 'failed',
      ...(failedResult?.errorCode ? { errorCode: failedResult.errorCode } : {}),
      ...(failedResult?.errorMessage ? { errorMessage: failedResult.errorMessage } : {}),
      attempts: 1,
      plan: maskUnknown(plan, context.secretPaths, context.values),
      extracted: {},
      assertions: [],
      logs: [
        `foreach:${step.name}:count:${items.length}:completed:${iterations.length}:status:${success ? 'success' : 'failed'}`,
        ...logs,
      ].map((line) => maskText(line, context.secretPaths, context.values)),
      children: iterations.flatMap((iteration) => iteration.steps.map((child) => ({
        ...child,
        name: `${step.name}[${iteration.index}].${child.name}`,
      }))),
    };
    const snapshot = stepSnapshot(step, result, output, {});
    context.values.steps = { ...(context.values.steps as Record<string, unknown>), [step.name]: snapshot };

    return {
      rendered: {
        name: step.name,
        type: step.type,
        stage: step.stage,
        request: maskUnknown(plan, context.secretPaths, context.values),
        preview: maskUnknown(plan, context.secretPaths, context.values),
      },
      result,
      output: maskUnknown(output, context.secretPaths, context.values),
    };
  }

  private async getTemplateOrThrow(templateId: string): Promise<WorkflowTemplate> {
    const template = this.templates.get(templateId);
    if (!template) throw new AppError('RESOURCE_NOT_FOUND', 'workflow template not found', { templateId });
    return template;
  }

  private async findVersion(versionId: string): Promise<{ template: WorkflowTemplate; version: WorkflowTemplateVersion }> {
    for (const [templateId, list] of this.versions.entries()) {
      const version = list.find((item) => item.id === versionId);
      if (version) return { template: await this.getTemplateOrThrow(templateId), version };
    }
    throw new AppError('RESOURCE_NOT_FOUND', 'workflow template version not found', { versionId });
  }

  private withCurrentVersionSummary(template: WorkflowTemplate): WorkflowTemplate {
    const list = this.versions.get(template.id) ?? [];
    const current = list.find((item) => item.id === template.currentVersionId);
    return {
      ...template,
      status: template.status === 'disabled' ? 'disabled' : this.deriveTemplateStatus(list),
      currentVersion: current?.version,
      currentVersionLabel: current ? `V${current.version}` : undefined,
    };
  }

  private deriveTemplateStatus(list: readonly WorkflowTemplateVersion[]): WorkflowTemplate['status'] {
    const enabled = list.filter((item) => item.status !== 'disabled');
    if (enabled.some((item) => item.status === 'draft')) return 'draft';
    return enabled.length > 0 ? 'published' : 'draft';
  }

  private findEditableDraftVersion(template: WorkflowTemplate, list: readonly WorkflowTemplateVersion[]): WorkflowTemplateVersion | undefined {
    const current = list.find((item) => item.id === template.currentVersionId && item.status === 'draft');
    return current ?? [...list]
      .filter((item) => item.status === 'draft')
      .sort((left, right) => right.version - left.version)[0];
  }

  private async appendDraftVersion(
    template: WorkflowTemplate,
    content: WorkflowDslV1,
    changeSummary: string | undefined,
    options: { rejectDuplicateContent: boolean; enforcePluginVersionIncrement: boolean; pluginSource?: WorkflowPluginSource },
  ): Promise<WorkflowTemplateVersion> {
    const list = this.versions.get(template.id) ?? [];
    const hash = computeWorkflowContentHash(content);
    if (options.rejectDuplicateContent && list.some((item) => item.contentHash === hash)) throw new AppError('VALIDATION_FAILED', 'duplicate workflow version content');
    const previous = [...list].sort((left, right) => right.version - left.version)[0];
    if (previous && options.enforcePluginVersionIncrement) assertPluginVersionIncrement(previous.content, content, hash !== previous.contentHash);
    const versionNumber = list.reduce((max, item) => Math.max(max, item.version), 0) + 1;
    const version = this.createVersion(template.id, versionNumber, content, 'draft', changeSummary, options.pluginSource);
    this.versions.set(template.id, [...list, version]);
    template.currentVersionId = version.id;
    template.status = 'draft';
    template.updatedAt = new Date().toISOString();
    this.templates.set(template.id, template);
    await this.templatesRepository.upsert(template);
    await this.versionsRepository.upsert(version);
    return clone(version);
  }

  private createVersion(
    templateId: string,
    versionNumber: number,
    content: WorkflowDslV1,
    status: WorkflowTemplateVersion['status'],
    changeSummary?: string,
    pluginSource?: WorkflowPluginSource,
  ): WorkflowTemplateVersion {
    return {
      id: `wftplv_${randomUUID()}`,
      templateId,
      version: versionNumber,
      dslVersion: 'v1',
      content: clone(content),
      contentHash: computeWorkflowContentHash(content),
      status,
      changeSummary,
      ...(pluginSource ? { pluginSource: clone(pluginSource) } : {}),
      createdAt: new Date().toISOString(),
    };
  }

  private async rehydrate(): Promise<void> {
    const templates = await this.templatesRepository.list();
    const versions = await this.versionsRepository.list();
    this.templates.clear();
    this.versions.clear();
    for (const template of templates) {
      const normalized = normalizeTemplate(template);
      this.templates.set(normalized.id, normalized);
    }
    const byTemplate = new Map<string, WorkflowTemplateVersion[]>();
    for (const version of versions) {
      const list = byTemplate.get(version.templateId) ?? [];
      list.push(version);
      byTemplate.set(version.templateId, list);
    }
    for (const [templateId, list] of byTemplate.entries()) {
      list.sort((a, b) => a.version - b.version);
      const template = this.templates.get(templateId);
      if (template?.provenance && !list.some((version) => version.pluginSource)) {
        const current = list.find((version) => version.id === template.currentVersionId) ?? list[list.length - 1];
        if (current) current.pluginSource = normalizePluginSource(template.provenance);
        delete template.provenance;
        await this.templatesRepository.upsert(template);
        if (current) await this.versionsRepository.upsert(current);
      }
      this.versions.set(templateId, list.map((version) => normalizeVersion(version)));
    }
  }
}

async function reportWorkflowProgress(
  reporter: WorkflowProgressReporter | undefined,
  runId: string,
  input: WorkflowRuntimeInput,
  steps: WorkflowProgressStep[],
  logs: string[],
  status: 'running' | 'success' | 'failed' | 'rolled_back',
  activeStep?: string,
): Promise<void> {
  if (!reporter) return;
  await reporter({
    id: runId,
    mode: input.mode,
    status,
    totalSteps: steps.length,
    completedSteps: steps.filter((step) => ['success', 'failed', 'skipped'].includes(step.status)).length,
    ...(activeStep ? { activeStep } : {}),
    steps: clone(steps),
    logs: [...logs],
    updatedAt: new Date().toISOString(),
  });
}

function buildRuntimeContextFromResolvedInput(input: WorkflowRuntimeInput | WorkflowStepRuntimeInput): RuntimeContext {
  if (!input.resolvedInput.executable) {
    throw new AppError('VALIDATION_FAILED', '统一部署输入未通过执行前校验', { issues: input.resolvedInput.issues });
  }
  const values: Record<string, unknown> = {
    variables: input.resolvedInput.variables,
    connections: input.resolvedInput.connections,
    credentials: input.resolvedInput.credentials,
    artifacts: input.resolvedInput.artifacts,
    asset: input.resolvedInput.assetContext,
    steps: { ...(input.stepOutputs ?? {}) },
    system: { ...(input.systemValues ?? {}) },
  };
  return {
    values,
    secretPaths: new Set(input.resolvedInput.sensitivePaths),
    outputs: {},
    connections: resolveRuntimeConnections(input.resolvedInput),
    resolvedConnections: input.resolvedInput.connections,
  };
}

function withCurrentStepValues(values: Record<string, unknown>, stepName: string, extracted: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(extracted).length === 0) return values;
  return {
    ...values,
    steps: {
      ...(values.steps as Record<string, unknown>),
      [stepName]: { extracted },
    },
  };
}

function resolveRuntimeConnections(
  input: WorkflowRuntimeInput['resolvedInput'],
): Record<string, WorkflowSshConnection> {
  return Object.fromEntries(Object.entries(input.connections).flatMap(([name, resolved]) => {
    if (resolved.transport !== 'ssh') return [];
    const credential = resolved.credentialSlot ? input.credentials[resolved.credentialSlot] : undefined;
    if (!resolved.host || !resolved.username || !isCredentialBinding(credential)) {
      throw new AppError('VALIDATION_FAILED', '统一 SSH Connection 快照不完整', { connectionRef: name });
    }
    return [[name, {
      host: resolved.host,
      port: resolved.port,
      username: resolved.username,
      credential,
      hostKeyPolicy: resolved.hostKey?.policy,
      expectedHostKeyFingerprint: resolved.hostKey?.expectedFingerprint,
    } satisfies WorkflowSshConnection]];
  }));
}

function collectValuePaths(path: string, value: unknown, paths: Set<string>): void {
  paths.add(path);
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) collectValuePaths(`${path}.${key}`, child, paths);
  }
}

function isDeferredRuntimePath(path: string, values: Record<string, unknown>): boolean {
  const match = path.match(/^steps\.([A-Za-z][A-Za-z0-9_-]*)\.(?:output|extracted)(?:\.|$)/);
  return Boolean(match && readPath(values, `steps.${match[1]}`) !== undefined);
}

function renderDeferredForeachStep(
  step: Extract<WorkflowStep, { type: 'foreach' }>,
  context: RuntimeContext,
): { rendered: WorkflowRenderedStep; result: WorkflowStepRunResult; output: unknown } {
  const plan = adaptStep(step, context, 'render_only');
  const output = { deferred: true, itemsPath: step.foreach.itemsPath };
  const maskedPlan = maskUnknown(plan, context.secretPaths, context.values);
  const result: WorkflowStepRunResult = {
    name: step.name,
    type: step.type,
    stage: step.stage,
    status: 'success',
    attempts: 1,
    plan: maskedPlan,
    extracted: {},
    assertions: [],
    logs: [`foreach:${step.name}:deferred:${step.foreach.itemsPath}:status:success`],
    children: [],
  };
  context.values.steps = {
    ...(context.values.steps as Record<string, unknown>),
    [step.name]: stepSnapshot(step, result, output, {}),
  };
  return {
    rendered: { name: step.name, type: step.type, stage: step.stage, request: maskedPlan, preview: maskedPlan },
    result,
    output,
  };
}

function adaptStep(step: WorkflowStep, context: RuntimeContext, mode: WorkflowRuntimeInput['mode'], output?: WorkflowMockStepOutput): unknown {
  if (step.type === 'http') {
    const httpConnection = resolveHttpConnection(step.request.connectionRef, context);
    const renderedHeaders = renderUnknown(step.request.headers ?? {}, context.values, mode === 'render_only') as Record<string, string>;
    const promotedHeaders = promoteSecretHeaders(renderedHeaders, step.request.headerRefs);
    const curlRequest = {
      idempotencyKey: `workflow:${step.name}`,
      dryRun: mode !== 'real_test',
      template: {
        method: step.request.method,
        url: renderString(step.request.url, context.values, mode === 'render_only'),
        query: renderUnknown(step.request.query, context.values, mode === 'render_only'),
        headers: promotedHeaders.headers,
        headerRefs: renderUnknown(promotedHeaders.headerRefs, context.values, mode === 'render_only'),
        bodyType: step.request.bodyType,
        body: renderUnknown(step.request.body, context.values, mode === 'render_only'),
        form: renderUnknown(step.request.form, context.values, mode === 'render_only'),
        formSecretRefs: adaptFormCredentialRefs(step.request.formCredentialRefs, context.values, mode === 'render_only'),
        multipart: renderUnknown(step.request.multipart, context.values, mode === 'render_only'),
        auth: adaptHttpAuth(step.request.auth, context.values, mode === 'render_only'),
        tls: adaptHttpTls(step.request.tls ?? (httpConnection?.tls ? { verify: httpConnection.tls.verifyPeer, sni: httpConnection.tls.serverName } : undefined), context.values, mode === 'render_only'),
        timeoutMs: (step.request.timeoutSeconds ?? 30) * 1000,
        maxResponseBytes: step.request.maxResponseBytes,
      },
      responsePolicy: {
        successStatusCodes: step.request.successStatusCodes,
        failOnNon2xx: step.request.failOnNon2xx,
        assertions: adaptHttpResponseAssertions(step.assert ?? [], context.values, mode === 'render_only'),
      },
      extractors: normalizeExtractors(step.extract).flatMap((extractor) => {
        if (extractor.type === 'statusCode') return { name: extractor.name, source: 'status', required: !extractor.optional, secret: extractor.sensitive };
        if (extractor.type === 'header') return { name: extractor.name, source: 'header', header: extractor.header, required: !extractor.optional, secret: extractor.sensitive };
        if (extractor.type === 'regex') return { name: extractor.name, source: 'body', pattern: extractor.pattern, required: !extractor.optional, secret: extractor.sensitive };
        if (extractor.type === 'jsonPath') return { name: extractor.name, source: 'json', path: extractor.path, required: !extractor.optional, secret: extractor.sensitive };
        return [];
      }),
      retryPolicy: {
        maxAttempts: (step.retry?.count ?? 0) + 1,
        intervalMs: (step.retry?.intervalSeconds ?? 0) * 1000,
        retryOnStatus: step.retry?.retryOnStatus,
        retryOnNetworkError: step.retry?.retryOnNetworkError,
      },
      mockResponse: mode === 'mock' ? output : undefined,
    };
    return {
      executor: '017.CURL_HTTP',
      dryRun: mode !== 'real_test',
      realNetwork: mode === 'real_test',
      idempotencyKey: curlRequest.idempotencyKey,
      curlRequest,
      mode,
    };
  }
  if (step.type === 'ssh') {
    const command = step.ssh.mode === 'interactive'
      ? step.ssh.dialogue?.map((item) => renderString(item.send, context.values, mode === 'render_only')).join('\n')
      : renderString(buildSshCommandText(step), context.values, mode === 'render_only');
    return {
      executor: '015.SSH',
      dryRun: mode !== 'real_test',
      realSsh: mode === 'real_test',
      idempotencyKey: `workflow:${step.name}`,
      stage: step.stage,
      connection: adaptSshConnection(resolveStepConnection(step.ssh.connectionRef, context), context.values, mode === 'render_only'),
      command,
      commands: step.ssh.commands?.map((item) => renderString(item, context.values, mode === 'render_only')),
      mode: step.ssh.mode,
      timeoutMs: (step.ssh.timeoutSeconds ?? 60) * 1000,
      testMode: mode,
    };
  }
  if (step.type === 'sftp' || step.type === 'scp') {
    const transferStep = buildFileTransferStepPlan(step, context, mode === 'render_only');
    return {
      executor: '015.SSH',
      dryRun: mode !== 'real_test',
      realSsh: mode === 'real_test',
      idempotencyKey: `workflow:${step.name}`,
      stage: step.stage,
      protocol: step.type,
      connection: transferStep.connection,
      timeoutMs: transferStep.timeoutMs,
      sshRequest: transferStep.sshRequest,
      testMode: mode,
    };
  }
  if (step.type === 'condition') {
    const passed = evaluateCondition(step.condition, context.values);
    return {
      executor: 'workflow.condition',
      condition: step.condition,
      description: step.description,
      passed,
      mode,
    };
  }
  if (step.type === 'transform') {
    return {
      executor: 'workflow.transform',
      engine: step.transform.engine,
      outputNames: Object.keys(step.transform.outputs),
      timeoutMs: step.transform.timeoutMs ?? defaultTransformTimeoutMs,
      maxInputBytes: step.transform.maxInputBytes ?? defaultTransformMaxInputBytes,
      maxOutputBytes: step.transform.maxOutputBytes ?? defaultTransformMaxOutputBytes,
      plannedOnly: mode === 'render_only',
    };
  }
  if (step.type === 'foreach') {
    const items = readPath(context.values, step.foreach.itemsPath);
    return {
      executor: 'workflow.foreach',
      itemsPath: step.foreach.itemsPath,
      itemVariable: step.foreach.itemVariable,
      indexVariable: step.foreach.indexVariable,
      maxItems: step.foreach.maxItems ?? 100,
      continueOnError: step.foreach.continueOnError === true,
      itemCount: Array.isArray(items) ? items.length : undefined,
      steps: step.foreach.steps.map((child) => ({ name: child.name, type: child.type, stage: child.stage })),
      plannedOnly: mode === 'render_only',
    };
  }
  if (step.type === 'checkpoint') {
    const captureEntries: Array<[string, unknown]> = [];
    const deferredCapturePaths: Record<string, string> = {};
    for (const [name, path] of Object.entries(step.checkpoint.capture)) {
      if (isSecretCapturePath(path, context.secretPaths)) {
        throw new AppError('VALIDATION_FAILED', 'checkpoint 不允许捕获敏感变量', { step: step.name, name, path });
      }
      const value = readPath(context.values, path);
      if (value === undefined && mode === 'render_only' && isDeferredRuntimePath(path, context.values)) {
        deferredCapturePaths[name] = path;
        continue;
      }
      if (value === undefined) throw new AppError('VALIDATION_FAILED', 'checkpoint 捕获路径不存在', { step: step.name, name, path });
      assertCheckpointValueSafe(value, `${step.name}.${name}`);
      captureEntries.push([name, value]);
    }
    if (Object.keys(deferredCapturePaths).length > 0) {
      return {
        executor: 'workflow.checkpoint',
        checkpointName: step.checkpoint.name,
        capturePaths: step.checkpoint.capture,
        deferredCapturePaths,
        normalizedHash: step.checkpoint.normalizedHash !== false,
        requiredForRollback: step.checkpoint.requiredForRollback,
        deferred: true,
        plannedOnly: true,
      };
    }
    const capture = Object.fromEntries(captureEntries);
    const normalized = stableStringify(capture);
    return {
      executor: 'workflow.checkpoint',
      checkpointName: step.checkpoint.name,
      capture,
      captureHash: createHash('sha256').update(normalized).digest('hex'),
      normalizedHash: step.checkpoint.normalizedHash !== false,
      requiredForRollback: step.checkpoint.requiredForRollback,
      plannedOnly: mode === 'render_only',
    };
  }
  if (step.type === 'checkpoint_verify') {
    const value = readPath(context.values, step.checkpointVerify.valuePath);
    if (value === undefined && mode === 'render_only' && isDeferredRuntimePath(step.checkpointVerify.valuePath, context.values)) {
      return {
        executor: 'workflow.checkpoint_verify',
        valuePath: step.checkpointVerify.valuePath,
        expectedHash: renderString(step.checkpointVerify.expectedHash, context.values, true),
        deferred: true,
        plannedOnly: true,
      };
    }
    if (value === undefined) throw new AppError('VALIDATION_FAILED', 'checkpoint_verify 路径不存在', { step: step.name, valuePath: step.checkpointVerify.valuePath });
    assertCheckpointValueSafe(value, step.checkpointVerify.valuePath);
    const actualHash = createHash('sha256').update(stableStringify(value)).digest('hex');
    const expectedHash = renderString(step.checkpointVerify.expectedHash, context.values, mode === 'render_only').toLowerCase();
    return {
      executor: 'workflow.checkpoint_verify',
      valuePath: step.checkpointVerify.valuePath,
      expectedHash,
      actualHash,
      matched: actualHash === expectedHash,
      plannedOnly: mode === 'render_only',
    };
  }
  if (step.type === 'wait') return { executor: 'workflow.wait', seconds: step.seconds, plannedOnly: true };
  return { executor: 'workflow.manual', instruction: renderString(step.instruction, context.values, mode === 'render_only'), plannedOnly: true };
}

function promoteSecretHeaders(
  headers: Record<string, string>,
  declaredRefs: Record<string, string> | undefined,
): { headers: Record<string, string>; headerRefs: Record<string, string> | undefined } {
  const plainHeaders: Record<string, string> = {};
  const headerRefs: Record<string, string> = { ...(declaredRefs ?? {}) };
  for (const [name, value] of Object.entries(headers)) {
    if (/^secret:\/\/[a-zA-Z0-9/_#.-]+$/.test(value)) headerRefs[name] = value;
    else plainHeaders[name] = value;
  }
  return { headers: plainHeaders, headerRefs: Object.keys(headerRefs).length > 0 ? headerRefs : undefined };
}

function adaptHttpTls(
  tls: WorkflowHttpRequest['tls'],
  values: Record<string, unknown>,
  keepMissing: boolean,
): WorkflowHttpRequest['tls'] {
  if (!tls) return undefined;
  return {
    ...tls,
    verify: renderBoolean(tls.verify, values, keepMissing),
    sni: tls.sni ? renderString(tls.sni, values, keepMissing) : undefined,
  };
}

function renderBoolean(value: boolean | string | undefined, variables: Record<string, unknown>, keepMissing: boolean): boolean | string | undefined {
  if (typeof value !== 'string') return value;
  const match = value.match(/^\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}$/);
  if (!match) throw new AppError('VALIDATION_FAILED', '布尔变量表达式无效', { value });
  const resolved = readPath(variables, match[1]!);
  if (resolved === undefined && keepMissing && isDeferredPreviewReference(match[1]!)) return value;
  if (typeof resolved !== 'boolean') throw new AppError('VALIDATION_FAILED', 'TLS verify 变量必须是布尔值', { key: match[1] });
  return resolved;
}

function adaptHttpResponseAssertions(assertions: WorkflowAssertion[], values: Record<string, unknown>, keepMissing: boolean): Array<
  | { type: 'status'; equals: number }
  | { type: 'header_exists'; name: string }
  | { type: 'body_contains'; text: string }
> {
  const adapted: Array<
    | { type: 'status'; equals: number }
    | { type: 'header_exists'; name: string }
    | { type: 'body_contains'; text: string }
  > = [];
  for (const assertion of assertions) {
    if (assertion.type === 'statusCode') adapted.push({ type: 'status', equals: assertion.equals });
    if (assertion.type === 'contains') adapted.push({ type: 'body_contains', text: renderString(assertion.value, values, keepMissing) });
    if (assertion.type === 'header' && assertion.exists === true && assertion.equals === undefined) {
      adapted.push({ type: 'header_exists', name: assertion.name });
    }
  }
  return adapted;
}

function runExtractors(step: WorkflowStep, output: WorkflowMockStepOutput, context: RuntimeContext): Record<string, unknown> {
  const extracted: Record<string, unknown> = {};
  for (const extractor of normalizeExtractors(step.extract)) {
    let value: unknown;
    if (extractor.type === 'statusCode') value = output.statusCode;
    if (extractor.type === 'header') value = output.headers?.[extractor.header ?? ''];
    if (extractor.type === 'jsonPath') value = readJsonPath(output.body, extractor.path ?? '');
    if (extractor.type === 'outputPath') value = readJsonPath(output, extractor.path ?? '');
    if (extractor.type === 'firstOf') value = readFirstAvailablePath(output, extractor.paths ?? []);
    if (extractor.type === 'regex') value = String(output.stdout ?? output.body ?? '').match(new RegExp(extractor.pattern ?? ''))?.[1];
    if (extractor.type === 'textContains') value = String(output.stdout ?? output.body ?? '').includes(extractor.value ?? '');
    if ((value === undefined || value === null) && !extractor.optional) throw buildWorkflowExtractorError(step, extractor, output);
    if (value !== undefined && value !== null) {
      extracted[extractor.name] = value;
      if (extractor.sensitive) collectValuePaths(`steps.${step.name}.extracted.${extractor.name}`, value, context.secretPaths);
    }
  }
  return extracted;
}

function buildWorkflowExtractorError(step: WorkflowStep, extractor: WorkflowExtractor, output: WorkflowMockStepOutput): AppError {
  const detail = {
    step: step.name,
    stepType: step.type,
    extractor: extractor.name,
    extractorType: extractor.type,
    ...extractorRuleDetail(extractor),
    outputStatusCode: output.statusCode,
    outputExitCode: output.exitCode,
    outputHeaderNames: Object.keys(output.headers ?? {}),
    outputBodyShape: summarizeValueShape(output.body),
    stdoutLength: String(output.stdout ?? '').length,
  };
  return new AppError(
    'WORKFLOW_ASSERTION_FAILED',
    `提取变量失败：step=${step.name}，extractor=${extractor.name}，type=${extractor.type}${describeWorkflowExtractorRule(extractor)}`,
    detail,
  );
}

function extractorRuleDetail(extractor: WorkflowExtractor): Record<string, unknown> {
  if (extractor.type === 'jsonPath' || extractor.type === 'outputPath') return { path: extractor.path };
  if (extractor.type === 'firstOf') return { paths: extractor.paths };
  if (extractor.type === 'header') return { header: extractor.header };
  if (extractor.type === 'regex') return { pattern: extractor.pattern };
  if (extractor.type === 'textContains') return { value: extractor.value };
  return {};
}

function describeWorkflowExtractorRule(extractor: WorkflowExtractor): string {
  if (extractor.type === 'jsonPath' || extractor.type === 'outputPath') return extractor.path ? `，path=${extractor.path}` : '';
  if (extractor.type === 'firstOf') return extractor.paths?.length ? `，paths=${extractor.paths.join('|')}` : '';
  if (extractor.type === 'header') return extractor.header ? `，header=${extractor.header}` : '';
  if (extractor.type === 'regex') return extractor.pattern ? `，pattern=${extractor.pattern}` : '';
  if (extractor.type === 'textContains') return extractor.value ? `，value=${extractor.value}` : '';
  return '';
}

async function executeTransformStep(step: WorkflowTransformStep, values: Record<string, unknown>): Promise<WorkflowMockStepOutput> {
  const input = renderTransformInput(step.transform.input ?? {}, values);
  assertJsonByteSize(input, step.transform.maxInputBytes ?? defaultTransformMaxInputBytes, 'transform input');
  const outputValues: Record<string, unknown> = {};
  for (const [name, config] of Object.entries(step.transform.outputs)) {
    assertJsonataExpressionSafe(config.expression);
    const scope = { ...asRecord(input), ...outputValues };
    const raw = await evaluateJsonata(config.expression, scope, step.transform.timeoutMs ?? defaultTransformTimeoutMs, {
      step: step.name,
      output: name,
    });
    if ((raw === undefined || raw === null) && !config.optional) {
      throw new AppError('WORKFLOW_ASSERTION_FAILED', '转换输出为空', { step: step.name, output: name });
    }
    const value = config.format === 'jsonString' ? JSON.stringify(raw ?? null) : raw;
    assertJsonByteSize(value, step.transform.maxOutputBytes ?? defaultTransformMaxOutputBytes, `transform output ${name}`);
    outputValues[name] = value;
  }
  return { statusCode: 200, body: { success: true, outputs: outputValues } };
}

function readTransformOutputs(step: WorkflowTransformStep, output: WorkflowMockStepOutput, context: RuntimeContext): Record<string, unknown> {
  const outputs = readPath(output.body, 'outputs');
  if (!isRecord(outputs)) throw new AppError('WORKFLOW_ASSERTION_FAILED', '转换节点没有输出对象', { step: step.name });
  for (const [name, config] of Object.entries(step.transform.outputs)) {
    if (config.sensitive && outputs[name] !== undefined) collectValuePaths(name, outputs[name], context.secretPaths);
  }
  return outputs;
}

async function evaluateJsonata(
  expression: string,
  input: Record<string, unknown>,
  timeoutMs: number,
  location?: { step: string; output: string },
): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    const worker = createJsonataWorker({ expression, input });
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new AppError('EXECUTION_TIMEOUT', 'JSONata 转换执行超时', { timeoutMs })));
    }, timeoutMs);
    timeout.unref();
    worker.once('message', (message: JsonataWorkerMessage) => {
      finish(() => {
        if (message.ok) resolve(message.value);
        else reject(new AppError('VALIDATION_FAILED', 'JSONata 转换执行失败', { ...location, message: message.message }));
      });
    });
    worker.once('error', (error) => {
      finish(() => reject(new AppError('VALIDATION_FAILED', 'JSONata 转换执行失败', {
        ...location,
        message: error instanceof Error ? error.message : String(error),
      })));
    });
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new AppError('VALIDATION_FAILED', 'JSONata 转换执行失败', { ...location, code })));
    });
  });
}

function createJsonataWorker(workerData: { expression: string; input: Record<string, unknown> }): Worker {
  const compiledWorkerUrl = new URL('./jsonata-transform.worker.js', import.meta.url);
  if (existsSync(fileURLToPath(compiledWorkerUrl))) {
    return new Worker(compiledWorkerUrl, { workerData });
  }

  const sourceWorkerUrl = new URL('./jsonata-transform.worker.ts', import.meta.url);
  const bootstrap = `
    const { workerData } = require('node:worker_threads');
    import('tsx/esm/api')
      .then(({ tsImport }) => tsImport(workerData.sourceWorkerUrl, { parentURL: workerData.parentURL }))
      .catch((error) => { throw error; });
  `;
  return new Worker(bootstrap, {
    eval: true,
    workerData: {
      ...workerData,
      sourceWorkerUrl: sourceWorkerUrl.href,
      parentURL: import.meta.url,
    },
  });
}

type JsonataWorkerMessage =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

function assertJsonataExpressionSafe(expression: string): void {
  if (expression.length > 4096) throw new AppError('VALIDATION_FAILED', 'JSONata 表达式过长');
  if (/\$(eval|assert|error)\s*\(/i.test(expression)) {
    throw new AppError('VALIDATION_FAILED', 'JSONata 表达式包含禁用函数');
  }
}

function renderTransformInput(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const match = value.match(/^\s*\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}\s*$/);
    if (match) {
      const resolved = readPath(variables, match[1]!);
      if (resolved === undefined) throw new AppError('VALIDATION_FAILED', `变量缺失：${match[1]}`, { key: match[1] });
      return resolved;
    }
    return renderString(value, variables);
  }
  if (Array.isArray(value)) return value.map((item) => renderTransformInput(item, variables));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, renderTransformInput(child, variables)]));
  return value;
}

function assertJsonByteSize(value: unknown, maxBytes: number, label: string): void {
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  if (bytes > maxBytes) throw new AppError('WORKFLOW_ASSERTION_FAILED', `${label} 超过大小限制`, { bytes, maxBytes });
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : { value };
}

function readFirstAvailablePath(output: WorkflowMockStepOutput, paths: string[]): unknown {
  for (const path of paths) {
    const value = readJsonPath(output, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function evaluateAssertions(assertions: WorkflowAssertion[], output: WorkflowMockStepOutput, values: Record<string, unknown>): WorkflowStepRunResult['assertions'] {
  return assertions.map((assertion) => {
    if (assertion.type === 'statusCode') return assertionResult(assertion.type, output.statusCode === assertion.equals, `status=${output.statusCode}`);
    if (assertion.type === 'jsonPath') return assertionResult(assertion.type, Object.is(readJsonPath(output.body, assertion.path), assertion.equals), `path=${assertion.path}`);
    if (assertion.type === 'header') {
      const value = output.headers?.[assertion.name];
      const passed = assertion.equals !== undefined ? value === assertion.equals : (assertion.exists ?? true) === (value !== undefined);
      return assertionResult(assertion.type, passed, `header=${assertion.name}`);
    }
    if (assertion.type === 'contains') {
      const actual = String(output.stdout ?? output.body ?? '');
      const expected = renderString(assertion.value, values);
      const passed = actual.includes(expected) || actual.toLowerCase().includes(expected.toLowerCase());
      return assertionResult(assertion.type, passed, `contains expected="${expected}" actualLength=${actual.length}`);
    }
    if (assertion.type === 'regex') return assertionResult(assertion.type, new RegExp(assertion.pattern).test(String(output.stdout ?? output.body ?? '')), 'regex');
    const actual = renderString(assertion.actual, values);
    const expected = renderString(assertion.expected, values);
    return assertionResult(assertion.type, actual === expected, 'fingerprint');
  });
}

function evaluateCondition(condition: WorkflowStep['when'], values: Record<string, unknown>): boolean {
  if (!condition) return true;
  const value = readPath(values, condition.variable);
  if (condition.exists !== undefined) return (value !== undefined) === condition.exists;
  if (condition.equals !== undefined) return Object.is(value, renderUnknown(condition.equals, values));
  if (condition.notEquals !== undefined) return !Object.is(value, renderUnknown(condition.notEquals, values));
  return true;
}

function defaultMockOutput(step: WorkflowStep, rollback: boolean, attempt: number): WorkflowMockStepOutput {
  if (step.type === 'http') return { statusCode: rollback ? 204 : 200, headers: { 'x-workflow-mock': 'true' }, body: { success: true, attempt } };
  if (step.type === 'ssh') return { exitCode: 0, stdout: `mock ssh ${step.name} ok`, body: { success: true } };
  if (step.type === 'sftp' || step.type === 'scp') {
    const remotePath = step.type === 'sftp' ? step.sftp.remotePath : step.scp.remotePath;
    const direction = step.type === 'sftp' ? step.sftp.direction : step.scp.direction;
    return {
      exitCode: 0,
      stdout: `${step.type.toUpperCase()}_${direction.toUpperCase()} ${remotePath} ok`,
      body: {
        success: true,
        attempt,
        transferResults: [
          {
            direction,
            protocol: step.type,
            remotePath,
            localPath: `virtual://workflow/${step.name}`,
            size: 16,
            hash: 'a'.repeat(64),
            auditDetails: [],
          },
        ],
      },
    };
  }
  if (step.type === 'condition') return { body: { passed: true, attempt } };
  return { body: { success: true } };
}

function orderStepsByStage(steps: WorkflowStep[]): WorkflowStep[] {
  if (!steps.some((step) => step.stage)) return steps;
  const order = new Map<WorkflowStage, number>([
    ['prepare', 0],
    ['backup', 1],
    ['install', 2],
    ['refresh', 3],
    ['verify', 4],
  ]);
  return steps
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const leftOrder = left.step.stage ? order.get(left.step.stage) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const rightOrder = right.step.stage ? order.get(right.step.stage) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map((item) => item.step);
}

function buildSshCommandText(step: Extract<WorkflowStep, { type: 'ssh' }>): string {
  if (step.ssh.commands?.length) return step.ssh.commands.join('\n');
  return step.ssh.command ?? step.ssh.script ?? '';
}

function adaptSshConnection(connection: WorkflowSshConnection, values: Record<string, unknown>, keepMissing: boolean) {
  if (!connection) throw new AppError('VALIDATION_FAILED', '执行前必须先解析 connectionRef');
  const credential = resolveCredentialBinding(connection.credential, values, keepMissing);
  return {
    host: renderString(connection.host, values, keepMissing),
    ...(connection.port !== undefined ? { port: connection.port } : {}),
    username: renderString(connection.username, values, keepMissing),
    credentialSecretRef: credential ? credentialToSecretRef(credential) : 'secret://credential/unresolved#current',
    ...(connection.expectedHostKeyFingerprint ? { expectedHostKeyFingerprint: renderString(connection.expectedHostKeyFingerprint, values, keepMissing) } : {}),
    ...(connection.hostKeyPolicy ? { hostKeyPolicy: connection.hostKeyPolicy } : {}),
  };
}

function resolveStepConnection(connectionRef: string, context: RuntimeContext): WorkflowSshConnection {
  const resolved = context.connections[connectionRef];
  if (!resolved) throw new AppError('VALIDATION_FAILED', 'connectionRef 未定义或不是 SSH 连接', { connectionRef });
  return resolved;
}

function resolveHttpConnection(connectionRef: string, context: RuntimeContext): ResolvedConnectionV1 {
  const resolved = context.resolvedConnections[connectionRef];
  if (!resolved) throw new AppError('VALIDATION_FAILED', 'HTTP connectionRef 未定义', { connectionRef });
  if (resolved.transport !== 'http') throw new AppError('VALIDATION_FAILED', 'HTTP connectionRef 必须引用 HTTP 连接', { connectionRef, transport: resolved.transport });
  if (!resolved.host || !resolved.port) throw new AppError('VALIDATION_FAILED', '统一 HTTP Connection 快照不完整', { connectionRef });
  return resolved;
}

function adaptHttpAuth(auth: Extract<WorkflowStep, { type: 'http' }>['request']['auth'], values: Record<string, unknown>, keepMissing: boolean) {
  if (!auth || auth.type === 'none') return auth;
  if (auth.type === 'basic') {
    const credential = resolveCredentialBinding(auth.credential, values, keepMissing);
    return {
      type: 'basic' as const,
      username: renderString(auth.username, values, keepMissing),
      secretRef: credential ? credentialToSecretRef(credential) : 'secret://credential/unresolved#current',
    };
  }
  if (auth.type === 'bearer') {
    const credential = resolveCredentialBinding(auth.credential, values, keepMissing);
    return { type: 'bearer' as const, secretRef: credential ? credentialToSecretRef(credential) : 'secret://credential/unresolved#current' };
  }
  if (auth.type === 'api_key') {
    const credential = resolveCredentialBinding(auth.credential, values, keepMissing);
    return {
      type: 'api_key' as const,
      name: renderString(auth.name, values, keepMissing),
      in: auth.in,
      secretRef: credential ? credentialToSecretRef(credential) : 'secret://credential/unresolved#current',
    };
  }
  return auth;
}

function adaptFormCredentialRefs(refs: Extract<WorkflowStep, { type: 'http' }>['request']['formCredentialRefs'], values: Record<string, unknown>, keepMissing: boolean): Record<string, string> | undefined {
  if (!refs) return undefined;
  return Object.fromEntries(Object.entries(refs).map(([field, value]) => {
    const credential = resolveCredentialBinding(value, values, keepMissing);
    return [field, credential ? credentialToSecretRef(credential) : 'secret://credential/unresolved#current'];
  }));
}

function resolveCredentialBinding(value: unknown, values: Record<string, unknown>, keepMissing: boolean): WorkflowCredentialBinding | null {
  if (isCredentialBinding(value)) return value;
  if (typeof value !== 'string') throw new AppError('VALIDATION_FAILED', '凭据必须是对象或变量引用');
  const match = value.match(/^\s*\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}\s*$/);
  if (!match) throw new AppError('VALIDATION_FAILED', '凭据变量引用格式无效', { value });
  const resolved = readPath(values, match[1]!);
  if (resolved === undefined && keepMissing && isDeferredPreviewReference(match[1]!)) return null;
  if (!isCredentialBinding(resolved)) throw new AppError('VALIDATION_FAILED', '凭据变量未绑定有效凭据', { variable: match[1] });
  return resolved;
}

function isCredentialBinding(value: unknown): value is WorkflowCredentialBinding {
  if (!isRecord(value)) return false;
  return typeof value.credentialId === 'string' && value.credentialId.trim().length > 0
    && isRecord(value.secretRefs)
    && Object.values(value.secretRefs).every((secretRef) => typeof secretRef === 'string' && secretRef.startsWith('secret://'));
}

function credentialToSecretRef(credential: WorkflowCredentialBinding): string {
  const secretRef = credential.secretRefs.password ?? credential.secretRefs.token ?? credential.secretRefs.privateKey;
  if (!secretRef) throw new AppError('VALIDATION_FAILED', '凭据没有适用于当前认证方式的 Secret Slot', { credentialId: credential.credentialId });
  return secretRef;
}

function normalizeStepOutput(step: WorkflowStep, output: WorkflowMockStepOutput): WorkflowMockStepOutput {
  if (step.type !== 'http') return output;
  const bodyText = typeof output.body === 'string' ? output.body : output.body === undefined ? '' : JSON.stringify(output.body);
  return {
    ...output,
    statusCode: output.statusCode ?? 200,
    headers: output.headers ?? {},
    body: output.body ?? {},
    stdout: output.stdout ?? bodyText,
  };
}

function stepOutputSuccess(step: WorkflowStep, output: WorkflowMockStepOutput, values: Record<string, unknown>): boolean {
  if (step.type === 'http') return [200, 201, 202, 204].includes(output.statusCode ?? 200);
  if (step.type === 'ssh') return (output.exitCode ?? 0) === 0;
  if (step.type === 'condition') return evaluateCondition(step.condition, values);
  if (step.type === 'checkpoint_verify') {
    const plan = adaptStep(step, { values, secretPaths: new Set(), outputs: {}, connections: {}, resolvedConnections: {} }, 'mock');
    return isRecord(plan) && plan.matched === true;
  }
  return true;
}

function renderUnknown(value: unknown, variables: Record<string, unknown>, keepMissing = false): unknown {
  if (typeof value === 'string') {
    const match = value.match(/^\s*\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}\s*$/);
    if (match) {
      const resolved = readPath(variables, match[1]!);
      if (resolved === undefined && keepMissing && isDeferredPreviewReference(match[1]!)) return value;
      if (resolved === undefined) throw new AppError('VALIDATION_FAILED', `变量缺失：${match[1]}`, { key: match[1] });
      return resolved;
    }
    return renderString(value, variables, keepMissing);
  }
  if (Array.isArray(value)) return value.map((item) => renderUnknown(item, variables, keepMissing));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, renderUnknown(child, variables, keepMissing)]));
  return value;
}

function renderString(template: string, variables: Record<string, unknown>, keepMissing = false): string {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g, (_match, key: string) => {
    const value = readPath(variables, key);
    if (value === undefined && keepMissing && isDeferredPreviewReference(key)) return `{{${key}}}`;
    if (value === undefined) throw new AppError('VALIDATION_FAILED', `变量缺失：${key}`, { key });
    if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  });
}

function isDeferredPreviewReference(path: string): boolean {
  // dry-run 不执行真实节点，只能延迟解析前序节点的运行时输出；部署输入本身必须在预检阶段完整可用。
  return path === 'steps' || path.startsWith('steps.');
}

function maskUnknown(value: unknown, secretPaths: Set<string>, values: Record<string, unknown>): unknown {
  if (Buffer.isBuffer(value)) return `[BINARY ${value.byteLength} bytes]`;
  if (typeof value === 'string') return maskText(value, secretPaths, values);
  if (Array.isArray(value)) return value.map((item) => maskUnknown(item, secretPaths, values));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, isSensitiveKey(key) ? '[REDACTED]' : maskUnknown(child, secretPaths, values)]));
  return value;
}

function maskText(text: string, secretPaths: Set<string>, values: Record<string, unknown>): string {
  let result = text;
  for (const path of secretPaths) {
    const value = readPath(values, path);
    if (typeof value === 'string' && value) result = result.split(value).join('[REDACTED]');
  }
  return result.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]').replace(/secret:\/\/[a-zA-Z0-9/_#.-]+/g, '[SECRET_REF]');
}

function isSensitiveKey(key: string): boolean {
  return /^(content)$/i.test(key) || /(password|token|privateKey|authorization|credential|secret|pfx|jks)/i.test(key);
}

function assertionResult(type: string, passed: boolean, message: string): WorkflowStepRunResult['assertions'][number] {
  return { type, passed, message };
}

function emptyStepResult(step: WorkflowStep, status: WorkflowStepRunResult['status'], plan: unknown, logs: string[]): WorkflowStepRunResult {
  return { name: step.name, type: step.type, stage: step.stage, status, attempts: 0, plan, extracted: {}, assertions: [], logs };
}

function readJsonPath(body: unknown, path: string): unknown {
  if (!path.startsWith('$.')) return undefined;
  return readPath(body, path.slice(2));
}

function stepSnapshot(step: WorkflowStep, result: WorkflowStepRunResult, output: unknown, extracted: Record<string, unknown>): Record<string, unknown> {
  return {
    name: step.name,
    type: step.type,
    stage: step.stage,
    status: result.status,
    output,
    extracted,
  };
}

function readPath(source: unknown, path: string): unknown {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    return isRecord(current) ? current[key] : undefined;
  }, source);
}

function buildFileTransferStepPlan(step: Extract<WorkflowStep, { type: 'sftp' | 'scp' }>, context: RuntimeContext, keepMissing: boolean) {
  const config = step.type === 'sftp' ? step.sftp : step.scp;
  const localPath = config.localPath
    ? renderString(config.localPath, context.values, keepMissing)
    : `virtual://workflow/${step.name}`;
  const sshRequest: Record<string, unknown> = {
    connection: adaptSshConnection(resolveStepConnection(config.connectionRef, context), context.values, keepMissing),
    timeoutMs: (config.timeoutSeconds ?? 60) * 1000,
    dryRun: false,
    [step.type]: [
      {
        direction: config.direction,
        localPath,
        remotePath: renderString(config.remotePath, context.values, keepMissing),
        ...(config.contentRef ? { content: renderTransferContent(config.contentRef, config.contentEncoding, context.values, keepMissing) } : {}),
        ...(config.temporaryPath ? { temporaryPath: renderString(config.temporaryPath, context.values, keepMissing) } : {}),
        ...(config.expectedHash ? { expectedHash: renderString(config.expectedHash, context.values, keepMissing) } : {}),
        ...(config.expectedSize !== undefined ? { expectedSize: config.expectedSize } : {}),
        ...(config.verifyHash !== undefined ? { verifyHash: config.verifyHash } : {}),
        ...(config.mode ? { mode: renderString(config.mode, context.values, keepMissing) } : {}),
        ...(config.owner ? { owner: renderString(config.owner, context.values, keepMissing) } : {}),
        ...(config.group ? { group: renderString(config.group, context.values, keepMissing) } : {}),
      },
    ],
  };
  return {
    connection: sshRequest.connection,
    timeoutMs: sshRequest.timeoutMs,
    sshRequest,
  };
}

function renderTransferContent(template: string, encoding: 'utf8' | 'base64' | undefined, values: Record<string, unknown>, keepMissing: boolean): string | Buffer {
  const rendered = renderUnknown(template, values, keepMissing);
  if (keepMissing && typeof rendered === 'string' && /\{\{/.test(rendered)) return rendered;
  if (typeof rendered !== 'string' && typeof rendered !== 'number' && typeof rendered !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', '文件传输 contentRef 必须渲染为字符串、数字或布尔值', { template });
  }
  const text = String(rendered);
  return encoding === 'base64' ? Buffer.from(text, 'base64') : text;
}

export function computeWorkflowContentHash(content: WorkflowDslV1): string {
  return createHash('sha256').update(stableStringify(content)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSecretCapturePath(path: string, secretPaths: Set<string>): boolean {
  for (const secretPath of secretPaths) {
    if (path === secretPath || path.startsWith(`${secretPath}.`) || secretPath.startsWith(`${path}.`)) return true;
  }
  return false;
}

function assertCheckpointValueSafe(value: unknown, path: string): void {
  if (Buffer.isBuffer(value)) throw new AppError('VALIDATION_FAILED', 'checkpoint 不允许保存二进制内容', { path });
  if (typeof value === 'string') {
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|secret:\/\//i.test(value)) {
      throw new AppError('VALIDATION_FAILED', 'checkpoint 不允许保存 SecretRef 或私钥内容', { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCheckpointValueSafe(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) throw new AppError('VALIDATION_FAILED', 'checkpoint 不允许保存敏感字段', { path: `${path}.${key}` });
      assertCheckpointValueSafe(child, `${path}.${key}`);
    }
  }
}

function restoreContextValue(values: Record<string, unknown>, key: string, previousValue: unknown, existed: boolean): void {
  if (existed) {
    values[key] = previousValue;
    return;
  }
  delete values[key];
}

function assertPluginVersionIncrement(previous: WorkflowDslV1, next: WorkflowDslV1, contentChanged: boolean): void {
  if (!contentChanged) return;
  const previousVersion = previous.metadata.version;
  const nextVersion = next.metadata.version;
  if (!previousVersion && !nextVersion) return;
  if (!previousVersion || !nextVersion || compareSemanticVersions(nextVersion, previousVersion) <= 0) {
    throw new AppError('VALIDATION_FAILED', 'DSL 模板内容发生变化时必须递进 metadata.version', {
      previousVersion,
      nextVersion,
    });
  }
}

function compareSemanticVersions(left: string, right: string): number {
  const [leftCoreText, leftPreRelease = ''] = left.split('+', 1)[0]!.split('-', 2);
  const [rightCoreText, rightPreRelease = ''] = right.split('+', 1)[0]!.split('-', 2);
  const leftCore = leftCoreText!.split('.').map(Number);
  const rightCore = rightCoreText!.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((leftCore[index] ?? 0) !== (rightCore[index] ?? 0)) return (leftCore[index] ?? 0) - (rightCore[index] ?? 0);
  }
  if (!leftPreRelease && !rightPreRelease) return 0;
  if (!leftPreRelease) return 1;
  if (!rightPreRelease) return -1;
  const leftParts = leftPreRelease.split('.');
  const rightParts = rightPreRelease.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveExecutionBranch(
  content: WorkflowDslV1,
  branch: WorkflowExecutionBranch,
  allowLegacyFallback: boolean,
): WorkflowStep[] {
  if (branch === 'deploy') return content.steps;
  if (content.rollback?.length) return content.rollback;
  if (allowLegacyFallback) return [];
  throw new AppError('VALIDATION_FAILED', '工作流没有 rollback 分支，无法执行回滚', {
    executionBranch: branch,
  });
}

function normalizeOrigin(origin: unknown): WorkflowTemplate['origin'] {
  return origin === 'plugin_internal' ? 'plugin_internal' : 'user';
}

function normalizeTemplate(template: WorkflowTemplate): WorkflowTemplate {
  const origin = normalizeOrigin(template.origin);
  const ownerType = template.ownerType ?? (origin === 'plugin_internal' ? 'SYSTEM' : 'TENANT');
  const ownerId = template.ownerId ?? (ownerType === 'SYSTEM' ? 'SYSTEM' : undefined);
  return {
    ...template,
    origin,
    ownerType,
    ...(ownerId ? { ownerId } : {}),
    ...(template.tenantId ? { tenantId: template.tenantId } : {}),
  };
}

function normalizePluginSource(source: WorkflowPluginSource): WorkflowPluginSource {
  return {
    sourceType: 'PLUGIN_CAPABILITY',
    pluginId: source.pluginId,
    pluginVersionId: source.pluginVersionId,
    capabilityKey: source.capabilityKey,
    sourceWorkflowVersionId: source.sourceWorkflowVersionId,
    sourceContentHash: source.sourceContentHash,
    createdAt: source.createdAt,
    ...(source.sourceWorkflowTemplateId ? { sourceWorkflowTemplateId: source.sourceWorkflowTemplateId } : {}),
  };
}

function normalizeVersion(version: WorkflowTemplateVersion): WorkflowTemplateVersion {
  return {
    ...version,
    ...(version.pluginSource ? { pluginSource: normalizePluginSource(version.pluginSource) } : {}),
  };
}

function assertUserEditable(template: WorkflowTemplate): void {
  if (template.origin === 'plugin_internal') {
    throw new AppError('WORKFLOW_INTERNAL_READ_ONLY', '插件内部工作流为只读资源', { templateId: template.id });
  }
}

function summarizeValueShape(value: unknown, depth = 0): unknown {
  if (value === null) return { type: 'null' };
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'string') return { type: 'string', length: value.length };
  if (typeof value === 'number' || typeof value === 'boolean') return { type: typeof value };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      ...(depth >= 1 || value.length === 0 ? {} : { firstItem: summarizeValueShape(value[0], depth + 1) }),
    };
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return {
      type: 'object',
      keys: keys.slice(0, 12),
      ...(depth >= 1 ? {} : {
        children: Object.fromEntries(keys.slice(0, 6).map((key) => [key, summarizeValueShape(value[key], depth + 1)])),
      }),
    };
  }
  return { type: typeof value };
}
