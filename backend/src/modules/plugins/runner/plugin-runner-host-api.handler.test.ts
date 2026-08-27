import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import type { WriteAuditInput } from '../../audits/audit.service.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import { createPluginRunnerHostApiHandler, type PluginRunnerHostApiDependencies } from './plugin-runner-host-api.handler.js';
import { PgPluginRunnerHostApiRequestStore, PluginRunnerHostApiRequestGate, type HostApiRequestAdmission, type HostApiRequestCompleteResult, type HostApiRequestOutcome, type PluginRunnerHostApiRequestStore, type HostApiRequestClaimResult, type HostApiRequestExpireResult } from './host-api.request-gate.js';
import type { PluginRunnerHostCallContext } from './plugin-runner-client.js';
import { getHostApiMethod } from './protocol/host-api.registry.js';
import type { PluginRunnerError } from './protocol/protocol.types.js';
import { CookieSessionStore } from '../../executors/curl/cookie-session.js';

const planDigest = 'b'.repeat(64);
const allActions = ['cloud.service.get', 'artifact.read', 'secret.resolve', 'crypto.sign', 'crypto.hmac', 'network.http', 'execution.cancel', 'audit.append'];

test('允许的 Host API 只通过 Action Grant、持久化端口和审计调用', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);

  const artifact = await handler({ ...context('artifact.grant.read', ['artifact.read']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } });
  assert.equal((artifact.data as Record<string, unknown>).contentBase64, Buffer.from('artifact-data').toString('base64'));

  const secret = await handler({ ...context('secret.grant.resolve', ['secret.resolve']), input: { grantId: 'grant-1', secretRef: 'secret://api_token/secret-1#current', purpose: 'secret.resolve' } });
  assert.equal(JSON.stringify(secret).includes('plain-text-must-not-leak'), false);
  assert.equal((secret.data as Record<string, unknown>).value, '[REDACTED]');

  const hmac = await handler({
    ...context('crypto.hmac', ['crypto.hmac']),
    input: {
      grantId: 'grant-1',
      secretRef: 'secret://api_token/secret-key#current',
      publicValueRef: 'secret://api_token/public-id#current',
      publicValuePlaceholder: '__PUBLIC__',
      data: 'action=Describe&key=__PUBLIC__',
      hashAlgorithm: 'SHA-1',
      keySuffix: '&',
    },
  });
  assert.equal((hmac.data as Record<string, unknown>).publicValue, 'public-access-id');
  assert.equal((hmac.data as Record<string, unknown>).signatureBase64, createHmac('sha1', 'plain-text-must-not-leak&').update('action=Describe&key=public-access-id').digest('base64'));
  assert.equal(JSON.stringify(hmac).includes('plain-text-must-not-leak'), false);


  const cancelled = await handler({ ...context('execution.isCancelled', ['execution.cancel']), input: { executionId: 'run-1', executionStepId: 'step-1' } });
  assert.deepEqual(cancelled, { ok: true, data: { cancelled: false } });

  await handler({ ...context('audit.append', ['audit.append']), input: { eventType: 'plugin.fixture', action: 'fixture.run', resourceType: 'fixture', resourceId: 'fixture-1', result: 'success', detail: { secret: 'should-be-redacted-by-audit-service' } } });

  assert.equal(fixture.validations.every((input) => input.executorType === 'plugin.action'), true);
  assert.equal(fixture.validations.every((input) => input.tenantId === 'tenant-1' && input.runId === 'run-1' && input.stepId === 'step-1'), true);
  assert.equal(fixture.validations.every((input) => input.workflowVersionId === 'workflow-1' && input.pluginVersionId === 'plugin-version-1' && input.pluginId === 'test.echo' && input.capability === 'test.echo' && input.actionId === 'test.echo.v1' && input.actionContractVersion === 'v1' && input.planDigest === planDigest), true);
  assert.equal(fixture.audits.some((event) => event.eventType === 'plugin.host_api.call'), true);
});

test('Host API 对错步骤、未绑定 Grant、权限不足和编排方法失败关闭', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);

  await assert.rejects(
    handler({ ...context('execution.isCancelled', ['execution.cancel']), executionId: 'other-run', input: { executionId: 'other-run', executionStepId: 'step-1' } }),
    /绑定不匹配|属于当前运行/,
  );
  await assert.rejects(
    handler({ ...context('secret.grant.resolve', ['secret.resolve'], ['other-grant']), input: { grantId: 'grant-1', secretRef: 'secret://api_token/secret-1#current', purpose: 'secret.resolve' } }),
    /未绑定|无权/,
  );
  await assert.rejects(
    handler({ ...context('artifact.grant.read', []), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } }),
    /权限不足/,
  );

  for (const method of ['execution.checkpoint.load', 'workflow.rollback.execute', 'workflow.lock.acquire', 'resourceLock.acquire', 'plugin.invoke']) {
    await assert.rejects(handler({ ...context(method, [], []), input: {} }), /未注册/);
  }
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

test('Runner http.request 使用运行级 CookieSession 并保留多值 Set-Cookie', async () => {
  const fixture = createFixture();
  const store = new CookieSessionStore();
  const requests: Array<Record<string, unknown>> = [];
  let call = 0;
  fixture.dependencies.cookieSessionStore = store;
  fixture.dependencies.cloudServices = {
    get: async () => ({ tenantId: 'tenant-1', providerKey: 'test.echo', displayName: 'fixture', scope: { endpoint: 'https://runner.example.invalid' }, status: 'ACTIVE', id: 'caa-1', version: 1, metadata: {} } as never),
    list: async () => ({ items: [{ tenantId: 'tenant-1', providerKey: 'test.echo', displayName: 'fixture', scope: { endpoint: 'https://runner.example.invalid' }, status: 'ACTIVE', id: 'caa-1', version: 1, metadata: {} }], page: 1, pageSize: 1, total: 1 } as never),
  };
  fixture.dependencies.security.grants.validate = async (input) => {
    fixture.validations.push(input as unknown as Record<string, unknown>);
    return { id: String(input.grantId), allowedActions: [...allActions, 'http.cookie.session'], allowedArtifactRefs: [] } as never;
  };
  fixture.dependencies.httpClient = {
    request: async (request) => {
      requests.push(request as unknown as Record<string, unknown>);
      call += 1;
      return call === 1
        ? { statusCode: 200, headers: { 'Set-Cookie': 'sid=first; Path=/' } as Record<string, string>, setCookie: ['sid=first; Path=/', 'prefs=x,y; Path=/'], bodyText: '{"cookie":"sid=first"}', body: { cookie: 'sid=first' } }
        : { statusCode: 200, headers: {} as Record<string, string>, bodyText: '{}', body: {} };
    },
  };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const input = { url: 'https://runner.example.invalid/login', method: 'POST', headers: {}, cookieSessionRef: 'waf' };
  const first = await handler({ ...context('http.request', ['network.http']), input });
  assert.equal(JSON.stringify(first).includes('sid=first'), false);
  await handler({ ...context('http.request', ['network.http']), input: { ...input, url: 'https://runner.example.invalid/probe' }, requestId: 'runner-cookie-2', idempotencyKey: 'runner-cookie-2' });
  assert.equal((requests[0]?.headers as Record<string, string>).Cookie, undefined);
  assert.equal((requests[1]?.headers as Record<string, string>).Cookie, 'sid=first; prefs=x,y');
  assert.equal(store.size(), 1);
  assert.equal(JSON.stringify(await handler({ ...context('http.request', ['network.http']), input: { ...input, url: 'https://runner.example.invalid/probe2', cookieSessionRef: 'waf2' }, requestId: 'runner-cookie-3', idempotencyKey: 'runner-cookie-3' })).includes('sid=first'), false);
});

test('Cloud Service 缺少 scope endpoint 时使用资产声明的通用端点集合', async () => {
  const fixture = createFixture();
  fixture.dependencies.cloudServices = {
    get: async () => ({
      tenantId: 'tenant-1', providerKey: 'cloud.aliyun', displayName: '阿里云',
      scope: {}, status: 'ACTIVE', id: 'caa-aliyun', version: 1,
      metadata: { serviceEndpoints: ['https://cdn.aliyuncs.com', 'https://ecs.aliyuncs.com'] },
    } as never),
    list: async () => ({ items: [{
      tenantId: 'tenant-1', providerKey: 'cloud.aliyun', displayName: '阿里云',
      scope: {}, status: 'ACTIVE', id: 'caa-aliyun', version: 1,
      metadata: { serviceEndpoints: ['https://cdn.aliyuncs.com', 'https://ecs.aliyuncs.com'] },
    }], page: 1, pageSize: 1, total: 1 } as never),
  };
  fixture.dependencies.httpClient = { request: async () => ({ statusCode: 200, headers: {}, bodyText: '{}', body: {} }) };
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  const service = await handler({ ...context('cloudService.get', ['cloud.service.get']), pluginId: 'cloud.aliyun', input: { cloudServiceRef: 'caa-aliyun' } });
  assert.deepEqual((service.data as Record<string, unknown>).scope, { endpoint: 'https://cdn.aliyuncs.com' });
  const response = await handler({ ...context('http.request', ['network.http']), pluginId: 'cloud.aliyun', input: { url: 'https://cdn.aliyuncs.com/', method: 'POST', headers: {}, body: '{}' } });
  assert.equal((response.data as Record<string, unknown>).statusCode, 200);
  const ecsResponse = await handler({ ...context('http.request', ['network.http']), pluginId: 'cloud.aliyun', input: { url: 'https://ecs.aliyuncs.com/', method: 'POST', headers: {}, body: '{}' } });
  assert.equal((ecsResponse.data as Record<string, unknown>).statusCode, 200);
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
  const first = { ...context('artifact.grant.read', ['artifact.read'], ['grant-1']), input: { grantId: 'grant-1', artifactRef: 'artifact://artifact-1' } };
  const conflict = { ...context('artifact.grant.read', ['artifact.read'], ['grant-2']), input: { grantId: 'grant-2', artifactRef: 'artifact://artifact-1' } };

  await handler(first);
  await assert.rejects(handler(conflict), /幂等键|摘要/);
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
  assert.equal(fixture.requestStore.claimCalls, claimCallsAfterUnknown + 1);
});

test('Host API 禁止 checkpoint、rollback 和工作流锁，且不获取消费权', async () => {
  const fixture = createFixture();
  const handler = createPluginRunnerHostApiHandler(fixture.dependencies);
  for (const method of ['execution.checkpoint.save', 'execution.checkpoint.load', 'workflow.rollback.execute', 'workflow.lock.acquire']) {
    await assert.rejects(handler({ ...context(method, [], []), input: {} }), /未注册/);
  }
  assert.equal(fixture.requestStore.claimCalls, 0);
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

test('plugin.action Grant 缺少完整身份绑定或字段不一致时拒绝创建和校验', async () => {
  const { ExecutionGrantService } = await import('../../executions/execution-grant.service.js');
  const service = new ExecutionGrantService();
  await assert.rejects(service.create({
    tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'plugin.action',
    allowedSecretRefs: [], allowedActions: ['artifact.read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
  }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');

  const grant = await service.create({
    tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'plugin.action',
    workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', actionId: 'test.echo.v1', actionContractVersion: 'v1', inputSchemaSha256: `sha256:${'a'.repeat(64)}`, outputSchemaSha256: `sha256:${'c'.repeat(64)}`, planDigest,
    allowedSecretRefs: [], allowedActions: ['artifact.read'], expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await service.validate({ grantId: grant.id, tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'plugin.action', workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', actionId: 'test.echo.v1', actionContractVersion: 'v1', inputSchemaSha256: `sha256:${'a'.repeat(64)}`, outputSchemaSha256: `sha256:${'c'.repeat(64)}`, planDigest });
  await assert.rejects(service.validate({ grantId: grant.id, tenantId: 'tenant-1', runId: 'run-1', stepId: 'step-1', executorType: 'plugin.action', workflowVersionId: 'workflow-1', pluginVersionId: 'other-version', pluginId: 'test.echo', capability: 'test.echo', actionId: 'test.echo.v1', actionContractVersion: 'v1', inputSchemaSha256: `sha256:${'a'.repeat(64)}`, outputSchemaSha256: `sha256:${'c'.repeat(64)}`, planDigest }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');
  await assert.rejects(service.validate({ grantId: grant.id, tenantId: 'other-tenant', runId: 'run-1', stepId: 'step-1', executorType: 'plugin.action', workflowVersionId: 'workflow-1', pluginVersionId: 'plugin-version-1', pluginId: 'test.echo', capability: 'test.echo', actionId: 'test.echo.v1', actionContractVersion: 'v1', inputSchemaSha256: `sha256:${'a'.repeat(64)}`, outputSchemaSha256: `sha256:${'c'.repeat(64)}`, planDigest }), (error: unknown) => (error as { errorCode?: string }).errorCode === 'SEC_EXECUTOR_GRANT_DENIED');
});

function createFixture() {
  const validations: Array<Record<string, unknown>> = [];
  const audits: WriteAuditInput[] = [];
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
        resolveForExecution: async (input: { secretRef: string }) => ({ secretRef: input.secretRef, versionId: 'secret-version-1', plainText: input.secretRef.includes('public-id') ? 'public-access-id' : 'plain-text-must-not-leak', fingerprint: 'a'.repeat(64) }),
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
    executions: {
      getRunOrThrow: async () => ({ status: 'RUNNING' }),
      getStepOrThrow: async () => ({ executionRunId: 'run-1' }),
    } as unknown as PluginRunnerHostApiDependencies['executions'],
  };
  return { dependencies, validations, audits, requestStore };
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
    actionId: 'test.echo.v1',
    actionContractVersion: 'v1',
    inputSchemaSha256: `sha256:${'a'.repeat(64)}`,
    outputSchemaSha256: `sha256:${'c'.repeat(64)}`,
    packageHash: `sha256:${'d'.repeat(64)}`,
    manifestHash: `sha256:${'e'.repeat(64)}`,
    resourceHash: `sha256:${'f'.repeat(64)}`,
    planDigest,
    writeEffect: false,
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
