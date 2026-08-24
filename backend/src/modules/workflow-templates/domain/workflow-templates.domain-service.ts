import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import type {
  CreateWorkflowTemplateInput,
  UpdateWorkflowTemplateInput,
  WorkflowAssertion,
  WorkflowDslV1,
  WorkflowMockStepOutput,
  WorkflowRenderedStep,
  WorkflowRunResult,
  WorkflowRuntimeInput,
  WorkflowStep,
  WorkflowStepRunResult,
  WorkflowTemplate,
  WorkflowTemplateVersion,
  WorkflowVariableDefinition,
} from '../dto/workflow-templates.dto.js';
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
  ) {
    this.ready = this.rehydrate();
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
    template.updatedAt = new Date().toISOString();
    this.templates.set(template.id, template);
    await this.templatesRepository.upsert(template);
    await this.versionsRepository.upsert(version);
    return clone(version);
  }

  async publishVersion(versionId: string): Promise<WorkflowTemplateVersion> {
    await this.ready;
    const { template, version } = await this.findVersion(versionId);
    if (template.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'template is disabled');
    if (version.status === 'disabled') throw new AppError('VALIDATION_FAILED', 'version is disabled');
    const list = this.versions.get(template.id) ?? [];
    for (const item of list) {
      if (item.status === 'published') {
        item.status = 'disabled';
        await this.versionsRepository.upsert(item);
      }
    }
    version.status = 'published';
    template.status = 'published';
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
    return [...this.templates.values()].map((item) => ({ ...item }));
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
    const version = await this.getVersion(input.templateVersionId);
    const context = resolveRuntimeContext(version.content, input);
    const renderedSteps: WorkflowRenderedStep[] = [];
    const stepResults: WorkflowStepRunResult[] = [];
    const rollbackResults: WorkflowStepRunResult[] = [];
    const logs: string[] = [];
    let failed = false;

    for (const step of version.content.steps) {
      const result = this.runStep(step, context, input, false);
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
        const result = this.runStep(step, context, input, true);
        rollbackResults.push(result.result);
        logs.push(...result.result.logs);
      }
    }

    return {
      id: `wfrun_${randomUUID()}`,
      mode: input.mode,
      plannedOnly: true,
      status: failed ? (rollbackResults.length ? 'rolled_back' : 'failed') : 'success',
      renderedSteps,
      stepResults,
      rollbackResults,
      logs: logs.map((line) => maskText(line, context.secretPaths, context.values)),
    };
  }

  private runStep(step: WorkflowStep, context: RuntimeContext, input: WorkflowRuntimeInput, rollback: boolean): { rendered: WorkflowRenderedStep; result: WorkflowStepRunResult } {
    const type = step.type;
    if (!evaluateCondition(step.when, context.values)) {
      return {
        rendered: { name: step.name, type, skipped: true, reason: 'condition_not_matched', preview: { skipped: true } },
        result: emptyStepResult(step, 'skipped', { skipped: true }, ['step:skipped:condition']),
      };
    }

    const attempts = (step.retry?.count ?? 0) + 1;
    let last: WorkflowStepRunResult | undefined;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const output = input.mockResponses?.[step.name] ?? defaultMockOutput(step, rollback, attempt);
      const extracted = input.mode === 'render_only' ? {} : runExtractors(step, output);
      const localValues = { ...context.values, ...extracted };
      const plan = adaptStep(step, { ...context, values: localValues }, input.mode);
      const assertions = input.mode === 'render_only' ? [] : evaluateAssertions(step.assert ?? [], output, localValues);
      const success = input.mode === 'render_only' || (assertions.every((item) => item.passed) && stepOutputSuccess(step, output));
      last = {
        name: step.name,
        type,
        status: success ? 'success' : 'failed',
        attempts: attempt,
        plan: maskUnknown(plan, context.secretPaths, context.values),
        extracted: maskUnknown(extracted, context.secretPaths, context.values) as Record<string, unknown>,
        assertions,
        logs: [`step:${step.name}:attempt:${attempt}:status:${success ? 'success' : 'failed'}`],
      };
      if (success || attempt === attempts) {
        for (const [key, value] of Object.entries(extracted)) {
          context.values[key] = value;
          context.outputs[`${step.name}.${key}`] = value;
        }
        context.values.steps = { ...(context.values.steps as Record<string, unknown>), [step.name]: { output, extracted } };
        return {
          rendered: { name: step.name, type, request: maskUnknown(plan, context.secretPaths, context.values), preview: maskUnknown(plan, context.secretPaths, context.values) },
          result: last,
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

function resolveRuntimeContext(content: WorkflowDslV1, input: WorkflowRuntimeInput): RuntimeContext {
  const values: Record<string, unknown> = {};
  const secretPaths = new Set<string>();
  const source = { ...(input.assetVariables ?? {}), ...(input.userVariables ?? {}) };
  for (const [name, definition] of Object.entries(content.variables)) {
    let value = source[name] ?? definition.default;
    if (definition.type === 'certificate') value = input.certificateMaterials?.[name] ?? value;
    if (definition.type === 'secret') value = resolveSecretValue(name, value, input.secretRefs);
    if (value === undefined) {
      if (definition.required) throw new AppError('VALIDATION_FAILED', '鍙橀噺缂哄け', { name });
      continue;
    }
    validateVariableValue(definition, value, `variables.${name}`);
    values[name] = value;
    markSensitive(name, definition, value, secretPaths);
  }
  values.asset = input.assetVariables ?? {};
  values.steps = {};
  return { values, secretPaths, outputs: {} };
}

function resolveSecretValue(name: string, value: unknown, secretRefs: WorkflowRuntimeInput['secretRefs']): unknown {
  if (typeof value === 'string' && /^secret:\/\//.test(value)) return secretRefs?.[value] ?? { secretRef: value };
  if (value === undefined && secretRefs?.[name] !== undefined) return secretRefs[name];
  return value;
}

function markSensitive(name: string, definition: WorkflowVariableDefinition, value: unknown, secretPaths: Set<string>): void {
  if (definition.sensitive || definition.type === 'secret') collectValuePaths(name, value, secretPaths);
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

function adaptStep(step: WorkflowStep, context: RuntimeContext, mode: WorkflowRuntimeInput['mode']): unknown {
  if (step.type === 'http') {
    return {
      executor: '017.CURL_HTTP',
      dryRun: true,
      realNetwork: false,
      idempotencyKey: `workflow:${step.name}`,
      template: {
        method: step.request.method,
        url: renderString(step.request.url, context.values, mode === 'render_only'),
        headers: renderUnknown(step.request.headers ?? {}, context.values, mode === 'render_only'),
        body: renderUnknown(step.request.body, context.values, mode === 'render_only'),
        timeoutMs: (step.request.timeoutSeconds ?? 30) * 1000,
      },
      mode,
    };
  }
  if (step.type === 'ssh') {
    const command = step.ssh.mode === 'interactive'
      ? step.ssh.dialogue?.map((item) => renderString(item.send, context.values, mode === 'render_only')).join('\n')
      : renderString(step.ssh.command ?? step.ssh.script ?? '', context.values, mode === 'render_only');
    return {
      executor: '015.SSH',
      dryRun: true,
      realSsh: false,
      idempotencyKey: `workflow:${step.name}`,
      connection: renderUnknown(step.ssh.connection, context.values, mode === 'render_only'),
      command,
      mode: step.ssh.mode,
      timeoutMs: (step.ssh.timeoutSeconds ?? 60) * 1000,
      testMode: mode,
    };
  }
  if (step.type === 'wait') return { executor: 'workflow.wait', seconds: step.seconds, plannedOnly: true };
  return { executor: 'workflow.manual', instruction: renderString(step.instruction, context.values, mode === 'render_only'), plannedOnly: true };
}

function runExtractors(step: WorkflowStep, output: WorkflowMockStepOutput): Record<string, unknown> {
  const extracted: Record<string, unknown> = {};
  for (const extractor of normalizeExtractors(step.extract)) {
    let value: unknown;
    if (extractor.type === 'statusCode') value = output.statusCode;
    if (extractor.type === 'header') value = output.headers?.[extractor.header ?? ''];
    if (extractor.type === 'jsonPath') value = readJsonPath(output.body, extractor.path ?? '');
    if (extractor.type === 'regex') value = String(output.stdout ?? output.body ?? '').match(new RegExp(extractor.pattern ?? ''))?.[1];
    if (extractor.type === 'textContains') value = String(output.stdout ?? output.body ?? '').includes(extractor.value ?? '');
    if ((value === undefined || value === null) && !extractor.optional) throw new AppError('WORKFLOW_ASSERTION_FAILED', '鎻愬彇鍙橀噺澶辫触', { step: step.name, extractor: extractor.name });
    if (value !== undefined && value !== null) extracted[extractor.name] = extractor.sensitive ? '[SECRET_CAPTURED]' : value;
  }
  return extracted;
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
  return { body: { success: true } };
}

function stepOutputSuccess(step: WorkflowStep, output: WorkflowMockStepOutput): boolean {
  if (step.type === 'http') return [200, 201, 202, 204].includes(output.statusCode ?? 200);
  if (step.type === 'ssh') return (output.exitCode ?? 0) === 0;
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
    if (value === undefined) throw new AppError('VALIDATION_FAILED', '鍙橀噺缂哄け', { key });
    if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  });
}

function maskUnknown(value: unknown, secretPaths: Set<string>, values: Record<string, unknown>): unknown {
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
  return /(password|token|privateKey|authorization|credential|secret|pfx|jks)/i.test(key);
}

function assertionResult(type: string, passed: boolean, message: string): WorkflowStepRunResult['assertions'][number] {
  return { type, passed, message };
}

function emptyStepResult(step: WorkflowStep, status: WorkflowStepRunResult['status'], plan: unknown, logs: string[]): WorkflowStepRunResult {
  return { name: step.name, type: step.type, status, attempts: 0, plan, extracted: {}, assertions: [], logs };
}

function readJsonPath(body: unknown, path: string): unknown {
  if (!path.startsWith('$.')) return undefined;
  return readPath(body, path.slice(2));
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), source);
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
