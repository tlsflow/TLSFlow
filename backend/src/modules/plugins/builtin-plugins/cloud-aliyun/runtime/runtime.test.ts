import assert from 'node:assert/strict';
import test from 'node:test';
import { createPluginRunnerExecutor, normalizeDiscoveryResponse } from './index.js';

const descriptor = { pluginId: 'cloud.aliyun', pluginVersionId: 'cloud.aliyun:2.0.35' };

test('阿里云签名请求使用 RPC 要求的 Timestamp 公共参数', async () => {
  const envKeys = ['GCAC_PLUGIN_VERSION_ID', 'GCAC_PLUGIN_PACKAGE_HASH', 'GCAC_PLUGIN_MANIFEST_HASH', 'GCAC_PLUGIN_RESOURCE_HASH'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: 'cloud.aliyun:2.0.35',
    GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'1'.repeat(64)}`,
    GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'2'.repeat(64)}`,
    GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'3'.repeat(64)}`,
  });
  let outboundRequest: Record<string, unknown> | undefined;
  try {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute({
      pluginVersionId: 'cloud.aliyun:2.0.35',
      pluginId: 'cloud.aliyun',
      pluginVersion: '2.0.35',
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

test('阿里云 CDN 证书更新使用表单正文传递 PEM，且不将私钥写入 URL', async () => {
  const envKeys = ['GCAC_PLUGIN_VERSION_ID', 'GCAC_PLUGIN_PACKAGE_HASH', 'GCAC_PLUGIN_MANIFEST_HASH', 'GCAC_PLUGIN_RESOURCE_HASH'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: 'cloud.aliyun:2.0.35',
    GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'1'.repeat(64)}`,
    GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'2'.repeat(64)}`,
    GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'3'.repeat(64)}`,
  });
  let outboundRequest: Record<string, unknown> | undefined;
  try {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute({
      pluginVersionId: 'cloud.aliyun:2.0.35', pluginId: 'cloud.aliyun', pluginVersion: '2.0.35', capability: 'certificate.deploy', actionId: 'certificate.deploy.v1', actionContractVersion: 'v1',
      packageHash: `sha256:${'1'.repeat(64)}`, manifestHash: `sha256:${'2'.repeat(64)}`, resourceHash: `sha256:${'3'.repeat(64)}`,
      planDigest: 'd'.repeat(64), idempotencyKey: 'aliyun-deploy-fixture', deadlineAt: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal, grantRefs: ['grant-cloud'], writeEffect: true,
      input: {
        cloudServiceRef: 'caa-fixture', target: 'nas-cdn.jacksonz.cn', certificateName: 'GCAC-jacksonz',
        credential: { secretRefs: { accessKeyId: 'secret://cloud/access-key-id#current', accessKeySecret: 'secret://cloud/access-key-secret#current' } },
        artifact: {
          artifactRef: 'artifact://certificate-version-4',
          outputs: {
            leafPem: '-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----',
            privateKeyPem: '-----BEGIN PRIVATE KEY-----\nPRIVATE-KEY-MATERIAL\n-----END PRIVATE KEY-----',
            orderedChainPem: '-----BEGIN CERTIFICATE-----\nCHAIN\n-----END CERTIFICATE-----',
            fingerprintSha256: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          },
        },
      },
    }, {
      async call(method, input) {
        if (method === 'cloudService.get') return { ok: true, data: { providerKey: 'cloud.aliyun', scope: { endpoint: 'https://cdn.aliyuncs.com' }, status: 'ACTIVE' } };
        if (method === 'artifact.grant.read') return { ok: true, data: { artifactRef: input.artifactRef, sha256: `sha256:${'e'.repeat(64)}`, contentBase64: '' } };
        if (method === 'crypto.hmac') return { ok: true, data: { signatureBase64: 'fixture-signature', publicValue: 'fixture-access-key-id' } };
        if (method === 'http.request') { outboundRequest = input; return { ok: true, data: { statusCode: 200, body: { RequestId: 'request-fixture' } } }; }
        throw new Error(`unexpected host method ${method}`);
      },
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.output, {
      provider: 'cloud.aliyun', operation: 'certificate.deploy', signatureAlgorithm: 'ALIYUN-RPC-HMAC-SHA1', signatureVerified: false, status: 'ACCEPTED', domainName: 'nas-cdn.jacksonz.cn', certificateName: 'GCAC-jacksonz', requestId: 'request-fixture',
    });
    assert.ok(outboundRequest);
    const url = String(outboundRequest.url);
    assert.equal(url.includes('PRIVATE-KEY-MATERIAL'), false);
    assert.equal(url.includes('-----BEGIN'), false);
    assert.equal((outboundRequest.headers as Record<string, string>)['content-type'], 'application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(outboundRequest.body));
    assert.equal(form.get('DomainName'), 'nas-cdn.jacksonz.cn');
    assert.equal(form.get('CertType'), 'upload');
    assert.equal(form.get('SSLProtocol'), 'on');
    assert.match(String(form.get('SSLPub')), /LEAF[\s\S]*CHAIN/);
    assert.match(String(form.get('SSLPri')), /PRIVATE-KEY-MATERIAL/);
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('阿里云 CDN 证书更新在私钥缺失时失败关闭', async () => {
  const envKeys = ['GCAC_PLUGIN_VERSION_ID', 'GCAC_PLUGIN_PACKAGE_HASH', 'GCAC_PLUGIN_MANIFEST_HASH', 'GCAC_PLUGIN_RESOURCE_HASH'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: 'cloud.aliyun:2.0.35', GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'1'.repeat(64)}`, GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'2'.repeat(64)}`, GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'3'.repeat(64)}`,
  });
  try {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute({
      pluginVersionId: 'cloud.aliyun:2.0.35', pluginId: 'cloud.aliyun', pluginVersion: '2.0.35', capability: 'certificate.deploy', actionId: 'certificate.deploy.v1', actionContractVersion: 'v1', packageHash: `sha256:${'1'.repeat(64)}`, manifestHash: `sha256:${'2'.repeat(64)}`, resourceHash: `sha256:${'3'.repeat(64)}`,
      planDigest: 'd'.repeat(64), idempotencyKey: 'aliyun-deploy-missing-key', deadlineAt: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal, grantRefs: ['grant-cloud'], writeEffect: true,
      input: { cloudServiceRef: 'caa-fixture', target: 'nas-cdn.jacksonz.cn', credential: { secretRefs: { accessKeyId: 'secret://cloud/access-key-id#current', accessKeySecret: 'secret://cloud/access-key-secret#current' } }, artifact: { outputs: { leafPem: '-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----' } } },
    }, {
      async call(method) {
        if (method === 'cloudService.get') return { ok: true, data: { providerKey: 'cloud.aliyun', scope: { endpoint: 'https://cdn.aliyuncs.com' }, status: 'ACTIVE' } };
        throw new Error(`unexpected host method ${method}`);
      },
    });
    assert.equal(result.success, false);
    const error = result.error as Record<string, unknown>;
    assert.equal(error.code, 'CLOUD_ARTIFACT_INVALID');
    assert.equal(error.secretRedacted, true);
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('阿里云 CDN 写入错误不会回显私钥', async () => {
  const envKeys = ['GCAC_PLUGIN_VERSION_ID', 'GCAC_PLUGIN_PACKAGE_HASH', 'GCAC_PLUGIN_MANIFEST_HASH', 'GCAC_PLUGIN_RESOURCE_HASH'];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    GCAC_PLUGIN_VERSION_ID: 'cloud.aliyun:2.0.35', GCAC_PLUGIN_PACKAGE_HASH: `sha256:${'1'.repeat(64)}`, GCAC_PLUGIN_MANIFEST_HASH: `sha256:${'2'.repeat(64)}`, GCAC_PLUGIN_RESOURCE_HASH: `sha256:${'3'.repeat(64)}`,
  });
  try {
    const executor = createPluginRunnerExecutor();
    const result = await executor.execute({
      pluginVersionId: 'cloud.aliyun:2.0.35', pluginId: 'cloud.aliyun', pluginVersion: '2.0.35', capability: 'certificate.deploy', actionId: 'certificate.deploy.v1', actionContractVersion: 'v1', packageHash: `sha256:${'1'.repeat(64)}`, manifestHash: `sha256:${'2'.repeat(64)}`, resourceHash: `sha256:${'3'.repeat(64)}`,
      planDigest: 'd'.repeat(64), idempotencyKey: 'aliyun-deploy-vendor-error', deadlineAt: new Date(Date.now() + 10_000).toISOString(), signal: new AbortController().signal, grantRefs: ['grant-cloud'], writeEffect: true,
      input: { cloudServiceRef: 'caa-fixture', target: 'nas-cdn.jacksonz.cn', credential: { secretRefs: { accessKeyId: 'secret://cloud/access-key-id#current', accessKeySecret: 'secret://cloud/access-key-secret#current' } }, artifact: { outputs: { leafPem: '-----BEGIN CERTIFICATE-----\nLEAF\n-----END CERTIFICATE-----', privateKeyPem: '-----BEGIN PRIVATE KEY-----\nPRIVATE-KEY-MATERIAL\n-----END PRIVATE KEY-----' } } },
    }, {
      async call(method) {
        if (method === 'cloudService.get') return { ok: true, data: { providerKey: 'cloud.aliyun', scope: { endpoint: 'https://cdn.aliyuncs.com' }, status: 'ACTIVE' } };
        if (method === 'crypto.hmac') return { ok: true, data: { signatureBase64: 'fixture-signature', publicValue: 'fixture-access-key-id' } };
        if (method === 'http.request') return { ok: true, data: { statusCode: 400, body: { Code: 'InvalidCertificate', Message: 'certificate rejected' } } };
        throw new Error(`unexpected host method ${method}`);
      },
    });
    assert.equal(result.success, false);
    const error = result.error as Record<string, unknown>;
    assert.equal(error.code, 'CLOUD_WRITE_FAILED');
    assert.match(String(error.message), /InvalidCertificate/);
    assert.equal(String(error.message).includes('PRIVATE-KEY-MATERIAL'), false);
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

test('阿里云 CDN 域名未返回 CertId 时仍声明证书更新目标', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      Domain: [{ DomainName: 'no-cert-fact.example', Region: 'overseas', DomainStatus: 'online' }],
    },
  }, descriptor);
  assert.deepEqual(result[0]?.metadata?.certificateEndpoints, [{
    endpointKey: 'no-cert-fact.example',
    targetType: 'cloud.aliyun.cdn.certificate',
    targetKey: 'no-cert-fact.example',
    bindingKey: 'no-cert-fact.example',
    supportedCapabilities: ['cloud.service.discover', 'certificate.deploy'],
    executionLocations: ['CONTROL_PLANE'],
  }]);
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
    pluginVersionId: 'cloud.aliyun:2.0.35',
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

test('重复或大小写不同的 CDN 域名只归一化为一个国际站实例', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      PageData: [
        { DomainName: 'NAS-CDN.JACKSONZ.CN', Coverage: 'overseas', DomainStatus: 'online' },
        { DomainName: 'nas-cdn.jacksonz.cn', Coverage: 'overseas', DomainStatus: 'online', CertId: 'cert-valid' },
      ],
    },
  }, descriptor);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.resourceId, 'nas-cdn.jacksonz.cn');
  assert.equal((result[0]?.metadata?.certificate as Record<string, unknown>)?.providerCertificateId, 'cert-valid');
});

test('CDN 域名未返回证书事实时仍声明证书更新端点', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      Domain: [{ DomainName: 'certificate.example', Coverage: 'domestic', DomainStatus: 'online' }],
    },
  }, descriptor);
  assert.deepEqual(result[0]?.metadata?.certificateEndpoints, [{
    endpointKey: 'certificate.example',
    targetType: 'cloud.aliyun.cdn.certificate',
    targetKey: 'certificate.example',
    bindingKey: 'certificate.example',
    supportedCapabilities: ['cloud.service.discover', 'certificate.deploy'],
    executionLocations: ['CONTROL_PLANE'],
  }]);
});

test('CDN 域名响应中的 CertId 会恢复证书事实和控制面目标', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      Domain: [{
        DomainName: 'bound.example',
        Coverage: 'domestic',
        CertId: 'cas-cert-001',
        CertificateFingerprint: 'sha256:' + 'a'.repeat(64),
        Subject: 'CN=bound.example',
        Issuer: 'CN=Example CA',
        NotBefore: '2026-01-01T00:00:00Z',
        NotAfter: '2027-01-01T00:00:00Z',
      }],
    },
  }, descriptor);
  const certificate = result[0]?.metadata?.certificate as Record<string, unknown> | undefined;
  assert.equal(certificate?.providerCertificateId, 'cas-cert-001');
  assert.equal(certificate?.fingerprintSha256, 'sha256:' + 'a'.repeat(64));
  assert.deepEqual(result[0]?.metadata?.certificateEndpoints, [{
    endpointKey: 'bound.example',
    targetType: 'cloud.aliyun.cdn.certificate',
    targetKey: 'bound.example',
    bindingKey: 'bound.example',
    supportedCapabilities: ['cloud.service.discover', 'certificate.deploy'],
    executionLocations: ['CONTROL_PLANE'],
    metadata: { providerCertificateId: 'cas-cert-001' },
  }]);
});

test('CDN 域名仅返回 CertId 时仍保留域名证书关联键', () => {
  const result = normalizeDiscoveryResponse({
    Domains: {
      Domain: [{ DomainName: 'cert-only.example', Coverage: 'overseas', CertId: 'cas-cert-only', CertName: 'cert-only.example' }],
    },
  }, descriptor);
  const certificate = result[0]?.metadata?.certificate as Record<string, unknown> | undefined;
  assert.equal(certificate?.providerCertificateId, 'cas-cert-only');
  assert.equal(certificate?.domainName, 'cert-only.example');
  const endpoints = result[0]?.metadata?.certificateEndpoints as Array<Record<string, unknown>> | undefined;
  assert.equal(endpoints?.[0]?.targetKey, 'cert-only.example');
});
