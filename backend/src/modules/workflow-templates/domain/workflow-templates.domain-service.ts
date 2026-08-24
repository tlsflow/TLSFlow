import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type {
  ApplyWorkflowTemplateFromFileInput,
  CreateWorkflowTemplateInput,
  CreateWorkflowTemplateFromFileInput,
  UpdateWorkflowTemplateInput,
  WorkflowAssertion,
  WorkflowCredentialBinding,
  WorkflowDslV1,
  WorkflowMockStepOutput,
  WorkflowRenderedStep,
  WorkflowExecutorDispatcher,
  WorkflowRunResult,
  WorkflowRuntimeInput,
  WorkflowSingleStepRunResult,
  WorkflowFileTemplate,
  WorkflowStage,
  WorkflowStep,
  WorkflowStepRuntimeInput,
  WorkflowStepRunResult,
  WorkflowTemplate,
  WorkflowTemplateVersion,
  WorkflowVariableDefinition,
} from '../dto/workflow-templates.dto.js';
import { WorkflowTemplateFileLibrary } from './workflow-template-file-library.js';
import { normalizeExtractors, validateVariableValue, workflowTemplatesSchemaRegistry } from '../schema/workflow-templates.schema.js';

interface RuntimeContext {
  values: Record<string, unknown>;
  secretPaths: Set<string>;
  outputs: Record<string, unknown>;
}

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
    private readonly fileTemplateLibrary = new WorkflowTemplateFileLibrary(),
  ) {
    this.ready = this.rehydrate();
  }

  async listFileTemplates(): Promise<WorkflowFileTemplate[]> {
    return await this.fileTemplateLibrary.list();
  }

  async createTemplate(input: CreateWorkflowTemplateInput): Promise<{ template: WorkflowTemplate; version: WorkflowTemplateVersion }> {
    await this.ready;
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    const now = new Date().toISOString();
    const template: WorkflowTemplate = {
      id: `wftpl_${randomUUID()}`,
      name: content.metadata.name,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    const version = this.createVersion(template.id, 1, content, 'draft', input.changeSummary);
    template.currentVersionId = version.id;
    this.templates.set(template.id, template);
    this.versions.set(template.id, [version]);
    await this.templatesRepository.upsert(template);
    await this.versionsRepository.upsert(version);
    return { template: { ...template }, version: clone(version) };
  }

  async createTemplateFromFile(input: CreateWorkflowTemplateFromFileInput): Promise<{ template: WorkflowTemplate; version: WorkflowTemplateVersion }> {
    const content = await this.fileTemplateLibrary.getValidContent(input.fileTemplateId);
    return await this.createTemplate({
      content,
      changeSummary: input.changeSummary ?? `从文件模板 ${input.fileTemplateId} 创建工作流草稿`,
    });
  }

  async createDraftVersion(input: UpdateWorkflowTemplateInput): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const template = await this.getTemplateOrThrow(input.templateId);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    const list = this.versions.get(template.id) ?? [];
    const hash = digest(content);
    if (list.some((item) => item.contentHash === hash)) throw new AppError('VALIDATION_FAILED', 'duplicate workflow version content');
    const versionNumber = list.reduce((max, item) => Math.max(max, item.version), 0) + 1;
    const version = this.createVersion(template.id, versionNumber, content, 'draft', input.changeSummary);
    this.versions.set(template.id, [...list, version]);
    template.currentVersionId = version.id;
    template.status = 'draft';
    template.updatedAt = new Date().toISOString();
    this.templates.set(template.id, template);
    await this.templatesRepository.upsert(template);
    await this.versionsRepository.upsert(version);
    return clone(version);
  }

  async applyFileTemplateToTemplate(input: ApplyWorkflowTemplateFromFileInput): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const template = await this.getTemplateOrThrow(input.templateId);
    const imported = await this.fileTemplateLibrary.getValidContent(input.fileTemplateId);
    const content: WorkflowDslV1 = {
      ...clone(imported),
      metadata: {
        ...clone(imported.metadata),
        name: template.name,
      },
    };
    return await this.createDraftVersion({
      templateId: input.templateId,
      content,
      changeSummary: input.changeSummary ?? `从文件模板 ${input.fileTemplateId} 覆盖工作流草稿`,
    });
  }

  async publishVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const { template, version } = await this.findVersion(versionId);
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

  async disableTemplate(templateId: string): Promise<WorkflowTemplate> {
    await this.ready;
    const template = await this.getTemplateOrThrow(templateId);
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

  async preview(input: WorkflowRuntimeInput): Promise<WorkflowRunResult> {
    return this.testRun({ ...input, mode: 'render_only' });
  }

  async testRun(input: WorkflowRuntimeInput): Promise<WorkflowRunResult> {
    await this.ready;
    return this.executeRuntime(input);
  }

  async runWithDispatcher(input: WorkflowRuntimeInput, dispatcher: WorkflowExecutorDispatcher): Promise<WorkflowRunResult> {
    await this.ready;
    return this.executeRuntime(input, dispatcher);
  }

  async testStep(input: WorkflowStepRuntimeInput): Promise<WorkflowSingleStepRunResult> {
    return await this.testStepWithDispatcher(input);
  }

  async testStepWithDispatcher(input: WorkflowStepRuntimeInput, dispatcher?: WorkflowExecutorDispatcher): Promise<WorkflowSingleStepRunResult> {
    await this.ready;
    const content = workflowTemplatesSchemaRegistry.validate(input.content);
    const step = content.steps.find((item) => item.name === input.stepName) ?? content.rollback?.find((item) => item.name === input.stepName);
    if (!step) throw new AppError('RESOURCE_NOT_FOUND', 'workflow step not found', { stepName: input.stepName });
    const context = resolveRuntimeContext(content, input);
    // 中文说明：单节点模拟允许调用方补上游步骤产物，但不能覆盖已经解析过的 Secret/证书变量。
    for (const [key, value] of Object.entries(input.userVariables ?? {})) {
      if (key === 'previous' || key === 'steps' || context.values[key] === undefined) context.values[key] = value;
    }
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

  private async executeRuntime(input: WorkflowRuntimeInput, dispatcher?: WorkflowExecutorDispatcher): Promise<WorkflowRunResult> {
    const version = await this.getVersion(input.templateVersionId);
    const context = resolveRuntimeContext(version.content, input);
    const runId = `wfrun_${randomUUID()}`;
    const renderedSteps: WorkflowRenderedStep[] = [];
    const stepResults: WorkflowStepRunResult[] = [];
    const rollbackResults: WorkflowStepRunResult[] = [];
    const logs: string[] = [];
    let failed = false;

    for (const step of orderStepsByStage(version.content.steps)) {
      const result = await this.runStep(step, context, input, false, runId, dispatcher);
      renderedSteps.push(result.rendered);
      stepResults.push(result.result);
      logs.push(...result.result.logs);
      if (result.result.status === 'failed') {
        failed = true;
        break;
      }
    }

    if (failed && version.content.rollback?.length) {
      logs.push('rollback:started');
      for (const step of version.content.rollback) {
        const result = await this.runStep(step, context, input, true, runId, dispatcher);
        rollbackResults.push(result.result);
        logs.push(...result.result.logs);
      }
    }

    return {
      id: runId,
      mode: input.mode,
      plannedOnly: input.mode === 'render_only',
      status: failed ? (rollbackResults.length ? 'rolled_back' : 'failed') : 'success',
      renderedSteps,
      stepResults,
      rollbackResults,
      logs: logs.map((line) => maskText(line, context.secretPaths, context.values)),
    };
  }

  private async runStep(step: WorkflowStep, context: RuntimeContext, input: WorkflowRuntimeInput, rollback: boolean, runId: string, dispatcher?: WorkflowExecutorDispatcher): Promise<{ rendered: WorkflowRenderedStep; result: WorkflowStepRunResult; output: unknown }> {
    const type = step.type;
    if (!evaluateCondition(step.when, context.values)) {
      return {
        rendered: { name: step.name, type, stage: step.stage, skipped: true, reason: 'condition_not_matched', preview: { skipped: true } },
        result: emptyStepResult(step, 'skipped', { skipped: true }, ['step:skipped:condition']),
        output: { skipped: true, reason: 'condition_not_matched' },
      };
    }

    const attempts = (step.retry?.count ?? 0) + 1;
    let last: WorkflowStepRunResult | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const mockOutput = input.mockResponses?.[step.name] ?? defaultMockOutput(step, rollback, attempt);
      const preOutput = normalizeStepOutput(step, mockOutput);
      const plan = adaptStep(step, context, input.mode, preOutput);
      const dispatchOutput = dispatcher && input.mode !== 'render_only'
        ? await dispatcher({ runId, step, renderedPlan: plan, attempt, rollback })
        : undefined;
      const structuredOutput = normalizeStepOutput(step, dispatchOutput ?? mockOutput);
      const dispatchSucceeded = dispatchOutput ? dispatchOutput.success : true;
      const extracted = input.mode === 'render_only' || !dispatchSucceeded ? {} : runExtractors(step, structuredOutput, context);
      const localValues = { ...context.values, ...extracted };
      const finalPlan = extracted && Object.keys(extracted).length > 0
        ? adaptStep(step, { ...context, values: localValues }, input.mode, structuredOutput)
        : plan;
      const assertions = input.mode === 'render_only' || !dispatchSucceeded ? [] : evaluateAssertions(step.assert ?? [], structuredOutput, localValues);
      const success = input.mode === 'render_only' || dispatchSucceeded && assertions.every((item) => item.passed) && stepOutputSuccess(step, structuredOutput, localValues);
      const rawLogs = [`step:${step.name}:attempt:${attempt}:status:${success ? 'success' : 'failed'}`, ...(dispatchOutput?.logs ?? [])];
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
        for (const [key, value] of Object.entries(extracted)) {
          context.values[key] = value;
          context.outputs[`${step.name}.${key}`] = value;
        }
        const snapshot = stepSnapshot(step, last, structuredOutput, extracted);
        context.values.previous = snapshot;
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

  private createVersion(templateId: string, versionNumber: number, content: WorkflowDslV1, status: WorkflowTemplateVersion['status'], changeSummary?: string): WorkflowTemplateVersion {
    return {
      id: `wftplv_${randomUUID()}`,
      templateId,
      version: versionNumber,
      dslVersion: 'v1',
      content: clone(content),
      contentHash: digest(content),
      status,
      changeSummary,
      createdAt: new Date().toISOString(),
    };
  }

  private async rehydrate(): Promise<void> {
    const templates = await this.templatesRepository.list();
    const versions = await this.versionsRepository.list();
    this.templates.clear();
    this.versions.clear();
    for (const template of templates) {
      this.templates.set(template.id, template);
    }
    const byTemplate = new Map<string, WorkflowTemplateVersion[]>();
    for (const version of versions) {
      const list = byTemplate.get(version.templateId) ?? [];
      list.push(version);
      byTemplate.set(version.templateId, list);
    }
    for (const [templateId, list] of byTemplate.entries()) {
      list.sort((a, b) => a.version - b.version);
      this.versions.set(templateId, list);
    }
  }
}

function resolveRuntimeContext(content: WorkflowDslV1, input: WorkflowRuntimeInput | WorkflowStepRuntimeInput): RuntimeContext {
  const values: Record<string, unknown> = {};
  const secretPaths = new Set<string>();
  const source = { ...(input.assetVariables ?? {}), ...(input.userVariables ?? {}) };
  for (const [name, definition] of Object.entries(content.variables)) {
    let value = source[name] ?? definition.default;
    if (definition.type === 'certificate') value = input.certificateMaterials?.[name] ?? value;
    if (value === undefined) {
      if (definition.required) throw new AppError('VALIDATION_FAILED', '变量缺失', { name });
      continue;
    }
    validateVariableValue(definition, value, `variables.${name}`);
    values[name] = value;
    markSensitive(name, definition, value, secretPaths);
  }
  values.asset = input.assetVariables ?? {};
  values.previous = {};
  values.steps = {};
  return { values, secretPaths, outputs: {} };
}

function markSensitive(name: string, definition: WorkflowVariableDefinition, value: unknown, secretPaths: Set<string>): void {
  if (definition.sensitive || definition.type === 'credential') collectValuePaths(name, value, secretPaths);
  if (definition.type === 'certificate' && isRecord(value)) {
    for (const key of ['privateKey', 'pfx', 'jks']) {
      if (value[key] !== undefined) collectValuePaths(`${name}.${key}`, value[key], secretPaths);
    }
  }
}

function collectValuePaths(path: string, value: unknown, paths: Set<string>): void {
  paths.add(path);
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) collectValuePaths(`${path}.${key}`, child, paths);
  }
}

function adaptStep(step: WorkflowStep, context: RuntimeContext, mode: WorkflowRuntimeInput['mode'], output?: WorkflowMockStepOutput): unknown {
  if (step.type === 'http') {
    const curlRequest = {
      idempotencyKey: `workflow:${step.name}`,
      dryRun: mode !== 'real_test',
      template: {
        method: step.request.method,
        url: renderString(step.request.url, context.values, mode === 'render_only'),
        query: renderUnknown(step.request.query, context.values, mode === 'render_only'),
        headers: renderUnknown(step.request.headers ?? {}, context.values, mode === 'render_only'),
        headerRefs: step.request.headerRefs,
        bodyType: step.request.bodyType,
        body: renderUnknown(step.request.body, context.values, mode === 'render_only'),
        form: renderUnknown(step.request.form, context.values, mode === 'render_only'),
        multipart: renderUnknown(step.request.multipart, context.values, mode === 'render_only'),
        auth: adaptHttpAuth(step.request.auth, context.values, mode === 'render_only'),
        tls: step.request.tls,
        timeoutMs: (step.request.timeoutSeconds ?? 30) * 1000,
        maxResponseBytes: step.request.maxResponseBytes,
      },
      responsePolicy: {
        successStatusCodes: step.request.successStatusCodes,
        failOnNon2xx: step.request.failOnNon2xx,
        assertions: (step.assert ?? []).filter((item) => item.type === 'statusCode').map((item) => ({ type: 'status', equals: item.equals })),
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
      connection: adaptSshConnection(step.ssh.connection, context.values, mode === 'render_only'),
      command,
      commands: step.ssh.commands?.map((item) => renderString(item, context.values, mode === 'render_only')),
      mode: step.ssh.mode,
      timeoutMs: (step.ssh.timeoutSeconds ?? 60) * 1000,
      testMode: mode,
    };
  }
  if (step.type === 'sftp' || step.type === 'scp') {
    const transferStep = buildFileTransferStepPlan(step, context.values, mode === 'render_only');
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
  if (step.type === 'wait') return { executor: 'workflow.wait', seconds: step.seconds, plannedOnly: true };
  return { executor: 'workflow.manual', instruction: renderString(step.instruction, context.values, mode === 'render_only'), plannedOnly: true };
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
    if ((value === undefined || value === null) && !extractor.optional) throw new AppError('WORKFLOW_ASSERTION_FAILED', '提取变量失败', { step: step.name, extractor: extractor.name });
    if (value !== undefined && value !== null) {
      extracted[extractor.name] = value;
      if (extractor.sensitive) collectValuePaths(extractor.name, value, context.secretPaths);
    }
  }
  return extracted;
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
    if (assertion.type === 'contains') return assertionResult(assertion.type, String(output.stdout ?? output.body ?? '').includes(assertion.value), 'contains');
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
  if (condition.equals !== undefined) return Object.is(value, condition.equals);
  if (condition.notEquals !== undefined) return !Object.is(value, condition.notEquals);
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

function adaptSshConnection(connection: Extract<WorkflowStep, { type: 'ssh' }>['ssh']['connection'], values: Record<string, unknown>, keepMissing: boolean) {
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

function resolveCredentialBinding(value: unknown, values: Record<string, unknown>, keepMissing: boolean): WorkflowCredentialBinding | null {
  if (isCredentialBinding(value)) return value;
  if (typeof value !== 'string') throw new AppError('VALIDATION_FAILED', '凭据必须是对象或变量引用');
  const match = value.match(/^\s*\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}\s*$/);
  if (!match) throw new AppError('VALIDATION_FAILED', '凭据变量引用格式无效', { value });
  const resolved = readPath(values, match[1]!);
  if (resolved === undefined && keepMissing) return null;
  if (!isCredentialBinding(resolved)) throw new AppError('VALIDATION_FAILED', '凭据变量未绑定有效凭据', { variable: match[1] });
  return resolved;
}

function isCredentialBinding(value: unknown): value is WorkflowCredentialBinding {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && value.id.trim().length > 0
    && ['password', 'ssh_key', 'api_token'].includes(String(value.type));
}

function credentialToSecretRef(credential: WorkflowCredentialBinding): string {
  return `secret://${credential.type}/${credential.id}#current`;
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
  return true;
}

function renderUnknown(value: unknown, variables: Record<string, unknown>, keepMissing = false): unknown {
  if (typeof value === 'string') return renderString(value, variables, keepMissing);
  if (Array.isArray(value)) return value.map((item) => renderUnknown(item, variables, keepMissing));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, renderUnknown(child, variables, keepMissing)]));
  return value;
}

function renderString(template: string, variables: Record<string, unknown>, keepMissing = false): string {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g, (_match, key: string) => {
    const value = readPath(variables, key);
    if (value === undefined && keepMissing) return `{{${key}}}`;
    if (value === undefined) throw new AppError('VALIDATION_FAILED', '变量缺失', { key });
    if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  });
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

function stepSnapshot(step: WorkflowStep, result: WorkflowStepRunResult, output: WorkflowMockStepOutput, extracted: Record<string, unknown>): Record<string, unknown> {
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

function buildFileTransferStepPlan(step: Extract<WorkflowStep, { type: 'sftp' | 'scp' }>, values: Record<string, unknown>, keepMissing: boolean) {
  const config = step.type === 'sftp' ? step.sftp : step.scp;
  const localPath = config.localPath
    ? renderString(config.localPath, values, keepMissing)
    : `virtual://workflow/${step.name}`;
  const sshRequest: Record<string, unknown> = {
    connection: adaptSshConnection(config.connection, values, keepMissing),
    timeoutMs: (config.timeoutSeconds ?? 60) * 1000,
    dryRun: false,
    [step.type]: [
      {
        direction: config.direction,
        localPath,
        remotePath: renderString(config.remotePath, values, keepMissing),
        ...(config.contentRef ? { content: renderTransferContent(config.contentRef, config.contentEncoding, values, keepMissing) } : {}),
        ...(config.temporaryPath ? { temporaryPath: renderString(config.temporaryPath, values, keepMissing) } : {}),
        ...(config.expectedHash ? { expectedHash: renderString(config.expectedHash, values, keepMissing) } : {}),
        ...(config.expectedSize !== undefined ? { expectedSize: config.expectedSize } : {}),
        ...(config.verifyHash !== undefined ? { verifyHash: config.verifyHash } : {}),
        ...(config.mode ? { mode: renderString(config.mode, values, keepMissing) } : {}),
        ...(config.owner ? { owner: renderString(config.owner, values, keepMissing) } : {}),
        ...(config.group ? { group: renderString(config.group, values, keepMissing) } : {}),
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

function digest(content: WorkflowDslV1): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
