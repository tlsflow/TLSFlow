import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';
import { AgentCapabilityDiscoveryProjector } from './agent-capability-discovery.projector.js';

function createFixture() {
  let projected: Record<string, unknown> | undefined;
  let projectionContext: Record<string, unknown> | undefined;
  const queries: string[] = [];
  const database = {
    query: async (query: string) => {
      queries.push(query);
      return { rows: [{ id: 'host-1', hostname: 'agent-host', display_name: 'Agent Host', primary_ip: '10.0.0.10' }], rowCount: 1 };
    },
  } as unknown as DatabasePort;
  const projector = {
    project: async (context: Record<string, unknown>, discovery: Record<string, unknown>) => {
      projectionContext = context;
      projected = discovery;
      return { serviceInstances: 0, sites: 0, managedTargets: 0, certificates: 0, certificateBindings: 0, stale: 0, conflicts: 0 };
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  return { projected: () => projected, projectionContext: () => projectionContext, queries: () => queries, service: new AgentCapabilityDiscoveryProjector(database, projector) };
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
    capabilities: capabilities.map((capability) => {
      if (capability.capabilityKey !== 'web.inventory' || !capability.value || typeof capability.value !== 'object' || Array.isArray(capability.value)) return capability;
      const value = capability.value as Record<string, unknown>;
      return value.scope ? capability : { ...capability, value: { scope: 'FULL_WEB_DISCOVERY', ...value } };
    }),
  } as AgentCapabilitySnapshot;
}

test('周期运行态快照不触发 Web 投影', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    { capabilityKey: 'process.list', confidence: 1, value: true },
    { capabilityKey: 'service.list', confidence: 0.9, value: { count: 3 } },
  ]));

  assert.equal(fixture.projected(), undefined);
  assert.equal(fixture.queries().length, 0);
});

test('非完整 Web scope 的库存不能触发投影', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    { capabilityKey: 'web.inventory', confidence: 1, value: { scope: 'RUNTIME_TELEMETRY', configFiles: [{ path: '/etc/nginx/nginx.conf', content: 'server { listen 443 ssl; }' }] } },
  ]));

  assert.equal(fixture.projected(), undefined);
  assert.equal(fixture.queries().length, 0);
});

test('缺少统一 Host 资产锚点时失败关闭', async () => {
  const database = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as DatabasePort;
  const projector = {} as StandardDeviceDiscoveryProjector;
  const service = new AgentCapabilityDiscoveryProjector(database, projector);

  await assert.rejects(
    () => service.project(agent(), snapshot([{ capabilityKey: 'web.inventory', confidence: 1, value: { scope: 'FULL_WEB_DISCOVERY', configFiles: [] } }])),
    (error: unknown) => error instanceof Error && error.message.includes('统一 Host 资产锚点'),
  );
});

test('产品能力字段不会被宿主当作站点识别结果', async () => {
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

  assert.equal(fixture.projected(), undefined);
});

test('成熟 Agent Web 快照直接投影框架、站点和配置绑定证书', async () => {
  const fixture = createFixture();

  await fixture.service.project(agent(), snapshot([
    {
      capabilityKey: 'web.inventory',
      confidence: 0.95,
      value: {
        scope: 'FULL_WEB_DISCOVERY',
        frameworks: [
          { frameworkType: 'web.iis', displayName: 'IIS', version: '10.0' },
          { frameworkType: 'web.nginx', displayName: 'Nginx', version: '1.24' },
          { frameworkType: 'web.apache', displayName: 'Apache', version: '2.4' },
          { frameworkType: 'app.tomcat', displayName: 'Tomcat', version: '10.1' },
        ],
        sites: [
          { name: 'IIS Portal', frameworkType: 'web.iis', serverNames: ['iis.example.test'], port: 443, protocol: 'HTTPS', metadata: { siteId: 'iis:1', configPath: 'C:/Windows/System32/inetsrv/config/applicationHost.config', listeners: [{ address: '*', port: 443, protocol: 'HTTPS', host: 'iis.example.test', certificateThumbprint: '00112233445566778899AABBCCDDEEFF00112233', certificateStoreName: 'My', certificateStoreLocation: 'LocalMachine' }] } },
          { name: 'Nginx Live', frameworkType: 'web.nginx', serverNames: ['nginx.example.test'], port: 8443, protocol: 'HTTPS', metadata: { siteId: 'nginx:1', configPath: 'D:/nginx/conf/nginx.conf', listeners: [{ address: '*', port: 80, protocol: 'HTTP', host: 'nginx.example.test' }, { address: '*', port: 8443, protocol: 'HTTPS', host: 'nginx.example.test', certificatePath: 'D:/nginx/certs/live.pem', sourceConfigPath: 'D:/nginx/conf/nginx.conf' }] } },
          { name: 'Apache Live', frameworkType: 'web.apache', serverNames: ['apache.example.test'], port: 9443, protocol: 'HTTPS', metadata: { siteId: 'apache:1', configPath: 'E:/Apache/conf/httpd.conf', listeners: [{ address: '*', port: 9443, protocol: 'HTTPS', host: 'apache.example.test', certificatePath: 'E:/Apache/certs/live.pem', sourceConfigPath: 'E:/Apache/conf/httpd.conf' }] } },
          { name: 'Tomcat Live', frameworkType: 'app.tomcat', serverNames: ['tomcat.example.test'], port: 10443, protocol: 'HTTPS', metadata: { siteId: 'tomcat:1', configPath: 'F:/Tomcat/conf/server.xml', listeners: [{ address: '*', port: 10443, protocol: 'HTTPS', host: 'tomcat.example.test', keystorePath: 'F:/Tomcat/conf/live.p12', keystoreType: 'PKCS12', sourceConfigPath: 'F:/Tomcat/conf/server.xml' }] } },
        ],
        certificateFiles: [
          { path: 'windows-certstore://LocalMachine/My/00112233445566778899AABBCCDDEEFF00112233', thumbprint: '00112233445566778899AABBCCDDEEFF00112233', sha256Fingerprint: 'a'.repeat(64), subject: 'CN=iis.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z', store: 'My', storeLocation: 'LocalMachine' },
          { path: 'D:/nginx/certs/live.pem', sha256Fingerprint: 'b'.repeat(64), subject: 'CN=nginx.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' },
          { path: 'E:/Apache/certs/live.pem', sha256Fingerprint: 'c'.repeat(64), subject: 'CN=apache.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' },
          { path: 'F:/Tomcat/conf/live.p12', sha256Fingerprint: 'd'.repeat(64), subject: 'CN=tomcat.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' },
        ],
      },
    },
  ]));

  const projected = fixture.projected() as {
    frameworks: Array<{ frameworkType: string }>;
    sites: Array<{ displayName: string; metadata?: { listeners?: Array<{ protocol?: string }> } }>;
    certificateBindings: Array<{ certificateStableKey: string; observedCertificateStableKey?: string }>;
  };
  assert.deepEqual(projected.frameworks.map((item) => item.frameworkType), ['web.iis', 'web.nginx', 'web.apache', 'app.tomcat']);
  assert.deepEqual(projected.sites.map((item) => item.displayName), ['IIS Portal', 'Nginx Live', 'Apache Live', 'Tomcat Live']);
  assert.equal(projected.sites[1]?.metadata?.listeners?.filter((item) => item.protocol === 'HTTP').length, 1);
  assert.deepEqual(projected.certificateBindings.map((item) => item.certificateStableKey), [
    `CERT:${'A'.repeat(64)}`,
    `CERT:${'B'.repeat(64)}`,
    `CERT:${'C'.repeat(64)}`,
    `CERT:${'D'.repeat(64)}`,
  ]);
  assert.ok(projected.certificateBindings.every((item) => item.observedCertificateStableKey === undefined));
  assert.equal(fixture.projectionContext()?.preserveEmptyWeb, false);
});

test('Windows Nginx 权威库存把服务名、程序路径和配置指纹投影到 ManagedTarget', async () => {
  const fixture = createFixture();
  const fingerprint = 'a'.repeat(64);
  const programSha256 = 'd'.repeat(64);
  const workingDirectory = 'D:/runtime/nginx';
  const configCheckArgs = ['-t', '-p', workingDirectory, '-c', 'D:/runtime/nginx/conf/nginx.conf'];
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory',
    confidence: 0.99,
    value: {
      scope: 'FULL_WEB_DISCOVERY',
      frameworks: [{
        frameworkType: 'web.nginx',
        displayName: 'Nginx',
        metadata: {
          programPath: 'D:/runtime/nginx/nginx.exe',
          configPath: 'D:/runtime/nginx/conf/nginx.conf',
          configFingerprint: fingerprint,
        },
      }],
      sites: [{
        frameworkType: 'web.nginx',
        name: 'portal.example.test',
        serverNames: ['portal.example.test'],
        metadata: {
          configPath: 'D:/runtime/nginx/conf/nginx.conf',
          configFingerprint: fingerprint,
          listeners: [{
            address: '*',
            port: 443,
            protocol: 'HTTPS',
            host: 'portal.example.test',
            sourceConfigPath: 'D:/runtime/nginx/conf/nginx.conf',
            certificatePath: 'D:/runtime/nginx/conf/certs/portal.crt',
            certificateKeyPath: 'D:/runtime/nginx/conf/certs/portal.key',
            serviceName: 'nginx-production',
            programPath: 'D:/runtime/nginx/nginx.exe',
            programSha256,
            workingDirectory,
            configCheckArgs,
            configCheckArgsTemplate: configCheckArgs,
            configFingerprint: fingerprint,
          }],
        },
      }],
      certificateFiles: [{
        path: 'D:/runtime/nginx/conf/certs/portal.crt',
        sha256Fingerprint: 'b'.repeat(64),
        subject: 'CN=portal.example.test',
        issuer: 'CN=GCAC Test CA',
        notBefore: '2026-08-01T00:00:00Z',
        notAfter: '2027-08-01T00:00:00Z',
      }],
    },
  }]));

  const projected = fixture.projected() as {
    managedTargets: Array<{ metadata?: { certificateLocation?: Record<string, unknown> } }>;
    certificateBindings: Array<{ deploymentTarget?: Record<string, unknown> }>;
  };
  assert.deepEqual(projected.managedTargets[0]?.metadata?.certificateLocation, {
    storageKind: 'PEM_FILES',
    certificatePath: 'D:/runtime/nginx/conf/certs/portal.crt',
    privateKeyPath: 'D:/runtime/nginx/conf/certs/portal.key',
    sourceConfigPath: 'D:/runtime/nginx/conf/nginx.conf',
    serviceName: 'nginx-production',
    programPath: 'D:/runtime/nginx/nginx.exe',
    programSha256,
    workingDirectory,
    configCheckArgs,
    configCheckArgsTemplate: configCheckArgs,
    configFingerprint: fingerprint,
  });
  assert.deepEqual(projected.certificateBindings[0]?.deploymentTarget, projected.managedTargets[0]?.metadata?.certificateLocation);
});

test('权威库存从框架运行事实向 Apache、Nginx 和 Tomcat 监听器统一补齐工作目录', async () => {
  const fixture = createFixture();
  const frameworkCases = [
    { frameworkType: 'web.apache', name: 'apache.example.test', workingDirectory: 'E:/Apache' },
    { frameworkType: 'web.nginx', name: 'nginx.example.test', workingDirectory: 'D:/Nginx' },
    { frameworkType: 'app.tomcat', name: 'tomcat.example.test', workingDirectory: 'F:/Tomcat' },
  ];
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory',
    confidence: 0.99,
    value: {
      scope: 'FULL_WEB_DISCOVERY',
      frameworks: frameworkCases.map(({ frameworkType, workingDirectory }) => ({
        frameworkType,
        metadata: { workingDirectory },
      })),
      sites: frameworkCases.map(({ frameworkType, name }) => ({
        frameworkType,
        name,
        metadata: {
          listeners: [{
            address: '*',
            port: 443,
            protocol: 'HTTPS',
            host: name,
            sourceConfigPath: `/${frameworkType}/server.conf`,
            certificatePath: `/${frameworkType}/server.crt`,
          }],
        },
      })),
      certificateFiles: frameworkCases.map(({ frameworkType, name }, index) => ({
        path: `/${frameworkType}/server.crt`,
        sha256Fingerprint: String.fromCharCode(97 + index).repeat(64),
        subject: `CN=${name}`,
        issuer: 'CN=GCAC Test CA',
        notBefore: '2026-08-01T00:00:00Z',
        notAfter: '2027-08-01T00:00:00Z',
      })),
    },
  }]));

  const projected = fixture.projected() as {
    managedTargets: Array<{ metadata?: { certificateLocation?: Record<string, unknown> } }>;
  };
  assert.deepEqual(
    projected.managedTargets.map((target) => target.metadata?.certificateLocation?.workingDirectory),
    ['E:/Apache', 'D:/Nginx', 'F:/Tomcat'],
  );
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
    frameworks: Array<{ frameworkType: string; metadata?: { source?: string } }>;
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
  assert.equal(projected.frameworks[0]?.metadata?.source, 'host.web-config');
  assert.equal(projected.managedTargets.length, 1);
  assert.deepEqual(projected.certificates, [{ sha256Fingerprint: 'A'.repeat(64), stableKey: `CERT:${'A'.repeat(64)}`, subject: 'CN=test.local', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00.000Z', notAfter: '2027-08-01T00:00:00.000Z', metadata: { path: '/etc/nginx/certs/test.pem', name: 'test.local' } }]);
  assert.equal(projected.certificateBindings.length, 1);
  assert.equal(projected.certificateBindings[0]?.managedTargetStableKey, projected.managedTargets[0]?.stableKey);
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'A'.repeat(64)}`);
});

test('TLS 握手证书不会进入 Agent 配置绑定投影', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: 'C:/GCAC-Lab/nginx/conf/nginx-gcac.conf', content: 'server { listen 8443 ssl; server_name nginx.test.local; ssl_certificate C:/GCAC-Lab/certs/config.pem; }' }],
      certificateFiles: [{ path: 'C:/GCAC-Lab/certs/config.pem', sha256Fingerprint: 'a'.repeat(64), subject: 'CN=nginx.test.local', issuer: 'CN=GCAC Lab Root CA', notBefore: '2026-08-04T02:29:03Z', notAfter: '2028-11-06T02:29:03Z' }],
      tlsCertificateObservations: [{ source: 'local-tls-handshake', frameworkType: 'web.nginx', address: '0.0.0.0', port: 8443, hostname: 'nginx.test.local', sni: 'nginx.test.local', thumbprint: 'B'.repeat(40), path: 'windows-tls://127.0.0.1/8443', sha256Fingerprint: 'b'.repeat(64), subject: 'CN=nginx.test.local', issuer: 'CN=GCAC Lab Root CA', notBefore: '2026-08-04T10:17:16Z', notAfter: '2028-11-06T10:17:16Z' }],
    },
  }]));

  const projected = fixture.projected() as {
    sites: Array<{ metadata?: { listeners?: Array<Record<string, unknown>> } }>;
    certificates: Array<{ stableKey: string; sha256Fingerprint?: string }>;
    certificateBindings: Array<{ certificateStableKey: string }>;
  };
  const listener = projected.sites[0]?.metadata?.listeners?.find((item) => item.protocol === 'HTTPS');
  assert.equal(listener?.certificatePath, 'C:/GCAC-Lab/certs/config.pem');
  assert.equal(listener?.certificateThumbprint, undefined);
  assert.ok(!projected.certificates.some((item) => item.sha256Fingerprint === 'B'.repeat(64)));
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'A'.repeat(64)}`);
  assert.equal((projected.certificateBindings[0] as any)?.observedCertificateStableKey, undefined);
});

test('有 DNS 主机名的 Apache 站点不能采用无 SNI 的默认 TLS 证书', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: 'C:/GCAC-Lab/Apache24/conf/httpd-gcac.conf', content: 'Listen 8444\nServerName apache.test.local:8444\nSSLEngine on\n' }],
      tlsCertificateObservations: [{ source: 'local-tls-handshake', frameworkType: 'web.apache', address: '0.0.0.0', port: 8444, hostname: '', sni: '', thumbprint: 'B'.repeat(40), path: 'windows-tls://127.0.0.1/8444/default', sha256Fingerprint: 'b'.repeat(64), subject: 'CN=default.test.local', issuer: 'CN=GCAC Lab Root CA', notBefore: '2026-08-04T10:17:16Z', notAfter: '2028-11-06T10:17:16Z' }],
    },
  }]));

  const projected = fixture.projected() as {
    sites: Array<{ displayName: string; metadata?: { listeners?: Array<Record<string, unknown>> } }>;
    certificateBindings: unknown[];
  };
  const https = projected.sites[0]?.metadata?.listeners?.find((item) => item.protocol === 'HTTPS');
  assert.equal(https?.certificateThumbprint, undefined);
  assert.equal(projected.certificateBindings.length, 0);
});

test('没有 TLS 观测时仍保留真实配置证书绑定', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: 'C:/GCAC-Lab/nginx/conf/nginx-gcac.conf', content: 'server { listen 8443 ssl; server_name nginx.test.local; ssl_certificate C:/GCAC-Lab/certs/config.pem; }' }],
      certificateFiles: [{ path: 'C:/GCAC-Lab/certs/config.pem', sha256Fingerprint: 'a'.repeat(64), subject: 'CN=config.local', issuer: 'CN=GCAC Lab Root CA', notBefore: '2026-08-04T02:29:03Z', notAfter: '2028-11-06T02:29:03Z' }],
    },
  }]));
  const projected = fixture.projected() as { sites: unknown[]; certificates: unknown[]; certificateBindings: unknown[] };
  assert.equal(projected.sites.length, 1);
  assert.equal(projected.certificates.length, 1);
  assert.equal(projected.certificateBindings.length, 1);
});

test('Windows Full Agent 的 IIS Binding 只投影实际关联的证书', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{
        path: 'C:/Windows/System32/inetsrv/config/applicationHost.config',
        content: '<configuration><system.applicationHost><sites><site name="Portal"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" certificateHash="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" certificateStoreName="My" /></bindings></site></sites></system.applicationHost></configuration>',
      }],
      certificateFiles: [
        { path: 'windows-certstore://LocalMachine/My/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', thumbprint: 'A'.repeat(40), sha256Fingerprint: 'a'.repeat(64), subject: 'CN=portal.example.test', issuer: 'CN=GCAC Lab Root CA', notBefore: '2026-08-04T02:29:03Z', notAfter: '2028-11-06T02:29:03Z', store: 'My', storeLocation: 'LocalMachine' },
      ],
      sslCertificateBindings: [{ source: 'web-administration', frameworkType: 'web.iis', address: '0.0.0.0', port: 443, hostname: 'portal.example.test', thumbprint: 'A'.repeat(40), store: 'My' }],
      tlsCertificateObservations: [{ source: 'local-tls-handshake', frameworkType: 'web.iis', address: '0.0.0.0', port: 443, hostname: 'portal.example.test', sni: 'portal.example.test', thumbprint: 'B'.repeat(40), path: 'windows-tls://127.0.0.1/443/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', sha256Fingerprint: 'b'.repeat(64), subject: 'CN=portal.example.test', issuer: 'CN=GCAC Lab Root CA', notBefore: '2026-08-04T10:17:16Z', notAfter: '2028-11-06T10:17:16Z' }],
    },
  }]));
  const projected = fixture.projected() as {
    certificateBindings: Array<{ certificateStableKey: string; observedCertificateStableKey?: string; metadata?: Record<string, unknown> }>;
  };
  assert.equal(projected.certificateBindings.length, 1);
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'A'.repeat(64)}`);
  assert.equal(projected.certificateBindings[0]?.observedCertificateStableKey, undefined);
  assert.equal(projected.certificateBindings[0]?.metadata?.driftStatus, undefined);
});

test('IIS binding Thumbprint 只关联完整的 Windows 证书库事实', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: 'C:/Windows/System32/inetsrv/config/applicationHost.config', content: `<configuration><system.applicationHost><sites><site name="Portal"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" certificateHash="a1 b2 c3 d4 e5 f6 07 08" certificateStoreName="My" /></bindings></site></sites></system.applicationHost></configuration>` }],
      certificateFiles: [{ path: 'windows-certstore://LocalMachine/My/A1B2C3D4E5F60708', thumbprint: 'A1B2C3D4E5F60708', sha256Fingerprint: 'a'.repeat(64), subject: 'CN=portal.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z', store: 'My', storeLocation: 'LocalMachine' }],
    },
  }]));
  const projected = fixture.projected() as {
    certificates: Array<{ stableKey: string; subject?: string; sha256Fingerprint?: string; metadata?: Record<string, unknown> }>;
    certificateBindings: Array<{ certificateStableKey: string; metadata?: Record<string, unknown> }>;
  };
  assert.equal(projected.certificates[0]?.stableKey, `CERT:${'A'.repeat(64)}`);
  assert.equal(projected.certificates[0]?.subject, 'CN=portal.example.test');
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'A'.repeat(64)}`);
  assert.equal(projected.certificateBindings[0]?.metadata?.certificateThumbprint, 'A1B2C3D4E5F60708');
  assert.deepEqual(projected.certificateBindings[0]?.metadata?.configuredCertificate, {
    path: 'windows-certstore://LocalMachine/My/A1B2C3D4E5F60708',
    fingerprintSha256: 'A'.repeat(64),
    subject: 'CN=portal.example.test',
    issuer: 'CN=GCAC Test CA',
    notBefore: '2026-08-01T00:00:00.000Z',
    notAfter: '2027-08-01T00:00:00.000Z',
    thumbprint: 'A1B2C3D4E5F60708',
  });
});

test('HTTP.sys 同端口绑定不能补回 IIS 缺失的证书关联', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: 'C:/Windows/System32/inetsrv/config/applicationHost.config', content: '<configuration><system.applicationHost><sites><site name="Portal"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" /></bindings></site></sites></system.applicationHost></configuration>' }],
      sslCertificateBindings: [{ address: '0.0.0.0', port: 443, protocol: 'https', thumbprint: 'A1B2C3D4E5F60708', store: 'MY' }],
      certificateFiles: [{ path: 'windows-certstore://LocalMachine/My/A1B2C3D4E5F60708', thumbprint: 'A1B2C3D4E5F60708', sha256Fingerprint: 'a'.repeat(64), subject: 'CN=portal.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z', store: 'My', storeLocation: 'LocalMachine' }],
    },
  }]));
  const projected = fixture.projected() as {
    certificateBindings: Array<{ certificateStableKey: string; metadata?: Record<string, unknown> }>;
  };
  assert.equal(projected.certificateBindings.length, 0);
});

test('IIS 证书库暂不可读时保留站点和监听器，但不伪造证书绑定', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: 'C:/Windows/System32/inetsrv/config/applicationHost.config', content: '<configuration><system.applicationHost><sites><site name="Portal"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" certificateHash="A1B2C3D4E5F60708" /></bindings></site></sites></system.applicationHost></configuration>' }],
      certificateFiles: [],
    },
  }]));
  const projected = fixture.projected() as { sites: unknown[]; managedTargets: unknown[]; certificates: unknown[]; certificateBindings: unknown[] };
  assert.equal(projected.sites.length, 1);
  assert.equal(projected.managedTargets.length, 1);
  assert.equal(projected.certificates.length, 0);
  assert.equal(projected.certificateBindings.length, 0);
});

test('非 IIS 配置引用证书路径但证书未真实解析时不生成伪绑定', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: 'F:/runtime/Tomcat/conf/server.xml', content: '<Connector port="8443" scheme="https"><SSLHostConfig><Certificate certificateKeystoreFile="conf/localhost-rsa.p12" /></SSLHostConfig></Connector><Host name="tomcat.example.test" />' }],
      certificateFiles: [],
    },
  }]));
  const projected = fixture.projected() as { sites: unknown[]; managedTargets: unknown[]; certificates: unknown[]; certificateBindings: unknown[] };
  assert.equal(projected.sites.length, 1);
  assert.equal(projected.managedTargets.length, 1);
  assert.equal(projected.certificates.length, 0);
  assert.equal(projected.certificateBindings.length, 0);
});

test('Windows 原始库存可同时投影 IIS、Nginx、Apache、Tomcat 及其证书绑定', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [
        { path: 'C:/Windows/System32/inetsrv/config/applicationHost.config', content: `<configuration><system.applicationHost><sites><site name="IIS Portal"><bindings><binding protocol="https" bindingInformation="*:443:iis.example.test" certificateHash="00112233445566778899AABBCCDDEEFF00112233" certificateStoreName="My" /></bindings></site></sites></system.applicationHost></configuration>` },
        { path: 'D:/services/nginx/conf/nginx.conf', content: `server { listen 8443 ssl; server_name nginx.example.test; ssl_certificate D:/services/nginx/conf/nginx.crt; }` },
        { path: 'E:/apps/Apache2.4/conf/extra/httpd-vhosts.conf', content: `<VirtualHost *:9443>\nServerName apache.example.test\nSSLEngine on\nSSLCertificateFile E:/apps/Apache2.4/conf/apache.crt\n</VirtualHost>` },
        { path: 'F:/runtime/Tomcat/conf/server.xml', content: `<Server><Service><Connector port="10443" scheme="https"><SSLHostConfig><Certificate certificateFile="F:/runtime/Tomcat/conf/tomcat.crt" /></SSLHostConfig></Connector></Service><Host name="tomcat.example.test" /></Server>` },
      ],
      certificateFiles: [
        { path: 'windows-certstore://LocalMachine/My/00112233445566778899AABBCCDDEEFF00112233', thumbprint: '00112233445566778899AABBCCDDEEFF00112233', sha256Fingerprint: 'd'.repeat(64), store: 'My', storeLocation: 'LocalMachine', subject: 'CN=iis.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' },
        { path: 'D:/services/nginx/conf/nginx.crt', sha256Fingerprint: 'a'.repeat(64), subject: 'CN=nginx.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' },
        { path: 'E:/apps/Apache2.4/conf/apache.crt', sha256Fingerprint: 'b'.repeat(64), subject: 'CN=apache.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' },
        { path: 'F:/runtime/Tomcat/conf/tomcat.crt', sha256Fingerprint: 'c'.repeat(64), subject: 'CN=tomcat.example.test', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' },
      ],
    },
  }]));

  const projected = fixture.projected() as {
    frameworks: Array<{ frameworkType: string }>;
    sites: Array<{ displayName: string }>;
    certificateBindings: Array<{ certificateStableKey: string }>;
  };
  assert.deepEqual(projected.frameworks.map((item) => item.frameworkType), ['web.iis', 'web.nginx', 'web.apache', 'app.tomcat']);
  assert.deepEqual(projected.sites.map((item) => item.displayName), ['IIS Portal', 'nginx.example.test', 'apache.example.test', 'tomcat.example.test']);
  assert.deepEqual(projected.certificateBindings.map((item) => item.certificateStableKey), [
    `CERT:${'D'.repeat(64)}`,
    `CERT:${'A'.repeat(64)}`,
    `CERT:${'B'.repeat(64)}`,
    `CERT:${'C'.repeat(64)}`,
  ]);
});

test('Windows Nginx、Apache、Tomcat 保留旧扫描器的完整部署位置语义', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [
        { path: 'D:/runtime/nginx/conf/nginx.conf', content: 'server { listen 8443 ssl; server_name nginx.test.local; ssl_certificate conf/certs/nginx.crt; ssl_certificate_key conf/certs/nginx.key; }' },
        { path: 'E:/runtime/Apache24/conf/httpd.conf', content: '<VirtualHost *:8444>\nServerName apache.test.local\nSSLEngine on\nSSLCertificateFile conf/certs/apache.crt\nSSLCertificateKeyFile conf/certs/apache.key\nSSLCertificateChainFile conf/certs/apache-chain.crt\n</VirtualHost>' },
        { path: 'F:/runtime/Tomcat/conf/server.xml', content: '<Connector port="8445" scheme="https"><SSLHostConfig><Certificate certificateKeystoreFile="conf/tomcat.p12" certificateKeystoreType="PKCS12" certificateKeyAlias="server" /></SSLHostConfig></Connector><Host name="tomcat.test.local" />' },
      ],
      certificateFiles: [
        { path: 'D:/runtime/nginx/conf/certs/nginx.crt', configuredPaths: ['conf/certs/nginx.crt'], sha256Fingerprint: 'a'.repeat(64), subject: 'CN=nginx.test.local', issuer: 'CN=CA', notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z' },
        { path: 'E:/runtime/Apache24/conf/certs/apache.crt', configuredPaths: ['conf/certs/apache.crt'], sha256Fingerprint: 'b'.repeat(64), subject: 'CN=apache.test.local', issuer: 'CN=CA', notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z' },
        { path: 'F:/runtime/Tomcat/conf/tomcat.p12', configuredPaths: ['conf/tomcat.p12'], sha256Fingerprint: 'c'.repeat(64), subject: 'CN=tomcat.test.local', issuer: 'CN=CA', notBefore: '2026-01-01T00:00:00Z', notAfter: '2027-01-01T00:00:00Z' },
      ],
    },
  }]));

  const projected = fixture.projected() as {
    certificateBindings: Array<{ deploymentTarget?: Record<string, unknown> }>;
  };
  assert.deepEqual(projected.certificateBindings.map((binding) => binding.deploymentTarget), [
    {
      storageKind: 'PEM_FILES',
      certificatePath: 'D:/runtime/nginx/conf/certs/nginx.crt',
      privateKeyPath: 'D:/runtime/nginx/conf/certs/nginx.key',
      sourceConfigPath: 'D:/runtime/nginx/conf/nginx.conf',
    },
    {
      storageKind: 'PEM_FILES',
      certificatePath: 'E:/runtime/Apache24/conf/certs/apache.crt',
      privateKeyPath: 'E:/runtime/Apache24/conf/certs/apache.key',
      chainPath: 'E:/runtime/Apache24/conf/certs/apache-chain.crt',
      sourceConfigPath: 'E:/runtime/Apache24/conf/httpd.conf',
    },
    {
      storageKind: 'KEYSTORE',
      keystorePath: 'F:/runtime/Tomcat/conf/tomcat.p12',
      keystoreType: 'PKCS12',
      keyAlias: 'server',
      sourceConfigPath: 'F:/runtime/Tomcat/conf/server.xml',
    },
  ]);
});

test('Tomcat 的相对 keystore 配置路径可关联 Agent 读取到的绝对路径证书', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: '/opt/tomcat/conf/server.xml', content: `<Connector port="8445" scheme="https"><SSLHostConfig><Certificate certificateKeystoreFile="localhost-rsa.p12" /></SSLHostConfig></Connector><Host name="localhost" />` }],
      certificateFiles: [{ path: '/opt/tomcat/conf/localhost-rsa.p12', configuredPaths: ['localhost-rsa.p12'], name: 'localhost', sha256Fingerprint: 'b'.repeat(64), subject: 'CN=localhost', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' }],
    },
  }]));

  const projected = fixture.projected() as {
    sites: Array<{ stableKey: string; displayName: string; port?: number; protocol?: string }>;
    certificates: Array<{ sha256Fingerprint?: string }>;
    certificateBindings: Array<{ certificateStableKey: string }>;
  };
  assert.deepEqual(projected.sites, [{
    stableKey: projected.sites[0]?.stableKey,
    frameworkStableKey: 'framework:app.tomcat',
    siteType: 'web.site',
    displayName: 'localhost',
    addresses: ['localhost', '10.0.0.10'],
    port: 8445,
    protocol: 'HTTPS',
    metadata: {
      connectorProtocol: undefined,
      keystoreFile: 'localhost-rsa.p12',
      listeners: [{ port: 8445, protocol: 'HTTPS', keystorePath: 'localhost-rsa.p12', keystoreType: 'PKCS12', sourceConfigPath: '/opt/tomcat/conf/server.xml' }],
    },
  }]);
  assert.equal(projected.certificates[0]?.sha256Fingerprint, 'B'.repeat(64));
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'B'.repeat(64)}`);
});

test('Tomcat Debian 布局可通过 Agent 保留的相对 keystore 别名关联证书', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: '/etc/tomcat9/server.xml', content: '<Connector port="8445" scheme="https" keystoreFile="conf/localhost-rsa.p12" keystorePass="changeit"/><Host name="localhost" />' }],
      certificateFiles: [{ path: '/var/lib/tomcat9/conf/localhost-rsa.p12', configuredPaths: ['conf/localhost-rsa.p12'], name: 'localhost', sha256Fingerprint: 'e'.repeat(64), subject: 'CN=localhost', issuer: 'CN=GCAC Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' }],
    },
  }]));

  const projected = fixture.projected() as { certificateBindings: Array<{ certificateStableKey: string }> };
  assert.equal(projected.certificateBindings.length, 1);
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'E'.repeat(64)}`);
});

test('Tomcat 多 listener 中会选择已上报证书路径，而不是注释示例路径', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.95, value: {
      configFiles: [{ path: '/opt/tomcat/conf/server.xml', content: `<Server><Service>
        <Connector port="8443" scheme="https"><SSLHostConfig><Certificate certificateKeystoreFile="conf/localhost-rsa-cert.pem" /></SSLHostConfig></Connector>
        <Connector port="8445" scheme="https"><SSLHostConfig><Certificate certificateKeystoreFile="/etc/gcac-test/certs/test.p12" /></SSLHostConfig></Connector>
      </Service><Host name="localhost" /></Server>` }],
      certificateFiles: [{ path: '/etc/gcac-test/certs/test.p12', name: 'test.local', sha256Fingerprint: 'c'.repeat(64), subject: 'CN=test.local', issuer: 'CN=Test CA', notBefore: '2026-08-01T00:00:00Z', notAfter: '2027-08-01T00:00:00Z' }],
    },
  }]));
  const projected = fixture.projected() as { certificateBindings: Array<{ certificateStableKey: string; metadata?: { keystorePath?: string; certificatePath?: string } }> };
  assert.equal(projected.certificateBindings.length, 1);
  assert.equal(projected.certificateBindings[0]?.certificateStableKey, `CERT:${'C'.repeat(64)}`);
  assert.equal(projected.certificateBindings[0]?.metadata?.keystorePath, '/etc/gcac-test/certs/test.p12');
});

test('权威 web.inventory 投影成功后只淘汰旧 Agent Web 插件资产', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{
    capabilityKey: 'web.inventory', confidence: 0.9, value: { configFiles: [{ path: '/etc/nginx/conf.d/current.conf', content: 'server { listen 443 ssl; server_name current.example.test; }' }] },
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

test('Web inventory 没有可解析事实时保留旧投影，不执行清理', async () => {
  const fixture = createFixture();
  await fixture.service.project(agent(), snapshot([{ capabilityKey: 'web.inventory', confidence: 0.9, value: { configFiles: [] } }]));

  assert.equal(fixture.projectionContext()?.preserveEmptyWeb, true);
  assert.equal(fixture.queries().filter((query) => /update pg_(framework_instances|site_assets|managed_targets|certificate_bindings)/i.test(query)).length, 0);
});
