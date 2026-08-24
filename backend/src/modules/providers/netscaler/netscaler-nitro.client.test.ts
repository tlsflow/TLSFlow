import assert from 'node:assert/strict';
import test from 'node:test';
import type { CurlHttpClient, CurlHttpClientRequest, CurlHttpClientResponse } from '../../executors/curl/curl.http-client.js';
import { NetscalerNitroClient } from './netscaler-nitro.client.js';
import { NetscalerNitroError } from './netscaler-nitro.errors.js';

class RecordingHttpClient implements CurlHttpClient {
  readonly requests: CurlHttpClientRequest[] = [];

  constructor(private readonly responses: CurlHttpClientResponse[]) {}

  async send(request: CurlHttpClientRequest): Promise<CurlHttpClientResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('缺少测试响应');
    return response;
  }
}

const credentialResolver = {
  async resolveCredentials() {
    return { username: 'nitro-user', password: 'nitro-password' };
  },
};

test('Session 认证登录后只使用 Cookie，并在关闭时注销', async () => {
  const httpClient = new RecordingHttpClient([
    nitroResponse({ errorcode: 0 }, { 'set-cookie': 'NITRO_AUTH_TOKEN=session-token; Path=/nitro' }),
    nitroResponse({ errorcode: 0, nsversion: [{ version: 'NS14.1: Build 21.57.nc' }] }),
    nitroResponse({ errorcode: 0 }),
  ]);
  const client = createClient('SESSION', httpClient);

  await client.request({ path: '/nitro/v1/config/nsversion' });
  await client.close();

  assert.equal(httpClient.requests.length, 3);
  assert.match(httpClient.requests[0].body?.toString('utf8') ?? '', /nitro-password/);
  assert.equal(httpClient.requests[0].headers['Content-Type'], 'application/vnd.com.citrix.netscaler.login+json');
  assert.equal(httpClient.requests[1].headers.Cookie, 'NITRO_AUTH_TOKEN=session-token');
  assert.equal(httpClient.requests[1].headers['X-NITRO-PASS'], undefined);
  assert.equal(httpClient.requests[2].url, 'https://10.0.0.10/nitro/v1/config/logout');
  assert.equal(httpClient.requests[2].headers['Content-Type'], 'application/vnd.com.citrix.netscaler.logout+json');
});

test('Session 登录接受 201、空响应体和 Set-Cookie Token', async () => {
  const httpClient = new RecordingHttpClient([
    { statusCode: 201, headers: { 'set-cookie': 'SESSID=deleted; Path=/, NITRO_AUTH_TOKEN=%23%23encoded-token; Path=/nitro/v1' }, bodyText: '', body: undefined },
    nitroResponse({ errorcode: 0, nsversion: [{ version: 'NS13.1: Build 55.29.nc' }] }),
  ]);
  const client = createClient('SESSION', httpClient);

  const result = await client.request({ path: '/nitro/v1/config/nsversion' });

  assert.deepEqual(result.nsversion, [{ version: 'NS13.1: Build 55.29.nc' }]);
  assert.equal(httpClient.requests[1].headers.Cookie, 'NITRO_AUTH_TOKEN=%23%23encoded-token');
});

test('逐请求认证只注入 X-NITRO Header，不创建 Session', async () => {
  const httpClient = new RecordingHttpClient([nitroResponse({ errorcode: 0, sslcertkey: [] })]);
  const client = createClient('PER_REQUEST', httpClient);

  await client.request({ path: '/nitro/v1/config/sslcertkey' });

  assert.equal(httpClient.requests.length, 1);
  assert.equal(httpClient.requests[0].headers['X-NITRO-USER'], 'nitro-user');
  assert.equal(httpClient.requests[0].headers['X-NITRO-PASS'], 'nitro-password');
  assert.equal(httpClient.requests[0].headers.Cookie, undefined);
});

test('带请求体的 NITRO 配置请求使用资源专用媒体类型', async () => {
  const httpClient = new RecordingHttpClient([nitroResponse({ errorcode: 0 })]);
  const client = createClient('PER_REQUEST', httpClient);

  await client.request({
    method: 'PUT',
    path: '/nitro/v1/config/sslcertkey/example-cert',
    body: { sslcertkey: { certkey: 'example-cert' } },
  });

  assert.equal(httpClient.requests[0].headers['Content-Type'], 'application/vnd.com.citrix.netscaler.sslcertkey+json');
});

test('HTTP 成功但 NITRO 业务失败会归一化并脱敏', async () => {
  const httpClient = new RecordingHttpClient([nitroResponse({ errorcode: 444, message: 'invalid password nitro-password' })]);
  const client = createClient('PER_REQUEST', httpClient);

  await assert.rejects(
    client.request({ path: '/nitro/v1/config/nsversion' }),
    (error: unknown) => error instanceof NetscalerNitroError
      && error.code === 'NETSCALER_AUTH_FAILED'
      && !error.message.includes('nitro-password'),
  );
});

test('AUTO 在支持 Session 时不会混用逐请求认证', async () => {
  const httpClient = new RecordingHttpClient([
    nitroResponse({ errorcode: 0 }, { 'set-cookie': 'NITRO_AUTH_TOKEN=auto-token; Path=/' }),
    nitroResponse({ errorcode: 0, nsversion: [] }),
  ]);
  const client = createClient('AUTO', httpClient);

  await client.request({ path: '/nitro/v1/config/nsversion' });

  assert.equal(httpClient.requests[1].headers.Cookie, 'NITRO_AUTH_TOKEN=auto-token');
  assert.equal(httpClient.requests[1].headers['X-NITRO-USER'], undefined);
});

function createClient(authMode: 'AUTO' | 'SESSION' | 'PER_REQUEST', httpClient: CurlHttpClient) {
  return new NetscalerNitroClient({
    managementAddress: '10.0.0.10',
    credentialId: 'secret://credential/adc/current',
    authMode,
    credentialResolver,
    httpClient,
    tls: { verify: true },
  });
}

function nitroResponse(bodyJson: Record<string, unknown>, headers?: Record<string, string>): CurlHttpClientResponse {
  return { statusCode: 200, headers, bodyJson, bodyText: JSON.stringify(bodyJson), body: bodyJson };
}
