import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';
import { AgentCapabilityDiscoveryProjector } from './agent-capability-discovery.projector.js';

function createFixture() {
  let projected: Record<string, unknown> | undefined;
  const queries: string[] = [];
  const database = {
    query: async (query: string) => {
      queries.push(query);
      return { rows: [{ id: 'host-1', hostname: 'agent-host', display_name: 'Agent Host', primary_ip: '10.0.0.10' }], rowCount: 1 };
    },
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: Record<string, unknown>) => {
      projected = discovery;
      return { serviceInstances: 0, sites: 0, managedTargets: 0, certificates: 0, certificateBindings: 0, stale: 0, conflicts: 0 };
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  return { projected: () => projected, queries: () => queries, service: new AgentCapabilityDiscoveryProjector(database, projector) };
}

function agent(): AgentRegistration {
  return {
    id: 'agent-1',
    descriptor: { hostname: 'agent-host', osVersion: 'Linux', ipAddress: '10.0.0.10' },
  } as AgentRegistration;
}

function snapshot(capabilities: AgentCapabilitySnapshot['capabilities']): AgentCapabilitySnapshot {
  return {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    reportedAt: '2026-08-09T00:00:00.000Z',
    capabilities,
  } as AgentCapabilitySnapshot;
}

test('Agent 快照只投影通用主机事实，不生成产品对象', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    { capabilityKey: 'process.list', confidence: 1, value: true },
    { capabilityKey: 'service.list', confidence: 0.9, value: { count: 3 } },
  ]));

  const projected = fixture.projected() as {
    device: { productFamily: string };
    capabilities: Array<{ key: string; available: boolean; metadata?: Record<string, unknown> }>;
    frameworks: unknown[];
    sites: unknown[];
    managedTargets: unknown[];
    certificates: unknown[];
    certificateBindings: unknown[];
  };
  assert.equal(projected.device.productFamily, 'AGENT_HOST');
  assert.deepEqual(projected.capabilities, [
    { key: 'process.list', available: true, metadata: { confidence: 1 } },
    { key: 'service.list', available: true, metadata: { confidence: 0.9 } },
  ]);
  assert.equal(projected.frameworks.length, 0);
  assert.equal(projected.sites.length, 0);
  assert.equal(projected.managedTargets.length, 0);
  assert.equal(projected.certificates.length, 0);
  assert.equal(projected.certificateBindings.length, 0);
});

test('Agent 能力值为 false 或 null 时只表示不可用，不被解释为产品未安装', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    { capabilityKey: 'filesystem.read', confidence: 1, value: false },
    { capabilityKey: 'service.status', confidence: 1, value: null },
  ]));

  const projected = fixture.projected() as { capabilities: Array<{ key: string; available: boolean }> };
  assert.deepEqual(projected.capabilities, [
    { key: 'filesystem.read', available: false, metadata: { confidence: 1 } },
    { key: 'service.status', available: false, metadata: { confidence: 1 } },
  ]);
});

test('缺少统一 Host 资产锚点时失败关闭', async () => {
  const database = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as DatabasePort;
  const projector = {} as StandardDeviceDiscoveryProjector;
  const service = new AgentCapabilityDiscoveryProjector(database, projector);

  await assert.rejects(
    () => service.project(agent(), snapshot([])),
    (error: unknown) => error instanceof Error && error.message.includes('统一 Host 资产锚点'),
  );
});

test('Agent 快照中的产品能力字段不会被宿主当作站点识别结果', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    { capabilityKey: 'web.nginx.detail', confidence: 0.9, value: { installed: true, version: '1.24', sites: [
      { name: 'nginx-a', port: 443, protocol: 'https', serverNames: ['a.example.test'] },
      { name: 'nginx-a', port: 443, protocol: 'https', serverNames: ['a.example.test'] },
    ] } },
    { capabilityKey: 'web.apache.detail', confidence: 0.9, value: { Installed: true, VersionString: '2.4', Sites: [
      { Name: 'apache-a', Bindings: [{ Port: 8443, Protocol: 'https', HostHeader: 'apache.example.test' }] },
    ] } },
    { capabilityKey: 'app.tomcat.detail', confidence: 0.9, value: { installed: true, version: '10', apps: [
      { contextPath: '/app', docBase: '/srv/app' },
      { contextPath: '/admin', docBase: '/srv/admin' },
    ], connectors: [{ port: 8443, tls: true }] } },
    { capabilityKey: 'web.iis.detail', confidence: 0.9, value: { Installed: true, VersionString: '10', Sites: [
      { Name: 'IIS Site', Bindings: [{ Port: 443, Protocol: 'https', HostHeader: 'iis.example.test' }] },
    ] } },
  ]));

  const projected = fixture.projected() as {
    frameworks: Array<{ frameworkType: string }>;
    sites: Array<{ stableKey: string }>;
    managedTargets: Array<{ siteStableKey: string }>;
  };
  assert.equal(projected.frameworks.length, 0);
  assert.equal(projected.sites.length, 0);
  assert.equal(projected.managedTargets.length, 0);
});

test('通用 Web inventory 已带框架和站点时完整保留，不退化为单端口猜测', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    {
      capabilityKey: 'web.inventory',
      confidence: 0.95,
      value: {
        processExecutables: ['/usr/sbin/nginx', '/usr/sbin/httpd'],
        listeningPorts: [{ port: 80, address: '0.0.0.0', protocol: 'tcp' }],
        frameworks: [
          { frameworkType: 'web.nginx', executable: '/usr/sbin/nginx' },
          { frameworkType: 'web.apache', executable: '/usr/sbin/httpd' },
        ],
        sites: [
          { name: 'public.example.test', frameworkType: 'web.nginx', port: 80, protocol: 'HTTP', address: 'public.example.test' },
          { name: 'admin.example.test', frameworkType: 'web.apache', port: 80, protocol: 'HTTP', address: 'admin.example.test' },
        ],
      },
    },
  ]));

  const projected = fixture.projected() as {
    frameworks: Array<{ frameworkType: string }>;
    sites: Array<{ displayName: string; frameworkStableKey: string }>;
  };
  assert.deepEqual(projected.frameworks.map((item) => item.frameworkType), ['web.nginx', 'web.apache']);
  assert.deepEqual(projected.sites.map((item) => item.displayName), ['public.example.test', 'admin.example.test']);
  assert.deepEqual(projected.sites.map((item) => item.frameworkStableKey), ['framework:web.nginx', 'framework:web.apache']);
});

test('同一 Nginx 站点聚合 HTTP 和 HTTPS 监听，并关联 Agent 上报的证书元数据', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: '/etc/nginx/conf.d/site.conf', content: `server { listen 80; server_name test.local www.test.local; }\nserver { listen 443 ssl; server_name test.local www.test.local; ssl_certificate /etc/nginx/certs/test.pem; }` }],
      certificateFiles: [{ path: '/etc/nginx/certs/test.pem', name: 'test.local', sha256Fingerprint: 'a'.repeat(64), subject: 'CN=test.local', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' }],
    },
  }]));

  const projected = fixture.projected() as {
    sites: Array<{ displayName: string; addresses: string[]; port?: number; protocol?: string; metadata: { listeners?: unknown[] } }>;
    managedTargets: Array<{ stableKey: string; siteStableKey?: string }>;
    certificates: Array<{ sha256Fingerprint?: string; subject?: string }>;
    certificateBindings: Array<{ managedTargetStableKey: string; certificateStableKey: string }>;
  };
  assert.equal(projected.sites.length, 1);
  assert.equal(projected.sites[0]?.displayName, 'test.local');
  assert.deepEqual(projected.sites[0]?.addresses, ['test.local', 'www.test.local', '10.0.0.10']);
  assert.equal(projected.sites[0]?.port, 443);
  assert.equal(projected.sites[0]?.protocol, 'HTTPS');
  assert.equal(projected.sites[0]?.metadata.listeners?.length, 2);
  assert.equal(projected.managedTargets.length, 1);
  assert.deepEqual(projected.certificates, [{ sha256Fingerprint: 'A'.repeat(64), stableKey: `CERT:${'A'.repeat(64)}`, subject: 'CN=test.local', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00.000Z', notAfter: '2027-08-01T00:00:00.000Z', metadata: { path: '/etc/nginx/certs/test.pem', name: 'test.local' } }]);
  assert.equal(projected.certificateBindings.length, 1);
  assert.equal(projected.certificateBindings[0]?.managedTargetStableKey, projected.managedTargets[0]?.stableKey);
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'A'.repeat(64)}`);
});

test('权威 web.inventory 投影成功后只淘汰旧 Agent Web 插件资产', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.9, value: { configFiles: [] },
  }]));

  const cleanupSql = fixture.queries().slice(1).join('\n');
  assert.match(cleanupSql, /update pg_framework_instances/i);
  assert.match(cleanupSql, /update pg_site_assets/i);
  assert.match(cleanupSql, /update pg_managed_targets/i);
  assert.match(cleanupSql, /update pg_certificate_bindings/i);
  assert.match(cleanupSql, /framework_type = any\(\$4::text\[\]\)/i);
  assert.match(cleanupSql, /discovery_source='AGENT'/i);
  assert.match(cleanupSql, /discovery_provider_key like 'plugin:%'/i);
});
