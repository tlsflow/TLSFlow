import assert from 'node:assert/strict';
import test from 'node:test';
import type { CloudAccountAsset } from '../dto/providers.dto.js';
import { AliyunProviderExtension, HuaweiProviderExtension, TencentProviderExtension, VolcengineProviderExtension } from './cloud-provider-extensions.js';
import type { ProviderCredentialResolver, ProviderHttpRequest, ProviderHttpResponse, ProviderTransport } from './provider-runtime.js';

class FixtureTransport implements ProviderTransport {
  readonly requests: ProviderHttpRequest[] = [];

  async request(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    this.requests.push(request);
    const body = request.body ? JSON.parse(request.body) as Record<string, unknown> : {};
    if (request.url.includes('aliyuncs.com')) {
      const action = new URL(request.url).searchParams.get('Action');
      if (action === 'DescribeDomainCertificateInfo') return response({ CertId: 'old-cert', FingerprintSha256: 'old-fp' });
      return response({ RequestId: 'req-1', CertId: 'new-cert' });
    }
    if (body.certificateId === 'new-cert') return response({ certificateId: 'new-cert' });
    return response({ certificateId: 'old-cert', existingField: 'preserved' });
  }
}

const credentials: ProviderCredentialResolver = {
  async resolve(asset: CloudAccountAsset) {
    const result: Record<string, string> = {};
    if (asset.providerKey === 'cloud.aliyun') {
      result.accessKeyId = 'ak';
      result.accessKeySecret = 'sk';
    } else if (asset.providerKey === 'cloud.tencent') {
      result.secretId = 'sid';
      result.secretKey = 'ssk';
    } else if (asset.providerKey === 'cloud.volcengine') {
      result.accessKeyId = 'vak';
      result.secretAccessKey = 'vsk';
    } else {
      result.accessKey = 'ak';
      result.secretKey = 'sk';
    }
    return result;
  },
};

function asset(providerKey: CloudAccountAsset['providerKey']): CloudAccountAsset {
  return {
    id: 'caa_test',
    tenantId: 'tenant_test',
    assetKind: 'cloud.account',
    providerKey,
    displayName: '测试账号',
    credentialRef: 'credential://cred_test',
    scope: {},
    status: 'ACTIVE',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
  };
}

test('阿里云扩展部署结果包含可用于回滚的 checkpoint', async () => {
  const transport = new FixtureTransport();
  const extension = new AliyunProviderExtension(credentials, transport);
  const result = await extension.execute(
    'certificate.deploy',
    { tenantId: 'tenant_test', asset: asset('cloud.aliyun'), requestId: 'req' },
    { frameworkType: 'cloud.aliyun.cdn', resourceId: 'cdn.example.com', domain: 'cdn.example.com' },
    { certificatePem: '-----BEGIN CERTIFICATE-----', privateKeyPem: 'private-key' },
  );
  assert.equal(result.status, 'SUCCESS');
  assert.equal((result.resultSummary?.checkpoint as { previous: { certificateId: string } }).previous.certificateId, 'old-cert');
  assert.equal(transport.requests.length, 2);
});

test('华为云扩展读取旧配置后保留旧配置字段再提交', async () => {
  const transport = new FixtureTransport();
  const extension = new HuaweiProviderExtension(credentials, transport);
  const result = await extension.execute(
    'certificate.deploy',
    { tenantId: 'tenant_test', asset: asset('cloud.huawei') },
    { frameworkType: 'cloud.huawei.cdn', resourceId: 'cdn.example.com', domain: 'cdn.example.com' },
    { certificatePem: 'pem', certificateId: 'new-cert' },
  );
  assert.equal(result.status, 'SUCCESS');
  const requestBody = JSON.parse(transport.requests.at(-1)?.body ?? '{}') as Record<string, unknown>;
  assert.equal(requestBody.existingField, 'preserved');
  assert.equal(requestBody.certificateId, 'new-cert');
});

test('腾讯云 CLB 扩展会按监听器路由证书并返回回滚点', async () => {
  const transport = new TencentFixtureTransport();
  const extension = new TencentProviderExtension(credentials, transport);
  const result = await extension.execute(
    'certificate.deploy',
    { tenantId: 'tenant_test', asset: asset('cloud.tencent') },
    { frameworkType: 'cloud.tencent.clb', resourceId: 'lb-1', listenerId: 'listener-1', domain: 'example.test', metadata: { loadBalancerId: 'lb-1' } },
    { certificateId: 'cert-new' },
  );
  assert.equal(result.status, 'SUCCESS');
  assert.equal((result.resultSummary?.checkpoint as { previous: { certificateId: string } }).previous.certificateId, 'cert-old');
});

test('火山引擎 CLB 扩展会按监听器更新证书', async () => {
  const transport = new VolcengineFixtureTransport();
  const extension = new VolcengineProviderExtension(credentials, transport);
  const result = await extension.execute(
    'certificate.deploy',
    { tenantId: 'tenant_test', asset: asset('cloud.volcengine') },
    { frameworkType: 'cloud.volcengine.clb', resourceId: 'lb-1', listenerId: 'listener-1', domain: 'example.test', metadata: { loadBalancerId: 'lb-1' } },
    { certificateId: 'cert-new' },
  );
  assert.equal(result.status, 'SUCCESS');
  const requestBody = JSON.parse(transport.requests.at(-1)?.body ?? '{}') as Record<string, unknown>;
  assert.equal(requestBody.CertificateId, 'cert-new');
});

function response(payload: Record<string, unknown>): ProviderHttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(payload), json: payload };
}

class TencentFixtureTransport implements ProviderTransport {
  readonly requests: ProviderHttpRequest[] = [];

  async request(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    this.requests.push(request);
    const action = request.headers?.['x-tc-action'];
    if (action === 'DescribeLoadBalancers') {
      return response({ Response: { LoadBalancerSet: [{ LoadBalancerId: 'lb-1', LoadBalancerName: 'lb-one' }] } });
    }
    if (action === 'DescribeListeners') {
      return response({ Response: { ListenerSet: [{ ListenerId: 'listener-1', ListenerName: 'listener-one', CertificateId: 'cert-old', Domain: 'example.test', Port: 443, Protocol: 'HTTPS' }] } });
    }
    if (action === 'ModifyListener') {
      return response({ RequestId: 'req-modify', Response: { RequestId: 'req-modify' } });
    }
    if (action === 'DescribeDomainConfig') {
      return response({ Response: { Status: 'SUCCESS' } });
    }
    return response({});
  }
}

class VolcengineFixtureTransport implements ProviderTransport {
  readonly requests: ProviderHttpRequest[] = [];

  async request(request: ProviderHttpRequest): Promise<ProviderHttpResponse> {
    this.requests.push(request);
    const action = request.headers?.['x-action'];
    if (action === 'DescribeLoadBalancers') {
      return response({ Result: { LoadBalancers: [{ LoadBalancerId: 'lb-1', LoadBalancerName: 'lb-one' }] } });
    }
    if (action === 'DescribeListeners') {
      return response({ Result: { Listeners: [{ ListenerId: 'listener-1', ListenerName: 'listener-one', CertificateId: 'cert-old', Domain: 'example.test', ListenerPort: 443, ListenerProtocol: 'HTTPS' }] } });
    }
    if (action === 'ModifyListener') {
      return response({ Result: { RequestId: 'req-modify' } });
    }
    return response({});
  }
}
