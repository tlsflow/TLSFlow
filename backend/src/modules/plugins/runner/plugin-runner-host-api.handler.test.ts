import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { WriteAuditInput } from '../../audits/audit.service.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { createPluginRunnerHostApiHandler, type PluginRunnerHostApiDependencies } from './plugin-runner-host-api.handler.js';
import { PgPluginRunnerHostApiRequestStore, PluginRunnerHostApiRequestGate, type HostApiRequestAdmission, type HostApiRequestCompleteResult, type HostApiRequestOutcome, type PluginRunnerHostApiRequestStore, type HostApiRequestClaimResult, type HostApiRequestExpireResult } from './host-api.request-gate.js';
import type { PluginRunnerHostCallContext } from './plugin-runner-client.js';
import { getHostApiMethod } from './protocol/host-api.registry.js';
import type { PluginRunnerError } from './protocol/protocol.types.js';

const planDigest = 'b'.repeat(64);
const allActions = ['cloud.service.get', 'artifact.read', 'secret.resolve', 'network.http', 'execution.progress', 'execution.checkpoint', 'execution.cancel', 'resource.lock', 'audit.append'];

test('Host API 的十一项已登记方法均走绑定 Grant、持久化端口和审计', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);

  const artifact = await handler({ ...context('artifact.grant.read', ['artifact.read']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } });
  assert.equal((artifact.data as Record<string, unknown>).contentBase64, Buffer.from('artifact-data').toString('base64'));

  const secret = await handler({ ...context('secret.grant.resolve', ['secret.resolve']), input: { grantId: 'grant-1', secretRef: 'secret://api_token/secret-1#current', purpose: 'secret.resolve' } });
  assert.equal(JSON.stringify(secret).includes('plain-text-must-not-leak'), false);
  assert.equal((secret.data as Record<string, unknown>).value, '[REDACTED]');

  const progress = await handler({ ...context('execution.progress', ['execution.progress']), input: { executionId: 'run-1', executionStepId: 'step-1', sequence: 3, stage: 'prepare', summary: '已准备' } });
  assert.deepEqual(progress, { ok: true, data: { accepted: true, sequence: 3, stage: 'prepare' } });
  await assert.rejects(
    handler({ ...context('execution.progress', ['execution.progress']), input: { executionId: 'run-1', executionStepId: 'step-1', sequence: 3, stage: 'other', summary: '同序号不同内容' } }),
    /幂等键|摘要/,
  );

  const payload = { snapshot: 'v1' };
  const digest = sha256(payload);
  const checkpoint = await handler({ ...context('execution.checkpoint.save', ['execution.checkpoint']), input: { executionId: 'run-1', executionStepId: 'step-1', payload, digest } });
  assert.equal((checkpoint.data as Record<string, unknown>).checkpointRef, 'checkpoint-1');
  const loaded = await handler({ ...context('execution.checkpoint.load', ['execution.checkpoint']), input: { checkpointRef: 'checkpoint-1' } });
  assert.deepEqual((loaded.data as Record<string, unknown>).payload, payload);

  const cancelled = await handler({ ...context('execution.isCancelled', ['execution.cancel']), input: { executionId: 'run-1', executionStepId: 'step-1' } });
  assert.deepEqual(cancelled, { ok: true, data: { cancelled: false } });

  const acquired = await handler({ ...context('resourceLock.acquire', ['resource.lock']), input: { resourceKey: 'certificate:1', ownerRunId: 'run-1', ownerStepId: 'step-1', ttlSeconds: 30 } });
  assert.equal((acquired.data as Record<string, unknown>).lockId, 'lock-1');
  await handler({ ...context('resourceLock.release', ['resource.lock']), input: { lockId: 'lock-1', ownerRunId: 'run-1', ownerStepId: 'step-1' } });
  await handler({ ...context('audit.append', ['audit.append']), input: { eventType: 'plugin.fixture', action: 'fixture.run', resourceType: 'fixture', resourceId: 'fixture-1', result: 'success', detail: { secret: 'should-be-redacted-by-audit-service' } } });

  assert.equal(fixture.validations.every((input) => input.executorType === 'PLUGIN_RUNNER'), true);
  assert.equal(fixture.validations.every((input) => input.tenantId === 'tenant-1' && input.runId === 'run-1' && input.stepId === 'step-1'), true);
  assert.equal(fixture.validations.every((input) => input.workflowVersionId === 'workflow-1' && input.pluginVersionId === 'plugin-version-1' && input.pluginId === 'test.echo' && input.capability === 'test.echo' && input.planDigest === planDigest), true);
  assert.equal(fixture.progress.length, 1);
  assert.equal(fixture.locks.acquires.length, 1);
  assert.equal(fixture.locks.releases.length, 1);
  assert.equal(fixture.audits.some((event) => event.eventType === 'plugin.host_api.call'), true);
});

test('Host API 对错步骤、未绑定 Grant、权限不足、checkpoint 越权和未知方法失败关闭', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);

  await assert.rejects(
    handler({ ...context('execution.progress', ['execution.progress']), input: { executionId: 'run-1', executionStepId: 'other-step', sequence: 1, stage: 'prepare', summary: '错误步骤' } }),
    /绑定不匹配/,
  );
  await assert.rejects(
    handler({ ...context('secret.grant.resolve', ['secret.resolve'], ['other-grant']), input: { grantId: 'grant-1', secretRef: 'secret://api_token/secret-1#current', purpose: 'secret.resolve' } }),
    /未绑定|无权/,
  );
  await assert.rejects(
    handler({ ...context('artifact.grant.read', []), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } }),
    /权限不足/,
  );

  fixture.checkpoint.ledgerId = 'other-ledger';
  await assert.rejects(handler({ ...context('execution.checkpoint.load', ['execution.checkpoint']), input: { checkpointRef: 'checkpoint-1' } }), /不属于当前/);
  await assert.rejects(
    handler({ ...context('plugin.invoke', [], []), method: 'plugin.invoke', input: {} }),
    /未注册/,
  );
  assert.equal(fixture.audits.some((event) => event.result === 'denied'), true);
});

test('Cloud Service 只读取当前租户 ACTIVE 标准对象，HTTP 只允许有界 HTTPS', async () => {
  const fixture = createFixture();
  const requests: unknown[] = [];
  fixture.dependencies.cloudServices = {
    get: async (tenantId: string, id: string) => ({
      id,
      tenantId,
      assetKind: 'cloud.account',
      providerKey: 'cloud.aliyun',
      displayName: '开发云账号',
      credentialRef: 'credential://not-returned',
      scope: { endpoint: 'https://cloud.example.invalid', metadata: { region: 'cn-test-1' } },
      status: 'ACTIVE',
      metadata: { managed: true },
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      version: 1,
    }),
    list: async (tenantId: string) => ({
      items: [{
        id: 'caa-1',
        tenantId,
        assetKind: 'cloud.account',
        providerKey: 'cloud.aliyun',
        displayName: '开发云账号',
        credentialRef: 'credential://not-returned',
        scope: { endpoint: 'https://cloud.example.invalid', metadata: { region: 'cn-test-1' } },
        status: 'ACTIVE',
        metadata: { managed: true },
        createdAt: '2026-08-10T00:00:00.000Z',
        updatedAt: '2026-08-10T00:00:00.000Z',
        version: 1,
      }],
      page: 1,
      pageSize: 1,
      total: 1,
    }),
  };
  fixture.dependencies.httpClient = {
    request: async (request) => {
      requests.push(request);
      return { statusCode: 200, headers: { 'content-type': 'application/json' }, bodyText: '{"status":"SUCCEEDED"}', body: { status: 'SUCCEEDED' } };
    },
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);

  const cloudContext = { ...context('cloudService.get', ['cloud.service.get']), pluginId: 'cloud.aliyun' };
  const service = await handler({ ...cloudContext, input: { cloudServiceRef: 'caa-1' } });
  assert.equal((service.data as Record<string, unknown>).kind, 'CloudService');
  assert.equal((service.data as Record<string, unknown>).credentialRef, undefined);
  assert.equal((service.data as Record<string, unknown>).endpoint, undefined);
  assert.deepEqual((service.data as Record<string, unknown>).scope, { endpoint: 'https://cloud.example.invalid', metadata: { region: 'cn-test-1' } });
  const response = await handler({ ...context('http.request', ['network.http']), pluginId: 'cloud.aliyun', input: { url: 'https://cloud.example.invalid/api', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } });
  assert.equal((response.data as Record<string, unknown>).statusCode, 200);
  assert.equal(requests.length, 1);

  await assert.rejects(
    handler({ ...context('http.request', ['network.http']), pluginId: 'cloud.aliyun', input: { url: 'http://cloud.example.invalid/api', method: 'GET', headers: {} } }),
    /Schema|格式|HTTPS/,
  );
  await assert.rejects(
    handler({ ...context('http.request', ['network.http']), pluginId: 'cloud.aliyun', input: { url: 'https://unbound.example.invalid/api', method: 'GET', headers: {} } }),
    /ACTIVE Cloud Service/,
  );
});

test('Cloud Service 非 ACTIVE 或 Host API 装配缺失时失败关闭', async () => {
  const fixture = createFixture();
  fixture.dependencies.cloudServices = { get: async () => ({ tenantId: 'tenant-1', status: 'DISABLED' } as never), list: async () => ({ items: [], page: 1, pageSize: 0, total: 0 }) };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  await assert.rejects(
    handler({ ...context('cloudService.get', ['cloud.service.get']), pluginId: 'cloud.aliyun', input: { cloudServiceRef: 'caa-1' } }),
    /ACTIVE/,
  );
  await assert.rejects(
    handler({ ...context('http.request', ['network.http']), input: { url: 'https://example.invalid', method: 'GET', headers: {} } }),
    /HTTP Host API 未装配/,
  );
});

test('生产 Host API 未装配持久化消费门禁时失败关闭，不使用内存 fallback', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler({ ...fixture.dependencies, requestGate: undefined });
  await assert.rejects(
    handler({ ...context('artifact.grant.read', ['artifact.read']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } }),
    /持久化幂等消费门禁/,
  );
});

test('Host API 缺少请求固定材料或 Grant 时失败关闭，不进入宿主消费', async () => {
  const cases: Array<[string, Partial<PluginRunnerHostCallContext>, RegExp]> = [
    ['requestId', { requestId: '' }, /固定执行绑定/],
    ['idempotencyKey', { idempotencyKey: '' }, /固定执行绑定/],
    ['planDigest', { planDigest: 'invalid' }, /planDigest/],
    ['hostPermissions', { hostPermissions: [] }, /权限不足/],
    ['grantRefs', { grantRefs: [] }, /权限不足|Grant/],
  ];
  for (const [, override, expected] of cases) {
    const fixture = createFixture();
    const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
    await assert.rejects(
      handler({ ...context('artifact.grant.read', ['artifact.read']), ...override, input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } }),
      expected,
    );
    assert.equal(fixture.requestStore.claimCalls, 0);
  }
});

test('Host API 已完成请求只重放结果，不重复消费宿主能力', async () => {
  const fixture = createFixture();
  let reads = 0;
  fixture.dependencies.artifacts.get = async (artifactRef: string) => {
    reads += 1;
    return { tenantId: 'tenant-1', artifactRef, content: Buffer.from('artifact-data'), contentType: 'application/octet-stream', sha256: 'c'.repeat(64), createdBy: 'fixture', createdAt: '2026-08-10T00:00:00.000Z' };
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const request = { ...context('artifact.grant.read', ['artifact.read']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } };
  await handler(request);
  await handler(request);
  assert.equal(reads, 1);
  assert.equal(fixture.requestStore.completeCalls, 1);
});

test('Host API 幂等键或绑定 Grant 摘要冲突时失败关闭，不提交第二次', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const first = { ...context('execution.progress', ['execution.progress'], ['grant-1']), input: { executionId: 'run-1', executionStepId: 'step-1', sequence: 9, stage: 'prepare', summary: '第一次' } };
  const conflict = { ...context('execution.progress', ['execution.progress'], ['grant-2']), input: { executionId: 'run-1', executionStepId: 'step-1', sequence: 9, stage: 'prepare', summary: '第一次' } };

  await handler(first);
  await assert.rejects(handler(conflict), /幂等键|摘要/);
  assert.equal(fixture.progress.length, 1);
  assert.equal(fixture.requestStore.completeCalls, 1);
});

test('生产 Host API 请求账本跨 Store 实例恢复，不重复获得消费权', async () => {
  const db = new PgliteDatabase();
  try {
    const definition = getHostApiMethod('artifact.grant.read');
    const input = { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' };
    const base = context(definition.method, ['artifact.read']);
    const binding = {
      ...base,
      input,
      pluginVersion: '1.0.0',
      hostPermissions: base.hostPermissions,
    };
    const firstGate = new PluginRunnerHostApiRequestGate(new PgPluginRunnerHostApiRequestStore(db));
    const restartedGate = new PluginRunnerHostApiRequestGate(new PgPluginRunnerHostApiRequestStore(db));
    const admission = firstGate.createAdmission(binding, definition);
    assert.deepEqual(await firstGate.claim(admission), { status: 'ACQUIRED' });
    assert.deepEqual(await restartedGate.claim(admission), { status: 'IN_FLIGHT' });
    assert.equal(await firstGate.complete(admission, { ok: true, output: { contentBase64: 'persisted' } }), 'COMMITTED');
    assert.deepEqual(await restartedGate.claim(admission), { status: 'COMPLETED', outcome: { ok: true, output: { contentBase64: 'persisted' } } });
  } finally {
    await db.close();
  }
});

test('Host API 超时后迟到结果不能提交，重放只能收敛为 UNKNOWN', async () => {
  const fixture = createFixture();
  fixture.dependencies.artifacts.get = async (artifactRef: string) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    return { tenantId: 'tenant-1', artifactRef, content: Buffer.from('late'), contentType: 'application/octet-stream', sha256: 'c'.repeat(64), createdBy: 'fixture', createdAt: '2026-08-10T00:00:00.000Z' };
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const request = { ...context('artifact.grant.read', ['artifact.read']), timeoutMs: 5, deadlineAt: new Date(Date.now() + 500).toISOString(), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } };
  await assert.rejects(handler(request), /超时|UNKNOWN/);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
  await assert.rejects(handler(request), /UNKNOWN|已过期/);
  assert.equal(fixture.requestStore.expireCalls, 1);
  assert.equal(fixture.requestStore.completeCalls, 1);
  assert.ok(fixture.audits.filter((event) => event.result === 'failure').length >= 2);
});

test('Host API 已完成账本缺少 Receipt 时失败关闭且不重放宿主写操作', async () => {
  const fixture = createFixture();
  let reads = 0;
  fixture.dependencies.artifacts.get = async (artifactRef: string) => {
    reads += 1;
    return { tenantId: 'tenant-1', artifactRef, content: Buffer.from('artifact-data'), contentType: 'application/octet-stream', sha256: 'c'.repeat(64), createdBy: 'fixture', createdAt: '2026-08-10T00:00:00.000Z' };
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const request = { ...context('artifact.grant.read', ['artifact.read']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } };

  await handler(request);
  fixture.requestStore.removeReceipt(fixture.requestStore.lastAdmission!);
  await assert.rejects(handler(request), /Receipt|UNKNOWN/);
  assert.equal(reads, 1);
});

test('Host API UNKNOWN 状态不可重放，也不再次获得宿主消费权', async () => {
  const fixture = createFixture();
  fixture.dependencies.artifacts.get = async (artifactRef: string) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
    return { tenantId: 'tenant-1', artifactRef, content: Buffer.from('unknown'), contentType: 'application/octet-stream', sha256: 'c'.repeat(64), createdBy: 'fixture', createdAt: '2026-08-10T00:00:00.000Z' };
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const request = { ...context('artifact.grant.read', ['artifact.read']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' }, timeoutMs: 5, deadlineAt: new Date(Date.now() + 500).toISOString() };

  await assert.rejects(handler(request), /超时|UNKNOWN/);
  const claimCallsAfterUnknown = fixture.requestStore.claimCalls;
  await assert.rejects(handler(request), /UNKNOWN|已过期/);
  assert.equal(fixture.progress.length, 0);
  assert.equal(fixture.requestStore.claimCalls, claimCallsAfterUnknown + 1);
});

test('Host API 消费权内的确定性拒绝会落终态，不遗留 IN_FLIGHT', async () => {
  const fixture = createFixture();
  fixture.checkpoint.ledgerId = 'other-ledger';
  let reads = 0;
  fixture.dependencies.workflowRecovery.getCheckpoint = async () => {
    reads += 1;
    return {
      id: 'checkpoint-1', tenantId: 'tenant-1', ledgerId: 'other-ledger', checkpointName: 'checkpoint-1',
      workflowStepName: 'step-1', capture: { snapshot: 'v1' }, captureHash: sha256({ snapshot: 'v1' }),
      requiredForRollback: false, createdAt: '2026-08-10T00:00:00.000Z',
    };
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const request = { ...context('execution.checkpoint.load', ['execution.checkpoint']), input: { checkpointRef: 'checkpoint-1' } };
  await assert.rejects(handler(request), /不属于当前/);
  await assert.rejects(handler(request), /已记录失败结果|禁止重新执行/);
  assert.equal(reads, 1);
});

test('Host API 拒绝已过期截止时间，不创建消费记录', async () => {
  const fixture = createFixture();
  let reads = 0;
  fixture.dependencies.artifacts.get = async () => {
    reads += 1;
    return undefined;
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  await assert.rejects(
    handler({ ...context('artifact.grant.read', ['artifact.read']), deadlineAt: new Date(Date.now() - 1).toISOString(), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } }),
    /已过期|UNKNOWN/,
  );
  assert.equal(reads, 0);
});

test('Plugin Runner Grant 缺少完整身份绑定或字段不一致时拒绝创建和校验', async () => {
  const { ExecutionGrantService } = await import('../../executions/execution-grant.service.js');
  const service = new ExecutionGrantService();
  await assert.rejects(service.create({
    tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER',
    allowedSecretRefs: [], allowedActions: ['artifact.read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');

  const grant = await service.create({
    tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER',
    workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', planDigest,
    allowedSecretRefs: [], allowedActions: ['artifact.read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await service.validate({ grantId: grant.id, tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER', workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', planDigest });
  await assert.rejects(service.validate({ grantId: grant.id, tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER', workflowVersionId: 'workflow-1', pluginVersionId: 'other-version', pluginId: 'test.echo', capability: 'test.echo', planDigest }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');
  await assert.rejects(service.validate({ grantId: grant.id, tenantId: 'other-tenant', runId: 'run-1', stepId: 'step-1', executorType: 'PLUGIN_RUNNER', workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', planDigest }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');
});

function createFixture() {
  const validations: Array<Record<string, unknown>> = [];
  const audits: WriteAuditInput[] = [];
  const progress: unknown[] = [];
  const locks = { acquires: [] as Array<Record<string, unknown>>, releases: [] as Array<Record<string, unknown>> };
  const checkpoint = { ledgerId: 'ledger-1' };
  const requestStore = new TestHostApiRequestStore();
  const dependencies: PluginRunnerHostApiDependencies = {
    requestGate: new PluginRunnerHostApiRequestGate(requestStore),
    security: {
      grants: {
        validate: async (input: Record<string, unknown>) => {
          validations.push(input);
          return { id: String(input.grantId), allowedActions: allActions, allowedArtifactRefs: ['artifact://artifact-1'] };
        },
      },
      secrets: {
        resolveForExecution: async () => ({ secretRef: 'secret://api_token/secret-1#current', versionId: 'secret-version-1', plainText: 'plain-text-must-not-leak', fingerprint: 'a'.repeat(64) }),
      },
      audit: {
        write: async (input: WriteAuditInput) => {
          audits.push(input);
          return {} as never;
        },
      },
    } as unknown as PluginRunnerHostApiDependencies['security'],
    artifacts: {
      get: async (artifactRef: string) => artifactRef === 'artifact://artifact-1'
        ? { tenantId: 'tenant-1', artifactRef, content: Buffer.from('artifact-data'), contentType: 'application/octet-stream', sha256: 'c'.repeat(64), createdBy: 'fixture', createdAt: '2026-08-10T00:00:00.000Z' }
        : undefined,
    },
    resourceLocks: {
      acquire: async (input: Record<string, unknown>) => {
        locks.acquires.push(input);
        return { id: 'lock-1' } as never;
      },
      release: async (input: Record<string, unknown>) => {
        locks.releases.push(input);
      },
    },
    workflowRecovery: {
      begin: async () => ({ id: 'ledger-1' }),
      recordCheckpoint: async () => ({ id: 'checkpoint-1', captureHash: sha256({ snapshot: 'v1' }) }),
      get: async () => ({ ledger: { id: 'ledger-1' }, checkpoints: [] }),
      getCheckpoint: async () => ({ id: 'checkpoint-1', ledgerId: checkpoint.ledgerId, capture: { snapshot: 'v1' }, captureHash: sha256({ snapshot: 'v1' }) }),
    } as unknown as PluginRunnerHostApiDependencies['workflowRecovery'],
    executionDetails: { publishLog: (...input: unknown[]) => { progress.push(input); } } as PluginRunnerHostApiDependencies['executionDetails'],
    executions: {
      getRunOrThrow: async () => ({ status: 'RUNNING' }),
      getStepOrThrow: async () => ({ executionRunId: 'run-1' }),
    } as unknown as PluginRunnerHostApiDependencies['executions'],
  };
  return { dependencies, validations, audits, progress, locks, checkpoint, requestStore };
}

function context(method: string, hostPermissions: string[], grantRefs = ['grant-1']): PluginRunnerHostCallContext {
  return {
    requestId: `host-call:${method}`,
    method,
    input: {},
    grantRefs,
    timeoutMs: 10_000,
    idempotencyKey: `idem:${method}`,
    deadlineAt: new Date(Date.now() + 10_000).toISOString(),
    tenantId: 'tenant-1',
    executionId: 'run-1',
    executionStepId: 'step-1',
    workflowVersionId: 'workflow-1',
    pluginVersionId: 'plugin-version-1',
    pluginId: 'test.echo',
    pluginVersion: '1.0.0',
    capability: 'test.echo',
    planDigest,
    hostPermissions,
  };
}

class TestHostApiRequestStore implements PluginRunnerHostApiRequestStore {
  private readonly records = new Map<string, { fingerprint: string; status: 'IN_FLIGHT' | 'COMPLETED' | 'UNKNOWN'; outcome?: HostApiRequestOutcome }>();
  claimCalls = 0;
  completeCalls = 0;
  expireCalls = 0;
  lastAdmission?: HostApiRequestAdmission;

  async claim(admission: HostApiRequestAdmission): Promise<HostApiRequestClaimResult> {
    this.claimCalls += 1;
    this.lastAdmission = admission;
    const existing = this.records.get(admission.key);
    if (!existing) {
      if (!Number.isFinite(Date.parse(admission.expiresAt)) || Date.parse(admission.expiresAt) <= Date.now()) return { status: 'EXPIRED' };
      this.records.set(admission.key, { fingerprint: admission.requestFingerprint, status: 'IN_FLIGHT' });
      return { status: 'ACQUIRED' };
    }
    if (existing.fingerprint !== admission.requestFingerprint) return { status: 'CONFLICT' };
    if (existing.status === 'COMPLETED') {
      if (!existing.outcome) {
        existing.status = 'UNKNOWN';
        existing.outcome = unknownOutcome('Host API Receipt 缺失，禁止重放');
        return { status: 'UNKNOWN', outcome: existing.outcome };
      }
      return { status: 'COMPLETED', outcome: existing.outcome };
    }
    if (existing.status === 'UNKNOWN') return { status: 'UNKNOWN', ...(existing.outcome ? { outcome: existing.outcome } : {}) };
    if (!Number.isFinite(Date.parse(admission.expiresAt)) || Date.parse(admission.expiresAt) <= Date.now()) {
      existing.status = 'UNKNOWN';
      existing.outcome = unknownOutcome('Host API 请求超过截止时间，状态未知');
      return { status: 'UNKNOWN', outcome: existing.outcome };
    }
    return { status: 'IN_FLIGHT' };
  }

  async complete(admission: HostApiRequestAdmission, outcome: HostApiRequestOutcome): Promise<HostApiRequestCompleteResult> {
    this.completeCalls += 1;
    const existing = this.records.get(admission.key);
    if (!existing || existing.fingerprint !== admission.requestFingerprint) return 'CONFLICT';
    if (existing.status !== 'IN_FLIGHT') return 'LATE';
    if (!Number.isFinite(Date.parse(admission.expiresAt)) || Date.parse(admission.expiresAt) <= Date.now()) {
      existing.status = 'UNKNOWN';
      existing.outcome = unknownOutcome('Host API 结果到达时请求已超过截止时间');
      return 'LATE';
    }
    existing.status = 'COMPLETED';
    existing.outcome = outcome;
    return 'COMMITTED';
  }

  async expire(admission: HostApiRequestAdmission, error: PluginRunnerError): Promise<HostApiRequestExpireResult> {
    this.expireCalls += 1;
    const existing = this.records.get(admission.key);
    if (!existing || existing.fingerprint !== admission.requestFingerprint) return 'CONFLICT';
    if (existing.status !== 'IN_FLIGHT') return 'ALREADY_TERMINAL';
    existing.status = 'UNKNOWN';
    existing.outcome = { ok: false, error };
    return 'EXPIRED';
  }

  removeReceipt(admission: HostApiRequestAdmission): void {
    const existing = this.records.get(admission.key);
    if (existing) existing.outcome = undefined;
  }
}

function unknownOutcome(message: string): HostApiRequestOutcome {
  return {
    ok: false,
    error: {
      code: 'PLUGIN_OPERATION_UNKNOWN_STATE',
      message,
      retryable: false,
      mayBeUnknown: true,
      secretRedacted: true,
    },
  };
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
