import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../../../common/errors/app-error.js';
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
    assert.match(failed.errorMessage ?? '', /HTTP 响应未满足成功策略：status=200, expected=200，response=/);
    assert.deepEqual(failed.extracted, { token: '[SECRET_CAPTURED]' });
    assert.equal(failed.assertions.some((item) => item.passed === false), true);
  });

  it('允许工作流把前序步骤 JWT 通过临时 SecretRef 注入 Authorization', async () => {
    let captured: CurlHttpClientRequest | undefined;
    const executor = new CurlExecutor({
      httpClient: {
        async send(request) {
          captured = request;
          return { statusCode: 200, body: { ok: true } };
        },
      },
    });
    const ref = 'secret://workflow/runtime/readProxyHosts/Authorization';
    const result = await executor.execute({
      idempotencyKey: 'workflow_runtime_authorization',
      template: {
        method: 'GET',
        url: 'https://npm.example.test/api/nginx/proxy-hosts',
        headers: { Accept: 'application/json' },
        headerRefs: { Authorization: ref },
      },
      secrets: { [ref]: 'Bearer runtime-jwt' },
    });

    assert.equal(result.success, true);
    assert.equal(captured?.headers.Authorization, 'Bearer runtime-jwt');
    assert.equal(captured?.headers.Accept, 'application/json');
  });

  it('HTTP 200 且响应 JSON 时按成功策略成功', async () => {
    const executor = new CurlExecutor();
    const result = await executor.execute({
      idempotencyKey: 'http_json_success',
      template: { method: 'GET', url: 'https://npm.example.test/api/nginx/proxy-hosts' },
      responsePolicy: { successStatusCodes: [200] },
      mockResponse: { statusCode: 200, body: [{ id: 1, domain_names: ['npm.example.test'] }] },
    });

    assert.equal(result.success, true);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.bodyJson, [{ id: 1, domain_names: ['npm.example.test'] }]);
    assert.equal(result.errorCode, undefined);
  });

  it('HTTP 401/403/404/500 返回状态、成功策略和脱敏响应摘要', async () => {
    const cases = [401, 403, 404, 500];
    for (const statusCode of cases) {
      const jwt = `eyJheader${statusCode}.eyJpayload${statusCode}.signature${statusCode}`;
      const executor = new CurlExecutor();
      const result = await executor.execute({
        idempotencyKey: `http_failure_${statusCode}`,
        template: {
          method: 'GET',
          url: 'https://npm.example.test/api/nginx/proxy-hosts',
          headerRefs: { Authorization: `secret://workflow/runtime/readProxyHosts/Authorization-${statusCode}` },
        },
        secrets: { [`secret://workflow/runtime/readProxyHosts/Authorization-${statusCode}`]: `Bearer ${jwt}` },
        responsePolicy: { successStatusCodes: [200] },
        mockResponse: {
          statusCode,
          body: {
            error: {
              code: statusCode,
              message: statusCode === 403 ? 'Permission Denied' : `NPM failure ${statusCode}`,
              authorization: `Bearer ${jwt}`,
              password: 'fixture-password',
              cookie: 'session=fixture-cookie',
            },
          },
        },
      });

      assert.equal(result.success, false);
      assert.equal(result.statusCode, statusCode);
      assert.equal(result.errorCode, 'HTTP_NON_SUCCESS_STATUS');
      assert.match(result.errorMessage ?? '', new RegExp(`status=${statusCode}`));
      assert.match(result.errorMessage ?? '', /expected=200/);
      assert.match(result.errorMessage ?? '', /response=.*shape=.*errorCode=/);
      assert.doesNotMatch(result.errorMessage ?? '', /Authorization|authorization|eyJheader|fixture-password|fixture-cookie|secret:\/\//);
      assert.doesNotMatch(JSON.stringify({ logs: result.logs, body: result.bodyJson }), new RegExp(jwt));
    }
  });

  it('工作流执行保留内部原始响应，同时公共结果继续脱敏', async () => {
    const executor = new CurlExecutor();
    const runtimeToken = 'runtime-synology-token';
    const execution = await executor.executeForWorkflow({
      idempotencyKey: 'idem_curl_workflow_runtime_response',
      template: { url: 'https://example.com/login', method: 'POST' },
      extractors: [{ name: 'synoToken', source: 'json', path: '$.data.synotoken', required: true, secret: true }],
      mockResponse: {
        statusCode: 200,
        body: { success: true, data: { synotoken: runtimeToken } },
      },
    });

    assert.deepEqual(execution.result.bodyJson, { success: true, data: { synotoken: '[REDACTED]' } });
    assert.deepEqual(execution.result.extracted, { synoToken: '[SECRET_CAPTURED]' });
    assert.equal((execution.runtimeResponse?.bodyJson as { data?: { synotoken?: string } })?.data?.synotoken, runtimeToken);
    assert.doesNotMatch(JSON.stringify(execution.result), new RegExp(runtimeToken));
  });

  it('响应策略失败时不让缺失的必需提取器覆盖主错误', async () => {
    const executor = new CurlExecutor();
    const failed = await executor.execute({
      idempotencyKey: 'idem_curl_policy_failure_before_required_extractor',
      template: { url: 'https://example.com/api', method: 'GET' },
      responsePolicy: { assertions: [{ type: 'body_contains', text: '"success":true' }] },
      extractors: [{ name: 'certificates', source: 'json', path: '$.data.certificates', required: true }],
      mockResponse: { statusCode: 200, body: { success: false, error: { code: 119 } } },
    });

    assert.equal(failed.success, false);
    assert.equal(failed.errorCode, 'HTTP_NON_SUCCESS_STATUS');
    assert.deepEqual(failed.extracted, {});
    assert.equal(failed.assertions.some((item) => item.passed === false), true);
  });

  it('响应日志保留 HTTP 状态和 NITRO 业务错误诊断', async () => {
    const executor = new CurlExecutor();
    const result = await executor.execute({
      idempotencyKey: 'idem_curl_nitro_diagnostics',
      template: { method: 'GET', url: 'https://example.com/nitro' },
      responsePolicy: { successStatusCodes: [500] },
      mockResponse: { statusCode: 500, body: { errorcode: 273, message: 'Resource already exists' } },
    });

    assert.equal(result.success, true);
    assert.ok(result.logs.includes('response:status:500'));
    assert.ok(result.logs.includes('response:nitroErrorCode:273'));
    assert.ok(result.logs.includes('response:nitroMessage:Resource already exists'));
  });

  it('拒绝非法协议、明文敏感字段和重复幂等键', async () => {
    const executor = new CurlExecutor();
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_proto', template: { url: 'file:///etc/passwd' } }), /只允许/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'default_https_only', template: { url: 'http://example.com/health' } }), /白名单/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_secret', template: { url: 'https://example.com', headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } } }), /敏感|Authorization/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_tls', template: { url: 'https://example.com', tls: { verify: false } } }), /TLS/);
    await assert.rejects(() => executor.execute({ idempotencyKey: 'bad_var', template: { url: 'https://example.com/{{missing}}' }, dryRun: true }), /变量缺失：missing/);
    await executor.execute({ idempotencyKey: 'idem_curl_once', template: { url: 'https://example.com', method: 'POST', body: { ok: true } }, mockResponse: { statusCode: 200 } });
    await assert.rejects(() => executor.execute({ idempotencyKey: 'idem_curl_once', template: { url: 'https://example.com' } }), /幂等键/);
    assert.deepEqual(executor.getRequiredCapabilities(), ['curl.request', 'http.tls.verify', 'http.header.secret_ref', 'http.form.secret_ref', 'http.extractor', 'http.assertion', 'http.cookie.session']);
  });

  it('根据连接快照拼接 HTTP/HTTPS，并且明文请求不携带 TLS 参数', async () => {
    let captured: CurlHttpClientRequest | undefined;
    const executor = new CurlExecutor({
      httpClient: {
        async send(request) {
          captured = request;
          return { statusCode: 200, body: { ok: true } };
        },
      },
    });

    const httpResult = await executor.execute({
      idempotencyKey: 'connection_http_protocol',
      template: {
        method: 'GET',
        url: '/health',
        connection: { host: 'npm.example.test', port: 81, tlsEnabled: false, allowedProtocols: ['http', 'https'] },
      },
    });
    assert.equal(httpResult.success, true);
    assert.equal(httpResult.rendered.url, 'http://npm.example.test:81/health');
    assert.equal(httpResult.rendered.tlsVerify, false);
    assert.equal(captured?.url, 'http://npm.example.test:81/health');
    assert.equal(captured?.tls === undefined, true);

    const httpsResult = await executor.execute({
      idempotencyKey: 'connection_https_protocol',
      template: {
        method: 'GET',
        url: '/health',
        connection: { host: 'npm.example.test', port: 443, tlsEnabled: true, allowedProtocols: ['https'] },
        tls: { verify: true },
      },
    });
    assert.equal(httpsResult.success, true);
    assert.equal(httpsResult.rendered.url, 'https://npm.example.test/health');
    assert.equal(captured?.url, 'https://npm.example.test/health');
    assert.equal(captured?.tls?.verify, true);

    await assert.rejects(() => executor.execute({
      idempotencyKey: 'connection_http_protocol_denied',
      template: {
        url: '/health',
        connection: { host: 'npm.example.test', port: 81, tlsEnabled: false, allowedProtocols: ['https'] },
      },
    }), /白名单/);
  });

  it('连接上下文拒绝绝对 URL，防止绕过连接主机、端口和协议事实', async () => {
    const executor = new CurlExecutor({
      httpClient: { async send() { return { statusCode: 200 }; } },
    });
    const connection = { host: 'device.test', port: 80, tlsEnabled: false, allowedProtocols: ['http', 'https'] as ('http' | 'https')[] };
    await assert.rejects(() => executor.execute({
      idempotencyKey: 'connection_absolute_other_authority',
      template: { method: 'GET', url: 'https://other.test/api', connection },
    }), /相对路径/);
    await assert.rejects(() => executor.execute({
      idempotencyKey: 'connection_absolute_protocol_relative',
      template: { method: 'GET', url: '//other.test/api', connection },
    }), /相对路径/);
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

  it('必需 extractor 失败时返回可定位的错误详情', async () => {
    const executor = new CurlExecutor();

    await assert.rejects(async () => {
      await executor.execute({
        idempotencyKey: 'idem_curl_missing_extractor_detail',
        template: { method: 'GET', url: 'https://example.com/api' },
        mockResponse: { statusCode: 200, headers: { 'content-type': 'application/json' }, body: { data: { token: 'runtime-token-secret' } } },
        extractors: [{ name: 'sessionId', source: 'json', path: '$.data.sid', required: true }],
      });
    }, (error) => {
      assert.equal(error instanceof AppError, true);
      const appError = error as AppError;
      assert.equal(appError.errorCode, 'WORKFLOW_ASSERTION_FAILED');
      assert.match(appError.message, /extractor=sessionId/);
      assert.match(appError.message, /\$\.data\.sid/);
      const details = appError.details as Record<string, unknown>;
      assert.equal(details.extractor, 'sessionId');
      assert.equal(details.source, 'json');
      assert.equal(details.path, '$.data.sid');
      assert.equal(details.responseStatusCode, 200);
      assert.deepEqual(details.responseHeaderNames, ['content-type']);
      assert.deepEqual(details.responseBodyShape, {
        type: 'object',
        keys: ['data'],
        children: { data: { type: 'object', keys: ['token'] } },
      });
      assert.equal(typeof details.responseTextLength, 'number');
      assert.equal((details.responseTextLength as number) > 0, true);
      assert.doesNotMatch(JSON.stringify(appError.details), /runtime-token-secret/);
      return true;
    });
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
      template: {
        method: 'GET',
        url: '/api',
        timeoutMs: 1,
        connection: { host: '127.0.0.1', port: 1, tlsEnabled: false, allowedProtocols: ['http'] },
      },
      retryPolicy: { maxAttempts: 1 },
    });
    assert.equal(timeout.success, false);
    assert.match(timeout.errorCode ?? '', /HTTP_NETWORK_ERROR|HTTP_REQUEST_TIMEOUT/);
  });
});
