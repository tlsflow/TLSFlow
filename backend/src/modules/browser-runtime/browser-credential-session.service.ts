import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import type { RequestContext, SecuritySubject, SecretType } from '../../shared/security-types.js';
import { newId } from '../../shared/id.js';
import type { AssetsApplicationService } from '../assets/application/assets.application-service.js';
import type { CredentialsApplicationService } from '../credentials/application/credentials.application-service.js';
import type { UnifiedPluginsApplicationService } from '../plugins/application/unified-plugins.application-service.js';
import type { CredentialAcquireContract, CredentialOutputContract, UnifiedPluginVersionRecord } from '../plugins/dto/unified-plugins.dto.js';
import type { PluginWorkflowBindingsRepositoryPort } from '../plugins/repository/plugin-workflow-bindings.repository.js';
import type { WorkflowTemplatesApplicationService } from '../workflow-templates/application/workflow-templates.application-service.js';
import type { WorkflowBrowserExtraction, WorkflowDslV1, WorkflowExecutorDispatcher, WorkflowTemplateVersion } from '../workflow-templates/dto/workflow-templates.dto.js';
import type { BrowserCredentialSessionRecord } from './browser-credential-session.repository.js';
import type { BrowserRuntimeActionResult, BrowserRuntimeBrowserAction, BrowserRuntimeCreateRequest, BrowserRuntimeSession } from './browser-runtime.types.js';

export interface CreateBrowserCredentialSessionInput {
  assetId: string;
  pluginVersionId: string;
  ttlSeconds?: number;
  idempotencyKey?: string;
}

export interface BrowserCredentialSessionView {
  id: string;
  assetId: string;
  pluginVersionId: string;
  workflowVersionId: string;
  status: 'CREATING' | 'READY_FOR_ACQUISITION' | 'ACQUIRING' | 'SAVED' | 'FAILED' | 'EXPIRED' | 'CLOSED';
  temporaryUrl?: string;
  expiresAt: string;
  credentialId?: string;
  errorCode?: string;
  errorMessage?: string;
  capability: {
    pluginId: string;
    pluginVersion: string;
    loginUrl: string;
    outputParameters: string[];
  };
}

export interface BrowserCredentialSessionStore {
  save(record: BrowserCredentialSessionRecord): Promise<BrowserCredentialSessionRecord>;
  get(tenantId: string, id: string): Promise<BrowserCredentialSessionRecord | undefined>;
  findByIdempotencyKeyHash(tenantId: string, createdBy: string, idempotencyKeyHash: string): Promise<BrowserCredentialSessionRecord | undefined>;
  claimForAcquire(tenantId: string, id: string): Promise<BrowserCredentialSessionRecord | undefined>;
  update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<BrowserCredentialSessionRecord, 'status' | 'credentialProfileId' | 'lastErrorCode' | 'lastErrorMessage'>>,
  ): Promise<BrowserCredentialSessionRecord | undefined>;
  consumeTemporaryUrl(tenantId: string, id: string, oneTimeUrlHash: string): Promise<BrowserCredentialSessionRecord | undefined>;
}

export interface BrowserRuntimePort {
  createSession(input: BrowserRuntimeCreateRequest): Promise<BrowserRuntimeSession>;
  getSession(sessionId: string): Promise<BrowserRuntimeSession>;
  execute(sessionId: string, action: BrowserRuntimeBrowserAction): Promise<BrowserRuntimeActionResult>;
  stopSession(sessionId: string): Promise<void>;
}

export interface CredentialProfileWriter {
  create(tenantId: string, createdBy: string, input: Parameters<CredentialsApplicationService['create']>[2], context?: RequestContext): ReturnType<CredentialsApplicationService['create']>;
}

export interface PluginVersionReader {
  getVersionForTenant(tenantId: string, pluginVersionId: string): Promise<UnifiedPluginVersionRecord>;
}

export interface WorkflowVersionRunner {
  getVersion(versionId: string): Promise<WorkflowTemplateVersion>;
  runWithDispatcher: WorkflowTemplatesApplicationService['runWithDispatcher'];
}

export interface ServiceAssetReader {
  getServiceAssetDetail(tenantId: string, assetId: string): ReturnType<AssetsApplicationService['getServiceAssetDetail']>;
}

export class BrowserCredentialSessionService {
  constructor(
    private readonly sessions: BrowserCredentialSessionStore,
    private readonly runtime: BrowserRuntimePort,
    private readonly credentials: CredentialProfileWriter,
    private readonly plugins: PluginVersionReader,
    private readonly bindings: Pick<PluginWorkflowBindingsRepositoryPort, 'find'>,
    private readonly workflows: WorkflowVersionRunner,
    private readonly assets: ServiceAssetReader,
    private readonly publicBaseUrl = process.env.GCAC_PUBLIC_BASE_URL ?? '',
  ) {}

  async create(tenantId: string, actor: SecuritySubject, input: CreateBrowserCredentialSessionInput): Promise<BrowserCredentialSessionView> {
    const idempotencyKeyHash = optionalIdempotencyHash(input.idempotencyKey);
    if (idempotencyKeyHash) {
      const existing = await this.sessions.findByIdempotencyKeyHash(tenantId, actor.id, idempotencyKeyHash);
      if (existing) {
        throw new AppError('RESOURCE_VERSION_CONFLICT', '同一幂等键已经创建过浏览器会话', {
          sessionId: existing.id,
          status: existing.status,
        });
      }
    }
    const asset = await this.assets.getServiceAssetDetail(tenantId, input.assetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '应用资产不存在', { assetId: input.assetId });
    const plugin = await this.plugins.getVersionForTenant(tenantId, input.pluginVersionId);
    const contract = requireCredentialAcquire(plugin);
    if (plugin.status !== 'ENABLED') throw new AppError('CAPABILITY_MISSING', '插件版本未启用', { pluginVersionId: plugin.id });
    const binding = await this.bindings.find(plugin.id, 'credential.acquire');
    if (!binding) throw new AppError('WORKFLOW_VERSION_UNAVAILABLE', '插件缺少 credential.acquire 工作流绑定', { pluginVersionId: plugin.id });
    const workflow = await this.workflows.getVersion(binding.workflowVersionId);
    if (workflow.status !== 'published' || workflow.contentHash !== binding.workflowContentSha256) {
      throw new AppError('WORKFLOW_VERSION_UNAVAILABLE', 'credential.acquire 工作流版本不可执行', { workflowVersionId: workflow.id });
    }
    const ttlSeconds = normalizeTtl(input.ttlSeconds);
    const id = newId('bcs');
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const runtimeSession = await this.runtime.createSession({
      sessionId: id,
      loginUrl: contract.loginUrl,
      allowedOrigins: contract.allowedOrigins,
      ttlSeconds,
    });
    const record: BrowserCredentialSessionRecord = {
      id,
      tenantId,
      assetId: input.assetId,
      pluginVersionId: plugin.id,
      workflowTemplateId: binding.workflowTemplateId,
      workflowVersionId: binding.workflowVersionId,
      capabilityKey: 'credential.acquire',
      runtimeSessionId: runtimeSession.sessionId,
      oneTimeUrlHash: hashToken(token),
      ...(idempotencyKeyHash ? { idempotencyKeyHash } : {}),
      status: runtimeSession.status === 'ready' ? 'ready' : 'created',
      expiresAt,
      createdBy: actor.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.sessions.save(record);
    return this.view(record, plugin, contract, token);
  }

  async get(tenantId: string, id: string): Promise<BrowserCredentialSessionView> {
    const record = await this.requireRecord(tenantId, id);
    const plugin = await this.plugins.getVersionForTenant(tenantId, record.pluginVersionId);
    const contract = requireCredentialAcquire(plugin);
    const runtime = await this.runtime.getSession(record.runtimeSessionId).catch(() => undefined);
    if (isExpired(record.expiresAt) && record.status !== 'succeeded' && record.status !== 'closed') {
      await this.sessions.update(tenantId, id, { status: 'expired' });
      return this.view({ ...record, status: 'expired' }, plugin, contract);
    }
    if (runtime?.status === 'ready' && record.status === 'created') {
      const updated = await this.sessions.update(tenantId, id, { status: 'ready' });
      return this.view(updated ?? { ...record, status: 'ready' }, plugin, contract);
    }
    return this.view(record, plugin, contract);
  }

  async acquire(tenantId: string, actor: SecuritySubject, id: string, context: RequestContext = {}): Promise<BrowserCredentialSessionView> {
    const claimed = await this.sessions.claimForAcquire(tenantId, id);
    if (!claimed) {
      const current = await this.requireRecord(tenantId, id);
      if (current.status === 'acquiring') throw new AppError('ACQUIRE_ALREADY_RUNNING', '同一浏览器会话已有获取任务');
      if (isExpired(current.expiresAt)) throw new AppError('TEMPORARY_URL_EXPIRED', '浏览器会话已过期');
      throw new AppError('SESSION_NOT_READY', '浏览器会话当前不允许获取凭据', { status: current.status });
    }
    const plugin = await this.plugins.getVersionForTenant(tenantId, claimed.pluginVersionId);
    const contract = requireCredentialAcquire(plugin);
    try {
      const runtime = await this.runtime.getSession(claimed.runtimeSessionId);
      if (runtime.status !== 'ready') throw new AppError('BROWSER_CONTEXT_UNAVAILABLE', '浏览器上下文不可用', { status: runtime.status });
      const workflow = await this.workflows.getVersion(claimed.workflowVersionId);
      if (workflow.status !== 'published') throw new AppError('WORKFLOW_VERSION_UNAVAILABLE', '获取工作流版本已不可用');
      const parameters = await this.runBrowserWorkflow(claimed, workflow.content);
      validateOutput(contract.output, parameters);
      const secretValues = Object.fromEntries(Object.entries(parameters).map(([name, value]) => [
        name,
        { plainText: value, type: contract.output.parameters[name]!.secretType as SecretType },
      ]));
      const credential = await this.credentials.create(tenantId, actor.id, {
        name: `浏览器临时凭据-${claimed.assetId}`,
        kind: 'BROWSER_SESSION',
        scopeType: 'global',
        secretValues,
        metadata: {
          lifecycle: 'temporary',
          expiresAt: claimed.expiresAt,
          browserSessionId: claimed.id,
          assetId: claimed.assetId,
          pluginVersionId: claimed.pluginVersionId,
          workflowVersionId: claimed.workflowVersionId,
          outputContract: contract.output,
        },
      }, context);
      const saved = await this.sessions.update(tenantId, id, { status: 'succeeded', credentialProfileId: credential.id });
      await this.runtime.stopSession(claimed.runtimeSessionId).catch(() => undefined);
      return this.view(saved ?? { ...claimed, status: 'succeeded', credentialProfileId: credential.id }, plugin, contract);
    } catch (error) {
      const errorCode = error instanceof AppError ? error.errorCode : 'WORKFLOW_EXECUTION_FAILED';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failed = await this.sessions.update(tenantId, id, {
        status: 'failed',
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
      });
      await this.runtime.stopSession(claimed.runtimeSessionId).catch(() => undefined);
      if (error instanceof AppError) throw error;
      throw new AppError('WORKFLOW_EXECUTION_FAILED', errorMessage);
    }
  }

  async cancel(tenantId: string, id: string): Promise<BrowserCredentialSessionView> {
    const record = await this.requireRecord(tenantId, id);
    if (record.status === 'succeeded' || record.status === 'closed') {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '浏览器会话已经结束');
    }
    const updated = await this.sessions.update(tenantId, id, { status: 'closed' });
    await this.runtime.stopSession(record.runtimeSessionId).catch(() => undefined);
    const plugin = await this.plugins.getVersionForTenant(tenantId, record.pluginVersionId);
    return this.view(updated ?? { ...record, status: 'closed' }, plugin, requireCredentialAcquire(plugin));
  }

  async connect(tenantId: string, id: string, token: string): Promise<{ vncUrl: string; expiresAt: string }> {
    const record = await this.requireRecord(tenantId, id);
    const tokenHash = hashToken(token);
    if (tokenHash !== record.oneTimeUrlHash) throw new AppError('TEMPORARY_URL_INVALID', '临时 URL 无效');
    if (isExpired(record.expiresAt)) throw new AppError('TEMPORARY_URL_EXPIRED', '临时 URL 已过期');
    if (!['created', 'ready'].includes(record.status)) throw new AppError('SESSION_NOT_READY', '浏览器会话当前不允许连接');
    const runtime = await this.runtime.getSession(record.runtimeSessionId);
    if (runtime.status !== 'ready') throw new AppError('BROWSER_CONTEXT_UNAVAILABLE', '浏览器上下文不可用');
    const consumed = await this.sessions.consumeTemporaryUrl(tenantId, id, tokenHash);
    if (!consumed) throw new AppError('TEMPORARY_URL_INVALID', '临时 URL 已被使用或已失效');
    return { vncUrl: runtime.vncUrl, expiresAt: record.expiresAt };
  }

  private async runBrowserWorkflow(record: BrowserCredentialSessionRecord, content: WorkflowDslV1): Promise<Record<string, string>> {
    if (content.steps.some((step) => step.type === 'browser') === false) {
      throw new AppError('WORKFLOW_EXECUTION_FAILED', 'credential.acquire 工作流没有 browser 步骤');
    }
    const dispatcher: WorkflowExecutorDispatcher = async (dispatch) => {
      const plan = asRecord(dispatch.renderedPlan);
      if (plan?.executor !== 'workflow.browser') {
        return { success: false, errorCode: 'WORKFLOW_RUNNER_INCOMPATIBLE', errorMessage: 'credential.acquire 首期只允许浏览器步骤和内部转换步骤' };
      }
      const result = await this.runtime.execute(record.runtimeSessionId, {
        action: requireBrowserAction(plan.action),
        url: optionalString(plan.url),
        extractions: Array.isArray(plan.extractions) ? plan.extractions.map(toRuntimeExtractionFromPlan) : undefined,
        verification: asRecord(plan.verification) as BrowserRuntimeVerification | undefined,
      });
      return {
        success: result.success,
        statusCode: result.statusCode ?? (result.success ? 200 : 500),
        headers: result.headers,
        body: { parameters: result.parameters ?? {}, verified: result.success },
        raw: { parameters: Object.keys(result.parameters ?? {}), verified: result.success },
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        logs: [`browser:${String(plan.action)}:${result.success ? 'success' : 'failed'}`],
      };
    };
    const run = await this.workflows.runWithDispatcher({
      templateVersionId: record.workflowVersionId,
      mode: 'real_test',
      resolvedInput: {
        apiVersion: 'gcac.resolved-deployment-input/v1',
        contractVersion: content.inputContract.apiVersion,
        assetContext: { applicationAssetId: record.assetId } as never,
        variables: {},
        connections: {},
        credentials: {},
        artifacts: {},
        provenance: {},
        sensitivePaths: [],
        issues: [],
        executable: true,
        resolvedSha256: `browser-session:${record.id}`,
      },
    }, dispatcher);
    if (run.status !== 'success') throw new AppError('WORKFLOW_EXECUTION_FAILED', 'credential.acquire 工作流执行失败');
    const output: Record<string, string> = {};
    for (const step of run.stepResults) {
      for (const [name, value] of Object.entries(step.extracted)) {
        if (typeof value === 'string' && value) output[name] = value;
      }
    }
    return output;
  }

  private async requireRecord(tenantId: string, id: string): Promise<BrowserCredentialSessionRecord> {
    const record = await this.sessions.get(tenantId, id);
    if (!record) throw new AppError('RESOURCE_NOT_FOUND', '浏览器凭据会话不存在', { id });
    return record;
  }

  private view(record: BrowserCredentialSessionRecord, plugin: UnifiedPluginVersionRecord, contract: CredentialAcquireContract, token?: string): BrowserCredentialSessionView {
    const status = {
      created: 'CREATING',
      ready: 'READY_FOR_ACQUISITION',
      acquiring: 'ACQUIRING',
      succeeded: 'SAVED',
      failed: 'FAILED',
      expired: 'EXPIRED',
      closed: 'CLOSED',
    }[record.status] as BrowserCredentialSessionView['status'];
    return {
      id: record.id,
      assetId: record.assetId,
      pluginVersionId: record.pluginVersionId,
      workflowVersionId: record.workflowVersionId,
      status,
      ...(token ? { temporaryUrl: `${this.publicBaseUrl}/api/v1/credentials/browser-sessions/${encodeURIComponent(record.id)}/connect?token=${encodeURIComponent(token)}` } : {}),
      expiresAt: record.expiresAt,
      ...(record.credentialProfileId ? { credentialId: record.credentialProfileId } : {}),
      ...(record.lastErrorCode ? { errorCode: record.lastErrorCode } : {}),
      ...(record.lastErrorMessage ? { errorMessage: record.lastErrorMessage } : {}),
      capability: {
        pluginId: plugin.pluginId,
        pluginVersion: plugin.version,
        loginUrl: contract.loginUrl,
        outputParameters: Object.keys(contract.output.parameters),
      },
    };
  }
}

function requireCredentialAcquire(plugin: UnifiedPluginVersionRecord): CredentialAcquireContract {
  if (!plugin.manifest.capabilities.some((item) => item.key === 'credential.acquire') || !plugin.manifest.credentialAcquire) {
    throw new AppError('CAPABILITY_MISSING', '插件未声明 credential.acquire 能力', { pluginVersionId: plugin.id });
  }
  return plugin.manifest.credentialAcquire;
}

type BrowserRuntimeVerification = {
  url?: string;
  statusCode?: number;
  textContains?: string;
  headers?: Record<string, string>;
};

function toRuntimeExtraction(input: WorkflowBrowserExtraction) {
  return {
    name: input.name,
    source: input.source,
    key: input.key,
    optional: input.optional,
  };
}

function toRuntimeExtractionFromPlan(input: unknown) {
  const record = asRecord(input);
  if (!record) throw new AppError('VALIDATION_FAILED', 'browser extraction 必须是对象');
  return toRuntimeExtraction({
    name: requiredString(record.name, 'name'),
    source: requireExtractionSource(record.source),
    key: optionalString(record.key),
    optional: record.optional === true,
  });
}

function requireBrowserAction(value: unknown): 'navigate' | 'extract' | 'verify' {
  if (value === 'navigate' || value === 'extract' || value === 'verify') return value;
  throw new AppError('VALIDATION_FAILED', 'browser action 不支持');
}

function requireExtractionSource(value: unknown): WorkflowBrowserExtraction['source'] {
  if (value === 'cookie' || value === 'header' || value === 'local_storage' || value === 'session_storage' || value === 'url' || value === 'text') return value;
  throw new AppError('VALIDATION_FAILED', 'browser extraction source 不支持');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requiredString(value: unknown, field: string): string {
  const text = optionalString(value);
  if (!text) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`);
  return text;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateOutput(contract: CredentialOutputContract, output: Record<string, string>): void {
  const allowed = new Set(Object.keys(contract.parameters));
  const extra = Object.keys(output).filter((name) => !allowed.has(name));
  if (extra.length > 0) throw new AppError('CREDENTIAL_OUTPUT_INVALID', '工作流输出包含合同外字段', { fields: extra });
  const missing = Object.entries(contract.parameters).filter(([name, item]) => item.required && !output[name]).map(([name]) => name);
  if (missing.length > 0) throw new AppError('CREDENTIAL_OUTPUT_INVALID', '工作流输出缺少必填字段', { fields: missing });
}

function normalizeTtl(value: number | undefined): number {
  const ttl = value ?? 15 * 60;
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 60 * 60) throw new AppError('VALIDATION_FAILED', '浏览器会话 TTL 必须在 60 秒到 1 小时之间');
  return ttl;
}

function optionalIdempotencyHash(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(trimmed)) {
    throw new AppError('VALIDATION_FAILED', '浏览器会话幂等键必须是 8-128 位安全字符');
  }
  return hashToken(`browser-session:${trimmed}`);
}

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isExpired(value: string): boolean {
  return Date.parse(value) <= Date.now();
}
