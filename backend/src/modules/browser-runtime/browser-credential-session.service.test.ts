import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../common/errors/app-error.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import type { CredentialProfileWriter } from './browser-credential-session.service.js';
import { BrowserCredentialSessionService, type BrowserCredentialSessionStore, type BrowserRuntimePort } from './browser-credential-session.service.js';
import type { BrowserCredentialSessionRecord } from './browser-credential-session.repository.js';
import type { BrowserRuntimeBrowserAction, BrowserRuntimeCreateRequest } from './browser-runtime.types.js';
import type { PluginVersionReader } from './browser-credential-session.service.js';
import type { PluginWorkflowBindingsRepositoryPort } from '../plugins/repository/plugin-workflow-bindings.repository.js';
import type { UnifiedPluginVersionRecord } from '../plugins/dto/unified-plugins.dto.js';
import type { ServiceAssetReader, WorkflowVersionRunner } from './browser-credential-session.service.js';
import type { WorkflowDslV1, WorkflowExecutorDispatcher, WorkflowRunResult, WorkflowTemplateVersion } from '../workflow-templates/dto/workflow-templates.dto.js';

const tenantId = 'tenant_browser_credential';
const actor: SecuritySubject = { id: 'user_browser_credential', type: 'user', scope: { tenantId } };

describe('BrowserCredentialSessionService', () => {
  it('使用同一个 Runtime session 执行获取工作流，并按输出合同保存多参数临时凭据', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      ttlSeconds: 120,
      sharePassword: 'test-password',
      screenWidth: 1600,
      screenHeight: 900,
      idempotencyKey: 'request-001',
    });

    assert.equal(created.status, 'READY_FOR_ACQUISITION');
    assert.match(created.temporaryUrl ?? '', /\/api\/v1\/credentials\/browser-sessions\/.+\/connect\?token=/);

    const acquired = await fixture.service.acquire(tenantId, actor, created.id);

    assert.equal(acquired.status, 'SAVED');
    assert.equal(acquired.credentialId, 'cred_existing_1');
    assert.deepEqual(fixture.runtime.executedSessionIds, [created.id]);
    assert.equal(fixture.credentials.created.length, 0);
    assert.equal(fixture.credentials.updated.length, 1);
    assert.deepEqual(Object.keys(fixture.credentials.updated[0]!.input.secretValues ?? {}).sort(), ['sid', 'token']);
    assert.equal(fixture.credentials.updated[0]!.input.secretValues?.token?.plainText, 'token-value');
    assert.equal(fixture.credentials.updated[0]!.input.secretValues?.sid?.type, 'session_id');
    assert.equal(fixture.credentials.updated[0]!.input.expiresAt, created.expiresAt);
    assert.equal(fixture.credentials.updated[0]!.input.expectedVersion, 1);
    assert.deepEqual(fixture.runtime.createdScreenSizes, [{ width: 1600, height: 900 }]);
    assert.equal(fixture.runtime.stoppedSessionIds.includes(created.id), true);
  });

  it('同一资产重复获取时更新同一个凭据并保留应用资产关联', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    const first = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      ttlSeconds: 120,
      sharePassword: 'test-password',
    });
    const second = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      ttlSeconds: 120,
      sharePassword: 'test-password',
    });

    await fixture.service.acquire(tenantId, actor, first.id);
    await fixture.service.acquire(tenantId, actor, second.id);

    assert.equal(fixture.credentials.created.length, 0);
    assert.equal(fixture.credentials.updated.length, 2);
    assert.equal(fixture.credentials.updated[0]!.credentialId, 'cred_existing_1');
    assert.equal(fixture.credentials.updated[1]!.credentialId, 'cred_existing_1');
    assert.equal(fixture.credentials.updated[0]!.input.metadata?.assetId, 'asset_1');
    assert.equal(fixture.credentials.updated[1]!.input.metadata?.assetId, 'asset_1');
  });

  it('拒绝输出合同外字段，且不创建正式凭据', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value', unexpected: 'leak' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });

    await assert.rejects(
      () => fixture.service.acquire(tenantId, actor, created.id),
      (error) => error instanceof AppError && error.errorCode === 'CREDENTIAL_OUTPUT_INVALID',
    );
    assert.equal(fixture.credentials.created.length, 0);
    assert.equal(fixture.credentials.updated.length, 0);
    assert.equal((await fixture.sessions.get(tenantId, created.id))?.status, 'failed');
  });

  it('拒绝缺少必填输出字段，且不创建正式凭据', async () => {
    const fixture = createFixture({ token: 'token-value' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });

    await assert.rejects(
      () => fixture.service.acquire(tenantId, actor, created.id),
      (error) => error instanceof AppError && error.errorCode === 'CREDENTIAL_OUTPUT_INVALID',
    );
    assert.equal(fixture.credentials.created.length, 0);
    assert.equal(fixture.credentials.updated.length, 0);
  });

  it('同一幂等键重复创建会话时明确返回冲突', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      ttlSeconds: 120,
      sharePassword: 'test-password',
      idempotencyKey: 'request-002',
    });

    await assert.rejects(
      () => fixture.service.create(tenantId, actor, {
        credentialId: 'cred_existing_1',
        assetId: 'asset_1',
        pluginVersionId: 'plugin_version_1',
        ttlSeconds: 120,
        sharePassword: 'test-password',
        idempotencyKey: 'request-002',
      }),
      (error) => error instanceof AppError && error.errorCode === 'RESOURCE_VERSION_CONFLICT',
    );
    assert.equal(fixture.runtime.createdSessionIds.length, 1);
  });

  it('临时 URL 需要密码，并在同一会话内允许重复访问', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });
    const url = new URL(created.temporaryUrl ?? '', 'https://gcac.example.test');
    const token = url.searchParams.get('token') ?? '';

    const pending = await fixture.service.authorizeShare(created.id, token, undefined, undefined);
    assert.equal(pending.authorized, false);
    await assert.rejects(
      () => fixture.service.authorizeShare(created.id, token, 'wrong-password', undefined),
      (error) => error instanceof AppError && error.errorCode === 'AUTH_FORBIDDEN',
    );
    const connected = await fixture.service.authorizeShare(created.id, token, 'test-password', undefined);
    assert.equal(connected.authorized, true);
    assert.match(connected.setCookie ?? '', /HttpOnly/);
    const repeated = await fixture.service.authorizeShare(created.id, token, undefined, connected.setCookie);
    assert.equal(repeated.authorized, true);
  });

  it('使用用户输入的认证地址，并允许不绑定应用资产', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      pluginVersionId: 'plugin_version_1',
      loginUrl: 'https://asset.example.test/device/login',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });

    assert.equal(fixture.runtime.createdLoginUrls[0], 'https://asset.example.test/device/login');
    const queried = await fixture.service.get(tenantId, created.id);
    assert.equal(queried.loginUrl, 'https://asset.example.test/device/login');
    assert.equal(queried.capability.loginUrl, 'https://asset.example.test/device/login');
  });

  it('未显式传入认证地址时使用凭据保存的 browserLoginUrl', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      pluginVersionId: 'plugin_version_1',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });

    assert.equal(fixture.runtime.createdLoginUrls[0], 'https://asset.example.test/saved-login');
    assert.equal(created.loginUrl, 'https://asset.example.test/saved-login');
  });

  it('查询到过期会话时主动停止 Runtime 并标记 EXPIRED', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      pluginVersionId: 'plugin_version_1',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });
    fixture.sessions.expire(created.id);

    const expired = await fixture.service.get(tenantId, created.id);

    assert.equal(expired.status, 'EXPIRED');
    assert.deepEqual(fixture.runtime.stoppedSessionIds, [created.id]);
  });

  it('允许插件白名单外的认证地址，并将其加入当前会话访问范围', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });

    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      pluginVersionId: 'plugin_version_1',
      loginUrl: 'https://untrusted.example.test/login',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });

    assert.equal(created.loginUrl, 'https://untrusted.example.test/login');
    assert.deepEqual(fixture.runtime.createdAllowedOrigins[0], [
      'https://asset.example.test',
      'https://untrusted.example.test',
    ]);
  });

  it('只有完成密码校验后才能通过同源代理读取 VNC 资源', async () => {
    const fixture = createFixture({ token: 'token-value', sid: 'session-value' });
    const created = await fixture.service.create(tenantId, actor, {
      credentialId: 'cred_existing_1',
      assetId: 'asset_1',
      pluginVersionId: 'plugin_version_1',
      sharePassword: 'test-password',
      ttlSeconds: 120,
    });
    const token = new URL(created.temporaryUrl ?? '').searchParams.get('token') ?? '';
    const access = await fixture.service.authorizeShare(created.id, token, 'test-password', undefined);

    const proxied = await fixture.service.proxyVncHttp(created.id, access.setCookie, 'vnc.html', '?autoconnect=true');
    assert.equal(proxied.statusCode, 200);
    assert.equal(proxied.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(proxied.body.toString('utf8'), 'vnc-html');
    assert.equal(fixture.runtime.proxiedSessionIds.at(-1), created.id);
    await assert.rejects(
      () => fixture.service.proxyVncHttp(created.id, undefined, 'vnc.html', ''),
      (error) => error instanceof AppError && error.errorCode === 'AUTH_UNAUTHENTICATED',
    );
  });
});

function createFixture(parameters: Record<string, string>) {
  const sessions = new InMemoryBrowserCredentialSessions();
  const runtime = new FakeBrowserRuntime(parameters);
  const credentials = new FakeCredentialWriter();
  const workflow = browserWorkflow();
  const service = new BrowserCredentialSessionService(
    sessions,
    runtime,
    credentials,
    new FakePluginVersions(),
    new FakeWorkflowBindings(),
    new FakeWorkflowRunner(workflow),
    new FakeAssets(),
    'https://gcac.example.test',
  );
  return { service, sessions, runtime, credentials };
}

function browserWorkflow(): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name: 'browser-credential-acquire', version: '1.0.0' },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {},
      connections: {},
      credentials: {},
      artifacts: {},
    },
    steps: [{
      name: 'extractCredentials',
      type: 'browser',
      browser: {
        action: 'extract',
        extractions: [
          { name: 'token', source: 'local_storage', key: 'access_token', sensitive: true },
          { name: 'sid', source: 'cookie', key: 'sid', sensitive: true },
        ],
      },
    }],
  };
}

class InMemoryBrowserCredentialSessions implements BrowserCredentialSessionStore {
  private readonly records = new Map<string, BrowserCredentialSessionRecord>();

  async save(record: BrowserCredentialSessionRecord): Promise<BrowserCredentialSessionRecord> {
    this.records.set(record.id, { ...record });
    return { ...record };
  }

  async get(tenant: string, id: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const record = this.records.get(id);
    return record?.tenantId === tenant ? { ...record } : undefined;
  }

  async getById(id: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  async findByIdempotencyKeyHash(tenant: string, createdBy: string, idempotencyKeyHash: string): Promise<BrowserCredentialSessionRecord | undefined> {
    return [...this.records.values()].find((record) => record.tenantId === tenant
      && record.createdBy === createdBy
      && record.idempotencyKeyHash === idempotencyKeyHash);
  }

  async claimForAcquire(tenant: string, id: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const record = await this.get(tenant, id);
    if (!record || !['created', 'ready'].includes(record.status) || Date.parse(record.expiresAt) <= Date.now()) return undefined;
    const next = { ...record, status: 'acquiring' as const, updatedAt: new Date().toISOString() };
    this.records.set(id, next);
    return { ...next };
  }

  async update(
    tenant: string,
    id: string,
    patch: Partial<Pick<BrowserCredentialSessionRecord, 'status' | 'credentialProfileId' | 'lastErrorCode' | 'lastErrorMessage'>>,
  ): Promise<BrowserCredentialSessionRecord | undefined> {
    const record = await this.get(tenant, id);
    if (!record) return undefined;
    const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
    this.records.set(id, next);
    return { ...next };
  }

  async consumeTemporaryUrl(tenant: string, id: string, oneTimeUrlHash: string): Promise<BrowserCredentialSessionRecord | undefined> {
    const record = await this.get(tenant, id);
    if (!record || record.oneTimeUrlHash !== oneTimeUrlHash || Date.parse(record.expiresAt) <= Date.now()) return undefined;
    const next = { ...record, oneTimeUrlHash: `consumed:${record.oneTimeUrlHash}`, updatedAt: new Date().toISOString() };
    this.records.set(id, next);
    return { ...next };
  }

  expire(id: string): void {
    const record = this.records.get(id);
    if (record) this.records.set(id, { ...record, expiresAt: new Date(Date.now() - 1_000).toISOString() });
  }
}

class FakeBrowserRuntime implements BrowserRuntimePort {
  readonly createdSessionIds: string[] = [];
  readonly createdLoginUrls: string[] = [];
  readonly createdAllowedOrigins: string[][] = [];
  readonly createdScreenSizes: Array<{ width?: number; height?: number }> = [];
  readonly executedSessionIds: string[] = [];
  readonly stoppedSessionIds: string[] = [];
  readonly proxiedSessionIds: string[] = [];

  constructor(private readonly parameters: Record<string, string>) {}

  async createSession(input: BrowserRuntimeCreateRequest) {
    this.createdSessionIds.push(input.sessionId);
    this.createdLoginUrls.push(input.loginUrl);
    this.createdAllowedOrigins.push(input.allowedOrigins);
    this.createdScreenSizes.push({ width: input.screenWidth, height: input.screenHeight });
    return {
      sessionId: input.sessionId,
      status: 'ready' as const,
      vncUrl: '/vnc/session',
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000).toISOString(),
    };
  }

  async getSession(sessionId: string) {
    return {
      sessionId,
      status: 'ready' as const,
      vncUrl: '/vnc/session',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
  }

  async execute(sessionId: string, action: BrowserRuntimeBrowserAction) {
    this.executedSessionIds.push(sessionId);
    assert.equal(action.action, 'extract');
    return { success: true, statusCode: 200, parameters: this.parameters };
  }

  async stopSession(sessionId: string): Promise<void> {
    this.stoppedSessionIds.push(sessionId);
  }

  async proxyVncHttp(sessionId: string, _innerPath: string, _search: string) {
    this.proxiedSessionIds.push(sessionId);
    return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('vnc-html') };
  }

  getVncWebSocketUrl(sessionId: string): string {
    return `ws://runtime.test/vnc/${sessionId}/websockify`;
  }
}

class FakeCredentialWriter implements CredentialProfileWriter {
  readonly created: never[] = [];
  readonly updated: Array<{
    tenantId: string;
    credentialId: string;
    actorId: string;
    input: Parameters<CredentialProfileWriter['update']>[3];
  }> = [];
  private current = {
    id: 'cred_existing_1',
    tenantId,
    name: '现有浏览器凭据',
    kind: 'BROWSER_SESSION' as const,
    scopeType: 'global' as const,
      secretSlots: { cookie: 'secret://cookie/sec_existing#current' } as Record<string, string>,
    metadata: {
      assetId: 'asset_1',
      browserLoginUrl: 'https://asset.example.test/saved-login',
      lifecycle: 'temporary',
      outputContract: {
        version: 'credential.output/v1',
        parameters: {
          cookie: { secretType: 'cookie', required: true, delivery: { location: 'cookie', name: 'sid' } },
          token: { secretType: 'api_token', required: true, delivery: { location: 'header', name: 'Authorization' } },
        },
      },
    },
    status: 'active' as const,
    version: 1,
    createdBy: actor.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  async get() {
    return { ...this.current, metadata: { ...this.current.metadata } };
  }

  async update(
    tenant: string,
    credentialId: string,
    actorId: string,
    input: Parameters<CredentialProfileWriter['update']>[3],
  ) {
    assert.equal(tenant, this.current.tenantId);
    assert.equal(credentialId, this.current.id);
    assert.equal(input.expectedVersion, this.current.version);
    this.updated.push({ tenantId: tenant, credentialId, actorId, input });
    this.current = {
      ...this.current,
      secretSlots: Object.fromEntries(Object.keys(input.secretValues ?? {}).map((name) => [name, `secret://${name}/sec_${name}#current`])),
      metadata: { ...this.current.metadata, ...(input.metadata ?? {}) },
      version: this.current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return { ...this.current, metadata: { ...this.current.metadata } };
  }
}

class FakePluginVersions implements PluginVersionReader {
  async getVersionForTenant(): Promise<UnifiedPluginVersionRecord> {
    return {
      id: 'plugin_version_1',
      tenantId,
      pluginId: 'plugin.browser.fixture',
      version: '1.0.0',
      source: 'USER',
      runtime: 'WORKFLOW_DSL',
      scope: 'MANAGED',
      trust: 'USER_SIGNED',
      support: 'SELF_MANAGED',
      status: 'ENABLED',
      packageSha256: 'pkg',
      manifestSha256: 'manifest',
      resourceSha256: {},
      resources: {},
      permissionApprovalStatus: 'APPROVED',
      approvedPermissions: [],
      validationReport: { valid: true, errors: [], warnings: [], manifestSha256: 'manifest', resourceSha256: {} },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      manifest: {
        apiVersion: 'gcac.plugin-manifest/v1',
        kind: 'GcacPlugin',
        pluginId: 'plugin.browser.fixture',
        version: '1.0.0',
        displayNameKey: 'fixture',
        publisher: 'fixture',
        runtime: 'WORKFLOW_DSL',
        source: 'USER',
        scope: 'MANAGED',
        trust: 'USER_SIGNED',
        support: 'SELF_MANAGED',
        capabilities: [{
          key: 'credential.acquire',
          contractVersion: 'v1',
          actionContractId: 'credential.acquire.v1',
          riskLevel: 'HIGH',
          executionLocations: ['CONTROL_PLANE'],
        }],
        credentialAcquire: {
          inputContractVersion: 'gcac.credential-acquire-input/v1',
          loginUrl: 'https://asset.example.test/login',
          allowedOrigins: ['https://asset.example.test'],
          output: {
            version: 'gcac.credential-output/v1',
            parameters: {
              token: { secretType: 'api_token', required: true, delivery: { location: 'header', name: 'Authorization' } },
              sid: { secretType: 'session_id', required: true, delivery: { location: 'cookie', name: 'sid' } },
            },
          },
        },
        permissions: [],
        resources: { workflows: { 'credential.acquire': 'workflows/acquire.json' } },
      },
    };
  }
}

class FakeWorkflowBindings implements Pick<PluginWorkflowBindingsRepositoryPort, 'find'> {
  async find() {
    return {
      pluginVersionId: 'plugin_version_1',
      pluginId: 'plugin.browser.fixture',
      capabilityKey: 'credential.acquire',
      workflowKey: 'credential.acquire',
      workflowResourcePath: 'workflows/acquire.json',
      workflowTemplateId: 'workflow_template_1',
      workflowVersionId: 'workflow_version_1',
      workflowContentSha256: 'hash_fixture',
      createdAt: new Date().toISOString(),
    };
  }
}

class FakeWorkflowRunner implements WorkflowVersionRunner {
  constructor(private readonly content: WorkflowDslV1) {}

  async getVersion(): Promise<WorkflowTemplateVersion> {
    return {
      id: 'workflow_version_1',
      templateId: 'workflow_template_1',
      version: 1,
      dslVersion: 'v1',
      content: this.content,
      contentHash: 'hash_fixture',
      status: 'published',
      createdAt: new Date().toISOString(),
    };
  }

  async runWithDispatcher(_input: unknown, dispatcher: WorkflowExecutorDispatcher): Promise<WorkflowRunResult> {
    const step = this.content.steps[0]!;
    const result = await dispatcher({
      runId: 'run_browser_credential',
      step,
      renderedPlan: {
        executor: 'workflow.browser',
        action: 'extract',
        extractions: step.type === 'browser' ? step.browser.extractions : [],
      },
      attempt: 1,
      rollback: false,
    });
    const parameters = (result.body && typeof result.body === 'object' && 'parameters' in result.body)
      ? result.body.parameters as Record<string, string>
      : {};
    return {
      id: 'run_browser_credential',
      mode: 'real_test',
      executionBranch: 'deploy',
      plannedOnly: false,
      status: result.success ? 'success' : 'failed',
      renderedSteps: [],
      stepResults: [{
        name: step.name,
        type: step.type,
        status: result.success ? 'success' : 'failed',
        attempts: 1,
        plan: {},
        extracted: parameters,
        assertions: [],
        logs: result.logs ?? [],
      }],
      rollbackResults: [],
      logs: [],
    };
  }
}

class FakeAssets implements ServiceAssetReader {
  async getServiceAssetDetail() {
    return { id: 'asset_1', name: '资产 1' } as unknown as Awaited<ReturnType<ServiceAssetReader['getServiceAssetDetail']>>;
  }
}
