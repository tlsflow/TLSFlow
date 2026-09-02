import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request, type Server } from 'node:http';
import test from 'node:test';
import { App } from './app.js';
import type { AppConfig } from '../../config/app-config.js';

const config = (tlsInspectorUrl?: string, tlsInspectorDataDir?: string): AppConfig => ({
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  apiPrefix: '/api/v1',
  openApiEnabled: false,
  logLevel: 'error',
  tlsInspectorUrl,
  tlsInspectorDataDir,
});

test('TLS Inspector 前缀请求会原样转发给本机独立进程', async () => {
  let captured: { method?: string; path?: string; tenantId?: string; body?: string } = {};
  const upstream = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    captured = {
      method: incoming.method,
      path: incoming.url,
      tenantId: incoming.headers['x-tenant-id'] as string | undefined,
      body: Buffer.concat(chunks).toString('utf8'),
    };
    outgoing.writeHead(201, { 'content-type': 'application/json', 'x-upstream': 'tls-inspector' });
    outgoing.end(JSON.stringify({ status: 'forwarded' }));
  });
  const upstreamPort = await listen(upstream);
  const appServer = new App({ config: config(`http://127.0.0.1:${upstreamPort}`) }).createNodeServer();
  const appPort = await listen(appServer);

  try {
    const response = await requestJson(appPort, '/tls-inspector/api/v1/tls-inspector/targets?page=2', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant_1' },
      body: JSON.stringify({ host: 'example.com' }),
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.headers['x-upstream'], 'tls-inspector');
    assert.deepEqual(response.body, { status: 'forwarded' });
    assert.deepEqual(captured, {
      method: 'POST',
      path: '/api/v1/tls-inspector/targets?page=2',
      tenantId: 'tenant_1',
      body: JSON.stringify({ host: 'example.com' }),
    });
  } finally {
    await close(appServer);
    await close(upstream);
  }
});

test('TLS Inspector 不可用时返回明确的网关错误', async () => {
  const port = await reservePort();
  const appServer = new App({ config: config(`http://127.0.0.1:${port}`) }).createNodeServer();
  const appPort = await listen(appServer);

  try {
    const response = await requestJson(appPort, '/tls-inspector/healthz');
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      errorCode: 'TLS_INSPECTOR_UNAVAILABLE',
      message: 'TLS 深度检测服务暂不可用',
    });
  } finally {
    await close(appServer);
  }
});

test('TLS Inspector 不可用时读取持久化快照', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'gcac-tls-proxy-'));
  await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
    targets: [{ id: 'tls-target-1', tenantId: 'tenant_1', serviceAssetId: 'asset-1', host: 'xd.jacksonz.cn', port: 443, status: 'active' }],
    snapshots: [{
      id: 'tls-snapshot-1',
      targetId: 'tls-target-1',
      tenantId: 'tenant_1',
      status: 'succeeded',
      startedAt: '2026-08-24T09:47:00.000Z',
      finishedAt: '2026-08-24T09:47:01.000Z',
      summary: { endpoint: 'xd.jacksonz.cn:443', certificateSubject: 'CN=*.jacksonz.cn', tls13Supported: true },
      certificate: { subject: 'CN=*.jacksonz.cn' },
      trustPaths: [],
      protocols: [],
      cipherSuites: [],
      simulations: [],
      protocolDetails: {},
      riskSummary: {},
    }],
  }), 'utf8');
  const upstreamPort = await reservePort();
  const appServer = new App({ config: config(`http://127.0.0.1:${upstreamPort}`, dataDir) }).createNodeServer();
  const appPort = await listen(appServer);

  try {
    const response = await requestJson(appPort, '/tls-inspector/api/v1/tls-inspector/targets/tls-target-1/latest', {
      headers: { 'x-tenant-id': 'tenant_1' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as { data: { id: string; summary: { endpoint: string } } }).data.id, 'tls-snapshot-1');
    assert.equal((response.body as { data: { summary: { endpoint: string } } }).data.summary.endpoint, 'xd.jacksonz.cn:443');
  } finally {
    await close(appServer);
  }
});

test('TLS Inspector 返回 5xx 时读取持久化快照', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'gcac-tls-proxy-5xx-'));
  await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
    targets: [{ id: 'tls-target-1', tenantId: 'tenant_1', serviceAssetId: 'asset-1', host: 'xd.jacksonz.cn', port: 443, status: 'active' }],
    snapshots: [{
      id: 'tls-snapshot-1', targetId: 'tls-target-1', tenantId: 'tenant_1', status: 'succeeded',
      startedAt: '2026-08-24T09:47:00.000Z', finishedAt: '2026-08-24T09:47:01.000Z',
      summary: {
        endpoint: 'xd.jacksonz.cn:443', certificateSubject: 'CN=*.jacksonz.cn',
        tls13Supported: false, legacyProtocolEnabled: true, simulationFailedCount: 1,
      },
      certificate: { subject: 'CN=*.jacksonz.cn', notAfter: '2026-11-04T01:08:33.000Z' },
      trustPaths: [],
      protocols: [{ label: 'TLS 1.3', supported: false }, { label: 'TLS 1.2', supported: true }],
      cipherSuites: [{ insecure: false, weak: true, strengthBits: 128 }],
      simulations: [],
      protocolDetails: { forwardSecrecy: true, supportedNamedGroups: [], pqcSupported: false },
      riskSummary: {},
    }],
  }), 'utf8');
  const upstream = createServer((_incoming, outgoing) => {
    outgoing.writeHead(503, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ message: 'temporarily unavailable' }));
  });
  const upstreamPort = await listen(upstream);
  const appServer = new App({ config: config(`http://127.0.0.1:${upstreamPort}`, dataDir) }).createNodeServer();
  const appPort = await listen(appServer);

  try {
    const response = await requestJson(appPort, '/tls-inspector/api/v1/tls-inspector/targets/tls-target-1/latest', {
      headers: { 'x-tenant-id': 'tenant_1' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal((response.body as { data: { id: string } }).data.id, 'tls-snapshot-1');

    const listResponse = await requestJson(appPort, '/tls-inspector/api/v1/tls-inspector/targets', {
      headers: { 'x-tenant-id': 'tenant_1' },
    });
    assert.equal((listResponse.body as { data: { items: Array<{ latestRating: string }> } }).data.items[0]?.latestRating, 'C');
  } finally {
    await close(appServer);
    await close(upstream);
  }
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function requestJson(
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: unknown }> {
  return await new Promise((resolve, reject) => {
    const client = request({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: options.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
      }));
    });
    client.once('error', reject);
    if (options.body) client.write(options.body);
    client.end();
  });
}
