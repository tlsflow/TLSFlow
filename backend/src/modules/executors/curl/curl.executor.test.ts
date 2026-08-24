import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CurlHttpClientRequest } from './curl.http-client.js';
import { CurlExecutor } from './curl.executor.js';

describe('spec017 CURL/HTTP 执行器基础', () => {
  it('dry-run 渲染请求，不访问真实网络，并按响应策略判断结果', async () => {
    const executor = new CurlExecutor();
    const dryRun = await executor.execute({
      idempotencyKey: 'idem_curl_1',
      dryRun: true,
      template: { url: 'https://example.com/{{path}}', method: 'GET', headerRefs: { Authorization: 'secret://token/current' } },
      variables: { path: 'health' },
      secrets: { 'secret://token/current': 'secret-token-value' },
    });
    assert.equal(dryRun.success, true);
    assert.equal(dryRun.rendered.url, 'https://example.com/health');
    assert.deepEqual(dryRun.rendered.headerNames, ['Authorization']);

    const failed = await executor.execute({
      idempotencyKey: 'idem_curl_2',
      template: { url: 'https://example.com/health', method: 'GET' },
      responsePolicy: { successStatusCodes: [200], assertions: [{ type: 'status', equals: 200 }, { type: 'body_contains', text: 'expected-success-marker' }] },
      extractors: [{ name: 'token', source: 'json', path: '$.token', required: true, secret: true }],
      mockResponse: { statusCode: 200, body: { token: 'secret-token', value: 'bad' } },
    });
    assert.equal(failed.success, false);
    assert.equal(failed.statusCode, 200);
    assert.deepEqual(failed.extracted, { token: '[SECRET_CAPTURED]' });
    assert.equal(failed.assertions.some((item) => item.passed === false), true);
  });

  it('拒绝非法协议、明文敏感字段和重复幂等键', async () => {
    const executor = new CurlExecutor();
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_proto', template: { url: 'file:///etc/passwd' } }), /只允许/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_secret', template: { url: 'https://example.com', headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } } }), /敏感|Authorization/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_tls', template: { url: 'https://example.com', tls: { verify: false } } }), /TLS/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_var', template: { url: 'https://example.com/{{missing}}' }, dryRun: true }), /变量缺失/);
    await executor.execute({ idempotencyKey: 'idem_curl_once', template: { url: 'https://example.com', method: 'POST', body: { ok: true } }, mockResponse: { statusCode: 200 } });
    await assert.rejects(() => executor.execute({ idempotencyKey: 'idem_curl_once', template: { url: 'https://example.com' } }), /幂等键/);
    assert.deepEqual(executor.getRequiredCapabilities(), ['curl.request', 'http.tls.verify', 'http.header.secret_ref', 'http.form.secret_ref', 'http.extractor', 'http.assertion', 'http.cookie.session']);
  });

  it('Basic 认证使用用户名和通用 password SecretRef 生成 Authorization', async () => {
    let captured: CurlHttpClientRequest | undefined;
    const executor = new CurlExecutor({
      httpClient: {
        async send(request) {
          captured = request;
          return { statusCode: 200, body: { ok: true } };
        },
      },
    });

    const result = await executor.execute({
      idempotencyKey: 'idem_curl_basic_password',
      template: {
        method: 'GET',
        url: 'https://example.com/api',
        auth: { type: 'basic', username: '{{curlUsername}}', secretRef: 'secret://password/device-login#current' },
      },
      variables: { curlUsername: 'deploy' },
      secrets: { 'secret://password/device-login#current': 'secret-password' },
    });

    assert.equal(result.success, true);
    assert.equal(captured?.headers.Authorization, `Basic ${Buffer.from('deploy:secret-password').toString('base64')}`);
    assert.doesNotMatch(JSON.stringify(result), /secret-password/);
  });

  it('formSecretRefs 把密文字段注入 form body 并脱敏结果', async () => {
    let captured: CurlHttpClientRequest | undefined;
    const executor = new CurlExecutor({
      httpClient: {
        async send(request) {
          captured = request;
          return { statusCode: 200, body: { echoed: 'login-password-secret' } };
        },
      },
    });

    const result = await executor.execute({
      idempotencyKey: 'idem_curl_form_secret_refs',
      template: {
        method: 'POST',
        url: 'https://example.com/webapi/entry.cgi',
        bodyType: 'form',
        form: { account: 'admin', method: 'login' },
        formSecretRefs: { passwd: 'secret://password/device-login#current' },
      },
      secrets: { 'secret://password/device-login#current': 'login-password-secret' },
    });

    const body = captured?.body?.toString('utf8') ?? '';
    assert.equal(result.success, true);
    assert.equal(captured?.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.match(body, /account=admin/);
    assert.match(body, /passwd=login-password-secret/);
    assert.doesNotMatch(JSON.stringify(result), /login-password-secret/);
  });

  it('支持 curl 导入和脱敏导出，拒绝导入明文敏感值', () => {
    const executor = new CurlExecutor();
    const imported = executor.importCurl("curl -X POST -H 'X-Trace: abc' https://example.com/api");
    assert.equal(imported.template.url, 'https://example.com/api');
    assert.equal(imported.template.method, 'POST');
    assert.deepEqual(imported.template.headers, { 'X-Trace': 'abc' });
    assert.match(executor.exportCurl(imported), /\[REDACTED_OR_SECRET_REF\]/);
    assert.throws(() => executor.importCurl("curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' https://example.com"), /敏感/);
  });

  it('覆盖 GET/POST/PUT、query、headers、JSON 响应、重试和 Secret 脱敏', async () => {
    const executor = new CurlExecutor();

    const getResult = await executor.execute({
      idempotencyKey: 'idem_get_query',
      template: {
        method: 'GET',
        url: 'https://example.com/api',
        query: { page: 1, q: '{{keyword}}' },
        headers: { Accept: 'application/json' },
      },
      variables: { keyword: 'cert' },
      mockResponse: { statusCode: 200, headers: { 'content-type': 'application/json' }, body: { ok: true } },
      extractors: [{ name: 'ok', source: 'json', path: '$.ok', required: true }],
    });
    assert.equal(getResult.success, true);
    assert.match(getResult.rendered.url, /q=cert/);
    assert.deepEqual(getResult.extracted, { ok: true });

    const postResult = await executor.execute({
      idempotencyKey: 'idem_post_json',
      template: {
        method: 'POST',
        url: 'https://example.com/api',
        bodyType: 'json',
        body: { name: '{{name}}' },
        auth: { type: 'bearer', secretRef: 'secret://token/api' },
      },
      variables: { name: 'edge' },
      secrets: { 'secret://token/api': { token: 'runtime-token-secret' } },
      mockResponse: { statusCode: 201, body: { id: 'created' } },
      extractors: [{ name: 'id', source: 'json', path: '$.id', required: true }],
    });
    assert.equal(postResult.success, true);
    assert.doesNotMatch(JSON.stringify(postResult), /runtime-token-secret/);

    const putResult = await executor.execute({
      idempotencyKey: 'idem_put_retry',
      template: { method: 'PUT', url: 'https://example.com/api/cert', bodyType: 'raw', body: 'payload' },
      retryPolicy: { maxAttempts: 2, retryOnStatus: [500], intervalMs: 1 },
      mockResponse: { statusCode: 500, body: 'temporary failure' },
    });
    assert.equal(putResult.success, false);
    assert.equal(putResult.attempts, 2);
    assert.equal(putResult.errorCode, 'HTTP_NON_SUCCESS_STATUS');
  });

  it('处理超时、TLS 策略、响应大小限制和 Secret 缺失', async () => {
    const executor = new CurlExecutor();
    await assert.rejects(() => executor.execute({
      idempotencyKey: 'missing_secret',
      template: { method: 'GET', url: 'https://example.com/api', auth: { type: 'api_key', secretRef: 'secret://api/key', name: 'X-Api-Key' } },
      dryRun: true,
    }), /Secret|AUTH_FORBIDDEN/);

    const tooLarge = await executor.execute({
      idempotencyKey: 'too_large',
      template: { method: 'GET', url: 'https://example.com/api', maxResponseBytes: 4 },
      mockResponse: { statusCode: 200, body: '12345' },
    });
    assert.equal(tooLarge.success, false);
    assert.equal(tooLarge.errorCode, 'HTTP_RESPONSE_TOO_LARGE');

    await assert.rejects(() => executor.execute({
      idempotencyKey: 'tls_blocked',
      template: { method: 'GET', url: 'https://example.com/api', tls: { verify: false } },
      dryRun: true,
    }), /TLS/);

    const timeout = await executor.execute({
      idempotencyKey: 'timeout_network',
      template: { method: 'GET', url: 'http://127.0.0.1:1/api', timeoutMs: 1 },
      retryPolicy: { maxAttempts: 1 },
    });
    assert.equal(timeout.success, false);
    assert.match(timeout.errorCode ?? '', /HTTP_NETWORK_ERROR|HTTP_REQUEST_TIMEOUT/);
  });
});
