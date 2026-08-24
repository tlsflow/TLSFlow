import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';

import { createApp } from '../../app.module.js';
import { configureTestAuth, testAuthHeaders } from '../../common/http/test-auth.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { AgentsApplicationService } from '../agents/application/agents.application-service.js';
import { StandardDeviceDiscoveryProjector } from '../plugins/discovery/standard-device-discovery.projector.js';
import { createSecurityServices } from '../security/security.controller.js';

test('旧 Agent 发现写入退役，刷新通过管理端点直接进入 capability snapshot 标准链', async () => {
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/api/v1/control/discovery') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ success: true, detail: { capabilityRescan: { trigger: 'direct' } } }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ success: false }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  const security = createSecurityServices();
  await security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_admin',
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: '*' },
  });
  const tenantId = 'tenant-standard-agent-refresh';
  const app = configureTestAuth(createApp({ db, corePersistence: { mode: 'memory' }, security }));
  const agentsService = app.getResource<AgentsApplicationService>('agentsService');
  assert.ok(agentsService);
  agentsService.setDiscoveryRequestFactory({
    createForAgent: async ({ requestId }) => ({
      requestId,
      payload: { actionType: 'agent.fact.collect', refreshWebInventory: true, requestId },
    }),
  });
  const headers = testAuthHeaders('user_admin', tenantId, {
    'x-request-id': 'request-standard-agent-refresh',
  });

  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: {
      agentKey: 'standard-refresh-agent',
      hostname: 'standard-refresh.example.com',
      version: '1.0.0',
      osType: 'linux',
      managementEndpoint: `http://127.0.0.1:${address.port}`,
    },
  });
  assert.equal(registered.statusCode, 201);
  const agent = registered.body as { id: string };
  const heartbeat = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/heartbeat',
    headers,
    body: { agentId: agent.id, version: '1.0.0', status: 'ONLINE', managementEndpoint: `http://127.0.0.1:${address.port}`, taskSummary: { running: 0, queued: 0 } },
  });
  assert.equal(heartbeat.statusCode, 200, JSON.stringify(heartbeat.body));

  const retired = await app.inject({
    method: 'POST',
    path: '/api/v1/discovery-snapshots/ingest',
    headers,
    body: {
      normalizedHash: 'legacy-v1-write',
      source: 'AGENT',
      apply: true,
      normalizedPayload: {
        hosts: [{ hostname: 'legacy-injected.example.com', osType: 'LINUX' }],
      },
    },
  });
  assert.equal(retired.statusCode, 410);
  assert.match(JSON.stringify(retired.body), /LEGACY_API_REMOVED/);

  const legacyHostCount = await db.query<{ count: string }>(
    'select count(*)::text as count from pg_hosts where tenant_id=$1 and hostname=$2',
    [tenantId, 'legacy-injected.example.com'],
  );
  assert.equal(legacyHostCount.rows[0]?.count, '0');

  const refreshed = await app.inject({
    method: 'POST',
    path: '/api/v1/assets/refresh-from-agent',
    headers,
    body: {
      agentId: agent.id,
      providerTypes: ['IIS'],
      includeBindings: true,
      requestId: 'request-standard-agent-refresh-explicit',
    },
  });
  assert.equal(refreshed.statusCode, 200, JSON.stringify(refreshed.body));
  assert.equal((refreshed.body as { mode: string }).mode, 'direct');

  const tasks = await app.inject({
    method: 'GET',
    path: `/api/v1/agents/tasks?agentId=${agent.id}`,
    headers,
  });
  assert.equal(tasks.statusCode, 200);
  assert.doesNotMatch(JSON.stringify(tasks.body), /agent\.capability\.rescan/);

  const openapi = await app.inject({ method: 'GET', path: '/api/v1/openapi.json', headers });
  assert.equal(openapi.statusCode, 200);
  const paths = (openapi.body as { paths: Record<string, unknown> }).paths;
  assert.equal(paths['/api/v1/discovery-snapshots/ingest'], undefined);
  assert.ok(paths['/api/v1/assets/refresh-from-agent']);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('旧 V1 Payload 不能冒充 V2，Schema 失败时标准业务事实零写入', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db, undefined, {
    appliedBy: 'test',
    checksum: (content) => createHash('sha256').update(content).digest('hex'),
  });
  await db.query(
    `insert into pg_hosts (
       id, tenant_id, hostname, os_type, discovery_source, compatibility_level, management_mode, status
     ) values ('host-v1-rejected','tenant-v1-rejected','v1-rejected.example.com','LINUX','AGENT','L1','AGENT','ACTIVE')`,
  );

  const projector = new StandardDeviceDiscoveryProjector(db);
  await assert.rejects(() => projector.project({
    tenantId: 'tenant-v1-rejected',
    hostId: 'host-v1-rejected',
    discoveryProviderKey: 'agent:legacy-v1',
    discoverySource: 'AGENT',
  }, {
    hosts: [{ hostname: 'v1-rejected.example.com' }],
    services: [{ providerType: 'NGINX', serviceName: 'nginx' }],
    siteAssets: [{ siteName: 'legacy-site' }],
  }));

  for (const table of ['pg_framework_instances', 'pg_site_assets', 'pg_managed_targets']) {
    const result = await db.query<{ count: string }>(
      `select count(*)::text as count from ${table} where tenant_id=$1 and discovery_provider_key=$2`,
      ['tenant-v1-rejected', 'agent:legacy-v1'],
    );
    assert.equal(result.rows[0]?.count, '0', `${table} 不得写入旧 V1 事实`);
  }
  const diagnostic = await db.query<{ status: string; payload: unknown }>(
    'select status, payload from plugin_discovery_snapshots where tenant_id=$1 and device_id=$2',
    ['tenant-v1-rejected', 'host-v1-rejected'],
  );
  assert.equal(diagnostic.rows[0]?.status, 'FAILED');
  assert.equal(diagnostic.rows[0]?.payload, null);
});
