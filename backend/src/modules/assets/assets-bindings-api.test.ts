import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import { createSecurityServices } from '../security/security.controller.js';
import type { WorkflowDslV1 } from '../workflow-templates/dto/workflow-templates.dto.js';

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

async function startMockAgentServer(handler: (body: any) => any) {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/api/v1/control/discovery/run') {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw.trim() ? JSON.parse(raw) : {};
      const payload = handler(body);
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock agent listen failed');
  return {
    listenAddress: `127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}


async function importCertificateVersion(app: Awaited<ReturnType<typeof createMigratedApp>>, headers: Record<string, string>) {
  const response = await app.inject({
    method: 'POST',
    path: '/api/v1/certificate-versions/import',
    headers,
    body: {
      certificatePem: CERT_PEM,
      privateKeyPem: PRIVATE_KEY_PEM,
    },
  });
  assert.equal(response.statusCode, 201, JSON.stringify(response.body));
  return (response.body as { version: { id: string } }).version.id;
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
  const host = await app.inject({
    method: 'POST',
    path: '/api/v1/hosts',
    headers,
    body: { hostname: 'strategy-host.example.com', osType: 'WINDOWS', agentId: registeredAgentId, compatibilityLevel: 'L1', managementMode: 'AGENT' },
  });
  assert.equal(host.statusCode, 201, JSON.stringify(host.body));
  const hostBody = host.body as { id: string };
  const service = await app.inject({
    method: 'POST',
    path: '/api/v1/service-instances',
    headers,
    body: { hostId: hostBody.id, providerType: 'IIS', serviceName: 'iis', displayName: 'iis', configPath: 'IIS:\\\\Sites' },
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
      serviceInstanceId: serviceBody.id,
      serviceAssetId: serviceAssetBody.id,
      hostId: hostBody.id,
      agentId: registeredAgentId,
      providerType: 'IIS',
      siteType: 'WEB_SITE',
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
      agentId: registeredAgentId,
      hostId: hostBody.id,
      serviceInstanceId: serviceBody.id,
      serviceAssetId: serviceAssetBody.id,
      siteAssetId: siteAssetBody.id,
      providerType: 'IIS',
      frameworkType: 'IIS',
      targetType: 'SITE_BINDING',
      targetKey: `${agentId}:iis:strategy-site:*:443:${domain}`,
      bindingKey: `*:443:${domain}`,
      capabilityProfile: { canDeployPfx: true },
      deploymentMode: 'AGENT_PUSH',
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
        agentId: registeredAgentId,
        siteAssetId: siteAssetBody.id,
        managedTargetId: managedTargetBody.id,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: managedTargetBody.id,
        bindingKey: managedTargetBody.bindingKey,
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
    variables: {
      host: { type: 'string', required: true },
      sshCredential: { type: 'credential', required: false },
    },
    steps: [
      {
        name: 'verify',
        type: 'ssh',
        ssh: {
          mode: 'command',
          connection: {
            host: '{{host}}',
            username: 'deploy',
            credential: { credentialId: 'cred_default', kind: 'SSH_KEY', secretRefs: { privateKey: 'secret://ssh_key/sec_default#current' } },
          },
          command: 'echo ok',
        },
      },
    ],
  };
}

describe('资产与证书绑定 API', () => {
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
      path: '/api/v1/service-instances',
      headers,
      body: {
        hostId: host.id,
        providerType: 'NGINX',
        serviceName: 'nginx',
        displayName: '生产 nginx',
        configPath: '/etc/nginx/nginx.conf',
        discoverySource: 'MANUAL',
      },
    });
    assert.equal(serviceResponse.statusCode, 201);
    const service = serviceResponse.body as { id: string; hostId: string };
    assert.equal(service.hostId, host.id);

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
      path: '/api/v1/service-instances',
      headers,
      body: { hostId: host.id, providerType: 'NGINX', displayName: 'nginx' },
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
      path: '/api/v1/service-instances',
      headers,
      body: { hostId: host.id, providerType: 'NGINX', displayName: 'nginx' },
    })).body as { id: string };
    const certificateVersionId = await importCertificateVersion(app, headers);
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
      path: '/api/v1/service-instances',
      headers,
      body: { hostId: host.id, providerType: 'NGINX', displayName: 'nginx old' },
    })).body as { id: string };
    const updatedService = await app.inject({
      method: 'PATCH',
      path: '/api/v1/service-instances',
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
    const certificateVersionId = await importCertificateVersion(app, headers);

    const binding = (await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        serviceEndpointId: endpoint.id,
        bindingType: 'FILE_PATH',
        certificateVersionId,
        desiredFingerprintSha256: fingerprint,
        certPath: '/etc/nginx/delete.pem',
        verifyMethod: 'LOCAL_FILE',
      },
    })).body as { id: string };

    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/service-endpoints/delete', headers, body: { id: endpoint.id } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/service-instances/delete', headers, body: { id: service.id } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', path: '/api/v1/hosts/delete', headers, body: { id: host.id } })).statusCode, 200);

    const activeHosts = await app.inject({ method: 'GET', path: `/api/v1/hosts?filter[hostname]=delete-keep-binding.example.com`, headers });
    assert.equal((activeHosts.body as { total: number }).total, 0);

    const usage = await app.inject({
      method: 'GET',
      path: `/api/v1/certificate-bindings/usage?certificateVersionId=${certificateVersionId}`,
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
      path: '/api/v1/service-instances',
      headers,
      body: { hostId: host.id, providerType: 'TOMCAT', displayName: 'tomcat' },
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
      path: '/api/v1/service-instances',
      headers,
      body: {
        hostId: host.id,
        providerType: 'NGINX',
        displayName: 'nginx spec007',
        versionText: '1.26.0',
        providerKey: 'nginx:/etc/nginx/nginx.conf',
        ports: [443, { port: 8443, protocol: 'HTTPS' }],
        manualOverrides: { configPath: '/manual/nginx.conf' },
        rawFacts: { workerProcesses: 4 },
      },
    })).body as { id: string; providerKey: string; ports: unknown[]; manualOverrides: Record<string, unknown> };
    assert.equal(service.providerKey, 'nginx:/etc/nginx/nginx.conf');
    assert.equal(service.ports.length, 2);
    assert.equal(service.manualOverrides.configPath, '/manual/nginx.conf');

    const denied = await app.inject({ method: 'GET', path: '/api/v1/hosts', headers: { 'x-actor-id': 'no_policy', 'x-tenant-id': 'tenant_spec007_full' } });
    assert.equal(denied.statusCode, 403);

    const audits = await app.inject({ method: 'GET', path: '/api/v1/audit-events?resourceType=host&eventType=host.created', headers });
    assert.equal(audits.statusCode, 200);
    assert.equal((audits.body as { items: unknown[] }).items.length, 1);
  });

  it('Binding 支持 Spec 字段、更新、唯一性、软删除和历史反查', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_binding_crud' };
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'binding-crud.example.com' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/service-instances', headers, body: { hostId: host.id, providerType: 'NGINX', displayName: 'nginx' } })).body as { id: string };
    const fingerprint = 'e'.repeat(64);
    const targetCertificateVersionId = await importCertificateVersion(app, headers);

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
        targetCertificateVersionId,
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
    assert.equal(created.targetCertificateVersionId, targetCertificateVersionId);
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

    const deleted = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/delete', headers, body: { bindingId: created.id } });
    assert.equal(deleted.statusCode, 200);
    assert.ok((deleted.body as { deletedAt?: string }).deletedAt);

    const activeList = await app.inject({ method: 'GET', path: '/api/v1/certificate-bindings?filter[bindingKey]=nginx:api:443:https', headers });
    assert.equal((activeList.body as { total: number }).total, 0);

    const usage = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings/usage?fingerprint=${fingerprint}`, headers });
    assert.equal(usage.statusCode, 200);
    const items = usage.body as Array<{ binding: { id: string; deletedAt?: string }; service: { id: string }; host: { id: string } }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.binding.id, created.id);
    assert.ok(items[0]!.binding.deletedAt);
  });

});

describe('Spec 007 Discovery Ingest / Conflict / Drift 闭环', () => {
  it('资产刷新优先使用 Agent 直连发现结果入库', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec011_direct_asset_refresh', 'x-actor-id': 'user_admin', 'x-request-id': 'req_spec011_direct_asset_refresh' };
    const mockAgent = await startMockAgentServer(() => ({
      collectedAt: '2026-06-30T13:00:00.000Z',
      source: 'agent_direct',
      platform: 'linux',
      hosts: [{ hostname: 'direct-nginx.example.com', primaryIp: '10.9.0.20', osType: 'LINUX', agentId: 'agent-direct-01' }],
      services: [{ hostname: 'direct-nginx.example.com', providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx', configPath: '/etc/nginx/nginx.conf' }],
      serviceAssets: [{ hostname: 'direct-nginx.example.com', providerType: 'NGINX', serviceName: 'nginx', address: 'direct-nginx.example.com', port: 443, protocol: 'HTTPS', sniName: 'direct-nginx.example.com', displayName: 'direct-nginx.example.com' }],
      bindings: [{ hostname: 'direct-nginx.example.com', providerType: 'NGINX', serviceName: 'nginx', domainName: 'direct-nginx.example.com', port: 443, protocol: 'HTTPS', bindingType: 'FILE_PATH', certPath: '/etc/nginx/direct.pem', observedFingerprintSha256: '3'.repeat(64), verifyMethod: 'TLS_CONNECT' }],
    }));
    try {
      const registered = await app.inject({
        method: 'POST',
        path: '/api/v1/agents/register',
        headers,
        body: {
          agentKey: 'agent-direct-01',
          hostname: 'direct-nginx.example.com',
          version: '0.1.0',
          osType: 'linux',
          directControl: {
            enabled: true,
            reachable: true,
            listenAddress: mockAgent.listenAddress,
            protocolVersion: 'v1',
            supportedActions: ['health', 'discovery.run'],
          },
        },
      });
      assert.equal(registered.statusCode, 201);
      const agent = registered.body as { id: string };

      const refreshed = await app.inject({
        method: 'POST',
        path: '/api/v1/assets/refresh-from-agent',
        headers,
        body: { agentId: agent.id, includeBindings: true },
      });
      assert.equal(refreshed.statusCode, 201);
      assert.equal((refreshed.body as { mode: string }).mode, 'direct');

      const hosts = await app.inject({ method: 'GET', path: '/api/v1/hosts?filter[hostname]=direct-nginx.example.com', headers });
      assert.equal((hosts.body as { total: number }).total, 1);
      const bindings = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings?filter[observedFingerprintSha256]=${'3'.repeat(64)}`, headers });
      assert.equal((bindings.body as { total: number }).total, 1);
    } finally {
      await mockAgent.close();
    }
  });

  it('资产刷新在直连失败时回退 capability snapshot 入库', async () => {
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
                }],
              }],
            },
            confidence: 1,
          },
        ],
      },
    });
    assert.equal(capabilities.statusCode, 201);

    const refreshed = await app.inject({
      method: 'POST',
      path: '/api/v1/assets/refresh-from-agent',
      headers,
      body: { agentId: agent.id, includeBindings: true },
    });
    assert.equal(refreshed.statusCode, 201);
    const refreshedBody = refreshed.body as { mode: string; fallbackReason?: string };
    assert.equal(refreshedBody.mode, 'fallback_capability_snapshot');
    assert.ok(refreshedBody.fallbackReason);

    const siteAssets = await app.inject({ method: 'GET', path: '/api/v1/site-assets?filter[siteName]=default%20web%20site', headers });
    assert.equal((siteAssets.body as { total: number }).total, 1);
    const bindings = await app.inject({ method: 'GET', path: '/api/v1/certificate-bindings?filter[domainName]=fallback-iis.example.com', headers });
    assert.equal((bindings.body as { total: number }).total, 1);
  });

  it('DiscoveryIngest apply 创建 Host/Service/Binding，重复 normalizedHash 幂等不重复创建', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_ingest_create', 'x-actor-id': 'user_admin' };
    const fingerprint = 'e'.repeat(64);
    const payload = {
      hosts: [{ hostname: 'DISCOVER-A.EXAMPLE.COM', primaryIp: '10.7.0.1', osType: 'LINUX' }],
      services: [{ hostname: 'discover-a.example.com', providerType: 'NGINX', serviceName: 'nginx', displayName: '发现 nginx', configPath: '/etc/nginx/nginx.conf' }],
      bindings: [{ hostname: 'discover-a.example.com', providerType: 'NGINX', serviceName: 'nginx', domainName: 'DISCOVER-A.EXAMPLE.COM', port: 443, protocol: 'HTTPS', bindingType: 'FILE_PATH', certPath: '/etc/nginx/a.pem', observedFingerprintSha256: fingerprint, verifyMethod: 'TLS_CONNECT' }],
    };

    const first = await app.inject({ method: 'POST', path: '/api/v1/discovery-snapshots/ingest', headers, body: { normalizedHash: 'ingest-create-001', source: 'AGENT', apply: true, normalizedPayload: payload } });
    const second = await app.inject({ method: 'POST', path: '/api/v1/discovery-snapshots/ingest', headers, body: { normalizedHash: 'INGEST-CREATE-001', source: 'AGENT', apply: true, normalizedPayload: payload } });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal((first.body as any).snapshot.id, (second.body as any).snapshot.id);

    const hosts = await app.inject({ method: 'GET', path: '/api/v1/hosts?filter[hostname]=discover-a.example.com', headers });
    assert.equal((hosts.body as { total: number }).total, 1);
    const services = await app.inject({ method: 'GET', path: '/api/v1/service-instances?filter[serviceName]=nginx', headers });
    assert.equal((services.body as { total: number }).total, 1);
    const bindings = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings?filter[observedFingerprintSha256]=${fingerprint}`, headers });
    assert.equal((bindings.body as { total: number }).total, 1);
  });

  it('DiscoveryIngest apply 打通 serviceAssets 到 binding.serviceAssetId 主链路', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_ingest_service_asset', 'x-actor-id': 'user_admin' };
    const fingerprint = '9'.repeat(64);
    const payload = {
      hosts: [{ hostname: 'asset-ingest.example.com', primaryIp: '10.8.0.10', osType: 'LINUX' }],
      services: [{ hostname: 'asset-ingest.example.com', providerType: 'NGINX', serviceName: 'nginx', displayName: 'asset-ingest-nginx', configPath: '/etc/nginx/nginx.conf' }],
      serviceAssets: [{
        hostname: 'asset-ingest.example.com',
        providerType: 'NGINX',
        serviceName: 'nginx',
        address: 'asset-ingest.example.com',
        port: 443,
        protocol: 'HTTPS',
        sniName: 'asset-ingest.example.com',
        displayName: 'asset-ingest.example.com',
      }],
      bindings: [{
        hostname: 'asset-ingest.example.com',
        providerType: 'NGINX',
        serviceName: 'nginx',
        serviceAssetRef: 'asset-ingest.example.com:443:https',
        domainName: 'asset-ingest.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingType: 'FILE_PATH',
        certPath: '/etc/nginx/asset-ingest.pem',
        observedFingerprintSha256: fingerprint,
        verifyMethod: 'TLS_CONNECT',
      }],
    };

    const ingest = await app.inject({
      method: 'POST',
      path: '/api/v1/discovery-snapshots/ingest',
      headers,
      body: { normalizedHash: 'ingest-service-asset-001', source: 'AGENT', apply: true, normalizedPayload: payload },
    });
    assert.equal(ingest.statusCode, 201);

    const assetsPage = await app.inject({ method: 'GET', path: '/api/v1/service-assets?filter[address]=asset-ingest.example.com', headers });
    assert.equal(assetsPage.statusCode, 200);
    const assets = assetsPage.body as { total: number; items: Array<{ id: string; address: string; port: number; protocol: string }> };
    assert.equal(assets.total, 1);
    assert.equal(assets.items[0]!.address, 'asset-ingest.example.com');
    assert.equal(assets.items[0]!.port, 443);
    assert.equal(assets.items[0]!.protocol, 'HTTPS');

    const bindingsPage = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings?filter[observedFingerprintSha256]=${fingerprint}`, headers });
    assert.equal(bindingsPage.statusCode, 200);
    const bindings = bindingsPage.body as { total: number; items: Array<{ id: string; serviceAssetId?: string }> };
    assert.equal(bindings.total, 1);
    assert.equal(bindings.items[0]!.serviceAssetId, assets.items[0]!.id);
  });

  it('DiscoveryIngest apply 更新自动字段，但人工字段冲突持久化并可 use_discovered 解决', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_conflict', 'x-actor-id': 'user_admin' };
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'conflict.example.com', displayName: '人工主机名', primaryIp: '10.0.0.1', osType: 'LINUX' } })).body as { id: string };

    const ingest = await app.inject({
      method: 'POST',
      path: '/api/v1/discovery-snapshots/ingest',
      headers,
      body: {
        normalizedHash: 'conflict-001',
        source: 'SSH',
        apply: true,
        normalizedPayload: { hosts: [{ hostname: 'conflict.example.com', displayName: '发现主机名', primaryIp: '10.0.0.2', osVersion: 'Ubuntu 24.04' }] },
      },
    });
    assert.equal(ingest.statusCode, 201);
    assert.equal((ingest.body as any).conflicts.length, 1);

    const hostPage = await app.inject({ method: 'GET', path: '/api/v1/hosts?filter[hostname]=conflict.example.com', headers });
    const updatedHost = (hostPage.body as { items: Array<{ id: string; displayName: string; primaryIp: string; osVersion: string }> }).items[0]!;
    assert.equal(updatedHost.id, host.id);
    assert.equal(updatedHost.displayName, '人工主机名');
    assert.equal(updatedHost.primaryIp, '10.0.0.2');
    assert.equal(updatedHost.osVersion, 'Ubuntu 24.04');

    const conflicts = await app.inject({ method: 'GET', path: '/api/v1/asset-conflicts?filter[status]=open', headers });
    assert.equal(conflicts.statusCode, 200);
    const conflict = (conflicts.body as { items: Array<{ id: string; field: string; currentValue: string; discoveredValue: string; status: string }> }).items[0]!;
    assert.equal(conflict.field, 'displayName');
    assert.equal(conflict.currentValue, '人工主机名');
    assert.equal(conflict.discoveredValue, '发现主机名');

    const resolved = await app.inject({ method: 'POST', path: '/api/v1/asset-conflicts/resolve', headers, body: { id: conflict.id, resolution: 'use_discovered', comment: '确认采用发现值' } });
    assert.equal(resolved.statusCode, 200);
    assert.equal((resolved.body as any).conflict.status, 'resolved');
    assert.equal((resolved.body as any).conflict.resolvedBy, 'user_admin');
    assert.equal((resolved.body as any).resource.displayName, '发现主机名');
  });

  it('DiscoveryIngest apply 能对已有 Binding 更新自动字段，reloadCommand 人工字段进入冲突不覆盖', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_binding_update', 'x-actor-id': 'user_admin' };
    const oldFp = '1'.repeat(64);
    const newFp = '2'.repeat(64);
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'binding-update.example.com', osType: 'LINUX' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/service-instances', headers, body: { hostId: host.id, providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx' } })).body as { id: string };
    const binding = (await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings', headers, body: { serviceInstanceId: service.id, domainName: 'binding-update.example.com', port: 443, protocol: 'HTTPS', bindingType: 'FILE_PATH', certPath: '/etc/nginx/site.pem', observedFingerprintSha256: oldFp, reloadCommand: 'systemctl reload nginx', verifyMethod: 'TLS_CONNECT' } })).body as { id: string };

    const ingest = await app.inject({ method: 'POST', path: '/api/v1/discovery-snapshots/ingest', headers, body: { normalizedHash: 'binding-update-001', source: 'AGENT', apply: true, normalizedPayload: { bindings: [{ serviceRef: service.id, domainName: 'binding-update.example.com', port: 443, protocol: 'HTTPS', bindingType: 'FILE_PATH', certPath: '/etc/nginx/site.pem', observedFingerprintSha256: newFp, reloadCommand: 'nginx -s reload', verifyMethod: 'TLS_CONNECT' }] } } });
    assert.equal(ingest.statusCode, 201);
    assert.equal((ingest.body as any).conflicts.length, 1);

    const page = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings?filter[id]=${binding.id}`, headers });
    const updated = (page.body as { items: Array<{ observedFingerprintSha256: string; reloadCommand: string }> }).items[0]!;
    assert.equal(updated.observedFingerprintSha256, newFp);
    assert.equal(updated.reloadCommand, 'systemctl reload nginx');
  });

  it('DiscoveryIngest apply 会保留 NGINX 权限检查与命令准备 metadata', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_nginx_permission_ingest', 'x-actor-id': 'user_admin' };
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'perm.example.com', osType: 'LINUX' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/service-instances', headers, body: { hostId: host.id, providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx' } })).body as { id: string };

    const ingest = await app.inject({
      method: 'POST',
      path: '/api/v1/discovery-snapshots/ingest',
      headers,
      body: {
        normalizedHash: 'nginx-permission-001',
        source: 'AGENT',
        apply: true,
        normalizedPayload: {
          bindings: [{
            serviceRef: service.id,
            domainName: 'perm.example.com',
            port: 443,
            protocol: 'HTTPS',
            bindingType: 'FILE_PATH',
            certPath: '/var/lib/gcac/nginx-certs/perm/fullchain.pem',
            keyPath: '/var/lib/gcac/nginx-certs/perm/privkey.pem',
            verifyMethod: 'TLS_CONNECT',
            metadata: {
              testCommand: '/usr/sbin/nginx -t',
              reloadCommand: '/usr/bin/systemctl reload nginx',
              permission: {
                privilegeMode: 'sudo-n',
                helperRequired: false,
                certPath: { parentDirWritable: true },
                keyPath: { parentDirWritable: true },
              },
            },
          }],
        },
      },
    });
    assert.equal(ingest.statusCode, 201, JSON.stringify(ingest.body));

    const page = await app.inject({ method: 'GET', path: '/api/v1/certificate-bindings?filter[domainName]=perm.example.com', headers });
    assert.equal(page.statusCode, 200);
    const binding = (page.body as { items: Array<{ metadata?: { testCommand?: string; reloadCommand?: string; permission?: { privilegeMode?: string; certPath?: { parentDirWritable?: boolean } } } }> }).items[0]!;
    assert.equal(binding.metadata?.testCommand, '/usr/sbin/nginx -t');
    assert.equal(binding.metadata?.reloadCommand, '/usr/bin/systemctl reload nginx');
    assert.equal(binding.metadata?.permission?.privilegeMode, 'sudo-n');
    assert.equal(binding.metadata?.permission?.certPath?.parentDirWritable, true);
  });

  it('drift-results 持久化 local/remote 结果并更新 driftStatus，unreachable 不覆盖 local 字段', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_drift_persist', 'x-actor-id': 'user_admin' };
    const local = '3'.repeat(64);
    const remote = '4'.repeat(64);
    const desired = local;
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'drift-persist.example.com', osType: 'LINUX' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/service-instances', headers, body: { hostId: host.id, providerType: 'NGINX', displayName: 'nginx' } })).body as { id: string };
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
      path: '/api/v1/service-instances',
      headers,
      body: {
        hostId: host.id,
        providerType: 'NGINX',
        displayName: 'nginx spec007',
        versionText: '1.26.0',
        providerKey: 'nginx:/etc/nginx/nginx.conf',
        ports: [443, { port: 8443, protocol: 'HTTPS' }],
        manualOverrides: { configPath: '/manual/nginx.conf' },
        rawFacts: { workerProcesses: 4 },
      },
    })).body as { id: string; providerKey: string; ports: unknown[]; manualOverrides: Record<string, unknown> };
    assert.equal(service.providerKey, 'nginx:/etc/nginx/nginx.conf');
    assert.equal(service.ports.length, 2);
    assert.equal(service.manualOverrides.configPath, '/manual/nginx.conf');

    const denied = await app.inject({ method: 'GET', path: '/api/v1/hosts', headers: { 'x-actor-id': 'no_policy', 'x-tenant-id': 'tenant_spec007_full' } });
    assert.equal(denied.statusCode, 403);

    const audits = await app.inject({ method: 'GET', path: '/api/v1/audit-events?resourceType=host&eventType=host.created', headers });
    assert.equal(audits.statusCode, 200);
    assert.equal((audits.body as { items: unknown[] }).items.length, 1);
  });

  it('Binding 支持 Spec 字段、更新、唯一性、软删除和历史反查', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_spec007_binding_crud' };
    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'binding-crud.example.com' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/service-instances', headers, body: { hostId: host.id, providerType: 'NGINX', displayName: 'nginx' } })).body as { id: string };
    const fingerprint = 'e'.repeat(64);
    const targetCertificateVersionId = await importCertificateVersion(app, headers);

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
        targetCertificateVersionId,
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
    assert.equal(created.targetCertificateVersionId, targetCertificateVersionId);
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

    const deleted = await app.inject({ method: 'POST', path: '/api/v1/certificate-bindings/delete', headers, body: { bindingId: created.id } });
    assert.equal(deleted.statusCode, 200);
    assert.ok((deleted.body as { deletedAt?: string }).deletedAt);

    const activeList = await app.inject({ method: 'GET', path: '/api/v1/certificate-bindings?filter[bindingKey]=nginx:api:443:https', headers });
    assert.equal((activeList.body as { total: number }).total, 0);

    const usage = await app.inject({ method: 'GET', path: `/api/v1/certificate-bindings/usage?fingerprint=${fingerprint}`, headers });
    assert.equal(usage.statusCode, 200);
    const items = usage.body as Array<{ binding: { id: string; deletedAt?: string }; service: { id: string }; host: { id: string } }>;
    assert.equal(items.length, 1);
    assert.equal(items[0]!.binding.id, created.id);
    assert.ok(items[0]!.binding.deletedAt);
  });

});
  it('?? CertificateBinding ?????? ServiceAsset???? ServiceAsset CRUD', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-actor-id': 'user_admin', 'x-tenant-id': 'tenant_service_asset', 'x-request-id': 'req_service_asset_1' };

    const host = (await app.inject({ method: 'POST', path: '/api/v1/hosts', headers, body: { hostname: 'asset-auto.example.com', primaryIp: '10.0.9.9', osType: 'LINUX', compatibilityLevel: 'L1', managementMode: 'AGENT' } })).body as { id: string };
    const service = (await app.inject({ method: 'POST', path: '/api/v1/service-instances', headers, body: { hostId: host.id, providerType: 'NGINX', displayName: 'asset-auto-nginx' } })).body as { id: string };
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

  it('DiscoveryIngest apply 支持 siteAssets / managedTargets 入库并回填到 CertificateBinding', async () => {
    const app = await createMigratedApp();
    const headers = { 'x-tenant-id': 'tenant_spec012_site_asset_ingest', 'x-actor-id': 'user_admin' };
    const payload = {
      hosts: [{ hostname: 'iis-site.example.com', primaryIp: '10.8.1.10', osType: 'WINDOWS', agentId: 'agent-iis-01' }],
      services: [{ hostname: 'iis-site.example.com', providerType: 'IIS', serviceName: 'iis', displayName: 'iis', configPath: 'IIS:\\\\Sites' }],
      serviceAssets: [{
        serviceAssetRef: 'service-asset:iis-site.example.com:443:https',
        hostname: 'iis-site.example.com',
        providerType: 'IIS',
        serviceName: 'iis',
        address: 'iis-site.example.com',
        port: 443,
        protocol: 'HTTPS',
        sniName: 'iis-site.example.com',
        displayName: 'iis-site.example.com',
      }],
      siteAssets: [{
        siteAssetRef: 'site-asset:iis-default-web-site',
        serviceAssetRef: 'service-asset:iis-site.example.com:443:https',
        hostname: 'iis-site.example.com',
        providerType: 'IIS',
        serviceName: 'iis',
        agentId: 'agent-iis-01',
        siteType: 'WEB_SITE',
        siteName: 'Default Web Site',
        siteKey: 'agent-iis-01:iis:default web site:*:443:iis-site.example.com',
        bindingInformation: '*:443:iis-site.example.com',
        hostHeader: 'iis-site.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        configPath: 'IIS:\\\\Sites',
      }],
      bindings: [{
        siteAssetRef: 'site-asset:iis-default-web-site',
        serviceAssetRef: 'service-asset:iis-site.example.com:443:https',
        hostname: 'iis-site.example.com',
        providerType: 'IIS',
        serviceName: 'iis',
        domainName: 'iis-site.example.com',
        port: 443,
        protocol: 'HTTPS',
        bindingType: 'WINDOWS_CERT_STORE',
        storeLocation: 'LocalMachine',
        storeName: 'My',
        storeThumbprint: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        verifyMethod: 'TLS_CONNECT',
      }],
    };

    const ingest = await app.inject({
      method: 'POST',
      path: '/api/v1/discovery-snapshots/ingest',
      headers,
      body: { normalizedHash: 'spec012-site-asset-ingest-001', source: 'AGENT', apply: true, normalizedPayload: payload },
    });
    assert.equal(ingest.statusCode, 201);

    const siteAssets = await app.inject({ method: 'GET', path: '/api/v1/site-assets?filter[siteName]=default%20web%20site', headers });
    assert.equal(siteAssets.statusCode, 200);
    const siteAssetPage = siteAssets.body as { total: number; items: Array<{ id: string; siteName: string; hostHeader?: string }> };
    assert.equal(siteAssetPage.total, 1);
    assert.equal(siteAssetPage.items[0]!.siteName, 'default web site');
    assert.equal(siteAssetPage.items[0]!.hostHeader, 'iis-site.example.com');

    const managedTargets = await app.inject({ method: 'GET', path: '/api/v1/managed-targets?filter[agentId]=agent-iis-01', headers });
    assert.equal(managedTargets.statusCode, 200);
    const managedTargetPage = managedTargets.body as { total: number; items: Array<{ id: string; siteAssetId?: string; targetType: string }> };
    assert.equal(managedTargetPage.total, 1);
    assert.equal(managedTargetPage.items[0]!.siteAssetId, siteAssetPage.items[0]!.id);
    assert.equal(managedTargetPage.items[0]!.targetType, 'SITE_BINDING');

    const bindings = await app.inject({ method: 'GET', path: '/api/v1/certificate-bindings?filter[domainName]=iis-site.example.com', headers });
    assert.equal(bindings.statusCode, 200);
    const bindingPage = bindings.body as { total: number; items: Array<{ siteAssetId?: string; managedTargetId?: string; serviceAssetId?: string }> };
    assert.equal(bindingPage.total, 1);
    assert.equal(bindingPage.items[0]!.siteAssetId, siteAssetPage.items[0]!.id);
    assert.equal(bindingPage.items[0]!.managedTargetId, managedTargetPage.items[0]!.id);
    assert.ok(bindingPage.items[0]!.serviceAssetId);
  });

  it('ServiceAsset 支持按 SiteAsset 自动解析 ApplicationAssetTarget 并保持绑定读写兼容', async () => {
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
      path: '/api/v1/service-instances',
      headers,
      body: { hostId: host.id, providerType: 'IIS', serviceName: 'iis', displayName: 'iis', configPath: 'IIS:\\\\Sites' },
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

    const siteAsset = (await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers,
      body: {
        serviceInstanceId: service.id,
        serviceAssetId: serviceAsset.id,
        hostId: host.id,
        agentId: 'agent-iis-02',
        providerType: 'IIS',
        siteType: 'WEB_SITE',
        siteName: 'Default Web Site',
        siteKey: 'agent-iis-02:iis:default web site:*:443:app-target.example.com',
        bindingInformation: '*:443:app-target.example.com',
        hostHeader: 'app-target.example.com',
        listenIp: '*',
        port: 443,
        protocol: 'HTTPS',
        configPath: 'IIS:\\\\Sites',
      },
    })).body as { id: string };

    const managedTarget = (await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers,
      body: {
        agentId: 'agent-iis-02',
        hostId: host.id,
        serviceInstanceId: service.id,
        serviceAssetId: serviceAsset.id,
        siteAssetId: siteAsset.id,
        providerType: 'IIS',
        frameworkType: 'IIS',
        targetType: 'SITE_BINDING',
        targetKey: 'agent-iis-02:iis:default web site:*:443:app-target.example.com',
        bindingKey: 'iis:*:443:app-target.example.com',
        capabilityProfile: { canDeployPfx: true },
        deploymentMode: 'AGENT_PUSH',
      },
    })).body as { id: string; bindingKey?: string };

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
        siteAssetId: siteAsset.id,
      },
    });
    assert.equal(created.statusCode, 201, JSON.stringify(created.body));
    const createdAsset = created.body as { id: string; targetBinding?: { siteAssetId: string; managedTargetId: string; bindingKey?: string } };
    assert.equal(createdAsset.targetBinding?.siteAssetId, siteAsset.id);
    assert.equal(createdAsset.targetBinding?.managedTargetId, managedTarget.id);

    const listed = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets?filter[id]=${createdAsset.id}`,
      headers,
    });
    assert.equal(listed.statusCode, 200);
    const listedBody = listed.body as { total: number; items: Array<{ id: string; targetBinding?: { siteAssetId: string; managedTargetId: string } }> };
    assert.equal(listedBody.total, 1);
    assert.equal(listedBody.items[0]!.targetBinding?.siteAssetId, siteAsset.id);

    const updated = await app.inject({
      method: 'PATCH',
      path: '/api/v1/service-assets',
      headers,
      body: {
        id: createdAsset.id,
        targetBinding: {
          agentId: 'agent-iis-02',
          siteAssetId: siteAsset.id,
          managedTargetId: managedTarget.id,
          providerType: 'IIS',
          frameworkType: 'IIS',
          targetType: 'SITE_BINDING',
          targetKey: 'updated-target-key',
          bindingKey: 'updated-binding-key',
          status: 'ACTIVE',
          metadata: { source: 'updated' },
        },
      },
    });
    assert.equal(updated.statusCode, 200);
    const updatedBody = updated.body as { targetBinding?: { targetKey: string; bindingKey?: string; metadata?: { source?: string } } };
    assert.equal(updatedBody.targetBinding?.targetKey, 'updated-target-key');
    assert.equal(updatedBody.targetBinding?.bindingKey, 'updated-binding-key');
    assert.equal(updatedBody.targetBinding?.metadata?.source, 'updated');

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets/detail?serviceAssetId=${createdAsset.id}`,
      headers,
    });
    assert.equal(detail.statusCode, 200);
    const detailBody = detail.body as {
      id: string;
      targetBinding?: { managedTargetId: string };
      targetBindingDetail?: {
        siteAsset?: { id: string; siteName: string };
        managedTarget?: { id: string; targetType: string };
        certificateBindings: Array<{ managedTargetId?: string; siteAssetId?: string; bindingKey?: string }>;
      };
    };
    assert.equal(detailBody.id, createdAsset.id);
    assert.equal(detailBody.targetBinding?.managedTargetId, managedTarget.id);
    assert.equal(detailBody.targetBindingDetail?.siteAsset?.id, siteAsset.id);
    assert.equal(detailBody.targetBindingDetail?.siteAsset?.siteName, 'Default Web Site');
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.id, managedTarget.id);
    assert.equal(detailBody.targetBindingDetail?.managedTarget?.targetType, 'SITE_BINDING');
    assert.ok(detailBody.targetBindingDetail?.certificateBindings.length);
    assert.equal(detailBody.targetBindingDetail?.certificateBindings[0]?.managedTargetId, managedTarget.id);
    assert.equal(detailBody.targetBindingDetail?.certificateBindings[0]?.siteAssetId, siteAsset.id);
  });

  it('ServiceAsset 策略会从旧 Agent 绑定推导，并拒绝未发布工作流和明文 Secret', async () => {
    const headers = { 'x-tenant-id': 'tenant_spec0151_strategy', 'x-actor-id': 'user_admin' };
    const app = await createMigratedAppWithWildcardPolicy('user_admin', headers['x-tenant-id']);
    const chain = await createApplicationAssetTargetChain(app, headers);

    const detail = await app.inject({
      method: 'GET',
      path: `/api/v1/service-assets/detail?id=${chain.serviceAssetId}`,
      headers,
    });
    assert.equal(detail.statusCode, 200, JSON.stringify(detail.body));
    const detailBody = detail.body as { deploymentStrategy?: { type: string; agent?: { agentId: string; siteAssetId: string; managedTargetId: string } } };
    assert.equal(detailBody.deploymentStrategy?.type, 'AGENT');
    assert.equal(detailBody.deploymentStrategy?.agent?.agentId, chain.agentId);
    assert.equal(detailBody.deploymentStrategy?.agent?.siteAssetId, chain.siteAssetId);
    assert.equal(detailBody.deploymentStrategy?.agent?.managedTargetId, chain.managedTargetId);

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
            credentialRefs: { ssh: 'plain-password' },
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
            credentialRefs: { ssh: 'secret://ssh/app-target' },
            variableBindings: { host: chain.domain },
          },
        },
      },
    });
    assert.equal(updated.statusCode, 200, JSON.stringify(updated.body));
    const updatedBody = updated.body as { deploymentStrategy?: { type: string; workflow?: { workflowVersionId: string; credentialRefs?: Record<string, string> } }; metadata?: { deploymentStrategy?: { type: string } } };
    assert.equal(updatedBody.deploymentStrategy?.type, 'WORKFLOW');
    assert.equal(updatedBody.deploymentStrategy?.workflow?.workflowVersionId, draftBody.version.id);
    assert.equal(updatedBody.deploymentStrategy?.workflow?.credentialRefs?.ssh, 'secret://ssh/app-target');
    assert.equal(updatedBody.metadata?.deploymentStrategy?.type, 'WORKFLOW');
  });

  it('NGINX ApplicationAssetTarget 自动补绑定时会继承 FILE_PATH 证书路径', async () => {
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
      path: '/api/v1/service-instances',
      headers,
      body: { hostId: host.id, providerType: 'NGINX', serviceName: 'nginx', displayName: 'nginx', configPath: '/etc/nginx/nginx.conf' },
    })).body as { id: string };

    const siteAsset = (await app.inject({
      method: 'POST',
      path: '/api/v1/site-assets',
      headers,
      body: {
        serviceInstanceId: service.id,
        hostId: host.id,
        agentId: 'agent-nginx-02',
        providerType: 'NGINX',
        siteType: 'WEB_SITE',
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
    })).body as { id: string };

    const managedTarget = (await app.inject({
      method: 'POST',
      path: '/api/v1/managed-targets',
      headers,
      body: {
        agentId: 'agent-nginx-02',
        hostId: host.id,
        serviceInstanceId: service.id,
        siteAssetId: siteAsset.id,
        providerType: 'NGINX',
        frameworkType: 'NGINX',
        targetType: 'SITE_BINDING',
        targetKey: 'agent-nginx-02:nginx:nginx-app-target.example.com:*:443:nginx-app-target.example.com',
        bindingKey: 'nginx:*:443:nginx-app-target.example.com',
        capabilityProfile: { providerType: 'NGINX' },
        deploymentMode: 'AGENT_PUSH',
      },
    })).body as { id: string; bindingKey?: string };

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
    assert.equal(siblingBinding.statusCode, 201);

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
        agentId: 'agent-nginx-02',
        serviceInstanceId: service.id,
        displayName: 'Manual NGINX App Target',
        targetBinding: {
          agentId: 'agent-nginx-02',
          siteAssetId: siteAsset.id,
          managedTargetId: managedTarget.id,
          providerType: 'NGINX',
          frameworkType: 'NGINX',
          targetType: 'SITE_BINDING',
          targetKey: managedTarget.id,
          bindingKey: managedTarget.bindingKey,
          status: 'ACTIVE',
          metadata: { source: 'manual' },
        },
      },
    });
    assert.equal(created.statusCode, 201);
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
          serviceAssetId?: string;
          bindingType?: string;
          certPath?: string;
          keyPath?: string;
          verifyMethod?: string;
        }>;
      };
    };
    const assetBinding = (detailBody.targetBindingDetail?.certificateBindings ?? []).find((item) => item.serviceAssetId === createdAsset.id);
    assert.ok(assetBinding);
    assert.equal(assetBinding?.bindingType, 'FILE_PATH');
    assert.equal(assetBinding?.certPath, '/etc/nginx/certs/nginx-app-target.pem');
    assert.equal(assetBinding?.keyPath, '/etc/nginx/certs/nginx-app-target.key');
    assert.equal(assetBinding?.verifyMethod, 'TLS_CONNECT');
  });
