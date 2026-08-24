import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createSecurityServices } from '../security/security.controller.js';
import type { WorkflowDslV1 } from '../workflow-templates/dto/workflow-templates.dto.js';

async function createMigratedApp() {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const security = createSecurityServices();
  await security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: 'user_admin',
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId: '*' },
  });
  return createApp({ db, corePersistence: { mode: 'memory' }, security });
}

async function createMigratedAppWithWildcardPolicy(actorId: string, tenantId: string) {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const security = createSecurityServices();
  security.rbac.createPolicy({
    subjectType: 'user',
    subjectId: actorId,
    effect: 'allow',
    actions: ['*'],
    resourceTypes: ['*'],
    scope: { tenantId },
  });
  return createApp({ db, corePersistence: { mode: 'memory' }, security });
}

async function importCertificateVersion(app: Awaited<ReturnType<typeof createMigratedApp>>, headers: Record<string, string>) {
  const certificate = createPemChainFixture();
  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-versions/import',
    headers,
    body: {
      certificatePem: certificate.pem,
      privateKeyPem: certificate.privateKeyPem,
    },
  });
  assert.equal(response.statusCode, 201, JSON.stringify(response.body));
  return (response.body as { version: { id: string; fingerprintSha256: string } }).version;
}

function createPemChainFixture(commonName = 'assets-bindings.example.test'): { pem: string; privateKeyPem: string } {
  const directory = mkdtempSync(join(tmpdir(), 'gcac-assets-cert-'));
  try {
    runOpenSsl(directory, 'genrsa', '-out', 'root.key', '2048');
    runOpenSsl(directory, 'req', '-x509', '-new', '-nodes', '-key', 'root.key', '-sha256', '-days', '3650', '-subj', '/CN=GCAC Assets Root CA/O=GCAC', '-out', 'root.pem');
    runOpenSsl(directory, 'genrsa', '-out', 'intermediate.key', '2048');
    runOpenSsl(directory, 'req', '-new', '-key', 'intermediate.key', '-subj', '/CN=GCAC Assets Intermediate CA/O=GCAC', '-out', 'intermediate.csr');
    writeFileSync(join(directory, 'intermediate.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
    runOpenSsl(directory, 'x509', '-req', '-in', 'intermediate.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'intermediate.pem', '-days', '1000', '-sha256', '-extfile', 'intermediate.ext');
    runOpenSsl(directory, 'genrsa', '-out', 'leaf.key', '2048');
    runOpenSsl(directory, 'req', '-new', '-key', 'leaf.key', '-subj', `/CN=${commonName}/O=GCAC`, '-out', 'leaf.csr');
    writeFileSync(join(directory, 'leaf.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${commonName}\n`);
    runOpenSsl(directory, 'x509', '-req', '-in', 'leaf.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '365', '-sha256', '-extfile', 'leaf.ext');
    return {
      pem: [readFileSync(join(directory, 'leaf.pem'), 'utf8'), readFileSync(join(directory, 'intermediate.pem'), 'utf8'), readFileSync(join(directory, 'root.pem'), 'utf8')].join('\n'),
      privateKeyPem: readFileSync(join(directory, 'leaf.key'), 'utf8'),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runOpenSsl(cwd: string, ...args: string[]): void {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}

async function createApplicationAssetTargetChain(app: Awaited<ReturnType<typeof createMigratedApp>>, headers: Record<string, string>) {
  const agentId = 'agent-strategy-01';
  const domain = 'strategy-app.example.com';
  const registered = await app.inject({
    method: 'POST',
    path: '/api/v1/agents/register',
    headers,
    body: { agentKey: agentId, hostname: 'strategy-host.example.com', version: '1.0.0', osType: 'windows' },
  });
  assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));
  const registeredAgentId = (registered.body as { id: string }).id;
  const hostBody = { id: `host_${registeredAgentId}` };
  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/framework-instances',
    headers,
    body: { deviceId: hostBody.id, frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'iis', rawFacts: { configPath: 'IIS:\\\\Sites'  }, discoveryProviderKey: 'manual:test' },
  });
  assert.equal(service.statusCode, 201, JSON.stringify(service.body));
  const serviceBody = service.body as { id: string };
  const serviceAsset = await app.inject({
    method: 'POST',
    path: '/api/v1/service-assets',
    headers,
    body: {
      serviceInstanceId: serviceBody.id,
      hostId: hostBody.id,
      agentId: registeredAgentId,
      address: domain,
      addressType: 'DNS',
      protocol: 'HTTPS',
      port: 443,
      platform: 'WINDOWS',
      displayName: domain,
    },
  });
  assert.equal(serviceAsset.statusCode, 201, JSON.stringify(serviceAsset.body));
  const serviceAssetBody = serviceAsset.body as { id: string };
  const siteAsset = await app.inject({
    method: 'POST',
    path: '/api/v1/site-assets',
    headers,
    body: {
      frameworkInstanceId: serviceBody.id,
      deviceId: hostBody.id,
      discoveryProviderKey: `agent:${registeredAgentId}`,
      siteType: 'web.site',
      siteName: 'Strategy Site',
      siteKey: `${agentId}:iis:strategy-site:*:443:${domain}`,
      bindingInformation: `*:443:${domain}`,
      hostHeader: domain,
      listenIp: '*',
      port: 443,
      protocol: 'HTTPS',
    },
  });
  assert.equal(siteAsset.statusCode, 201, JSON.stringify(siteAsset.body));
  const siteAssetBody = siteAsset.body as { id: string };
  const managedTarget = await app.inject({
    method: 'POST',
    path: '/api/v1/managed-targets',
    headers,
    body: {
      deviceId: hostBody.id,
      frameworkInstanceId: serviceBody.id,
      siteId: siteAssetBody.id,
      discoveryProviderKey: `agent:${registeredAgentId}`,
      targetType: 'tls.binding',
      targetKey: `${agentId}:iis:strategy-site:*:443:${domain}`,
      bindingKey: `*:443:${domain}`,
      supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
      executionLocations: ['AGENT'],
    },
  });
  assert.equal(managedTarget.statusCode, 201, JSON.stringify(managedTarget.body));
  const managedTargetBody = managedTarget.body as { id: string; bindingKey?: string };
  const targetBinding = await app.inject({
    method: 'PATCH',
    path: '/api/v1/service-assets',
    headers,
    body: {
      id: serviceAssetBody.id,
      targetBinding: {
        managedTargetId: managedTargetBody.id,
        status: 'ACTIVE',
      },
    },
  });
  assert.equal(targetBinding.statusCode, 200, JSON.stringify(targetBinding.body));
  return { agentId: registeredAgentId, domain, serviceAssetId: serviceAssetBody.id, siteAssetId: siteAssetBody.id, managedTargetId: managedTargetBody.id };
}

function workflowTemplateFixture(name: string): WorkflowDslV1 {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name, category: 'certificate_deployment' },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {
        host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
      },
      connections: {
        targetSsh: {
          transport: 'ssh',
          host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          port: { type: 'number', required: true, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: 22 },
          hostKey: { policy: 'strict' },
        },
      },
      credentials: {},
      artifacts: {},
    },
    steps: [
      {
        name: 'verify',
        type: 'ssh',
        ssh: {
          mode: 'command',
          connectionRef: 'targetSsh',
          command: 'echo ok',
        },
      },
    ],
  };
}

describe('资产与证书绑定 API', () => {
  it('应用资产平台仅作为标识，不校验直接关联 Agent 的操作系统', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_asset_platform_marker', 'x-request-id': 'req_asset_platform_marker' };
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: { agentKey: 'windows-marker-agent', hostname: 'windows-marker.example.com', version: '1.0.0', osType: 'windows' },
    });
    assert.equal(registered.statusCode, 201, JSON.stringify(registered.body));

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: {
        address: 'marker.example.com',
        port: 443,
        protocol: 'HTTPS',
        platform: 'LINUX',
        agentId: (registered.body as { id: string }).id,
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    assert.equal((created.body as { platform?: string }).platform, 'LINUX');
  });

  it('可以创建 Host、ServiceInstance、ServiceEndpoint 和 CertificateBinding，并按 Host 查询绑定', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007', 'x-request-id': 'req_spec007_create' };

    const hostResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: {
        hostname: 'WEB-01.EXAMPLE.COM',
        primaryIp: '10.0.0.10',
        osType: 'LINUX',
        environment: 'prod',
        compatibilityLevel: 'L1',
        managementMode: 'AGENT',
        tags: ['nginx', 'prod'],
      },
    });
    assert.equal(hostResponse.statusCode, 201);
    const host = hostResponse.body as { id: string; hostname: string };
    assert.equal(host.hostname, 'web-01.example.com');

    const serviceResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: {
        deviceId: host.id,
        frameworkType: 'web.nginx',
        frameworkKey: 'nginx',
        displayName: '生产 nginx',
        rawFacts: { configPath: '/etc/nginx/nginx.conf' },
        discoverySource: 'MANUAL',

        discoveryProviderKey: 'manual:test',
      },
    });
    assert.equal(serviceResponse.statusCode, 201);
    const service = serviceResponse.body as { id: string; deviceId: string };
    assert.equal(service.deviceId, host.id);

    const endpointResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/service-endpoints',
      headers,
      body: {
        serviceInstanceId: service.id,
        protocol: 'HTTPS',
        hostName: 'WWW.EXAMPLE.COM',
        listenIp: '10.0.0.10',
        port: 443,
      },
    });
    assert.equal(endpointResponse.statusCode, 201);
    const endpoint = endpointResponse.body as { id: string; serviceInstanceId: string; hostId: string; hostName: string };
    assert.equal(endpoint.serviceInstanceId, service.id);
    assert.equal(endpoint.hostId, host.id);
    assert.equal(endpoint.hostName, 'www.example.com');

    const bindingResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        serviceEndpointId: endpoint.id,
        domainName: 'WWW.EXAMPLE.COM',
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/certs/www.pem',
        keyPath: '/etc/nginx/certs/www.key',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    assert.equal(bindingResponse.statusCode, 201);
    const binding = bindingResponse.body as { id: string; hostId: string; serviceInstanceId: string; serviceEndpointId: string; status: string; domainName: string };
    assert.equal(binding.hostId, host.id);
    assert.equal(binding.serviceInstanceId, service.id);
    assert.equal(binding.serviceEndpointId, endpoint.id);
    assert.equal(binding.status, 'DISCOVERED');
    assert.equal(binding.domainName, 'www.example.com');

    const hostBindings = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-bindings?filter[hostId]=${host.id}&page=1&pageSize=10&sort=createdAt:desc`,
      headers,
    });
    assert.equal(hostBindings.statusCode, 200);
    const page = hostBindings.body as { items: Array<{ id: string; hostId: string }>; total: number };
    assert.equal(page.total, 1);
    assert.equal(page.items[0]!.id, binding.id);
    assert.equal(page.items[0]!.hostId, host.id);
  });

  it('CertificateBinding 列表允许按 lastVerifiedAt 排序', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_sort' };
    const host = (await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: { hostname: 'web-sort-01', osType: 'LINUX', compatibilityLevel: 'L1', managementMode: 'AGENT' },
    })).body as { id: string };
    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: { deviceId: host.id, frameworkType: 'web.nginx', displayName: 'nginx', frameworkKey: 'nginx', discoveryProviderKey: 'manual:test' },
    })).body as { id: string };

    const older = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        domainName: 'older.example.com',
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/certs/older.pem',
        verifyMethod: 'TLS_CONNECT',
        lastVerifiedAt: '2026-06-08T00:00:00.000Z',
      },
    });
    assert.equal(older.statusCode, 201);

    const newer = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        domainName: 'newer.example.com',
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/certs/newer.pem',
        verifyMethod: 'TLS_CONNECT',
        lastVerifiedAt: '2026-06-09T00:00:00.000Z',
      },
    });
    assert.equal(newer.statusCode, 201);

    const page = await app.inject({
      method: 'GET',
      path: '/api/v1/certificate-bindings?page=1&pageSize=10&sort=lastVerifiedAt:desc',
      headers,
    });
    assert.equal(page.statusCode, 200);
    const body = page.body as { items: Array<{ domainName: string; lastVerifiedAt: string }>; total: number };
    assert.equal(body.total, 2);
    assert.equal(body.items[0]!.domainName, 'newer.example.com');
    assert.equal(body.items[1]!.domainName, 'older.example.com');
  });

  it('Binding 不允许缺失 serviceInstanceId', async () => {
    const app = await createMigratedApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers: { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007' },
      body: {
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/certs/www.pem',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    assert.equal(response.statusCode, 400);
    assert.equal((response.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');
  });

  it('非法 Binding 状态跳转失败，合法跳转成功', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_status' };
    const host = (await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: { hostname: 'web-status-01', osType: 'LINUX', compatibilityLevel: 'L1', managementMode: 'AGENT' },
    })).body as { id: string };
    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: { deviceId: host.id, frameworkType: 'web.nginx', displayName: 'nginx', frameworkKey: 'nginx', discoveryProviderKey: 'manual:test' },
    })).body as { id: string };
    const certificateVersion = await importCertificateVersion(app, headers);
    const binding = (await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: { serviceInstanceId: service.id, bindingType: 'FILE_PATH', certPath: '/etc/nginx/cert.pem', verifyMethod: 'TLS_CONNECT' },
    })).body as { id: string };

    const illegal = await app.inject({
      method: 'PATCH',
      path: '/api/v1/certificate-bindings/status',
      headers,
      body: { bindingId: binding.id, status: 'EXPIRED' },
    });
    assert.equal(illegal.statusCode, 400);
    assert.equal((illegal.body as { errorCode: string }).errorCode, 'VALIDATION_FAILED');

    const legal = await app.inject({
      method: 'PATCH',
      path: '/api/v1/certificate-bindings/status',
      headers,
      body: { bindingId: binding.id, status: 'MANAGED' },
    });
    assert.equal(legal.statusCode, 200);
    assert.equal((legal.body as { status: string }).status, 'MANAGED');
  });

  it('资产支持基础更新和软删除，历史绑定反查不丢失 host/service 摘要', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_soft_delete' };
    const fingerprint = 'a'.repeat(64);
    const host = (await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: { hostname: 'delete-keep-binding.example.com', osType: 'LINUX', compatibilityLevel: 'L1', managementMode: 'AGENT' },
    })).body as { id: string };
    const updatedHost = await app.inject({
      method: 'PATCH',
      path: '/api/v1/hosts',
      headers,
      body: { id: host.id, displayName: '删除前主机', tags: ['prod', 'prod', 'edge'] },
    });
    assert.equal(updatedHost.statusCode, 200);
    assert.deepEqual((updatedHost.body as { tags: string[] }).tags, ['prod', 'edge']);

    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: { deviceId: host.id, frameworkType: 'web.nginx', displayName: 'nginx old', frameworkKey: 'nginx', discoveryProviderKey: 'manual:test' },
    })).body as { id: string };
    const updatedService = await app.inject({
      method: 'PATCH',
      path: '/api/v1/framework-instances',
      headers,
      body: { id: service.id, displayName: 'nginx new', rawFacts: { pid: 100 } },
    });
    assert.equal(updatedService.statusCode, 200);
    assert.equal((updatedService.body as { displayName: string }).displayName, 'nginx new');

    const endpoint = (await app.inject({
      method: 'POST',
      path: '/api/v1/service-endpoints',
      headers,
      body: { serviceInstanceId: service.id, protocol: 'HTTPS', hostName: 'delete.example.com', port: 443 },
    })).body as { id: string };
    const updatedEndpoint = await app.inject({
      method: 'PATCH',
      path: '/api/v1/service-endpoints',
      headers,
      body: { id: endpoint.id, port: 8443, pathHint: '/ssl' },
    });
    assert.equal(updatedEndpoint.statusCode, 200);
    assert.equal((updatedEndpoint.body as { port: number }).port, 8443);
    const certificateVersion = await importCertificateVersion(app, headers);

    const binding = (await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        serviceEndpointId: endpoint.id,
        bindingType: 'FILE_PATH',
        certificateVersionId: certificateVersion.id,
        desiredFingerprintSha256: fingerprint,
        certPath: '/etc/nginx/delete.pem',
        verifyMethod: 'LOCAL_FILE',
      },
    })).body as { id: string };

    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/service-endpoints/delete', headers, body: { id: endpoint.id } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/framework-instances/delete', headers, body: { id: service.id } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/hosts/delete', headers, body: { id: host.id } })).statusCode, 200);

    const activeHosts = await app.inject({ method: 'GET', path: `/api/v1/hosts?filter[hostname]=delete-keep-binding.example.com`, headers });
    assert.equal((activeHosts.body as { total: number }).total, 0);

    const usage = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-bindings/usage?certificateVersionId=${certificateVersion.id}`,
      headers,
    });
    assert.equal(usage.statusCode, 200);
    const items = usage.body as Array<{ binding: { id: string }; service: { deletedAt?: string; displayName: string }; host: { deletedAt?: string; hostname: string } }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.binding.id, binding.id);
    assert.equal(items[0]!.service.displayName, 'nginx new');
    assert.ok(items[0]!.service.deletedAt);
    assert.equal(items[0]!.host.hostname, 'delete-keep-binding.example.com');
    assert.ok(items[0]!.host.deletedAt);
  });

  it('发现快照按 normalizedHash 幂等写入，不污染业务资产表', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_discovery' };
    const first = await app.inject({
      method: 'POST',
      path: '/api/v1/discovery-snapshots',
      headers,
      body: { normalizedHash: 'HASH-001', source: 'AGENT', normalizedPayload: { hosts: 1 }, rawPayload: { noisy: true } },
    });
    const second = await app.inject({
      method: 'POST',
      path: '/api/v1/discovery-snapshots',
      headers,
      body: { normalizedHash: 'hash-001', source: 'SSH', normalizedPayload: { hosts: 2 } },
    });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal((first.body as { id: string }).id, (second.body as { id: string }).id);

    const snapshots = await app.inject({ method: 'GET', path: '/api/v1/discovery-snapshots?filter[normalizedHash]=hash-001', headers });
    assert.equal((snapshots.body as { total: number }).total, 1);
    const hosts = await app.inject({ method: 'GET', path: '/api/v1/hosts', headers });
    assert.equal((hosts.body as { total: number }).total, 0);
  });

  it('发现合并预览能输出 create/update/conflict，且不会直接写业务资产表', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_merge' };
    const existing = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: { hostname: 'merge.example.com', displayName: '人工名称', osType: 'LINUX' },
    });
    assert.equal(existing.statusCode, 201);

    const preview = await app.inject({
      method: 'POST',
      path: '/api/v1/discovery-snapshots/merge-preview',
      headers,
      body: {
        normalizedHash: 'merge-hash-001',
        source: 'SSH',
        normalizedPayload: {
          hosts: [
            { hostname: 'new-merge.example.com', displayName: '自动发现新主机' },
            { hostname: 'merge.example.com', displayName: '自动覆盖名称' },
          ],
        },
      },
    });
    assert.equal(preview.statusCode, 201);
    const body = preview.body as {
      businessTableMutated: boolean;
      actions: Array<{ action: string; identityKey: string }>;
      conflicts: Array<{ field: string; currentValue: string; discoveredValue: string }>;
    };
    assert.equal(body.businessTableMutated, false);
    assert.equal(body.actions.some((item) => item.action === 'create' && item.identityKey === 'host:new-merge.example.com'), true);
    assert.equal(body.actions.some((item) => item.action === 'conflict' && item.identityKey === 'host:merge.example.com'), true);
    assert.deepEqual(body.conflicts[0], {
      kind: 'host',
      identityKey: 'host:merge.example.com',
      field: 'displayName',
      currentValue: '人工名称',
      discoveredValue: '自动覆盖名称',
      reason: 'displayName 可能是人工维护字段',
    } as any);

    const hosts = await app.inject({ method: 'GET', path: '/api/v1/hosts', headers });
    assert.equal((hosts.body as { total: number }).total, 1);
  });

  it('DriftDetector 输出 synced、mismatch、unreachable、unknown、incomplete', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_drift' };
    const desired = 'b'.repeat(64);
    const other = 'c'.repeat(64);

    const synced = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/drift', headers, body: { remoteFingerprintSha256: desired, desiredFingerprintSha256: desired } });
    assert.equal((synced.body as { state: string }).state, 'synced');
    const mismatch = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/drift', headers, body: { localFingerprintSha256: other, desiredFingerprintSha256: desired } });
    assert.equal((mismatch.body as { state: string }).state, 'mismatch');
    const unreachable = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/drift', headers, body: { reachable: false, desiredFingerprintSha256: desired } });
    assert.equal((unreachable.body as { state: string }).state, 'unreachable');
    const unknown = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/drift', headers, body: { remoteFingerprintSha256: desired } });
    assert.equal((unknown.body as { state: string }).state, 'unknown');
    const incomplete = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/drift', headers, body: { desiredFingerprintSha256: desired } });
    assert.equal((incomplete.body as { state: string }).state, 'incomplete');
  });

  it('证书使用位置可按 fingerprint 反向查询绑定、service、host 摘要', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_usage' };
    const fingerprint = 'd'.repeat(64);
    const host = (await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: { hostname: 'usage.example.com', primaryIp: '10.0.1.20' },
    })).body as { id: string };
    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: { deviceId: host.id, frameworkType: 'web.tomcat', displayName: 'tomcat', frameworkKey: 'tomcat', discoveryProviderKey: 'manual:test' },
    })).body as { id: string };
    const binding = (await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        bindingType: 'FILE_PATH',
        observedFingerprintSha256: fingerprint.toUpperCase(),
        certPath: '/opt/tomcat/cert.pem',
        verifyMethod: 'LOCAL_FILE',
      },
    })).body as { id: string };

    const usage = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings/usage?fingerprint=${fingerprint}`, headers });
    assert.equal(usage.statusCode, 200);
    const items = usage.body as Array<{ binding: { id: string }; service: { id: string }; host: { id: string; primaryIp: string } }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.binding.id, binding.id);
    assert.equal(items[0]!.service.id, service.id);
    assert.equal(items[0]!.host.id, host.id);
    assert.equal(items[0]!.host.primaryIp, '10.0.1.20');
  });

  it('Spec 007 字段、重复候选、RBAC 和审计能闭环', async () => {
    const security = createSecurityServices();
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_full', 'x-request-id': 'req_spec007_full' };

    const hostResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: {
        primaryIp: '10.7.0.10',
        ipAddresses: ['10.7.0.10', '10.7.0.11'],
        ownerId: 'team_ops',
        managementChannels: [{ type: 'agent', refId: 'agent-007' }, { type: 'ssh' }],
        discoverySource: 'AGENT',
        lastDiscoveredAt: '2026-06-09T01:00:00.000Z',
        agentId: 'agent-007',
        assetFingerprint: 'asset-fp-007',
      },
    });
    assert.equal(hostResponse.statusCode, 201);
    const host = hostResponse.body as { id: string; hostname?: string; ownerId: string; managementChannels: Array<{ type: string }>; discoverySource: string; agentId: string; assetFingerprint: string };
    assert.equal(host.hostname, undefined);
    assert.equal(host.ownerId, 'team_ops');
    assert.deepEqual(host.managementChannels.map((item) => item.type), ['AGENT', 'SSH']);
    assert.equal(host.discoverySource, 'AGENT');

    const duplicate = await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'dup.example.com', agentId: 'agent-007' } });
    assert.equal(duplicate.statusCode, 409);
    assert.equal((duplicate.body as { errorCode: string }).errorCode, 'RESOURCE_ALREADY_EXISTS');

    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: {
        deviceId: host.id,
        frameworkType: 'web.nginx',
        displayName: 'nginx spec007',
        versionText: '1.26.0',
        rawFacts: { workerProcesses: 4 },

        frameworkKey: 'nginx',
        discoveryProviderKey: 'manual:test',
      },
    })).body as { id: string; frameworkKey: string; rawFacts: { workerProcesses: number } };
    assert.equal(service.frameworkKey, 'nginx');
    assert.equal(service.rawFacts.workerProcesses, 4);

    const denied = await app.inject({ method: 'GET', path: '/api/v1/hosts', headers: { 'x-actor-id': 'no_policy', 'x-tenant-id': 'tenant_spec007_full' } });
    assert.equal(denied.statusCode, 403);

    const audits = await app.inject({ method: 'GET', path: '/api/v1/audit-events?resourceType=host&eventType=host.created', headers });
    assert.equal(audits.statusCode, 200);
    assert.ok((audits.body as { items: unknown[] }).items.length >= 1);
  });

  it('Binding 支持 Spec 字段、更新、唯一性、软删除和历史反查', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_binding_crud' };
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'binding-crud.example.com' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/framework-instances', headers, body: { deviceId: host.id, frameworkType: 'web.nginx', displayName: 'nginx', frameworkKey: 'nginx', discoveryProviderKey: 'manual:test' } })).body as { id: string };
    const fingerprint = 'e'.repeat(64);
    const targetCertificate = await importCertificateVersion(app, headers);

    const createdResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        domain: 'API.EXAMPLE.COM',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: 'nginx:api:443:https',
        bindingType: 'FILE_PATH',
        targetCertificateVersionId: targetCertificate.id,
        targetFingerprintSha256: fingerprint,
        unmanagedCertificateFingerprint: 'f'.repeat(64),
        certPath: '/etc/nginx/api.pem',
        reloadHint: { command: 'nginx -s reload' },
        discoverySource: 'MANUAL',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.body as { id: string; bindingKey: string; domain: string; domainName: string; port: number; protocol: string; targetCertificateVersionId: string; desiredFingerprintSha256: string; reloadHint: Record<string, unknown> };
    assert.equal(created.domain, 'api.example.com');
    assert.equal(created.domainName, 'api.example.com');
    assert.equal(created.bindingKey, 'nginx:api:443:https');
    assert.equal(created.targetCertificateVersionId, targetCertificate.id);
    assert.equal(created.desiredFingerprintSha256, fingerprint);

    const duplicate = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: { serviceInstanceId: service.id, domain: 'api.example.com', port: 443, protocol: 'HTTPS', bindingKey: 'nginx:api:443:https', bindingType: 'FILE_PATH', certPath: '/etc/nginx/other.pem', verifyMethod: 'TLS_CONNECT' },
    });
    assert.equal(duplicate.statusCode, 409);

    const updated = await app.inject({ method: 'PATCH', path: '/api/v1/certificate-bindings', headers, body: { id: created.id, remoteEndpointFingerprint: fingerprint, driftStatus: 'synced', reloadHint: { signal: 'HUP' } } });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.body as { remoteEndpointFingerprint: string; driftStatus: string; reloadHint: { signal: string } }).driftStatus, 'synced');

    const usage = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings/usage?certificateVersionId=${targetCertificate.id}`, headers });
    assert.equal(usage.statusCode, 200);
    const items = usage.body as Array<{ binding: { id: string; deletedAt?: string }; service: { id: string }; host: { id: string } }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.binding.id, created.id);

    const deleted = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/delete', headers, body: { bindingId: created.id } });
    assert.equal(deleted.statusCode, 200);
    assert.ok((deleted.body as { deletedAt?: string }).deletedAt);

    const activeList = await app.inject({ method: 'GET', path: '/api/v1/certificate-bindings?filter[bindingKey]=nginx:api:443:https', headers });
    assert.equal((activeList.body as { total: number }).total, 0);
  });

});

describe('Spec 007 Discovery Ingest / Conflict / Drift 闭环', () => {
  it('Agent capability snapshot 自动投影统一 Framework、Site 与 ManagedTarget', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec011_direct_asset_fallback', 'x-actor-id': 'user_admin', 'x-request-id': 'req_spec011_direct_asset_fallback' };
    const registered = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/register',
      headers,
      body: {
        agentKey: 'agent-direct-fallback-01',
        hostname: 'fallback-iis.example.com',
        version: '0.1.0',
        osType: 'windows',
        directControl: {
          enabled: true,
          reachable: true,
          listenAddress: '127.0.0.1:9',
          protocolVersion: 'v1',
          supportedActions: ['health', 'discovery.run'],
        },
      },
    });
    assert.equal(registered.statusCode, 201);
    const agent = registered.body as { id: string };

    const capabilities = await app.inject({
      method: 'POST',
      path: '/api/v1/agents/capabilities',
      headers,
      body: {
        agentId: agent.id,
        compatibilityLevel: 'L1',
        capabilities: [
          {
            capabilityKey: 'windows.os.detail',
            value: { ProductName: 'Windows Server 2022', Version: '10.0.20348' },
            confidence: 1,
          },
          {
            capabilityKey: 'windows.network.adapters',
            value: [{ IPv4: ['10.9.0.30'] }],
            confidence: 1,
          },
          {
            capabilityKey: 'windows.iis.detail',
            value: {
              Installed: true,
              Sites: [{
                Name: 'Default Web Site',
                Bindings: [{
                  Protocol: 'https',
                  BindingInformation: '*:443:fallback-iis.example.com',
                  IPAddress: '*',
                  Port: 443,
                  HostHeader: 'fallback-iis.example.com',
                  CertificateStoreName: 'My',
                  CertificateThumbprint: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
                }, {
                  Protocol: 'http',
                  BindingInformation: '*:80:fallback-iis.example.com',
                  IPAddress: '*',
                  Port: 80,
                  HostHeader: 'fallback-iis.example.com',
                }],
              }],
            },
            confidence: 1,
          },
        ],
      },
    });
    assert.equal(capabilities.statusCode, 201);

    const hosts = await app.inject({ method: 'GET', path: '/api/v1/hosts?filter[hostname]=fallback-iis.example.com', headers });
    const host = (hosts.body as { items: Array<{ id: string }> }).items[0];
    assert.ok(host);

    const frameworks = await app.inject({ method: 'GET', path: `/api/v1/framework-instances?filter[deviceId]=${host.id}`, headers });
    const framework = (frameworks.body as { items: Array<{ id: string; frameworkType: string; discoveryProviderKey: string }> }).items[0];
    assert.equal(framework?.frameworkType, 'web.iis');
    assert.equal(framework?.discoveryProviderKey, `agent:${agent.id}`);

    const sites = await app.inject({ method: 'GET', path: `/api/v1/site-assets?filter[deviceId]=${host.id}`, headers });
    const siteBody = sites.body as { total: number; items: Array<{ id: string; siteName: string; bindingInformation?: string; metadata?: { listeners?: unknown[] } }> };
    assert.equal(siteBody.total, 1);
    const site = siteBody.items[0];
    assert.equal(site?.siteName, 'Default Web Site');
    assert.equal(site?.bindingInformation, '*:443:fallback-iis.example.com');
    assert.equal(site?.metadata?.listeners?.length, 2);

    const targets = await app.inject({ method: 'GET', path: `/api/v1/managed-targets?filter[siteId]=${site?.id}`, headers });
    const target = (targets.body as { items: Array<{ targetType: string; executionLocations: string[] }> }).items[0];
    assert.equal(target?.targetType, 'tls.binding');
    assert.deepEqual(target?.executionLocations, ['AGENT']);
  });

  it('drift-results 持久化 local/remote 结果并更新 driftStatus，unreachable 不覆盖 local 字段', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_drift_persist', 'x-actor-id': 'user_admin' };
    const local = '3'.repeat(64);
    const remote = '4'.repeat(64);
    const desired = local;
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'drift-persist.example.com', osType: 'LINUX' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/framework-instances', headers, body: { deviceId: host.id, frameworkType: 'web.nginx', displayName: 'nginx', frameworkKey: 'nginx', discoveryProviderKey: 'manual:test' } })).body as { id: string };
    const binding = (await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings', headers, body: { serviceInstanceId: service.id, bindingType: 'FILE_PATH', certPath: '/etc/nginx/drift.pem', desiredFingerprintSha256: desired, verifyMethod: 'TLS_CONNECT' } })).body as { id: string };

    const mismatch = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/drift-results', headers, body: { bindingId: binding.id, localConfigFingerprint: local, localConfigPath: '/etc/nginx/drift.pem', remoteEndpointFingerprint: remote, remoteStatus: 'reachable', tlsVersion: 'TLSv1.3', chainSummary: { subjects: ['CN=drift'] }, checkedAt: '2026-06-09T00:00:00.000Z' } });
    assert.equal(mismatch.statusCode, 200);
    assert.equal((mismatch.body as any).driftStatus, 'mismatch');
    assert.equal((mismatch.body as any).binding.localConfigFingerprint, local);
    assert.equal((mismatch.body as any).binding.remoteEndpointFingerprint, remote);
    assert.equal((mismatch.body as any).binding.status, 'DRIFTED');

    const unreachable = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/drift-results', headers, body: { bindingId: binding.id, localConfigFingerprint: '5'.repeat(64), localConfigPath: '/tmp/should-not-win.pem', remoteStatus: 'unreachable', checkedAt: '2026-06-09T00:05:00.000Z' } });
    assert.equal(unreachable.statusCode, 200);
    assert.equal((unreachable.body as any).driftStatus, 'unreachable');
    assert.equal((unreachable.body as any).binding.localConfigFingerprint, local);
    assert.equal((unreachable.body as any).binding.localConfigPath, '/etc/nginx/drift.pem');
  });

  it('Spec 007 字段、重复候选、RBAC 和审计能闭环', async () => {
    const security = createSecurityServices();
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_full', 'x-request-id': 'req_spec007_full' };

    const hostResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: {
        primaryIp: '10.7.0.10',
        ipAddresses: ['10.7.0.10', '10.7.0.11'],
        ownerId: 'team_ops',
        managementChannels: [{ type: 'agent', refId: 'agent-007' }, { type: 'ssh' }],
        discoverySource: 'AGENT',
        lastDiscoveredAt: '2026-06-09T01:00:00.000Z',
        agentId: 'agent-007',
        assetFingerprint: 'asset-fp-007',
      },
    });
    assert.equal(hostResponse.statusCode, 201);
    const host = hostResponse.body as { id: string; hostname?: string; ownerId: string; managementChannels: Array<{ type: string }>; discoverySource: string; agentId: string; assetFingerprint: string };
    assert.equal(host.hostname, undefined);
    assert.equal(host.ownerId, 'team_ops');
    assert.deepEqual(host.managementChannels.map((item) => item.type), ['AGENT', 'SSH']);
    assert.equal(host.discoverySource, 'AGENT');

    const duplicate = await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'dup.example.com', agentId: 'agent-007' } });
    assert.equal(duplicate.statusCode, 409);
    assert.equal((duplicate.body as { errorCode: string }).errorCode, 'RESOURCE_ALREADY_EXISTS');

    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: {
        deviceId: host.id,
        frameworkType: 'web.nginx',
        displayName: 'nginx spec007',
        versionText: '1.26.0',
        rawFacts: { workerProcesses: 4 },

        frameworkKey: 'nginx',
        discoveryProviderKey: 'manual:test',
      },
    })).body as { id: string; frameworkKey: string; rawFacts: { workerProcesses: number } };
    assert.equal(service.frameworkKey, 'nginx');
    assert.equal(service.rawFacts.workerProcesses, 4);

    const denied = await app.inject({ method: 'GET', path: '/api/v1/hosts', headers: { 'x-actor-id': 'no_policy', 'x-tenant-id': 'tenant_spec007_full' } });
    assert.equal(denied.statusCode, 403);

    const audits = await app.inject({ method: 'GET', path: '/api/v1/audit-events?resourceType=host&eventType=host.created', headers });
    assert.equal(audits.statusCode, 200);
    assert.ok((audits.body as { items: unknown[] }).items.length >= 1);
  });

  it('Binding 支持 Spec 字段、更新、唯一性、软删除和历史反查', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_binding_crud' };
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'binding-crud.example.com' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/framework-instances', headers, body: { deviceId: host.id, frameworkType: 'web.nginx', displayName: 'nginx', frameworkKey: 'nginx', discoveryProviderKey: 'manual:test' } })).body as { id: string };
    const fingerprint = 'e'.repeat(64);
    const targetCertificate = await importCertificateVersion(app, headers);

    const createdResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        domain: 'API.EXAMPLE.COM',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: 'nginx:api:443:https',
        bindingType: 'FILE_PATH',
        targetCertificateVersionId: targetCertificate.id,
        targetFingerprintSha256: fingerprint,
        unmanagedCertificateFingerprint: 'f'.repeat(64),
        certPath: '/etc/nginx/api.pem',
        reloadHint: { command: 'nginx -s reload' },
        discoverySource: 'MANUAL',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.body as { id: string; bindingKey: string; domain: string; domainName: string; port: number; protocol: string; targetCertificateVersionId: string; desiredFingerprintSha256: string; reloadHint: Record<string, unknown> };
    assert.equal(created.domain, 'api.example.com');
    assert.equal(created.domainName, 'api.example.com');
    assert.equal(created.bindingKey, 'nginx:api:443:https');
    assert.equal(created.targetCertificateVersionId, targetCertificate.id);
    assert.equal(created.desiredFingerprintSha256, fingerprint);

    const duplicate = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: { serviceInstanceId: service.id, domain: 'api.example.com', port: 443, protocol: 'HTTPS', bindingKey: 'nginx:api:443:https', bindingType: 'FILE_PATH', certPath: '/etc/nginx/other.pem', verifyMethod: 'TLS_CONNECT' },
    });
    assert.equal(duplicate.statusCode, 409);

    const updated = await app.inject({ method: 'PATCH', path: '/api/v1/certificate-bindings', headers, body: { id: created.id, remoteEndpointFingerprint: fingerprint, driftStatus: 'synced', reloadHint: { signal: 'HUP' } } });
    assert.equal(updated.statusCode, 200);
    assert.equal((updated.body as { remoteEndpointFingerprint: string; driftStatus: string; reloadHint: { signal: string } }).driftStatus, 'synced');

    const usage = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings/usage?certificateVersionId=${targetCertificate.id}`, headers });
    assert.equal(usage.statusCode, 200);
    const items = usage.body as Array<{ binding: { id: string; deletedAt?: string }; service: { id: string }; host: { id: string } }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.binding.id, created.id);

    const deleted = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/delete', headers, body: { bindingId: created.id } });
    assert.equal(deleted.statusCode, 200);
    assert.ok((deleted.body as { deletedAt?: string }).deletedAt);

    const activeList = await app.inject({ method: 'GET', path: '/api/v1/certificate-bindings?filter[bindingKey]=nginx:api:443:https', headers });
    assert.equal((activeList.body as { total: number }).total, 0);
  });

});
  it('CertificateBinding 自动关联 ServiceAsset，并支持 ServiceAsset CRUD', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_service_asset', 'x-request-id': 'req_service_asset_1' };

    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'asset-auto.example.com', primaryIp: '10.0.9.9', osType: 'LINUX', compatibilityLevel: 'L1', managementMode: 'AGENT' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/framework-instances', headers, body: { deviceId: host.id, frameworkType: 'web.nginx', displayName: 'asset-auto-nginx', frameworkKey: 'nginx', discoveryProviderKey: 'manual:test' } })).body as { id: string };
    const endpoint = (await app.inject({ method: 'POST', path: '/api/v1/service-endpoints', headers, body: { serviceInstanceId: service.id, protocol: 'HTTPS', hostName: 'asset-auto.example.com', listenIp: '10.0.9.9', port: 443 } })).body as { id: string };

    const bindingResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        serviceEndpointId: endpoint.id,
        domainName: 'asset-auto.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/asset-auto.pem',
        keyPath: '/etc/nginx/asset-auto.key',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    assert.equal(bindingResponse.statusCode, 201);
    const binding = bindingResponse.body as { id: string; serviceAssetId?: string };
    assert.ok(binding.serviceAssetId);

    const assetsPage = await app.inject({ method: 'GET', path: '/api/v1/service-assets?filter[address]=asset-auto.example.com', headers });
    assert.equal(assetsPage.statusCode, 200);
    const assets = assetsPage.body as { total: number; items: Array<{ id: string; address: string; port: number; protocol: string; serviceInstanceId?: string; serviceEndpointId?: string }> };
    assert.equal(assets.total, 1);
    assert.equal(assets.items[0]?.id, binding.serviceAssetId);
    assert.equal(assets.items[0]?.address, 'asset-auto.example.com');
    assert.equal(assets.items[0]?.serviceInstanceId, service.id);
    assert.equal(assets.items[0]?.serviceEndpointId, endpoint.id);

    const manualAsset = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: { address: 'manual.asset.example.com', addressType: 'DNS', port: 8443, protocol: 'HTTPS', serviceInstanceId: service.id, serviceEndpointId: endpoint.id, hostId: host.id, status: 'ACTIVE' },
    });
    assert.equal(manualAsset.statusCode, 201);
    const createdAsset = manualAsset.body as { id: string };

    const updatedAsset = await app.inject({ method: 'PATCH', path: '/api/v1/service-assets', headers, body: { id: createdAsset.id, displayName: 'manual-asset', tags: ['manual', 'https'] } });
    assert.equal(updatedAsset.statusCode, 200);
    assert.equal((updatedAsset.body as { displayName?: string }).displayName, 'manual-asset');

    const deletedAsset = await app.inject({ method: 'POST', path: '/api/v1/service-assets/delete', headers, body: { id: createdAsset.id } });
    assert.equal(deletedAsset.statusCode, 200);
    assert.ok((deletedAsset.body as { deletedAt?: string }).deletedAt);
  });

  it('ServiceAsset 必须显式绑定 ManagedTarget，并从其读取站点上下文', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec012_application_asset_target', 'x-actor-id': 'user_admin' };

    const host = (await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: { hostname: 'app-target.example.com', primaryIp: '10.8.2.20', osType: 'WINDOWS', agentId: 'agent-iis-02' },
    })).body as { id: string };

    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: { deviceId: host.id, frameworkType: 'web.iis', frameworkKey: 'iis', displayName: 'iis', rawFacts: { configPath: 'IIS:\\\\Sites'  }, discoveryProviderKey: 'manual:test' },
    })).body as { id: string };

    const serviceAsset = (await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: {
        address: 'app-target.example.com',
        addressType: 'DNS',
        port: 443,
        protocol: 'HTTPS',
        platform: 'WINDOWS',
        hostId: host.id,
        agentId: 'agent-iis-02',
        serviceInstanceId: service.id,
        displayName: 'App Target',
      },
    })).body as { id: string };

    const siteAssetResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers,
      body: {
        frameworkInstanceId: service.id,
        deviceId: host.id,
        discoveryProviderKey: 'agent:agent-iis-02',
        siteType: 'web.site',
        siteName: 'Default Web Site',
        siteKey: 'agent-iis-02:iis:default web site:*:443:app-target.example.com',
        bindingInformation: '*:443:app-target.example.com',
        hostHeader: 'app-target.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        configPath: 'IIS:\\\\Sites',
      },
    });
    assert.equal(siteAssetResponse.statusCode, 201, JSON.stringify(siteAssetResponse.body));
    const siteAsset = siteAssetResponse.body as { id: string };

    const managedTargetResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers,
      body: {
        deviceId: host.id,
        frameworkInstanceId: service.id,
        siteId: siteAsset.id,
        discoveryProviderKey: 'agent:agent-iis-02',
        targetType: 'tls.binding',
        targetKey: 'agent-iis-02:iis:default web site:*:443:app-target.example.com',
        bindingKey: 'iis:*:443:app-target.example.com',
        supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
        executionLocations: ['AGENT'],
        metadata: { canDeployPfx: true },
      },
    });
    assert.equal(managedTargetResponse.statusCode, 201, JSON.stringify(managedTargetResponse.body));
    const managedTarget = managedTargetResponse.body as { id: string; bindingKey?: string };

    const bindingResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        serviceAssetId: serviceAsset.id,
        siteAssetId: siteAsset.id,
        managedTargetId: managedTarget.id,
        domainName: 'app-target.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: managedTarget.bindingKey,
        bindingType: 'WINDOWS_CERT_STORE',
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: '1234567890ABCDEF1234567890ABCDEF12345678',
        verifyMethod: 'TLS_CONNECT',
      },
    });
    assert.equal(bindingResponse.statusCode, 201);

    const implicitTarget = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: {
        address: 'manual-app-target.example.com',
        addressType: 'DNS',
        port: 443,
        protocol: 'HTTPS',
        platform: 'WINDOWS',
        displayName: 'Manual App Target',
        siteAssetId: siteAsset.id,
      },
    });
    assert.equal(implicitTarget.statusCode, 400, JSON.stringify(implicitTarget.body));

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: {
        address: 'manual-app-target.example.com',
        addressType: 'DNS',
        port: 443,
        protocol: 'HTTPS',
        platform: 'WINDOWS',
        displayName: 'Manual App Target',
        targetBinding: { managedTargetId: managedTarget.id, status: 'ACTIVE' },
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const createdAsset = created.body as { id: string; targetBinding?: { managedTargetId: string } };
    assert.equal(createdAsset.targetBinding?.managedTargetId, managedTarget.id);

    const listed = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets?filter[id]=${createdAsset.id}`,
      headers,
    });
    assert.equal(listed.statusCode, 200);
    const listedBody = listed.body as {
      total: number;
      items: Array<{
        id: string;
        targetBinding?: {
          managedTargetId: string;
          deviceDisplayName?: string;
          frameworkType?: string;
          frameworkDisplayName?: string;
          siteName?: string;
        };
      }>;
    };
    assert.equal(listedBody.total, 1);
    assert.equal(listedBody.items[0]!.targetBinding?.managedTargetId, managedTarget.id);
    assert.equal(listedBody.items[0]!.targetBinding?.deviceDisplayName, 'app-target.example.com');
    assert.equal(listedBody.items[0]!.targetBinding?.frameworkType, 'web.iis');
    assert.equal(listedBody.items[0]!.targetBinding?.frameworkDisplayName, 'iis');
    assert.equal(listedBody.items[0]!.targetBinding?.siteName, 'Default Web Site');

    const updated = await app.inject({
      method: 'PATCH',
      path: '/api/v1/service-assets',
      headers,
      body: {
        id: createdAsset.id,
        verifyUrl: 'https://manual-app-target.example.com/health',
        deploymentStrategy: {
          type: 'MANAGED_TARGET',
          managedTarget: {
            managedTargetId: managedTarget.id,
            certificateFormatId: 'format-api-test',
          },
        },
        targetBinding: {
          managedTargetId: managedTarget.id,
          status: 'ACTIVE',
          metadata: { source: 'updated' },
        },
      },
    });
    assert.equal(updated.statusCode, 200);
    const updatedBody = updated.body as {
      verifyUrl?: string;
      deploymentStrategy?: { managedTarget?: { certificateFormatId?: string } };
      targetBinding?: { managedTargetId: string; metadata?: { source?: string } };
    };
    assert.equal(updatedBody.verifyUrl, 'https://manual-app-target.example.com/health');
    assert.equal(updatedBody.deploymentStrategy?.managedTarget?.certificateFormatId, 'format-api-test');
    assert.equal(updatedBody.targetBinding?.managedTargetId, managedTarget.id);
    assert.equal(updatedBody.targetBinding?.metadata?.source, 'updated');

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets/detail?serviceAssetId=${createdAsset.id}`,
      headers,
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as {
      id: string;
      verifyUrl?: string;
      deploymentStrategy?: { managedTarget?: { certificateFormatId?: string } };
      targetBinding?: { managedTargetId: string };
      targetBindingDetail?: {
        host?: { id: string };
        frameworkInstance?: { id: string };
        siteAsset?: { id: string; siteName: string; deviceId: string; frameworkInstanceId: string };
        managedTarget?: { id: string; targetType: string };
        certificateBindings: Array<{ managedTargetId?: string; siteAssetId?: string; bindingKey?: string }>;
      };
    };
    assert.equal(detailBody.id, createdAsset.id);
    assert.equal(detailBody.verifyUrl, 'https://manual-app-target.example.com/health');
    assert.equal(detailBody.deploymentStrategy?.managedTarget?.certificateFormatId, 'format-api-test');
    assert.equal(detailBody.targetBinding?.managedTargetId, managedTarget.id);
    assert.equal(detailBody.targetBindingDetail?.host?.id, host.id);
    assert.equal(detailBody.targetBindingDetail?.frameworkInstance?.id, service.id);
    assert.equal(detailBody.targetBindingDetail?.siteAsset?.id, siteAsset.id);
    assert.equal(detailBody.targetBindingDetail?.siteAsset?.siteName, 'Default Web Site');
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.id, managedTarget.id);
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.targetType, 'tls.binding');
    assert.ok(detailBody.targetBindingDetail?.certificateBindings.length);
    assert.equal(detailBody.targetBindingDetail?.certificateBindings[0]?.managedTargetId, managedTarget.id);
    assert.equal(detailBody.targetBindingDetail?.certificateBindings[0]?.siteAssetId, siteAsset.id);
  });

  it('ServiceAsset 使用显式 ManagedTarget 策略，并拒绝未发布工作流和明文 Secret', async () => {
    const headers = { 'x-tenant-id': 'tenant_spec0151_strategy', 'x-actor-id': 'user_admin' };
    const app = await createMigratedAppWithWildcardPolicy('user_admin', headers['x-tenant-id']);
    const chain = await createApplicationAssetTargetChain(app, headers);

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets/detail?id=${chain.serviceAssetId}`,
      headers,
    });
    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
    const detailBody = detail.body as { deploymentStrategy?: { type: string; managedTarget?: { managedTargetId: string } } };
    assert.equal(detailBody.deploymentStrategy?.type, 'MANAGED_TARGET');
    assert.equal(detailBody.deploymentStrategy?.managedTarget?.managedTargetId, chain.managedTargetId);

    const draft = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-templates',
      headers,
      body: { content: workflowTemplateFixture('未发布策略工作流') },
    });
    assert.equal(draft.statusCode, 201, JSON.stringify(draft.body));
    const draftBody = draft.body as { template: { id: string }; version: { id: string } };

    const rejectedDraft = await app.inject({
      method: 'PATCH',
      path: `/api/v1/service-assets/${chain.serviceAssetId}/deployment-strategy`,
      headers,
      body: {
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: draftBody.template.id,
            workflowVersionId: draftBody.version.id,
            runner: 'CONTROL_PLANE',
          },
        },
      },
    });
    assert.equal(rejectedDraft.statusCode, 400);
    assert.equal((rejectedDraft.body as { details?: { code?: string } }).details?.code, 'WORKFLOW_VERSION_NOT_PUBLISHED');

    const published = await app.inject({
      method: 'POST',
      path: '/api/v1/workflow-template-versions/publish',
      headers,
      body: { versionId: draftBody.version.id },
    });
    assert.equal(published.statusCode, 200, JSON.stringify(published.body));

    const rejectedSecret = await app.inject({
      method: 'PATCH',
      path: `/api/v1/service-assets/${chain.serviceAssetId}/deployment-strategy`,
      headers,
      body: {
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: draftBody.template.id,
            workflowVersionId: draftBody.version.id,
            runner: 'CONTROL_PLANE',
            credentialBindings: { ssh: { credentialId: '' } },
          },
        },
      },
    });
    assert.equal(rejectedSecret.statusCode, 400);
    assert.equal((rejectedSecret.body as { details?: { code?: string } }).details?.code, 'DEPLOYMENT_STRATEGY_INVALID');

    const updated = await app.inject({
      method: 'PATCH',
      path: `/api/v1/service-assets/${chain.serviceAssetId}/deployment-strategy`,
      headers,
      body: {
        deploymentStrategy: {
          type: 'WORKFLOW',
          workflow: {
            workflowId: draftBody.template.id,
            workflowVersionId: draftBody.version.id,
            runner: 'CONTROL_PLANE',
            credentialBindings: { ssh: { credentialId: 'cred_app_target' } },
            variableBindings: { host: chain.domain },
          },
        },
      },
    });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
    const updatedBody = updated.body as { deploymentStrategy?: { type: string; workflow?: { workflowVersionId: string; credentialBindings?: Record<string, { credentialId: string }> } }; metadata?: { deploymentStrategy?: { type: string } } };
    assert.equal(updatedBody.deploymentStrategy?.type, 'WORKFLOW');
    assert.equal(updatedBody.deploymentStrategy?.workflow?.workflowVersionId, draftBody.version.id);
    assert.equal(updatedBody.deploymentStrategy?.workflow?.credentialBindings?.ssh?.credentialId, 'cred_app_target');
    assert.equal(updatedBody.metadata?.deploymentStrategy?.type, 'WORKFLOW');
  });

  it('NGINX ApplicationAssetTarget 通过 ManagedTarget 获取显式证书部署上下文', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec012_nginx_application_asset_target', 'x-actor-id': 'user_admin' };

    const host = (await app.inject({
      method: 'POST',
      path: '/api/v1/hosts',
      headers,
      body: { hostname: 'nginx-app-target.example.com', primaryIp: '10.8.9.20', osType: 'LINUX', agentId: 'agent-nginx-02' },
    })).body as { id: string };

    const service = (await app.inject({
      method: 'POST',
      path: '/api/v1/framework-instances',
      headers,
      body: { deviceId: host.id, frameworkType: 'web.nginx', frameworkKey: 'nginx', displayName: 'nginx', rawFacts: { configPath: '/etc/nginx/nginx.conf'  }, discoveryProviderKey: 'manual:test' },
    })).body as { id: string };

    const siteAssetResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers,
      body: {
        frameworkInstanceId: service.id,
        deviceId: host.id,
        discoveryProviderKey: 'agent:agent-nginx-02',
        siteType: 'web.site',
        siteName: 'nginx-app-target.example.com',
        siteKey: 'agent-nginx-02:nginx:nginx-app-target.example.com:*:443:nginx-app-target.example.com',
        bindingInformation: '*:443:nginx-app-target.example.com',
        hostHeader: 'nginx-app-target.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        configPath: '/etc/nginx/sites-enabled/nginx-app-target.conf',
        metadata: {
          sourceFile: '/etc/nginx/sites-enabled/nginx-app-target.conf',
          serverNames: ['nginx-app-target.example.com'],
          testCommand: 'nginx -t',
          reloadCommand: 'systemctl reload nginx',
        },
      },
    });
    assert.equal(siteAssetResponse.statusCode, 201, JSON.stringify(siteAssetResponse.body));
    const siteAsset = siteAssetResponse.body as { id: string };

    const managedTargetResponse = await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers,
      body: {
        deviceId: host.id,
        frameworkInstanceId: service.id,
        siteId: siteAsset.id,
        discoveryProviderKey: 'agent:agent-nginx-02',
        targetType: 'tls.binding',
        targetKey: 'agent-nginx-02:nginx:nginx-app-target.example.com:*:443:nginx-app-target.example.com',
        bindingKey: 'nginx:*:443:nginx-app-target.example.com',
        supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'],
        executionLocations: ['AGENT'],
        metadata: {
          certPath: '/etc/nginx/certs/nginx-app-target.pem',
          keyPath: '/etc/nginx/certs/nginx-app-target.key',
          reloadCommand: 'systemctl reload nginx',
        },
      },
    });
    assert.equal(managedTargetResponse.statusCode, 201, JSON.stringify(managedTargetResponse.body));
    const managedTarget = managedTargetResponse.body as { id: string; bindingKey?: string };

    const siblingBinding = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        siteAssetId: siteAsset.id,
        managedTargetId: managedTarget.id,
        domainName: 'nginx-app-target.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingKey: managedTarget.bindingKey,
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/certs/nginx-app-target.pem',
        keyPath: '/etc/nginx/certs/nginx-app-target.key',
        reloadCommand: 'systemctl reload nginx',
        verifyMethod: 'TLS_CONNECT',
        metadata: {
          sourceFile: '/etc/nginx/sites-enabled/nginx-app-target.conf',
          serverNames: ['nginx-app-target.example.com'],
          testCommand: 'nginx -t',
        },
      },
    });
    assert.equal(siblingBinding.statusCode, 201, JSON.stringify(siblingBinding.body));

    const created = await app.inject({
      method: 'POST',
      path: '/api/v1/service-assets',
      headers,
      body: {
        address: 'manual-nginx-app-target.example.com',
        addressType: 'DNS',
        port: 443,
        protocol: 'HTTPS',
        platform: 'LINUX',
        hostId: host.id,
        serviceInstanceId: service.id,
        displayName: 'Manual NGINX App Target',
        targetBinding: {
          managedTargetId: managedTarget.id,
          status: 'ACTIVE',
          metadata: { source: 'manual' },
        },
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const createdAsset = created.body as { id: string };

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets/detail?serviceAssetId=${createdAsset.id}`,
      headers,
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as {
      targetBindingDetail?: {
        certificateBindings: Array<{
          managedTargetId?: string;
          bindingType?: string;
          verifyMethod?: string;
        }>;
        managedTarget?: { metadata?: { certPath?: string; keyPath?: string; reloadCommand?: string } };
      };
    };
    const assetBinding = (detailBody.targetBindingDetail?.certificateBindings ?? []).find((item) => item.managedTargetId === managedTarget.id);
    assert.ok(assetBinding);
    assert.equal(assetBinding?.bindingType, 'FILE_PATH');
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.metadata?.certPath, '/etc/nginx/certs/nginx-app-target.pem');
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.metadata?.keyPath, '/etc/nginx/certs/nginx-app-target.key');
  });
