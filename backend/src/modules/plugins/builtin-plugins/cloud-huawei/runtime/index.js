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
  scopeEndpoint,
  signHuaweiRequest,
  toRecordArray,
} from './shared.js';

const PROVIDER_KEY = 'cloud.huawei';
const PROVIDER_NAME = '华为云';
const SUPPORTED_PRODUCTS = ['cloud.huawei.cdn', 'cloud.huawei.elb'];
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
        if (frameworkType === 'cloud.huawei.cdn') {
          mergeDiscovery(discovery, await discoverHuaweiCdn(runtime));
          continue;
        }
        if (frameworkType === 'cloud.huawei.elb') {
          mergeDiscovery(discovery, await discoverHuaweiElb(runtime));
        }
      }
      return discovery;
    },

    async deployCertificate(context, input = {}) {
      const runtime = await buildRuntime(hostApi, context);
      const target = ensureTarget(input);
      const certificate = await resolveCertificateInput(hostApi, input);
      const previous = await readHuaweiTargetState(runtime, target);
      const checkpoint = await saveCheckpoint(hostApi, PROVIDER_KEY, target, previous);
      const applied = await applyHuaweiCertificate(runtime, target, certificate, previous);
      await hostApi.audit.record({
        action: 'provider.huawei.deploy_certificate',
        status: 'SUCCESS',
        summary: { frameworkType: target.frameworkType, resourceId: target.resourceId, certificateId: applied.certificateId },
      });
      return buildOperationResult(PROVIDER_KEY, 'certificate.deploy', 'SUCCESS', {
        certificateId: applied.certificateId,
        previousCertificateId: readString(previous?.certificateId),
        checkpoint,
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
      await applyHuaweiCertificate(runtime, target, { certificateId }, previous);
      await hostApi.audit.record({
        action: 'provider.huawei.rollback_certificate',
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

async function discoverHuaweiCdn(runtime) {
  const payload = await callHuaweiCdn(runtime, 'GET', '/v1.0/cdn/domains');
  const items = readArray(payload, [['domains'], ['items']]);
  return buildDomainDiscovery('cloud.huawei.cdn', 'cloud.huawei.cdn.domain', items, ['domain_name', 'domain', 'Domain'], ['certificate_id', 'certificateId', 'CertId']);
}

async function discoverHuaweiElb(runtime) {
  const projectId = huaweiProjectId(runtime.asset);
  const loadBalancers = readArray(await callHuaweiElb(runtime, 'GET', `/v3/${projectId}/elb/loadbalancers`), [['loadbalancers'], ['loadBalancers'], ['items']]);
  const discovery = emptyDiscovery();
  for (const loadBalancer of loadBalancers) {
    const loadBalancerId = firstString(loadBalancer, ['loadbalancer_id', 'loadBalancerId', 'id']);
    if (!loadBalancerId) continue;
    const listeners = readArray(
      await callHuaweiElb(runtime, 'GET', `/v3/${projectId}/elb/loadbalancers/${encodeURIComponent(loadBalancerId)}/listeners`),
      [['listeners'], ['listenerList'], ['items'], ['Response', 'listeners']],
    );
    for (const listener of listeners) {
      const listenerId = firstString(listener, ['listener_id', 'listenerId', 'id']) || `${loadBalancerId}:listener`;
      const domain = firstString(listener, ['domain', 'domain_name', 'Domain']) || listenerId;
      const certificateId = firstString(listener, ['certificate_id', 'certificateId', 'certId']);
      const stableKey = `${loadBalancerId}:${listenerId}`;
      const metadata = { ...listener, loadBalancerId, listenerId, projectId, domain };
      pushFramework(discovery, 'cloud.huawei.elb');
      discovery.sites.push({
        stableKey,
        frameworkStableKey: 'cloud.huawei.elb',
        siteType: 'cloud.huawei.elb.listener',
        displayName: firstString(listener, ['name', 'listener_name', 'listenerName']) || domain,
        addresses: [domain],
        port: readNumber(listener, ['protocol_port', 'port', 'listenerPort']) || 443,
        protocol: (firstString(listener, ['protocol', 'listener_protocol', 'ListenerProtocol']) || 'HTTPS').toUpperCase(),
        metadata,
      });
      discovery.managedTargets.push({
        stableKey,
        frameworkStableKey: 'cloud.huawei.elb',
        siteStableKey: stableKey,
        targetType: 'cloud.huawei.elb.listener',
        targetKey: listenerId,
        bindingKey: domain,
        supportedCapabilities: OPERATIONS,
        executionLocations: ['CONTROL_PLANE'],
        metadata,
      });
      if (certificateId) {
        pushCertificate(discovery, certificateId, { domain, loadBalancerId, listenerId, projectId });
        discovery.certificateBindings.push({
          stableKey: `${stableKey}:${certificateId}`,
          managedTargetStableKey: stableKey,
          certificateStableKey: certificateId,
          bindingName: domain,
          metadata: { domain, loadBalancerId, listenerId, certificateId, projectId },
        });
      }
    }
  }
  return discovery;
}

async function readHuaweiTargetState(runtime, target) {
  if (target.frameworkType === 'cloud.huawei.cdn') {
    const payload = await callHuaweiCdn(runtime, 'GET', `/v1.0/cdn/configuration/domains/${encodeURIComponent(target.domain || target.resourceId)}`);
    return {
      certificateId: firstString(payload, ['certificate_id', 'certificateId', 'CertId']),
      metadata: payload,
    };
  }
  const projectId = readString(target.metadata.projectId) || huaweiProjectId(runtime.asset);
  const payload = await callHuaweiElb(
    runtime,
    'GET',
    `/v3/${projectId}/elb/loadbalancers/${encodeURIComponent(readString(target.metadata.loadBalancerId) || target.resourceId)}/listeners`,
  );
  const listeners = readArray(payload, [['listeners'], ['listenerList'], ['items'], ['Response', 'listeners']]);
  const matched = listeners.find((item) => (firstString(item, ['listener_id', 'listenerId', 'id']) || '') === (target.listenerId || target.resourceId));
  return {
    certificateId: firstString(matched || payload, ['certificate_id', 'certificateId', 'certId']),
    metadata: {
      ...(matched || {}),
      projectId,
      loadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
      listenerId: firstString(matched || {}, ['listener_id', 'listenerId', 'id']) || target.listenerId || target.resourceId,
    },
  };
}

async function applyHuaweiCertificate(runtime, target, certificate, previous = {}) {
  const certificateId = certificate.certificateId || `huawei-cert-${Date.now()}`;
  if (target.frameworkType === 'cloud.huawei.cdn') {
    const payload = await callHuaweiCdn(
      runtime,
      'PUT',
      `/v1.0/cdn/configuration/domains/${encodeURIComponent(target.domain || target.resourceId)}`,
      {
        ...(readRecord(previous.metadata) || {}),
        domain: target.domain || target.resourceId,
        certificateId,
        ...(certificate.certificatePem ? { certificatePem: certificate.certificatePem } : {}),
        ...(certificate.privateKeyPem ? { privateKeyPem: certificate.privateKeyPem } : {}),
      },
    );
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.huawei.elb') {
    const projectId = readString(target.metadata.projectId) || huaweiProjectId(runtime.asset);
    const listenerId = target.listenerId || target.resourceId;
    const payload = await callHuaweiElb(
      runtime,
      'PUT',
      `/v3/${projectId}/elb/listeners/${encodeURIComponent(listenerId)}`,
      {
        project_id: projectId,
        loadbalancer_id: readString(target.metadata.loadBalancerId) || target.resourceId,
        listener_id: listenerId,
        certificate_id: certificateId,
      },
    );
    return { certificateId, response: payload };
  }
  throw providerRuntimeError('华为云插件不支持该目标类型', { frameworkType: target.frameworkType });
}

async function callHuaweiCdn(runtime, method, path, payload) {
  const request = signHuaweiRequest({
    accessKey: required(runtime.credential, ['accessKey', 'AK']),
    secretKey: required(runtime.credential, ['secretKey', 'SK']),
    method,
    path,
    payload,
    scope: runtime.asset.scope || {},
    endpoint: scopeEndpoint(runtime.asset.scope || {}, 'https://cdn.myhuaweicloud.com'),
  });
  return assertResponse(await requestJson(runtime.hostApi, request), PROVIDER_KEY);
}

async function callHuaweiElb(runtime, method, path, payload) {
  const request = signHuaweiRequest({
    accessKey: required(runtime.credential, ['accessKey', 'AK']),
    secretKey: required(runtime.credential, ['secretKey', 'SK']),
    method,
    path,
    payload,
    scope: runtime.asset.scope || {},
    endpoint: scopeEndpoint(runtime.asset.scope || {}, 'https://elb.myhuaweicloud.com'),
  });
  return assertResponse(await requestJson(runtime.hostApi, request), PROVIDER_KEY);
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

function huaweiProjectId(asset) {
  return readString(asset.scope?.projectId) || readString(asset.scope?.enterpriseProjectId) || 'default';
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
  throw providerRuntimeError('华为云凭据缺少必要字段', { keys });
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
