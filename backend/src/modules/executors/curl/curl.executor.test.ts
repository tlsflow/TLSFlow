import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CurlExecutor } from './curl.executor.js';

describe('spec017 CURL/HTTP 执行器基础', () => {
  it('dry-run 渲染请求，不访问真实网络，并按响应策略判断结果', () => {
    const executor = new CurlExecutor();
    const dryRun = executor.execute({
      idempotencyKey: 'idem_curl_1',
      dryRun: true,
      template: { url: 'https://example.com/{{path}}', method: 'GET', headerRefs: { Authorization: 'secret://token/current' } },
      variables: { path: 'health' },
    });
    assert.equal(dryRun.success, true);
    assert.equal(dryRun.rendered.url, 'https://example.com/health');
    assert.deepEqual(dryRun.rendered.headerNames, ['Authorization']);

    const failed = executor.execute({
      idempotencyKey: 'idem_curl_2',
      template: { url: 'https://example.com/health', method: 'GET' },
      responsePolicy: { successStatusCodes: [200], assertions: [{ type: 'status', equals: 200 }, { type: 'body_contains', text: 'ok' }] },
      extractors: [{ name: 'token', source: 'body', path: '$.token', required: true, secret: true }],
      mockResponse: { statusCode: 200, body: { token: 'secret-token', value: 'bad' } },
    });
    assert.equal(failed.success, false);
    assert.equal(failed.statusCode, 200);
    assert.deepEqual(failed.extracted, { token: '[SECRET_CAPTURED]' });
    assert.equal(failed.assertions.some((item) => item.passed === false), true);
  });

  it('拒绝非法协议、明文敏感字段和重复幂等键', () => {
    const executor = new CurlExecutor();
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_proto', template: { url: 'file:///etc/passwd' } }), /只允许/);
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_secret', template: { url: 'https://example.com', headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } } }), /敏感|Authorization/);
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_tls', template: { url: 'https://example.com', tls: { verify: false } } }), /TLS/);
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_var', template: { url: 'https://example.com/{{missing}}' }, dryRun: true }), /变量缺失/);
    executor.execute({ idempotencyKey: 'idem_curl_once', template: { url: 'https://example.com', method: 'POST', body: { ok: true } }, mockResponse: { statusCode: 200 } });
    assert.throws(() => executor.execute({ idempotencyKey: 'idem_curl_once', template: { url: 'https://example.com' } }), /幂等键/);
    assert.deepEqual(executor.getRequiredCapabilities(), ['curl.request', 'http.tls.verify', 'http.header.secret_ref', 'http.extractor', 'http.assertion', 'http.cookie.session']);
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
});
