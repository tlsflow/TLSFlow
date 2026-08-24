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
  signVolcengineRequest,
  scopeEndpoint,
  toRecordArray,
} from './shared.js';

const PROVIDER_KEY = 'cloud.volcengine';
const PROVIDER_NAME = '火山引擎';
const SUPPORTED_PRODUCTS = [
  'cloud.volcengine.cdn',
  'cloud.volcengine.alb',
  'cloud.volcengine.clb',
  'cloud.volcengine.live',
  'cloud.volcengine.vod',
];
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
        try {
        if (frameworkType === 'cloud.volcengine.cdn') {
          mergeDiscovery(discovery, await discoverVolcDomains(runtime, frameworkType, 'cloud.volcengine.cdn.domain', {
            service: 'cdn',
            action: 'ListCdnDomains',
            payload: { PageSize: 100 },
            paths: [['Result', 'Domains'], ['Domains'], ['domains']],
            domainFields: ['Domain', 'domain', 'DomainName'],
            certificateFields: ['CertificateId', 'certificateId', 'CertId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.volcengine.live') {
          mergeDiscovery(discovery, await discoverVolcDomains(runtime, frameworkType, 'cloud.volcengine.live.domain', {
            service: 'live',
            action: 'ListDomainDetail',
            payload: { PageNum: 1, PageSize: 100 },
            paths: [['Result', 'DomainList'], ['DomainList'], ['domains']],
            domainFields: ['Domain', 'domain', 'DomainName'],
            certificateFields: ['ChainID', 'CertificateId', 'certificateId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.volcengine.vod') {
          mergeDiscovery(discovery, await discoverVolcVod(runtime));
          continue;
        }
        if (frameworkType === 'cloud.volcengine.alb' || frameworkType === 'cloud.volcengine.clb') {
          mergeDiscovery(discovery, await discoverVolcListeners(runtime, frameworkType));
        }
        } catch (cause) {
          discovery.warnings.push(discoveryWarning(frameworkType, cause));
        }
      }
      return discovery;
    },

    async deployCertificate(context, input = {}) {
      const runtime = await buildRuntime(hostApi, context);
      const target = ensureTarget(input);
      const certificate = await resolveCertificateInput(hostApi, input);
      const previous = await readVolcTargetState(runtime, target);
      const checkpoint = await saveCheckpoint(hostApi, PROVIDER_KEY, target, previous);
      const applied = await applyVolcCertificate(runtime, target, certificate);
      await hostApi.audit.record({
        action: 'provider.volcengine.deploy_certificate',
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
      await applyVolcCertificate(runtime, target, { certificateId });
      await hostApi.audit.record({
        action: 'provider.volcengine.rollback_certificate',
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

async function discoverVolcDomains(runtime, frameworkType, targetType, definition) {
  const payload = await callVolcApi(runtime, definition.service, definition.action, definition.payload);
  const items = readArray(payload, definition.paths);
  return buildDomainDiscovery(frameworkType, targetType, items, definition.domainFields, definition.certificateFields);
}

async function discoverVolcListeners(runtime, frameworkType) {
  const service = frameworkType.endsWith('.alb') ? 'alb' : 'clb';
  const loadBalancers = readArray(
    await callVolcApi(runtime, service, 'DescribeLoadBalancers', { PageSize: 100 }),
    [['Result', 'LoadBalancers'], ['Result', 'loadBalancers'], ['LoadBalancers'], ['loadBalancers'], ['items']],
  );
  const discovery = emptyDiscovery();
  for (const loadBalancer of loadBalancers) {
    const loadBalancerId = firstString(loadBalancer, ['LoadBalancerId', 'loadBalancerId', 'id']);
    if (!loadBalancerId) continue;
    const listeners = readArray(
      await callVolcApi(runtime, service, 'DescribeListeners', { LoadBalancerId: loadBalancerId }),
      [['Result', 'Listeners'], ['Result', 'listeners'], ['Listeners'], ['listeners'], ['items']],
    );
    for (const listener of listeners) {
      const listenerId = firstString(listener, ['ListenerId', 'listenerId', 'id']) || `${loadBalancerId}:listener`;
      const domain = firstString(listener, ['Domain', 'domain', 'DomainName']) || listenerId;
      const certificateId = firstString(listener, ['CertificateId', 'certificateId', 'CertId']);
      const stableKey = `${loadBalancerId}:${listenerId}`;
      const metadata = { ...listener, loadBalancerId, listenerId, domain };
      pushFramework(discovery, frameworkType);
      discovery.sites.push({
        stableKey,
        frameworkStableKey: frameworkType,
        siteType: `cloud.volcengine.${service}.listener`,
        displayName: firstString(listener, ['ListenerName', 'listenerName', 'name']) || domain,
        addresses: [domain],
        port: readNumber(listener, ['ListenerPort', 'port', 'Port']) || 443,
        protocol: (firstString(listener, ['ListenerProtocol', 'protocol', 'Protocol']) || 'HTTPS').toUpperCase(),
        metadata,
      });
      discovery.managedTargets.push({
        stableKey,
        frameworkStableKey: frameworkType,
        siteStableKey: stableKey,
        targetType: `cloud.volcengine.${service}.listener`,
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

async function discoverVolcVod(runtime) {
  const discovery = emptyDiscovery();
  pushFramework(discovery, 'cloud.volcengine.vod');
  const spaces = readArray(await callVolcApi(runtime, 'vod', 'ListSpace', {}), [['Result'], ['spaces']]);
  for (const space of spaces) {
    const spaceName = firstString(space, ['SpaceName', 'spaceName']);
    if (!spaceName) continue;
    for (const domainType of ['vod_play', 'vod_image', 'third']) {
      const payload = await callVolcApi(runtime, 'vod', 'ListVodDomains', {
        SpaceName: spaceName,
        DomainType: domainType,
        ListCdnDomainsParam: { PageNum: 1, PageSize: 100 },
      });
      const domains = readArray(payload, [['Result', 'VodInfo', 'Domains'], ['Result', 'Domains'], ['domains']]);
      for (const domainItem of domains) {
        const domain = firstString(domainItem, ['Domain', 'domain', 'DomainName']);
        if (!domain) continue;
        const certificateId = firstString(domainItem, ['CertId', 'CertificateId', 'certificateId']);
        const stableKey = `${spaceName}:${domainType}:${domain}`;
        const metadata = { ...domainItem, spaceName, domainType };
        discovery.sites.push({
          stableKey,
          frameworkStableKey: 'cloud.volcengine.vod',
          siteType: 'cloud.volcengine.vod.domain',
          displayName: domain,
          addresses: [domain],
          port: 443,
          protocol: 'HTTPS',
          metadata,
        });
        discovery.managedTargets.push({
          stableKey,
          frameworkStableKey: 'cloud.volcengine.vod',
          siteStableKey: stableKey,
          targetType: 'cloud.volcengine.vod.domain',
          targetKey: domain,
          bindingKey: domain,
          supportedCapabilities: OPERATIONS,
          executionLocations: ['CONTROL_PLANE'],
          metadata,
        });
        if (certificateId) {
          pushCertificate(discovery, certificateId, { domain, spaceName, domainType });
          discovery.certificateBindings.push({
            stableKey: `${stableKey}:${certificateId}`,
            managedTargetStableKey: stableKey,
            certificateStableKey: certificateId,
            bindingName: domain,
            metadata: { domain, spaceName, domainType, certificateId },
          });
        }
      }
    }
  }
  return discovery;
}

async function readVolcTargetState(runtime, target) {
  if (target.frameworkType === 'cloud.volcengine.cdn') {
    const payload = await callVolcApi(runtime, 'cdn', 'GetDomainConfig', { Domain: target.domain || target.resourceId });
    return { certificateId: firstString(payload, ['CertificateId', 'certificateId', 'CertId']), metadata: payload };
  }
  if (target.frameworkType === 'cloud.volcengine.live') {
    const payload = await callVolcApi(runtime, 'live', 'ListDomainDetail', { PageNum: 1, PageSize: 100 });
    const domains = readArray(payload, [['Result', 'DomainList'], ['DomainList']]);
    const matched = domains.find((item) => (firstString(item, ['Domain', 'domain', 'DomainName']) || '') === (target.domain || target.resourceId));
    return { certificateId: firstString(matched || payload, ['ChainID', 'CertificateId', 'certificateId']), metadata: matched || payload };
  }
  if (target.frameworkType === 'cloud.volcengine.vod') {
    const payload = await callVolcApi(runtime, 'vod', 'ListVodDomains', {
      SpaceName: readString(target.metadata.spaceName),
      DomainType: readString(target.metadata.domainType),
      ListCdnDomainsParam: { PageNum: 1, PageSize: 100 },
    });
    const domains = readArray(payload, [['Result', 'VodInfo', 'Domains'], ['Result', 'Domains'], ['domains']]);
    const matched = domains.find((item) => (firstString(item, ['Domain', 'domain', 'DomainName']) || '') === (target.domain || target.resourceId));
    return { certificateId: firstString(matched || payload, ['CertId', 'CertificateId', 'certificateId']), metadata: matched || payload };
  }
  const service = target.frameworkType.endsWith('.alb') ? 'alb' : 'clb';
  const payload = await callVolcApi(runtime, service, 'DescribeListeners', {
    LoadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
  });
  const listeners = readArray(payload, [['Result', 'Listeners'], ['Result', 'listeners'], ['Listeners'], ['listeners'], ['items']]);
  const matched = listeners.find((item) => (firstString(item, ['ListenerId', 'listenerId', 'id']) || '') === (target.listenerId || target.resourceId));
  return {
    certificateId: firstString(matched || payload, ['CertificateId', 'certificateId', 'CertId']),
    metadata: {
      ...(matched || {}),
      loadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
      listenerId: firstString(matched || {}, ['ListenerId', 'listenerId', 'id']) || target.listenerId || target.resourceId,
    },
  };
}

async function applyVolcCertificate(runtime, target, certificate) {
  const certificateId = certificate.certificateId || await uploadVolcCertificate(runtime, target, certificate);
  if (target.frameworkType === 'cloud.volcengine.cdn') {
    const payload = await callVolcApi(runtime, 'cdn', 'UpdateDomainConfig', {
      Domain: target.domain || target.resourceId,
      CertificateId: certificateId,
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.volcengine.live') {
    const payload = await callVolcApi(runtime, 'live', 'BindCert', {
      Domain: target.domain || target.resourceId,
      HTTPS: true,
      ChainID: certificateId,
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.volcengine.vod') {
    const payload = await callVolcApi(runtime, 'vod', 'UpdateVodDomainConfig', {
      SpaceName: readString(target.metadata.spaceName),
      DomainType: readString(target.metadata.domainType),
      UpdateCdnConfigParam: {
        Domain: target.domain || target.resourceId,
        HTTPS: {
          Switch: true,
          CertInfo: { CertId: certificateId },
        },
      },
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.volcengine.alb' || target.frameworkType === 'cloud.volcengine.clb') {
    const service = target.frameworkType.endsWith('.alb') ? 'alb' : 'clb';
    const payload = await callVolcApi(runtime, service, 'ModifyListener', {
      LoadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
      ListenerId: target.listenerId || target.resourceId,
      CertificateId: certificateId,
    });
    return { certificateId, response: payload };
  }
  throw providerRuntimeError('火山引擎插件不支持该目标类型', { frameworkType: target.frameworkType });
}

async function uploadVolcCertificate(runtime, target, certificate) {
  if (!certificate.certificatePem || !certificate.privateKeyPem) {
    throw providerRuntimeError('火山引擎证书上传缺少 certificatePem 或 privateKeyPem', { frameworkType: target.frameworkType });
  }
  if (target.frameworkType === 'cloud.volcengine.live') {
    const payload = await callVolcApi(runtime, 'live', 'CreateCert', {
      Rsa: { Pubkey: certificate.certificatePem, Prikey: certificate.privateKeyPem },
      UseWay: 'https',
    });
    return readString(payload.ChainID) || `volc-live-cert-${Date.now()}`;
  }
  if (target.frameworkType === 'cloud.volcengine.vod') {
    const payload = await callVolcCertCenter(runtime, 'ImportCertificate', {
      Tag: `gcac-vod-${Date.now()}`,
      Repeatable: false,
      CertificateInfo: {
        CertificateChain: certificate.certificatePem,
        PrivateKey: certificate.privateKeyPem,
      },
    });
    return readString(payload.InstanceId) || readString(payload.RepeatId) || `volc-vod-cert-${Date.now()}`;
  }
  if (target.frameworkType === 'cloud.volcengine.cdn') {
    const payload = await callVolcApi(runtime, 'cdn', 'CertUpload', {
      Certificate: certificate.certificatePem,
      PrivateKey: certificate.privateKeyPem,
      ...(certificate.chainPem ? { Chain: certificate.chainPem } : {}),
    });
    return readString(readRecord(payload.Result)?.CertificateId) || readString(payload.CertificateId) || `volc-cert-${Date.now()}`;
  }
  throw providerRuntimeError('该火山引擎产品需要预先提供 certificateId', { frameworkType: target.frameworkType });
}

async function callVolcApi(runtime, service, action, payload = {}) {
  const request = signVolcengineRequest({
    accessKeyId: required(runtime.credential, ['accessKeyId', 'AccessKeyId']),
    secretAccessKey: required(runtime.credential, ['secretAccessKey', 'SecretAccessKey']),
    service,
    region: readString(runtime.asset.scope?.regions?.[0]) || 'cn-north-1',
    action,
    payload,
    scope: runtime.asset.scope || {},
    endpoint: scopeEndpoint(runtime.asset.scope || {}, 'https://open.volcengineapi.com'),
  });
  return assertResponse(await requestJson(runtime.hostApi, request), PROVIDER_KEY);
}

async function callVolcCertCenter(runtime, action, payload = {}) {
  const request = signVolcengineRequest({
    accessKeyId: required(runtime.credential, ['accessKeyId', 'AccessKeyId']),
    secretAccessKey: required(runtime.credential, ['secretAccessKey', 'SecretAccessKey']),
    service: 'certificate_service',
    region: 'cn-beijing',
    action,
    payload,
    scope: runtime.asset.scope || {},
    endpoint: scopeEndpoint(runtime.asset.scope || {}, 'https://open.volcengineapi.com'),
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

function discoveryWarning(frameworkType, cause) {
  const message = cause instanceof Error && cause.message ? cause.message : '云厂商接口不可用或当前凭据无权访问';
  return `${frameworkType}: ${message}`;
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
  throw providerRuntimeError('火山引擎凭据缺少必要字段', { keys });
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
