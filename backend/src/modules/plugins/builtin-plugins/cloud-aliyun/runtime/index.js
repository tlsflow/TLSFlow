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
  signAliyunRpc,
  toRecordArray,
} from './shared.js';

const PROVIDER_KEY = 'cloud.aliyun';
const PROVIDER_NAME = '阿里云';
const SUPPORTED_PRODUCTS = [
  'cloud.aliyun.cdn',
  'cloud.aliyun.alb',
  'cloud.aliyun.clb',
  'cloud.aliyun.oss',
  'cloud.aliyun.waf-cname',
  'cloud.aliyun.waf-cloud',
  'cloud.aliyun.live',
  'cloud.aliyun.vod',
];
const OPERATIONS = ['certificate.discover', 'certificate.deploy', 'certificate.rollback'];

export default async function createProviderPlugin({ hostApi, plugin }) {
  return {
    async testConnection(context) {
      const runtime = await buildRuntime(hostApi, context);
      return {
        ok: true,
        details: {
          providerKey: plugin.providerKey,
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
        if (frameworkType === 'cloud.aliyun.cdn') {
          mergeDiscovery(discovery, await discoverAliyunDomains(runtime, frameworkType, 'cloud.aliyun.cdn.domain', {
            action: 'DescribeUserDomains',
            version: '2018-05-10',
            endpoint: 'https://cdn.aliyuncs.com',
            params: { PageSize: 100 },
            paths: [['Domains', 'PageData'], ['Domains'], ['domains']],
            domainFields: ['DomainName', 'Domain', 'domain'],
            certificateFields: ['CertId', 'CertificateId', 'certificateId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.aliyun.live') {
          mergeDiscovery(discovery, await discoverAliyunDomains(runtime, frameworkType, 'cloud.aliyun.live.domain', {
            action: 'DescribeLiveUserDomains',
            version: '2016-11-01',
            endpoint: 'https://live.aliyuncs.com',
            params: { PageSize: 100 },
            paths: [['Domains', 'PageData'], ['Domains'], ['PageData'], ['domains']],
            domainFields: ['DomainName', 'Domain', 'domain'],
            certificateFields: ['CertId', 'CertificateId', 'certificateId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.aliyun.vod') {
          mergeDiscovery(discovery, await discoverAliyunDomains(runtime, frameworkType, 'cloud.aliyun.vod.domain', {
            action: 'DescribeVodUserDomains',
            version: '2017-03-21',
            endpoint: 'https://vod.cn-shanghai.aliyuncs.com',
            params: { PageNumber: 1, PageSize: 100 },
            paths: [['Domains', 'PageData'], ['Domains'], ['PageData'], ['domains']],
            domainFields: ['DomainName', 'Domain', 'domain'],
            certificateFields: ['CertId', 'CertificateId', 'certificateId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.aliyun.waf-cname') {
          mergeDiscovery(discovery, await discoverAliyunDomains(runtime, frameworkType, 'cloud.aliyun.waf.domain', {
            action: 'DescribeDomains',
            version: '2021-10-01',
            endpoint: wafEndpoint(runtime.asset),
            params: { RegionId: defaultAliyunRegion(runtime.asset), PageSize: 100 },
            paths: [['Domains'], ['domains']],
            domainFields: ['DomainName', 'Domain', 'domain'],
            certificateFields: ['CertId', 'CertificateId', 'certificateId'],
          }));
          continue;
        }
        if (frameworkType === 'cloud.aliyun.waf-cloud') {
          mergeDiscovery(discovery, await discoverAliyunWafCloud(runtime));
          continue;
        }
        if (frameworkType === 'cloud.aliyun.oss') {
          mergeDiscovery(discovery, await discoverAliyunOss(runtime));
          continue;
        }
        if (frameworkType === 'cloud.aliyun.alb' || frameworkType === 'cloud.aliyun.clb') {
          mergeDiscovery(discovery, await discoverAliyunListeners(runtime, frameworkType));
        }
      }
      return discovery;
    },

    async deployCertificate(context, input = {}) {
      const runtime = await buildRuntime(hostApi, context);
      const target = ensureTarget(input);
      const certificate = await resolveCertificateInput(hostApi, input);
      const previous = await readAliyunTargetState(runtime, target);
      const checkpoint = await saveCheckpoint(hostApi, PROVIDER_KEY, target, previous);
      const applied = await applyAliyunCertificate(runtime, target, certificate, previous);
      await hostApi.audit.record({
        action: 'provider.aliyun.deploy_certificate',
        status: 'SUCCESS',
        summary: { frameworkType: target.frameworkType, resourceId: target.resourceId, certificateId: applied.certificateId },
      });
      return buildOperationResult(PROVIDER_KEY, 'certificate.deploy', 'SUCCESS', {
        certificateId: applied.certificateId,
        previousCertificateId: readString(previous?.certificateId),
        checkpoint,
      }, {
        resourceRef: {
          frameworkType: target.frameworkType,
          resourceId: target.resourceId,
          certificateId: applied.certificateId,
        },
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
      await applyAliyunCertificate(runtime, target, { certificateId }, previous);
      await hostApi.audit.record({
        action: 'provider.aliyun.rollback_certificate',
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

async function discoverAliyunDomains(runtime, frameworkType, targetType, definition) {
  const payload = await callAliyunRpc(runtime, definition.action, definition.version, definition.endpoint, definition.params);
  const items = readArray(payload, definition.paths);
  return buildDomainDiscovery(runtime.asset, frameworkType, targetType, items, definition.domainFields, definition.certificateFields);
}

async function discoverAliyunListeners(runtime, frameworkType) {
  const product = frameworkType.endsWith('.alb')
    ? { actionPrefix: 'alb', version: '2020-06-16', endpoint: 'https://alb.aliyuncs.com' }
    : { actionPrefix: 'slb', version: '2014-05-15', endpoint: 'https://slb.aliyuncs.com' };
  const loadBalancers = readArray(
    await callAliyunRpc(runtime, 'DescribeLoadBalancers', product.version, product.endpoint, { PageSize: 100 }),
    [['LoadBalancers'], ['LoadBalancerSets'], ['LoadBalancerSet'], ['loadBalancers']],
  );
  const discovery = emptyDiscovery();
  for (const loadBalancer of loadBalancers) {
    const loadBalancerId = firstString(loadBalancer, ['LoadBalancerId', 'loadBalancerId', 'InstanceId']);
    if (!loadBalancerId) continue;
    const listeners = readArray(
      await callAliyunRpc(runtime, 'DescribeListeners', product.version, product.endpoint, { LoadBalancerId: loadBalancerId }),
      [['Listeners'], ['ListenerSet'], ['ListenerSets'], ['listeners'], ['Response', 'Listeners'], ['Response', 'ListenerSet']],
    );
    for (const listener of listeners) {
      const listenerId = firstString(listener, ['ListenerId', 'listenerId', 'Id']) || `${loadBalancerId}:listener`;
      const domain = firstString(listener, ['Domain', 'DomainName', 'domain']) || listenerId;
      const certificateId = firstString(listener, ['CertificateId', 'CertId', 'certificateId']);
      const stableKey = `${loadBalancerId}:${listenerId}`;
      const metadata = {
        ...listener,
        loadBalancerId,
        listenerId,
        domain,
      };
      pushFramework(discovery, frameworkType);
      discovery.sites.push({
        stableKey,
        frameworkStableKey: frameworkType,
        siteType: `${frameworkType}.listener`,
        displayName: firstString(listener, ['ListenerName', 'listenerName', 'name']) || domain,
        addresses: [domain],
        port: readNumber(listener, ['ListenerPort', 'Port', 'port']) || 443,
        protocol: (firstString(listener, ['ListenerProtocol', 'Protocol', 'protocol']) || 'HTTPS').toUpperCase(),
        metadata,
      });
      discovery.managedTargets.push({
        stableKey,
        frameworkStableKey: frameworkType,
        siteStableKey: stableKey,
        targetType: `${frameworkType}.listener`,
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

async function discoverAliyunWafCloud(runtime) {
  const regionId = defaultAliyunRegion(runtime.asset);
  const instance = await callAliyunRpc(runtime, 'DescribeInstance', '2021-10-01', wafEndpoint(runtime.asset), { RegionId: regionId });
  const instanceId = readString(instance.InstanceId) || runtime.asset.id;
  const payload = await callAliyunRpc(runtime, 'DescribeCloudResourceList', '2021-10-01', wafEndpoint(runtime.asset), {
    RegionId: regionId,
    InstanceId: instanceId,
    MaxResults: 100,
  });
  const items = readArray(payload, [['CloudResourceList'], ['cloudResourceList']]);
  const discovery = emptyDiscovery();
  for (const item of items) {
    const cloudResourceId = firstString(item, ['CloudResourceId', 'cloudResourceId']);
    if (!cloudResourceId) continue;
    const domain = firstString(item, ['Domain', 'DomainName', 'domain']) || cloudResourceId;
    const stableKey = `${cloudResourceId}:${domain}`;
    const certificateId = firstString(item, ['CertId', 'CertificateId', 'certificateId']);
    const metadata = { ...item, cloudResourceId, domain, instanceId, regionId };
    pushFramework(discovery, 'cloud.aliyun.waf-cloud');
    discovery.sites.push({
      stableKey,
      frameworkStableKey: 'cloud.aliyun.waf-cloud',
      siteType: 'cloud.aliyun.waf.resource',
      displayName: domain,
      addresses: [domain],
      port: 443,
      protocol: 'HTTPS',
      metadata,
    });
    discovery.managedTargets.push({
      stableKey,
      frameworkStableKey: 'cloud.aliyun.waf-cloud',
      siteStableKey: stableKey,
      targetType: 'cloud.aliyun.waf.resource',
      targetKey: cloudResourceId,
      bindingKey: domain,
      supportedCapabilities: OPERATIONS,
      executionLocations: ['CONTROL_PLANE'],
      metadata,
    });
    if (certificateId) {
      pushCertificate(discovery, certificateId, { domain, cloudResourceId, instanceId });
      discovery.certificateBindings.push({
        stableKey: `${stableKey}:${certificateId}`,
        managedTargetStableKey: stableKey,
        certificateStableKey: certificateId,
        bindingName: domain,
        metadata: { domain, cloudResourceId, instanceId, certificateId },
      });
    }
  }
  return discovery;
}

async function discoverAliyunOss(runtime) {
  const discovery = emptyDiscovery();
  pushFramework(discovery, 'cloud.aliyun.oss');
  const client = await createAliyunOssClient(runtime);
  const bucketResponse = await client.listBuckets({ 'max-keys': 1000 });
  const buckets = Array.isArray(bucketResponse?.buckets) ? bucketResponse.buckets.map((item) => readRecord(item)).filter(Boolean) : [];
  for (const bucket of buckets) {
    const bucketName = firstString(bucket, ['name', 'BucketName']);
    const region = firstString(bucket, ['region', 'Location']) || defaultAliyunOssRegion(runtime.asset);
    if (!bucketName) continue;
    const bucketClient = await createAliyunOssClient(runtime, bucketName, region);
    const response = await bucketClient.request(bucketClient._bucketRequestParams('GET', bucketName, { cname: '', bucket: bucketName }));
    const payload = readRecord(response?.data) || readRecord(response) || {};
    const cnames = extractAliyunOssCnames(payload);
    for (const cname of cnames) {
      const domain = firstString(cname, ['Domain', 'DomainName']) || bucketName;
      const certificateId = firstString(cname, ['CertId', 'CertificateId', 'certificateId']);
      const stableKey = `${bucketName}:${domain}`;
      const metadata = { ...cname, bucket: bucketName, region, domain };
      discovery.sites.push({
        stableKey,
        frameworkStableKey: 'cloud.aliyun.oss',
        siteType: 'cloud.aliyun.oss.domain',
        displayName: domain,
        addresses: [domain],
        port: 443,
        protocol: 'HTTPS',
        metadata,
      });
      discovery.managedTargets.push({
        stableKey,
        frameworkStableKey: 'cloud.aliyun.oss',
        siteStableKey: stableKey,
        targetType: 'cloud.aliyun.oss.domain',
        targetKey: domain,
        bindingKey: domain,
        supportedCapabilities: OPERATIONS,
        executionLocations: ['CONTROL_PLANE'],
        metadata,
      });
      if (certificateId) {
        pushCertificate(discovery, certificateId, { domain, bucket: bucketName, region });
        discovery.certificateBindings.push({
          stableKey: `${stableKey}:${certificateId}`,
          managedTargetStableKey: stableKey,
          certificateStableKey: certificateId,
          bindingName: domain,
          metadata: { domain, bucket: bucketName, region, certificateId },
        });
      }
    }
  }
  return discovery;
}

async function readAliyunTargetState(runtime, target) {
  if (target.frameworkType === 'cloud.aliyun.oss') {
    const bucket = readString(target.metadata.bucket) || target.resourceId;
    const region = readString(target.metadata.region) || defaultAliyunOssRegion(runtime.asset);
    const client = await createAliyunOssClient(runtime, bucket, region);
    const response = await client.request(client._bucketRequestParams('GET', bucket, { cname: '', bucket }));
    const payload = readRecord(response?.data) || readRecord(response) || {};
    const entry = extractAliyunOssCnames(payload).find((item) => (firstString(item, ['Domain', 'DomainName']) || '') === (target.domain || target.resourceId));
    return {
      certificateId: firstString(entry || payload, ['CertId', 'CertificateId', 'certificateId']),
      metadata: {
        bucket,
        region,
        ...(entry || payload),
      },
    };
  }
  if (target.frameworkType === 'cloud.aliyun.cdn') {
    const payload = await callAliyunRpc(runtime, 'DescribeDomainCertificateInfo', '2018-05-10', 'https://cdn.aliyuncs.com', {
      DomainName: target.domain || target.resourceId,
    });
    return { certificateId: firstString(payload, ['CertId', 'CertificateId', 'certificateId']), metadata: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.live') {
    const payload = await callAliyunRpc(runtime, 'DescribeLiveDomainDetail', '2016-11-01', 'https://live.aliyuncs.com', {
      DomainName: target.domain || target.resourceId,
    });
    return { certificateId: firstString(payload, ['CertId', 'CertificateId', 'certificateId']), metadata: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.vod') {
    const payload = await callAliyunRpc(runtime, 'DescribeVodDomainCertificateInfo', '2017-03-21', 'https://vod.cn-shanghai.aliyuncs.com', {
      DomainName: target.domain || target.resourceId,
    });
    return { certificateId: firstString(payload, ['CertId', 'CertificateId', 'certificateId']), metadata: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.waf-cname' || target.frameworkType === 'cloud.aliyun.waf-cloud') {
    const payload = await callAliyunRpc(runtime, 'DescribeDomainDetail', '2021-10-01', wafEndpoint(runtime.asset), {
      RegionId: readString(target.metadata.regionId) || defaultAliyunRegion(runtime.asset),
      Domain: target.domain || target.resourceId,
    });
    return { certificateId: firstString(payload, ['CertId', 'CertificateId', 'certificateId']), metadata: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.alb' || target.frameworkType === 'cloud.aliyun.clb') {
    const product = target.frameworkType.endsWith('.alb')
      ? { version: '2020-06-16', endpoint: 'https://alb.aliyuncs.com' }
      : { version: '2014-05-15', endpoint: 'https://slb.aliyuncs.com' };
    const payload = await callAliyunRpc(runtime, 'DescribeListeners', product.version, product.endpoint, {
      LoadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
    });
    const listeners = readArray(payload, [['Listeners'], ['ListenerSet'], ['ListenerSets'], ['listeners'], ['Response', 'Listeners'], ['Response', 'ListenerSet']]);
    const matched = listeners.find((item) => (firstString(item, ['ListenerId', 'listenerId', 'Id']) || '') === (target.listenerId || target.resourceId));
    return {
      certificateId: firstString(matched || payload, ['CertificateId', 'CertId', 'certificateId']),
      metadata: {
        ...(matched || {}),
        loadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
        listenerId: firstString(matched || {}, ['ListenerId', 'listenerId', 'Id']) || target.listenerId || target.resourceId,
      },
    };
  }
  return { metadata: {} };
}

async function applyAliyunCertificate(runtime, target, certificate, previous = {}) {
  const certificateId = certificate.certificateId || await uploadAliyunCertificate(runtime, target, certificate);
  if (target.frameworkType === 'cloud.aliyun.cdn') {
    const payload = await callAliyunRpc(runtime, 'SetDomainServerCertificate', '2018-05-10', 'https://cdn.aliyuncs.com', {
      DomainName: target.domain || target.resourceId,
      CertId: certificateId,
      ...(certificate.certificatePem ? { SSLPub: certificate.certificatePem } : {}),
      ...(certificate.privateKeyPem ? { SSLPri: certificate.privateKeyPem } : {}),
      CertType: certificate.certificatePem ? 'upload' : 'cas',
      Enable: 'on',
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.live') {
    const payload = await callAliyunRpc(runtime, 'SetLiveDomainCertificate', '2016-11-01', 'https://live.aliyuncs.com', {
      DomainName: target.domain || target.resourceId,
      CertName: readString(target.metadata.certName) || `gcac-${certificateId}`,
      SSLProtocol: 'on',
      ...(certificateId ? { CertId: certificateId, CertType: 'cas' } : {}),
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.vod') {
    const params = {
      DomainName: target.domain || target.resourceId,
      CertName: readString(target.metadata.certName) || `gcac-${certificateId}`,
      SSLProtocol: 'on',
      ...(certificate.certificatePem ? { SSLPub: certificate.certificatePem } : {}),
      ...(certificate.privateKeyPem ? { SSLPri: certificate.privateKeyPem } : {}),
      ...(certificateId && !certificate.certificatePem ? { CertId: certificateId } : {}),
    };
    const payload = await callAliyunRpc(runtime, 'SetVodDomainCertificate', '2017-03-21', 'https://vod.cn-shanghai.aliyuncs.com', params);
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.waf-cname') {
    const payload = await callAliyunRpc(runtime, 'ModifyDomain', '2021-10-01', wafEndpoint(runtime.asset), {
      RegionId: readString(target.metadata.regionId) || defaultAliyunRegion(runtime.asset),
      InstanceId: readString(target.metadata.instanceId) || target.resourceId,
      Domain: target.domain || target.resourceId,
      TLSVersion: readString(target.metadata.tlsVersion) || 'tlsv1.2',
      EnableTLSv3: target.metadata.enableTLSv3 === false ? false : true,
      Listen: JSON.stringify({
        ...(readRecord(previous.metadata?.listen) || readRecord(target.metadata.listen) || {}),
        CertId: certificateId,
        HttpsPorts: [443],
      }),
      Redirect: JSON.stringify(readRecord(previous.metadata?.redirect) || readRecord(target.metadata.redirect) || {}),
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.waf-cloud') {
    const payload = await callAliyunRpc(runtime, 'ModifyCloudResourceDefaultCert', '2021-10-01', wafEndpoint(runtime.asset), {
      RegionId: readString(target.metadata.regionId) || defaultAliyunRegion(runtime.asset),
      InstanceId: readString(target.metadata.instanceId) || target.resourceId,
      CloudResourceId: readString(target.metadata.cloudResourceId) || target.domain || target.resourceId,
      CertId: certificateId,
    });
    return { certificateId, response: payload };
  }
  if (target.frameworkType === 'cloud.aliyun.oss') {
    const bucket = readString(target.metadata.bucket) || target.resourceId;
    const region = readString(target.metadata.region) || defaultAliyunOssRegion(runtime.asset);
    const client = await createAliyunOssClient(runtime, bucket, region);
    const params = client._bucketRequestParams('POST', bucket, { cname: '', comp: 'add' });
    params.content = `\n<BucketCnameConfiguration>\n  <Cname>\n    <Domain>${target.domain || target.resourceId}</Domain>\n    <CertificateConfiguration>\n      <CertId>${certificateId}</CertId>\n      <Force>true</Force>\n    </CertificateConfiguration>\n  </Cname>\n</BucketCnameConfiguration>`;
    params.mime = 'xml';
    params.successStatuses = [200];
    const response = await client.request(params);
    return { certificateId, response: readRecord(response) || { ok: true } };
  }
  if (target.frameworkType === 'cloud.aliyun.alb' || target.frameworkType === 'cloud.aliyun.clb') {
    const product = target.frameworkType.endsWith('.alb')
      ? { version: '2020-06-16', endpoint: 'https://alb.aliyuncs.com' }
      : { version: '2014-05-15', endpoint: 'https://slb.aliyuncs.com' };
    const payload = await callAliyunRpc(runtime, 'ModifyListener', product.version, product.endpoint, {
      LoadBalancerId: readString(target.metadata.loadBalancerId) || target.resourceId,
      ListenerId: target.listenerId || target.resourceId,
      CertificateId: certificateId,
      ServerCertificateId: certificateId,
    });
    return { certificateId, response: payload };
  }
  throw providerRuntimeError('阿里云插件不支持该目标类型', { frameworkType: target.frameworkType });
}

async function uploadAliyunCertificate(runtime, target, certificate) {
  if (!certificate.certificatePem || !certificate.privateKeyPem) {
    throw providerRuntimeError('阿里云证书上传缺少 certificatePem 或 privateKeyPem', { frameworkType: target.frameworkType });
  }
  const payload = await callAliyunRpc(
    runtime,
    'UploadUserCertificate',
    '2020-04-07',
    'https://cas.aliyuncs.com',
    {
      Name: `gcac-${target.frameworkType.split('.').at(-1) || 'aliyun'}-${Date.now()}`,
      Cert: certificate.certificatePem,
      Key: certificate.privateKeyPem,
    },
    'POST',
  );
  return readString(payload.CertId) || `aliyun-cert-${Date.now()}`;
}

async function callAliyunRpc(runtime, action, version, endpoint, params = {}, method = 'GET') {
  const request = signAliyunRpc({
    accessKeyId: required(runtime.credential, ['accessKeyId', 'AccessKeyId']),
    accessKeySecret: required(runtime.credential, ['accessKeySecret', 'AccessKeySecret']),
    action,
    version,
    params,
    scope: runtime.asset.scope || {},
    endpoint,
    method,
  });
  return assertResponse(await requestJson(runtime.hostApi, request), PROVIDER_KEY);
}

async function createAliyunOssClient(runtime, bucket, region = defaultAliyunOssRegion(runtime.asset)) {
  const ossModule = await import('ali-oss');
  const OssClient = ossModule.default || ossModule;
  return new OssClient({
    accessKeyId: required(runtime.credential, ['accessKeyId', 'AccessKeyId']),
    accessKeySecret: required(runtime.credential, ['accessKeySecret', 'AccessKeySecret']),
    region,
    ...(bucket ? { bucket } : {}),
    authorizationV4: true,
  });
}

function buildDomainDiscovery(asset, frameworkType, targetType, items, domainFields, certificateFields) {
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
      pushCertificate(discovery, certificateId, { domain, providerKey: asset.providerKey });
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
  return {
    frameworks: [],
    sites: [],
    managedTargets: [],
    certificates: [],
    certificateBindings: [],
    warnings: [],
  };
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
  discovery.certificates.push({
    stableKey: certificateId,
    metadata,
  });
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
  throw providerRuntimeError('阿里云凭据缺少必要字段', { keys });
}

function defaultAliyunRegion(asset) {
  return readString(asset.scope?.regions?.[0]) || 'cn-hangzhou';
}

function defaultAliyunOssRegion(asset) {
  return readString(asset.scope?.regions?.[0]) || 'oss-cn-hangzhou';
}

function wafEndpoint(asset) {
  return scopeEndpoint(asset.scope || {}, `https://wafopenapi.${defaultAliyunRegion(asset)}.aliyuncs.com`);
}

function readArray(payload, paths) {
  for (const path of paths) {
    let current = payload;
    for (const key of path) {
      current = readRecord(current)?.[key];
    }
    const records = toRecordArray(current);
    if (records.length > 0) return records;
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

function extractAliyunOssCnames(payload) {
  if (Array.isArray(payload?.Cname)) return payload.Cname.map((item) => readRecord(item)).filter(Boolean);
  if (Array.isArray(payload?.Domains)) return payload.Domains.map((item) => readRecord(item)).filter(Boolean);
  if (Array.isArray(payload?.DomainList)) return payload.DomainList.map((item) => readRecord(item)).filter(Boolean);
  if (readRecord(payload)) return [payload];
  return [];
}
