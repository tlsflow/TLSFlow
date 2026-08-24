import assert from 'node:assert/strict';
import { createServer as createHttpsServer } from 'node:https';
import { describe, it } from 'node:test';
import type { TLSSocket } from 'node:tls';
import { CurlExecutor } from './curl.executor.js';
import { NodeCurlHttpClient, type CurlHttpClient, type CurlHttpClientRequest, type CurlHttpClientResponse } from './curl.http-client.js';
import { StaticCurlSecretResolver } from './curl.secret-resolver.js';

const CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDVDCCAjygAwIBAgIUG5ildtPXNPyfiDQ1eus6hH5dRFowDQYJKoZIhvcNAQEL
BQAwJTEUMBIGA1UEAwwLZXhhbXBsZS5jb20xDTALBgNVBAoMBEdDQUMwHhcNMjYw
NjA4MDkwOTU0WhcNMjcwNjA4MDkwOTU0WjAlMRQwEgYDVQQDDAtleGFtcGxlLmNv
bTENMAsGA1UECgwER0NBQzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
ANnmaaLnxtwDFZBfUmKgdJL5NPCkxIWunc+vrTi1dEXkGLlzppat6C8YGWc+fFvY
Ym+IBrukthZ7KEsjnum2rkKMEMl+a+lUPi2NDVAvy6ZyswouyxtuJnh5rC5GcReu
esZTQ0bR/SMgI8umYUu2A7fDfna9LnXjkXxqyb7ZY5gvVUyjaC3/gINJQ945JBxC
BO8PerlOXuRKbHXPAbeOuo0nsaiD7nMcmZ6BE5c4HvTLDfDKBzZNLaKwxwWrIr5l
tEhg0Zm7mhtLTYZkg/UzKpbuNOr4Zd48tMtVUzlyQeRxgGTJHcnZdSX3oaizfv88
FFhExjQwqpWaTHoiTXfk5SMCAwEAAaN8MHowHQYDVR0OBBYEFM3GnbaMzOx3k1qa
8XB2S4Zq+lw1MB8GA1UdIwQYMBaAFM3GnbaMzOx3k1qa8XB2S4Zq+lw1MA8GA1Ud
EwEB/wQFMAMBAf8wJwYDVR0RBCAwHoILZXhhbXBsZS5jb22CD3d3dy5leGFtcGxl
LmNvbTANBgkqhkiG9w0BAQsFAAOCAQEAsW/aieACElxUDvOF4jcto6lQAv30DZg3
q82o2sGsTcInQC987HN2AYK5v3uj9CyWT5OJmeFkJrRekeaFnnutGYyQoRsfJ16u
YrVXYshRygqzFzQ6WoWEnD9mN+eILLl9kkrPlNX8mV7ly+NuMEk+Y43WTo19lrg3
li+tUg7XYIzac937W72xTG2rrZ2MUqM+rNNSWjKh8hw32x6b0s1t6j7kKJxuPDJ7
ypU+DoduyO53xf/mnvIGcDUESJvwRZ7Iffi1pp99oPh73SWPRyLTaYBcsPbbsi/f
aAQqw3mzHJgVJXhAdmNXmxWG/TCNanalPXMpyLNYSW32L2rZKdE+UQ==
-----END CERTIFICATE-----`;

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDZ5mmi58bcAxWQ
X1JioHSS+TTwpMSFrp3Pr604tXRF5Bi5c6aWregvGBlnPnxb2GJviAa7pLYWeyhL
I57ptq5CjBDJfmvpVD4tjQ1QL8umcrMKLssbbiZ4eawuRnEXrnrGU0NG0f0jICPL
pmFLtgO3w352vS5145F8asm+2WOYL1VMo2gt/4CDSUPeOSQcQgTvD3q5Tl7kSmx1
zwG3jrqNJ7Gog+5zHJmegROXOB70yw3wygc2TS2isMcFqyK+ZbRIYNGZu5obS02G
ZIP1MyqW7jTq+GXePLTLVVM5ckHkcYBkyR3J2XUl96Gos37/PBRYRMY0MKqVmkx6
Ik135OUjAgMBAAECggEAGW5futsZOvlYgsfqmhyHA9ZLsaBRWBbX+p19dpEQTSNA
0s18I7mP+oXHWo+Q57lFTSYPlHE2ApaveQw4Z6eMsV3z4Z28eM1+ZPDsR6+5sXym
h77hW/C1qGRETlxQplu/SYv93fNJJi3XRP/vUBeiBHMFEf+kv1k8KXdfLMPmG08y
Tu4TGdu6prKXluOjKJKCmxyjcMMiMKs3KGEHFeZpehhCBZw/BAcUeJj4P0IOax5G
MLMyouiH8qz1ZZ43tOBGgF9gc2x7WK5yvEmAyfVE9bkehD7dzEyeYTzoym5tEebX
MK785Iu3z8fma7qmxDHG5tIrooaN/TNq2b6582pc0QKBgQD+XWrIQYCFM21tk1E9
GcgttA2xmYHne6gq+ZaFWE2Bemzf/oKFFtVyuauyASYnKLqv7uEc0LnTSF2hIkAP
qA/jSGUJ9wqbvcakz6TvDUfgYDamTnqp0EdlQj3Z+uMd/uoT+SOblJnyJTOi+NdR
EMUCxzY1OoaQ5gBun1JezQ4GMQKBgQDbTP0r2XUvodx2oJFzMC7/bEEV0Qg6KrJc
OsEdGsQL/W9+JW5IUqQlYb97F97Cg5MPPRkjlLM8tBHkUdiNbjyrHnpdt8d50P/O
ViMiFIPKDhUzimka32fKoPN7bkdmJ5EPP0Qa8YC4UcPZQi9Ptm5DVP0OzqDANAOE
EA2y2mwHkwKBgQCzM2cWXCdKMDgIuX/DVxWTNUVseKRvS8vnMt1bZiF8dZ6ck/aq
ArMv1yTiDDMv5V7YsaeAoIA6HMJx0epl3VYMHqWoRpX/sMxwsiUVkTqxFbeKpMGA
P079RJTErB8zs7J/jccLRb7LPHBLgZpX70OMuII1L9072f418SKbzUTzEQKBgQCj
rTigS7NtE6/KUll80Y+iUBfbwqITV967e5a6tElycXuPeTxwek3NIMGbi9tU7oMK
Mp3aspd8TSG1eWjZVletmBfYbtxRDS5/wEaEny8l1ZD5YOrFhcyfrbVMgKiFlC5u
ZNfeDDX4W/6C3yUUp6JwWrRtIsdT7P5ayOiQfvl2RQKBgQCajPXye+yJqWQboUyF
C38mSIcEm7mdLCLa7psXWxsMvH15ynl34RzjI/Ne3iWIVWHbnJ9yitudvM1UcdiX
PyyRtpZNjzHF1i72Y3Ox3WRenxBqp+KjnkkOMTrK8YqxeMXgQ1XBPXXSjhrn8yD8
HVlUi9P3lKu3lUEi2bOiP2KYvg==
-----END PRIVATE KEY-----`;

describe('spec017 CURL 真实传输闭环', () => {
  it('通过 SecretResolver 注入 Header 和 Body，不依赖 request.secrets 直塞', async () => {
    const httpClient = new RecordingHttpClient();
    const executor = new CurlExecutor({
      secretResolver: new StaticCurlSecretResolver({
        'secret://api_token/token#current': 'runtime-token-secret',
        'secret://password/body#current': '{"value":"secret-body"}',
      }),
      httpClient,
    });

    const result = await executor.execute({
      idempotencyKey: 'curl_secret_resolver',
      template: {
        method: 'POST',
        url: 'https://example.com/api',
        auth: { type: 'bearer', secretRef: 'secret://api_token/token#current' },
        bodySecretRef: 'secret://password/body#current',
      },
      responsePolicy: { successStatusCodes: [200] },
    });

    assert.equal(result.success, true);
    assert.equal(httpClient.requests[0]?.headers.Authorization, 'Bearer runtime-token-secret');
    assert.equal(httpClient.requests[0]?.body?.toString('utf8'), 'secret-body');
    assert.doesNotMatch(JSON.stringify(result), /runtime-token-secret|secret-body/);
  });

  it('HTTPS 传输未设置 SNI 时不传入非法的 checkServerIdentity', async () => {
    const server = createHttpsServer({
      key: PRIVATE_KEY_PEM,
      cert: CERT_PEM,
    }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const client = new NodeCurlHttpClient();
      const result = await client.send({
        url: `https://127.0.0.1:${port}/health`,
        method: 'GET',
        headers: {},
        timeoutMs: 3000,
        tls: { verify: false },
      });

      assert.equal(result.statusCode, 200);
      assert.equal(result.bodyJson && typeof result.bodyJson === 'object' ? (result.bodyJson as { ok?: boolean }).ok : false, true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('TLS 关闭校验时即使 SNI 与证书主机名不匹配也允许连接', async () => {
    const server = createHttpsServer({
      key: PRIVATE_KEY_PEM,
      cert: CERT_PEM,
    }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const client = new NodeCurlHttpClient();
      const result = await client.send({
        url: `https://127.0.0.1:${port}/health`,
        method: 'GET',
        headers: {},
        timeoutMs: 3000,
        tls: { verify: false, servername: '127.0.0.1' },
      });

      assert.equal(result.statusCode, 200);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('真实 HTTPS 传输支持自定义 CA、mTLS 和 SNI', async () => {
    let peerAuthorized = false;
    const server = createHttpsServer({
      key: PRIVATE_KEY_PEM,
      cert: CERT_PEM,
      ca: CERT_PEM,
      requestCert: true,
      rejectUnauthorized: true,
    }, (req, res) => {
      peerAuthorized = (req.socket as TLSSocket).authorized;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;

    try {
      const executor = new CurlExecutor({
        secretResolver: new StaticCurlSecretResolver({
          'secret://password/ca#current': CERT_PEM,
          'secret://password/cert#current': CERT_PEM,
          'secret://private_key/key#current': PRIVATE_KEY_PEM,
        }),
      });

      const result = await executor.execute({
        idempotencyKey: 'curl_tls_mtls',
        template: {
          method: 'GET',
          url: `https://127.0.0.1:${port}/health`,
          tls: {
            caSecretRef: 'secret://password/ca#current',
            clientCertSecretRef: 'secret://password/cert#current',
            clientKeySecretRef: 'secret://private_key/key#current',
            sni: 'example.com',
          },
        },
        responsePolicy: { successStatusCodes: [200] },
      });

      assert.equal(result.success, true);
      assert.equal(result.statusCode, 200);
      assert.equal(peerAuthorized, true);
      assert.equal(result.bodyJson && typeof result.bodyJson === 'object' ? (result.bodyJson as { ok?: boolean }).ok : false, true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

class RecordingHttpClient implements CurlHttpClient {
  readonly requests: CurlHttpClientRequest[] = [];

  async send(request: CurlHttpClientRequest): Promise<CurlHttpClientResponse> {
    this.requests.push(request);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    };
  }
}
