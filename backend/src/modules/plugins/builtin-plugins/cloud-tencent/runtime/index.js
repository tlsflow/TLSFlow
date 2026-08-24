import {
  assertResponse,
  buildDiscoveryPayload,
  buildOperationResult,
  ensureTarget,
  firstString,
  loadCheckpoint,
  providerRuntimeError,
  readRecord,
  readString,
  requestJson,
  resolveCertificateInput,
  resolveRuntimeContext,
  saveCheckpoint,
  signTencentTc3,
  toRecordArray,
} from './shared.js';

const PROVIDER_KEY = 'cloud.tencent';
const PROVIDER_NAME = '腾讯云';
const SUPPORTED_PRODUCTS = ['cloud.tencent.cdn', 'cloud.tencent.clb', 'cloud.tencent.live'];
const OPERATIONS = ['certificate.discover', 'certificate.deploy', 'certificate.rollback'];

export default async function createProviderPlugin({ hostApi, plugin }) {
  return {
    async testConnection(context) {
      const runtime = await buildRuntime(hostApi, context);
      return {
        ok: true,
        details: {
          providerKey: plugin.providerKey || PROVIDER_KEY,
          providerName: PROVIDER_NAME,
          accountId: runtime.asset.accountId || runtime.asset.id,
          credentialSlots: Object.keys(runtime.credential || {}).sort(),
        },
      };
    },

    async discover(context, input = {}) {
      const runtime = await buildRuntime(hostApi, context);
      const frameworks = selectFrameworks(input.frameworkTypes);
      const discovery = buildDiscoveryPayload(
        { providerKey: plugin.providerKey || PROVIDER_KEY, supportedProducts: SUPPORTED_PRODUCTS, supportedOperations: OPERATIONS },
        runtime.asset,
        PROVIDER_NAME,
        frameworks,
      );
      for (const frameworkType of frameworks) {
        if (frameworkType === 'cloud.tencent.cdn') {
          mergeDiscovery(discovery, await discoverTencentDomains(runtime, frameworkType, 'cloud.tencent.cdn.domain', {
            action: 'DescribeDomains',
            version: '2018-06-06',
            endpoint: 'https://cdn.tencentcloudapi.com',
            payload: { Limit: 100 },
            paths: [['Response', 'Domains'], ['Domains'], ['domains']],
            domainFields: ['Domain', 'DomainName', 'domain'],
            certificateFields: ['CertId', 'CertificateId', 'certificateId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.tencent.live') {
          mergeDiscovery(discovery, await discoverTencentDomains(runtime, frameworkType, 'cloud.tencent.live.domain', {
            action: 'DescribeLiveDomains',
            version: '2018-08-01',
            endpoint: 'https://live.tencentcloudapi.com',
            payload: { PageSize: 100 },
            paths: [['DomainList'], ['Response', 'DomainList'], ['domains']],
            domainFields: ['Name', 'DomainName', 'domain'],
            certificateFields: ['CloudCertId', 'CertId', 'CertificateId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.tencent.clb') {
          mergeDiscovery(discovery, await discoverTencentListeners(runtime));
        }
      }
      return discovery;
    },

    async deployCertificate(context, input = {}) {
      const runtime = await buildRuntime(hostApi, context);
      const target = ensureTarget(input);
      const certificate = await resolveCertificateInput(hostApi, input);
      const previous = await readTencentTargetState(runtime, target);
      const checkpoint = await saveCheckpoint(hostApi, PROVIDER_KEY, target, previous);
      const applied = await applyTencentCertificate(runtime, target, certificate);
      await hostApi.audit.record({
        action: 'provider.tencent.deploy_certificate',
        status: 'SUCCESS',
        summary: { frameworkType: target.frameworkType, resourceId: target.resourceId, certificateId: applied.certificateId },
      });
      return buildOperationResult(PROVIDER_KEY, 'certificate.deploy', 'SUCCESS', {
        certificateId: applied.certificateId,
        previousCertificateId: readString(previous?.certificateId),
        checkpoint,
        ...(applied.asyncOperation ? { asyncOperation: applied.asyncOperation } : {}),
      });
    },

    async rollbackCertificate(context, input = {}) {
      const runtime = await buildRuntime(hostApi, context);
      const checkpoint = await loadCheckpoint(hostApi, input);
      const target = ensureTarget(readRecord(checkpoint.target) || input);
      const previous = readRecord(checkpoint.previous) || {};
      const certificateId = readString(input.certificateId) || readString(previous.certificateId);
      if (!certificateId) {
        return buildOperationResult(PROVIDER_KEY, 'certificate.rollback', 'MANUAL_REQUIRED', {
          reason: 'missing_previous_certificate_id',
          checkpoint,
        });
      }
      await applyTencentCertificate(runtime, target, { certificateId });
      await hostApi.audit.record({
        action: 'provider.tencent.rollback_certificate',
        status: 'SUCCESS',
        summary: { frameworkType: target.frameworkType, resourceId: target.resourceId, certificateId },
      });
      return buildOperationResult(PROVIDER_KEY, 'certificate.rollback', 'SUCCESS', {
        certificateId,
        checkpoint,
      });
    },
  };
}

async function buildRuntime(hostApi, context) {
  return { hostApi, ...await resolveRuntimeContext(hostApi, context, PROVIDER_NAME) };
}

async function discoverTencentDomains(runtime, frameworkType, targetType, definition) {
  const payload = await callTencentApi(runtime, definition.action, definition.version, definition.endpoint, definition.payload);
  const items = readArray(payload, definition.paths);
  return buildDomainDiscovery(frameworkType, targetType, items, definition.domainFields, definition.certificateFields);
}

async function discoverTencentListeners(runtime) {
  const loadBalancers = readArray(
    await callTencentApi(runtime, 'DescribeLoadBalancers', '2018-03-17', 'https://clb.tencentcloudapi.com', { Limit: 100 }),
    [['Response', 'LoadBalancerSet'], ['Response', 'LoadBalancers'], ['LoadBalancerSet'], ['LoadBalancers'], ['loadBalancers']],
  );
  const discovery = emptyDiscovery();
  for (const loadBalancer of loadBalancers) {
    const loadBalancerId = firstString(loadBalancer, ['LoadBalancerId', 'loadBalancerId', 'instanceId']);
    if (!loadBalancerId) continue;
    const listeners = readArray(
      await callTencentApi(runtime, 'DescribeListeners', '2018-03-17', 'https://clb.tencentcloudapi.com', { LoadBalancerId: loadBalancerId }),
      [['Response', 'ListenerSet'], ['Response', 'Listeners'], ['ListenerSet'], ['Listeners'], ['listeners']],
    );
    for (const listener of listeners) {
      const listenerId = firstString(listener, ['ListenerId', 'listenerId', 'id']) || `${loadBalancerId}:listener`;
      const domain = firstString(listener, ['Domain', 'domain', 'DomainName']) || listenerId;
      const certificateId = firstString(listener, ['CertificateId', 'certId', 'CertId', 'certificateId']);
      const stableKey = `${loadBalancerId}:${listenerId}`;
      const metadata = { ...listener, loadBalancerId, listenerId, domain };
      pushFramework(discovery, 'cloud.tencent.clb');
      discovery.sites.push({
        stableKey,
        frameworkStableKey: 'cloud.tencent.clb',
        siteType: 'cloud.tencent.clb.listener',
        displayName: firstString(listener, ['ListenerName', 'listenerName', 'name']) || domain,
        addresses: [domain],
        port: readNumber(listener, ['ListenerPort', 'port', 'Port']) || 443,
        protocol: (firstString(listener, ['Protocol', 'protocol', 'ListenerProtocol']) || 'HTTPS').toUpperCase(),
        metadata,
      });
      discovery.managedTargets.push({
        stableKey,
        frameworkStableKey: 'cloud.tencent.clb',
        siteStableKey: stableKey,
        targetType: 'cloud.tencent.clb.listener',
        targetKey: listenerId,
        bindingKey: domain,
        supportedCapabilities: OPERATIONS,
        executionLocations: ['CONTROL_PLANE'],
        metadata,
      });
      if (certificateId) {
        pushCertificate(discovery, certificateId, { domain, loadBalancerId, listenerId });
        discovery.certificateBindings.push({
          stableKey: `${stableKey}:${certificateId}`,
          managedTargetStableKey: stableKey,
          certificateStableKey: certificateId,
          bindingName: domain,
          metadata: { domain, loadBalancerId, listenerId, certificateId },
        });
      }
    }
  }
  return discovery;
}

async function readTencentTargetState(runtime, target) {
  if (target.frameworkType === 'cloud.tencent.cdn') {
    const payload = await callTencentApi(runtime, 'DescribeDomains', '2018-06-06', 'https://cdn.tencentcloudapi.com', {
      Filters: [{ Name: 'domain', Value: [target.domain || target.resourceId] }],
    });
    return { certificateId: firstString(payload, ['CertId', 'CertificateId', 'certificateId']), metadata: payload };
  }
  if (target.frameworkType === 'cloud.tencent.live') {
    const payload = await callTencentApi(runtime, 'DescribeLiveDomains', '2018-08-01', 'https://live.tencentcloudapi.com', { PageSize: 100 });
    const domains = readArray(payload, [['DomainList'], ['Response', 'DomainList']]);
    const matched = domains.find((item) => (firstString(item, ['Name', 'DomainName', 'domain']) || '') === (target.domain || target.resourceId));
    return { certificateId: firstString(matched || payload, ['CloudCertId', 'CertId', 'CertificateId']), metadata: matched || payload };
  }
  const payload = await callTencentApi(runtime, 'DescribeListeners', '2018-03-17', 'https://clb.tencentcloudapi.com', {
    LoadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
  });
  const listeners = readArray(payload, [['Response', 'ListenerSet'], ['Response', 'Listeners'], ['ListenerSet'], ['Listeners'], ['listeners']]);
  const matched = listeners.find((item) => (firstString(item, ['ListenerId', 'listenerId', 'id']) || '') === (target.listenerId || target.resourceId));
  return {
    certificateId: firstString(matched || payload, ['CertificateId', 'certId', 'CertId', 'certificateId']),
    metadata: {
      ...(matched || {}),
      loadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
      listenerId: firstString(matched || {}, ['ListenerId', 'listenerId', 'id']) || target.listenerId || target.resourceId,
    },
  };
}

async function applyTencentCertificate(runtime, target, certificate) {
  const certificateId = certificate.certificateId || await uploadTencentCertificate(runtime, target, certificate);
  if (target.frameworkType === 'cloud.tencent.cdn') {
    const payload = await callTencentApi(runtime, 'ModifyDomainConfig', '2018-06-06', 'https://cdn.tencentcloudapi.com', {
      Domain: target.domain || target.resourceId,
      Certificate: { CertId: certificateId },
    });
    const asyncOperation = readAsyncOperation(payload);
    return { certificateId, response: payload, ...(asyncOperation ? { asyncOperation } : {}) };
  }
  if (target.frameworkType === 'cloud.tencent.live') {
    const payload = await callTencentApi(runtime, 'ModifyLiveDomainCertBindings', '2018-08-01', 'https://live.tencentcloudapi.com', {
      DomainInfos: [{ DomainName: target.domain || target.resourceId, Status: -1 }],
      CloudCertId: certificateId,
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.tencent.clb') {
    const payload = await callTencentApi(runtime, 'ModifyListener', '2018-03-17', 'https://clb.tencentcloudapi.com', {
      LoadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
      ListenerId: target.listenerId || target.resourceId,
      CertificateId: certificateId,
    });
    return { certificateId, response: payload };
  }
  throw providerRuntimeError('腾讯云插件不支持该目标类型', { frameworkType: target.frameworkType });
}

async function uploadTencentCertificate(runtime, target, certificate) {
  if (!certificate.certificatePem || !certificate.privateKeyPem) {
    throw providerRuntimeError('腾讯云证书上传缺少 certificatePem 或 privateKeyPem', { frameworkType: target.frameworkType });
  }
  if (target.frameworkType === 'cloud.tencent.live') {
    const payload = await callTencentSslApi(runtime, 'UploadCertificate', {
      CertificatePublicKey: certificate.certificatePem,
      CertificatePrivateKey: certificate.privateKeyPem,
      Alias: `gcac-live-${Date.now()}`,
    });
    return readString(payload.CertificateId) || `tencent-cert-${Date.now()}`;
  }
  if (target.frameworkType === 'cloud.tencent.cdn') {
    const payload = await callTencentApi(runtime, 'UploadCertificate', '2018-06-06', 'https://cdn.tencentcloudapi.com', {
      Certificate: certificate.certificatePem,
      PrivateKey: certificate.privateKeyPem,
      ...(certificate.chainPem ? { CertificateChain: certificate.chainPem } : {}),
    });
    return readString(payload.CertificateId) || `tencent-cert-${Date.now()}`;
  }
  throw providerRuntimeError('该腾讯云产品需要预先提供 certificateId', { frameworkType: target.frameworkType });
}

async function callTencentApi(runtime, action, version, endpoint, payload = {}) {
  const request = signTencentTc3({
    secretId: required(runtime.credential, ['secretId', 'SecretId']),
    secretKey: required(runtime.credential, ['secretKey', 'SecretKey']),
    service: tencentServiceFromEndpoint(endpoint),
    action,
    version,
    region: readString(runtime.asset.scope?.regions?.[0]),
    payload,
    scope: runtime.asset.scope || {},
    endpoint,
  });
  return unwrapTencentResponse(assertResponse(await requestJson(runtime.hostApi, request), PROVIDER_KEY));
}

async function callTencentSslApi(runtime, action, payload = {}) {
  const request = signTencentTc3({
    secretId: required(runtime.credential, ['secretId', 'SecretId']),
    secretKey: required(runtime.credential, ['secretKey', 'SecretKey']),
    service: 'ssl',
    action,
    version: '2019-12-05',
    payload,
    scope: runtime.asset.scope || {},
    endpoint: 'https://ssl.tencentcloudapi.com',
  });
  return unwrapTencentResponse(assertResponse(await requestJson(runtime.hostApi, request), PROVIDER_KEY));
}

function unwrapTencentResponse(payload) {
  const response = readRecord(payload.Response);
  if (response?.Error) {
    throw providerRuntimeError('腾讯云 API 返回错误', { error: response.Error });
  }
  return response || payload;
}

function tencentServiceFromEndpoint(endpoint) {
  if (endpoint.includes('clb.')) return 'clb';
  if (endpoint.includes('live.')) return 'live';
  return 'cdn';
}

function buildDomainDiscovery(frameworkType, targetType, items, domainFields, certificateFields) {
  const discovery = emptyDiscovery();
  pushFramework(discovery, frameworkType);
  for (const item of items) {
    const domain = firstString(item, domainFields);
    if (!domain) continue;
    const certificateId = firstString(item, certificateFields);
    const stableKey = domain;
    discovery.sites.push({
      stableKey,
      frameworkStableKey: frameworkType,
      siteType: targetType,
      displayName: domain,
      addresses: [domain],
      port: 443,
      protocol: 'HTTPS',
      metadata: item,
    });
    discovery.managedTargets.push({
      stableKey,
      frameworkStableKey: frameworkType,
      siteStableKey: stableKey,
      targetType,
      targetKey: domain,
      bindingKey: domain,
      supportedCapabilities: OPERATIONS,
      executionLocations: ['CONTROL_PLANE'],
      metadata: item,
    });
    if (certificateId) {
      pushCertificate(discovery, certificateId, { domain });
      discovery.certificateBindings.push({
        stableKey: `${stableKey}:${certificateId}`,
        managedTargetStableKey: stableKey,
        certificateStableKey: certificateId,
        bindingName: domain,
        metadata: { domain, certificateId },
      });
    }
  }
  return discovery;
}

function readAsyncOperation(payload) {
  const taskId = readString(payload.TaskId) || readString(payload.JobId) || readString(payload.RequestId);
  return taskId ? { taskId, status: 'RUNNING' } : undefined;
}

function emptyDiscovery() {
  return { frameworks: [], sites: [], managedTargets: [], certificates: [], certificateBindings: [], warnings: [] };
}

function pushFramework(discovery, frameworkType) {
  if (discovery.frameworks.some((item) => item.stableKey === frameworkType)) return;
  discovery.frameworks.push({
    stableKey: frameworkType,
    frameworkType,
    displayName: frameworkType.split('.').at(-1)?.toUpperCase() || frameworkType,
    metadata: { providerKey: PROVIDER_KEY },
  });
}

function pushCertificate(discovery, certificateId, metadata) {
  if (discovery.certificates.some((item) => item.stableKey === certificateId)) return;
  discovery.certificates.push({ stableKey: certificateId, metadata });
}

function mergeDiscovery(target, input) {
  target.frameworks.push(...input.frameworks.filter((item) => !target.frameworks.some((current) => current.stableKey === item.stableKey)));
  target.sites.push(...input.sites);
  target.managedTargets.push(...input.managedTargets);
  target.certificates.push(...input.certificates.filter((item) => !target.certificates.some((current) => current.stableKey === item.stableKey)));
  target.certificateBindings.push(...input.certificateBindings);
  target.warnings.push(...(input.warnings || []));
}

function selectFrameworks(requested) {
  if (!Array.isArray(requested) || requested.length === 0) return [...SUPPORTED_PRODUCTS];
  return requested.filter((item) => SUPPORTED_PRODUCTS.includes(item));
}

function required(source, keys) {
  for (const key of keys) {
    const value = readString(source?.[key]);
    if (value) return value;
  }
  throw providerRuntimeError('腾讯云凭据缺少必要字段', { keys });
}

function readArray(payload, paths) {
  for (const path of paths) {
    let current = payload;
    for (const key of path) current = readRecord(current)?.[key];
    const items = toRecordArray(current);
    if (items.length > 0) return items;
  }
  return [];
}

function readNumber(record, keys) {
  const source = readRecord(record) || {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
