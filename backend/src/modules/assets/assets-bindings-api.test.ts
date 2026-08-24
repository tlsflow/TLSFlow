import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../../app.module.js';

describe('资产与证书绑定 API', () => {
  it('可以创建 Host、ServiceInstance、ServiceEndpoint 和 CertificateBinding，并按 Host 查询绑定', async () => {
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_spec007', 'x-request-id': 'req_spec007_create' };

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

  it('Binding 不允许缺失 serviceInstanceId', async () => {
    const app = createApp();
    const response = await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers: { 'x-tenant-id': 'tenant_spec007' },
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
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_status' };
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
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_soft_delete' };
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

    const binding = (await app.inject({
      method: 'POST',
      path: '/api/v1/certificate-bindings',
      headers,
      body: {
        serviceInstanceId: service.id,
        serviceEndpointId: endpoint.id,
        bindingType: 'FILE_PATH',
        certificateVersionId: 'cv_keep_history',
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
      path: '/api/v1/certificate-bindings/usage?certificateVersionId=cv_keep_history',
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
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_discovery' };
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
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_merge' };
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
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_drift' };
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
    const app = createApp();
    const headers = { 'x-tenant-id': 'tenant_spec007_usage' };
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
});
