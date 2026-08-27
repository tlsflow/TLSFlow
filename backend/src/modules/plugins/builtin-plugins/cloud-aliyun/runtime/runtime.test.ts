import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginRunnerExecutor, normalizeDiscoveryResponse } from './index.js';

const descriptor = { pluginId: 'cloud.aliyun', pluginVersionId: 'cloud.aliyun:2.0.26' };

test('阿里云签名请求使用 RPC 要求的 Timestamp 公共参数', async () => {
  const envKeys = ['GCAC_PLUGIN_VERSION_ID', 'GCAC_PLUGIN_PACKAGE_HASH', 'GCAC_PLUGIN_MANIFEST_HASH', 'GCAC_PLUGIN_RESOURCE_HASH'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: 'cloud.aliyun:2.0.26',
    GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'1'.repeat(64)}`,
    GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'2'.repeat(64)}`,
    GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'3'.repeat(64)}`,
  });
  let outboundRequest: Record<string, unknown> | undefined;
  try {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute({
      pluginVersionId: 'cloud.aliyun:2.0.26',
      pluginId: 'cloud.aliyun',
      pluginVersion: '2.0.26',
      capability: 'cloud.service.connection-test',
      actionId: 'cloud.service.connection-test.v1',
      actionContractVersion: 'v1',
      packageHash: `sha256:${'1'.repeat(64)}`,
      manifestHash: `sha256:${'2'.repeat(64)}`,
      resourceHash: `sha256:${'3'.repeat(64)}`,
      planDigest: 'd'.repeat(64),
      idempotencyKey: 'aliyun-timestamp-fixture',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      signal: new AbortController().signal,
      grantRefs: ['grant-cloud'],
      writeEffect: false,
      input: {
        cloudServiceRef: 'caa-fixture',
        credential: { secretRefs: { accessKeyId: 'secret://cloud/access-key-id#current', accessKeySecret: 'secret://cloud/access-key-secret#current' } },
        request: { method: 'POST', uri: '/', action: 'DescribeUserDomains', apiVersion: '2018-05-10', timestamp: '2026-08-11T00:00:00Z', body: {} },
      },
    }, {
      async call(method, input) {
        if (method === 'cloudService.get') return { ok: true, data: { providerKey: 'cloud.aliyun', scope: { endpoint: 'https://cdn.aliyuncs.com' }, status: 'ACTIVE' } };
        if (method === 'crypto.hmac') return { ok: true, data: { signatureBase64: 'fixture-signature', publicValue: 'fixture-access-key-id' } };
        if (method === 'http.request') {
          outboundRequest = input;
          return { ok: true, data: { statusCode: 200, body: {} } };
        }
        throw new Error(`unexpected host method ${method}`);
      },
    });
    assert.equal(result.success, true);
    assert.ok(outboundRequest);
    const signedUrl = new URL(String(outboundRequest.url));
    assert.equal(signedUrl.searchParams.get('Timestamp'), '2026-08-11T00:00:00Z');
    assert.equal(signedUrl.searchParams.get('SignatureTimestamp'), null);
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('阿里云 CDN 发现兼容 DescribeUserDomains 的 Domains.Domain 响应', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      Domain: [
        { DomainName: 'example.com', Region: 'cn-hangzhou', Cname: 'example.com.w.kunlunsl.com', DomainStatus: 'online' },
        { DomainName: 'example.cn', Region: 'cn-shanghai', DomainStatus: 'online' },
      ],
    },
  }, descriptor);
  assert.deepEqual(result.map((item) => ({
    stableKey: item.stableKey,
    resourceId: item.resourceId,
    resourceType: item.resourceType,
    region: item.region,
    displayName: item.displayName,
  })), [
    { stableKey: 'cloud.aliyun:cdn.domain:example.com', resourceId: 'example.com', resourceType: 'cdn.domain', region: 'mainland', displayName: 'example.com' },
    { stableKey: 'cloud.aliyun:cdn.domain:example.cn', resourceId: 'example.cn', resourceType: 'cdn.domain', region: 'mainland', displayName: 'example.cn' },
  ]);
  assert.equal(result[0]?.metadata?.cname, 'example.com.w.kunlunsl.com');
  assert.equal(result[0]?.metadata?.cdnRegionName, '中国大陆');
});

test('归一化资源格式优先于厂商响应格式并保留非敏感元数据', () => {
  const result = normalizeDiscoveryResponse({ resources: [{ id: 'fixture-domain', type: 'cdn.domain', region: 'cn-test', displayName: 'fixture.example', metadata: { status: 'online' } }] }, descriptor);
  assert.equal(result[0]?.provider, 'cloud.aliyun');
  assert.equal(result[0]?.metadata?.status, 'online');
  assert.equal(result[0]?.region, 'mainland');
});

test('标准资源声明的证书端点字段会原样保留，供宿主投影 ManagedTarget', () => {
  const result = normalizeDiscoveryResponse({
    resources: [{
      id: 'fixture-endpoint',
      type: 'cdn.edge',
      region: 'global',
      displayName: 'edge.example',
      targetType: 'cloud.aliyun.cdn.certificate',
      targetKey: 'edge.example',
      bindingKey: 'edge-certificate',
      supportedCapabilities: ['certificate.deploy'],
      executionLocations: ['CONTROL_PLANE'],
    }],
  }, descriptor);
  assert.deepEqual(result[0], {
    apiVersion: 'gcac.cloud-service/v1',
    kind: 'CloudServiceResource',
    stableKey: 'cloud.aliyun:cdn.edge:fixture-endpoint',
    pluginId: 'cloud.aliyun',
    pluginVersionId: 'cloud.aliyun:2.0.26',
    provider: 'cloud.aliyun',
    resourceId: 'fixture-endpoint',
    resourceType: 'cdn.edge',
    region: 'global',
    displayName: 'edge.example',
    targetType: 'cloud.aliyun.cdn.certificate',
    targetKey: 'edge.example',
    bindingKey: 'edge-certificate',
    supportedCapabilities: ['certificate.deploy'],
    executionLocations: ['CONTROL_PLANE'],
  });
});

test('阿里云 CDN 发现只输出 CDN 域名，不把 ECS 区域转换为资源', () => {
  const result = normalizeDiscoveryResponse([
    { Regions: { Region: [{ RegionId: 'cn-hangzhou', LocalName: '华东1（杭州）', RegionEndpoint: 'ecs.cn-hangzhou.aliyuncs.com' }] } },
    { Domains: { Domain: [{ DomainName: 'global.example', Scope: 'overseas' }] } },
  ], descriptor);
  assert.deepEqual(result.map((item) => [item.resourceType, item.resourceId, item.region]), [
    ['cdn.domain', 'global.example', 'global'],
  ]);
  assert.equal(result[0]?.metadata?.cdnRegionName, '国际站');
});

test('阿里云 CDN 发现解析 DescribeUserDomains 的 Domains.PageData 响应', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      PageData: [{ DomainName: 'overseas.example', Coverage: 'overseas', DomainStatus: 'online' }],
    },
  }, descriptor);
  assert.deepEqual(result.map((item) => [item.resourceId, item.resourceType, item.region]), [
    ['overseas.example', 'cdn.domain', 'global'],
  ]);
});

test('同一 DescribeUserDomains 响应可将中国大陆与国际站域名分别归一化', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      PageData: [
        { DomainName: 'mainland.example', Coverage: 'domestic' },
        { DomainName: 'international.example', Coverage: 'overseas' },
      ],
    },
  }, descriptor);
  assert.deepEqual(result.map((item) => [item.resourceId, item.region, item.metadata?.cdnRegionName]), [
    ['mainland.example', 'mainland', '中国大陆'],
    ['international.example', 'global', '国际站'],
  ]);
});

test('CDN 域名未声明证书更换端点时不伪造 ManagedTarget', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      Domain: [{ DomainName: 'certificate.example', Coverage: 'domestic', DomainStatus: 'online' }],
    },
  }, descriptor);
  const endpoints = result[0]?.metadata?.certificateEndpoints;
  assert.equal(endpoints, undefined);
});
