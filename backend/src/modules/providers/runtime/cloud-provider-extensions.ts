import type { ProviderContext, ProviderTargetRef } from '../domain/provider-extension.js';
import type { ProviderExtensionDescriptor } from '../dto/providers.dto.js';
import {
  assertProviderResponse,
  isRecord,
  parseJsonResponse,
  type ProviderCredentialResolver,
  type ProviderHttpResponse,
  type ProviderTransport,
  scopeEndpoint,
  stringValue,
} from './provider-runtime.js';
import type { ProviderScope } from '../dto/providers.dto.js';
import { CloudProviderExtension, type CloudCertificateInput, type CloudTargetState, type DiscoveryTargets, type ProviderAsyncOperation } from './cloud-provider-extension.js';
import { signAliyunRpc, signHuaweiRequest, signTencentTc3, signVolcengineRequest } from './provider-signers.js';
import { ProviderAsyncWaiter, type ProviderAsyncState } from './provider-async-waiter.js';

type ListenerProductKey = 'cdn' | 'alb' | 'clb' | 'elb' | 'live' | 'vod';
type AliyunRpcProductKey = 'cdn' | 'alb' | 'slb' | 'waf' | 'live' | 'vod';

const CDN_OPERATIONAL_CAPABILITIES = ['certificate.deploy', 'certificate.verify', 'certificate.rollback'] as const;

export class AliyunProviderExtension extends CloudProviderExtension {
  constructor(credentials: ProviderCredentialResolver, transport: ProviderTransport) {
    super(descriptor('cloud.aliyun', 'aliyun', 'V4', [
      'cloud.aliyun.cdn',
      'cloud.aliyun.alb',
      'cloud.aliyun.clb',
      'cloud.aliyun.oss',
      'cloud.aliyun.waf-cname',
      'cloud.aliyun.waf-cloud',
      'cloud.aliyun.live',
      'cloud.aliyun.vod',
    ]), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const product = aliProductForAction(action);
    const request = signAliyunRpc({
      accessKeyId: required(credential, 'accessKeyId', 'AccessKeyId'),
      accessKeySecret: required(credential, 'accessKeySecret', 'AccessKeySecret'),
      action: aliActionName(action),
      version: aliVersionForAction(action),
      params: payload,
      scope: context.asset.scope,
      endpoint: aliEndpointForProduct(product, context.asset.scope),
    });
    return this.transport.request(request);
  }

  private async callCas(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const request = signAliyunRpc({
      accessKeyId: required(credential, 'accessKeyId', 'AccessKeyId'),
      accessKeySecret: required(credential, 'accessKeySecret', 'AccessKeySecret'),
      action,
      version: '2020-04-07',
      params: payload,
      scope: context.asset.scope,
      endpoint: scopeEndpoint(context.asset.scope, 'https://cas.aliyuncs.com'),
      method: 'POST',
    });
    return this.transport.request(request);
  }

  private async ossClient(context: ProviderContext, bucket?: string): Promise<any> {
    const credential = await this.credential(context);
    const oss = await import('ali-oss');
    const region = context.asset.scope.regions?.[0] ?? 'oss-cn-hangzhou';
    return new oss.default({
      accessKeyId: required(credential, 'accessKeyId', 'AccessKeyId'),
      accessKeySecret: required(credential, 'accessKeySecret', 'AccessKeySecret'),
      region,
      bucket,
      authorizationV4: true,
    });
  }

  private async discoverOssTargets(context: ProviderContext): Promise<DiscoveryTargets> {
    const client = await this.ossClient(context);
    const bucketResponse = await client.listBuckets({ 'max-keys': 1000 });
    const buckets = Array.isArray(bucketResponse?.buckets) ? bucketResponse.buckets.filter(isRecord) : [];
    const frameworkType = 'cloud.aliyun.oss';
    const sites: DiscoveryTargets['sites'] = [];
    const managedTargets: DiscoveryTargets['managedTargets'] = [];
    for (const bucket of buckets) {
      const bucketName = firstString(bucket, ['name', 'BucketName']) ?? '';
      const region = firstString(bucket, ['region', 'Location']) ?? context.asset.scope.regions?.[0] ?? 'oss-cn-hangzhou';
      if (!bucketName) continue;
      const bucketClient = await this.ossClient({ ...context, asset: { ...context.asset, scope: { ...context.asset.scope, regions: [region] } } }, bucketName);
      const cnameResponse = await bucketClient.request(bucketClient._bucketRequestParams('GET', bucketName, { cname: '', bucket: bucketName }));
      const entries = toDomainEntries(isRecord(cnameResponse?.data) ? cnameResponse.data : cnameResponse, ['Domain', 'DomainName'], ['CertId', 'CertificateId']);
      for (const entry of entries) {
        const stableKey = `${bucketName}:${entry.domain}`;
        const metadata = { ...entry.metadata, bucket: bucketName, region };
        sites.push({
          stableKey,
          frameworkStableKey: frameworkType,
          siteType: 'cloud.oss.domain',
          displayName: entry.domain,
          addresses: [entry.domain],
          port: 443,
          protocol: 'HTTPS',
          metadata,
        });
        managedTargets.push({
          stableKey,
          frameworkStableKey: frameworkType,
          siteStableKey: stableKey,
          targetType: 'cloud.aliyun.oss.domain',
          targetKey: entry.domain,
          bindingKey: entry.domain,
          supportedCapabilities: [...CDN_OPERATIONAL_CAPABILITIES],
          executionLocations: ['CONTROL_PLANE'],
          metadata,
        });
      }
    }
    return {
      frameworks: [{ stableKey: frameworkType, frameworkType, displayName: 'OSS', metadata: { providerKey: 'cloud.aliyun' } }],
      sites,
      managedTargets,
      certificates: [],
      certificateBindings: [],
    };
  }

  private async discoverWafCloudTargets(context: ProviderContext): Promise<DiscoveryTargets> {
    const regionId = context.asset.scope.regions?.[0] ?? 'cn-hangzhou';
    const instanceResponse = assertProviderResponse(await this.call(context, 'waf.DescribeInstance', { RegionId: regionId }), 'cloud.aliyun');
    const instanceId = stringValue(instanceResponse.InstanceId) ?? context.asset.id;
    const response = assertProviderResponse(await this.call(context, 'waf.DescribeCloudResourceList', {
      RegionId: regionId,
      InstanceId: instanceId,
      MaxResults: 100,
    }), 'cloud.aliyun');
    const items = arrayFrom(response, ['CloudResourceList', 'cloudResourceList']).filter(isRecord);
    const frameworkType = 'cloud.aliyun.waf-cloud';
    const sites: DiscoveryTargets['sites'] = [];
    const managedTargets: DiscoveryTargets['managedTargets'] = [];
    for (const item of items) {
      const cloudResourceId = firstString(item, ['CloudResourceId', 'cloudResourceId']) ?? '';
      if (!cloudResourceId) continue;
      const domain = firstString(item, ['Domain', 'DomainName', 'domain']) ?? cloudResourceId;
      const stableKey = `${cloudResourceId}:${domain}`;
      const metadata = { ...item, cloudResourceId, instanceId, regionId, domain };
      sites.push({
        stableKey,
        frameworkStableKey: frameworkType,
        siteType: 'cloud.waf.resource',
        displayName: domain,
        addresses: [domain],
        port: 443,
        protocol: 'HTTPS',
        metadata,
      });
      managedTargets.push({
        stableKey,
        frameworkStableKey: frameworkType,
        siteStableKey: stableKey,
        targetType: 'cloud.aliyun.waf.resource',
        targetKey: cloudResourceId,
        bindingKey: domain,
        supportedCapabilities: [...CDN_OPERATIONAL_CAPABILITIES],
        executionLocations: ['CONTROL_PLANE'],
        metadata,
      });
    }
    return {
      frameworks: [{ stableKey: frameworkType, frameworkType, displayName: 'WAF Cloud', metadata: { providerKey: 'cloud.aliyun' } }],
      sites,
      managedTargets,
      certificates: [],
      certificateBindings: [],
    };
  }

  protected async discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets> {
    const requested = selectFrameworkTypes(this.descriptor.supportedFrameworkTypes, frameworkTypes);
    const result: DiscoveryTargets = emptyDiscoveryTargets();
    for (const frameworkType of requested) {
      if (frameworkType === 'cloud.aliyun.cdn') {
        mergeDiscovery(result, cdnDiscovery('cloud.aliyun', arrayFrom(assertProviderResponse(await this.call(context, 'cdn.DescribeUserDomains', { PageSize: 50 }), 'cloud.aliyun'), ['Domains.PageData', 'Domains', 'domains'])));
        continue;
      }
      if (frameworkType === 'cloud.aliyun.alb' || frameworkType === 'cloud.aliyun.clb') {
        mergeDiscovery(result, await listenerDiscovery({
          providerKey: 'cloud.aliyun',
          frameworkType,
          listLoadBalancers: async () => arrayFrom(assertProviderResponse(await this.call(context, `${aliProductForFramework(frameworkType)}.DescribeLoadBalancers`, { PageSize: 50 }), 'cloud.aliyun'), ['LoadBalancers', 'LoadBalancerSets', 'LoadBalancerSet', 'loadBalancers']),
          listListeners: async (loadBalancerId) => arrayFrom(assertProviderResponse(await this.call(context, `${aliProductForFramework(frameworkType)}.DescribeListeners`, { LoadBalancerId: loadBalancerId }), 'cloud.aliyun'), ['Listeners', 'ListenerSet', 'ListenerSets', 'listeners', 'Response.Listeners', 'Response.ListenerSet']),
          loadBalancerIdFields: ['LoadBalancerId', 'loadBalancerId', 'InstanceId'],
          listenerIdFields: ['ListenerId', 'listenerId', 'Id'],
          loadBalancerNameFields: ['LoadBalancerName', 'loadBalancerName', 'LoadBalancerDescription', 'name'],
          listenerNameFields: ['ListenerName', 'listenerName', 'name'],
          certificateIdFields: ['CertificateId', 'CertId', 'certificateId'],
          domainFields: ['Domain', 'DomainName', 'domain'],
          portFields: ['ListenerPort', 'Port', 'port'],
          protocolFields: ['ListenerProtocol', 'Protocol', 'protocol'],
          targetType: `${frameworkType}.listener`,
        }));
        continue;
      }
      if (frameworkType === 'cloud.aliyun.live') {
        mergeDiscovery(result, await domainDiscovery({
          providerKey: 'cloud.aliyun',
          frameworkType,
          targetType: 'cloud.aliyun.live.domain',
          listDomains: async () => arrayFrom(assertProviderResponse(await this.call(context, 'live.DescribeLiveUserDomains', { PageSize: 100 }), 'cloud.aliyun'), ['Domains.PageData', 'Domains', 'PageData', 'domains']),
          domainFields: ['DomainName', 'domain', 'Domain'],
          certificateIdFields: ['CertId', 'CertificateId', 'certificateId'],
        }));
        continue;
      }
      if (frameworkType === 'cloud.aliyun.vod') {
        mergeDiscovery(result, await domainDiscovery({
          providerKey: 'cloud.aliyun',
          frameworkType,
          targetType: 'cloud.aliyun.vod.domain',
          listDomains: async () => arrayFrom(assertProviderResponse(await this.call(context, 'vod.DescribeVodUserDomains', { PageNumber: 1, PageSize: 100 }), 'cloud.aliyun'), ['Domains.PageData', 'Domains', 'PageData', 'domains']),
          domainFields: ['DomainName', 'domain', 'Domain'],
          certificateIdFields: ['CertId', 'CertificateId', 'certificateId'],
        }));
        continue;
      }
      if (frameworkType === 'cloud.aliyun.waf-cname') {
        mergeDiscovery(result, await domainDiscovery({
          providerKey: 'cloud.aliyun',
          frameworkType,
          targetType: 'cloud.aliyun.waf.domain',
          listDomains: async () => arrayFrom(assertProviderResponse(await this.call(context, 'waf.DescribeDomains', { RegionId: context.asset.scope.regions?.[0] ?? 'cn-hangzhou', PageSize: 100 }), 'cloud.aliyun'), ['Domains', 'domains']),
          domainFields: ['Domain', 'DomainName', 'domain'],
          certificateIdFields: ['CertId', 'CertificateId', 'certificateId'],
        }));
        continue;
      }
      if (frameworkType === 'cloud.aliyun.waf-cloud') {
        mergeDiscovery(result, await this.discoverWafCloudTargets(context));
        continue;
      }
      if (frameworkType === 'cloud.aliyun.oss') {
        mergeDiscovery(result, await this.discoverOssTargets(context));
        continue;
      }
    }
    return result;
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    if (target.frameworkType === 'cloud.aliyun.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.DescribeDomainCertificateInfo', { DomainName: target.domain ?? target.resourceId }), 'cloud.aliyun');
      return stateFrom(target, response);
    }
    if (target.frameworkType === 'cloud.aliyun.live') {
      const response = assertProviderResponse(await this.call(context, 'live.DescribeLiveDomainDetail', { DomainName: target.domain ?? target.resourceId }), 'cloud.aliyun');
      return stateFrom(target, response);
    }
    if (target.frameworkType === 'cloud.aliyun.vod') {
      const response = assertProviderResponse(await this.call(context, 'vod.DescribeVodDomainCertificateInfo', { DomainName: target.domain ?? target.resourceId }), 'cloud.aliyun');
      return stateFrom(target, response);
    }
    if (target.frameworkType === 'cloud.aliyun.waf-cname' || target.frameworkType === 'cloud.aliyun.waf-cloud') {
      const response = assertProviderResponse(await this.call(context, 'waf.DescribeDomainDetail', { RegionId: target.metadata?.regionId ?? context.asset.scope.regions?.[0] ?? 'cn-hangzhou', Domain: target.domain ?? target.resourceId }), 'cloud.aliyun');
      return stateFrom(target, response);
    }
    if (target.frameworkType === 'cloud.aliyun.oss') {
      const client = await this.ossClient(context, String(target.metadata?.bucket ?? target.resourceId));
      const bucket = String(target.metadata?.bucket ?? target.resourceId);
      const response = await client.request(client._bucketRequestParams('GET', bucket, { cname: '', bucket }));
      const payload = isRecord(response?.data) ? response.data : response;
      return {
        target,
        certificateId: firstString(payload, ['CertId', 'certId', 'CertificateId']),
        fingerprintSha256: firstString(payload, ['FingerprintSha256', 'fingerprintSha256']),
        metadata: payload,
      };
    }
    const product = aliProductForFramework(target.frameworkType);
    const response = assertProviderResponse(await this.call(context, `${product}.DescribeListeners`, { LoadBalancerId: target.metadata?.loadBalancerId ?? target.resourceId }), 'cloud.aliyun');
    return listenerStateFrom(target, response, {
      loadBalancerIdFields: ['LoadBalancerId', 'loadBalancerId', 'InstanceId'],
      listenerIdFields: ['ListenerId', 'listenerId', 'Id'],
      certificateIdFields: ['CertificateId', 'CertId', 'certificateId'],
      domainFields: ['Domain', 'DomainName', 'domain'],
      portFields: ['ListenerPort', 'Port', 'port'],
      protocolFields: ['ListenerProtocol', 'Protocol', 'protocol'],
      certificateListFields: ['Listeners', 'ListenerSet', 'ListenerSets', 'listeners', 'Response.Listeners', 'Response.ListenerSet'],
    });
  }

  protected async uploadCertificate(_context: ProviderContext, target: ProviderTargetRef, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    if (certificate.certificateId) return { certificateId: certificate.certificateId };
    if (!certificate.certificatePem || !certificate.privateKeyPem) {
      throw new Error('该阿里云产品需要先提供 certificateId 或证书材料');
    }
    const response = assertProviderResponse(await this.callCas(_context, 'UploadUserCertificate', {
      Name: `gcac-${target.frameworkType.split('.').at(-1) ?? 'aliyun'}-${Date.now()}`,
      Cert: certificate.certificatePem,
      Key: certificate.privateKeyPem,
    }), 'cloud.aliyun');
    return { certificateId: stringValue(response.CertId) ?? `aliyun-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, certificate: CloudCertificateInput): Promise<Record<string, unknown>> {
    if (target.frameworkType === 'cloud.aliyun.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.SetDomainServerCertificate', {
        DomainName: target.domain ?? target.resourceId,
        CertId: certificateId,
        SSLPub: certificate.certificatePem,
        SSLPri: certificate.privateKeyPem,
        CertType: 'upload',
        Enable: 'on',
      }), 'cloud.aliyun');
      return { requestId: stringValue(response.RequestId), certificateId };
    }
    if (target.frameworkType === 'cloud.aliyun.live') {
      const response = assertProviderResponse(await this.call(context, 'live.SetLiveDomainCertificate', {
        DomainName: target.domain ?? target.resourceId,
        CertName: target.metadata?.certName ?? `gcac-${certificateId}`,
        CertType: 'cas',
        SSLProtocol: 'on',
        CertId: certificateId,
      }), 'cloud.aliyun');
      return { requestId: stringValue(response.RequestId), certificateId, responseKeys: Object.keys(response).sort() };
    }
    if (target.frameworkType === 'cloud.aliyun.vod') {
      const response = assertProviderResponse(await this.call(context, 'vod.SetVodDomainCertificate', {
        DomainName: target.domain ?? target.resourceId,
        CertName: target.metadata?.certName ?? `gcac-${certificateId}`,
        SSLProtocol: 'on',
        SSLPub: certificate.certificatePem,
        SSLPri: certificate.privateKeyPem,
      }), 'cloud.aliyun');
      return { requestId: stringValue(response.RequestId), certificateId, responseKeys: Object.keys(response).sort() };
    }
    if (target.frameworkType === 'cloud.aliyun.waf-cname') {
      const response = assertProviderResponse(await this.call(context, 'waf.ModifyDomain', {
        RegionId: target.metadata?.regionId ?? context.asset.scope.regions?.[0] ?? 'cn-hangzhou',
        InstanceId: target.metadata?.instanceId ?? target.resourceId,
        Domain: target.domain ?? target.resourceId,
        TLSVersion: target.metadata?.tlsVersion ?? 'tlsv1.2',
        EnableTLSv3: target.metadata?.enableTLSv3 ?? true,
        Listen: JSON.stringify({
          ...(isRecord(target.metadata?.listen) ? target.metadata!.listen as Record<string, unknown> : {}),
          CertId: certificateId,
          HttpsPorts: [443],
        }),
        Redirect: JSON.stringify({
          ...(isRecord(target.metadata?.redirect) ? target.metadata!.redirect as Record<string, unknown> : {}),
        }),
      }), 'cloud.aliyun');
      return { requestId: stringValue(response.RequestId), certificateId, responseKeys: Object.keys(response).sort() };
    }
    if (target.frameworkType === 'cloud.aliyun.waf-cloud') {
      const response = assertProviderResponse(await this.call(context, 'waf.ModifyCloudResourceDefaultCert', {
        RegionId: target.metadata?.regionId ?? context.asset.scope.regions?.[0] ?? 'cn-hangzhou',
        InstanceId: target.metadata?.instanceId ?? target.resourceId,
        CloudResourceId: target.metadata?.cloudResourceId ?? target.domain ?? target.resourceId,
        CertId: certificateId,
      }), 'cloud.aliyun');
      return { requestId: stringValue(response.RequestId), certificateId, responseKeys: Object.keys(response).sort() };
    }
    if (target.frameworkType === 'cloud.aliyun.oss') {
      const client = await this.ossClient(context, String(target.metadata?.bucket ?? target.resourceId));
      const bucket = String(target.metadata?.bucket ?? target.resourceId);
      const params = client._bucketRequestParams('POST', bucket, { cname: '', comp: 'add' });
      params.content = `
<BucketCnameConfiguration>
  <Cname>
    <Domain>${target.domain ?? target.resourceId}</Domain>
    <CertificateConfiguration>
      <CertId>${certificateId}</CertId>
      <Force>true</Force>
    </CertificateConfiguration>
  </Cname>
</BucketCnameConfiguration>`;
      params.mime = 'xml';
      params.successStatuses = [200];
      const response = await client.request(params);
      return { certificateId, responseKeys: Object.keys(response ?? {}).sort(), domain: target.domain ?? target.resourceId };
    }
    const product = aliProductForFramework(target.frameworkType);
    const response = assertProviderResponse(await this.call(context, `${product}.ModifyListener`, {
      LoadBalancerId: target.metadata?.loadBalancerId ?? target.resourceId,
      ListenerId: target.listenerId ?? target.resourceId,
      CertificateId: certificateId,
      Domain: target.domain ?? target.metadata?.domain,
      Port: target.metadata?.port,
      Protocol: target.metadata?.protocol,
    }), 'cloud.aliyun');
    return { requestId: stringValue(response.RequestId), certificateId, responseKeys: Object.keys(response).sort() };
  }

  protected async verifyCertificate(context: ProviderContext, target: ProviderTargetRef, input: Record<string, unknown>): Promise<boolean> {
    const state = await this.readTargetState(context, target);
    return !input.certificateId || state.certificateId === input.certificateId || Boolean(state.fingerprintSha256);
  }

  protected async restoreCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<void> {
    await this.applyCertificate(context, target, certificateId, { certificateId });
  }
}

export class TencentProviderExtension extends CloudProviderExtension {
  constructor(
    credentials: ProviderCredentialResolver,
    transport: ProviderTransport,
    private readonly asyncWaiter = new ProviderAsyncWaiter(),
  ) {
    super(descriptor('cloud.tencent', 'tencent', 'V4', ['cloud.tencent.cdn', 'cloud.tencent.clb', 'cloud.tencent.live']), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const product = tencentProductForAction(action);
    const request = signTencentTc3({
      secretId: required(credential, 'secretId', 'SecretId'),
      secretKey: required(credential, 'secretKey', 'SecretKey'),
      service: product,
      action: tencentActionName(action),
      version: tencentVersionForAction(action),
      region: context.asset.scope.regions?.[0],
      payload,
      scope: context.asset.scope,
      endpoint: tencentEndpointForProduct(product, context.asset.scope),
    });
    return this.transport.request(request);
  }

  private async callSsl(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const request = signTencentTc3({
      secretId: required(credential, 'secretId', 'SecretId'),
      secretKey: required(credential, 'secretKey', 'SecretKey'),
      service: 'ssl',
      action,
      version: '2019-12-05',
      payload,
      scope: context.asset.scope,
      endpoint: scopeEndpoint(context.asset.scope, 'https://ssl.tencentcloudapi.com'),
    });
    return this.transport.request(request);
  }

  protected async discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets> {
    const requested = selectFrameworkTypes(this.descriptor.supportedFrameworkTypes, frameworkTypes);
    const result: DiscoveryTargets = emptyDiscoveryTargets();
    for (const frameworkType of requested) {
      if (frameworkType === 'cloud.tencent.cdn') {
        mergeDiscovery(result, cdnDiscovery('cloud.tencent', arrayFrom(assertProviderResponse(await this.call(context, 'cdn.DescribeDomains', { Limit: 100 }), 'cloud.tencent'), ['Response.Domains', 'Domains', 'domains'])));
        continue;
      }
      if (frameworkType === 'cloud.tencent.clb') {
        mergeDiscovery(result, await listenerDiscovery({
          providerKey: 'cloud.tencent',
          frameworkType,
          listLoadBalancers: async () => arrayFrom(assertProviderResponse(await this.call(context, 'clb.DescribeLoadBalancers', { Limit: 100 }), 'cloud.tencent'), ['Response.LoadBalancerSet', 'Response.LoadBalancers', 'LoadBalancerSet', 'LoadBalancers', 'loadBalancers']),
          listListeners: async (loadBalancerId) => arrayFrom(assertProviderResponse(await this.call(context, 'clb.DescribeListeners', { LoadBalancerId: loadBalancerId }), 'cloud.tencent'), ['Response.ListenerSet', 'Response.Listeners', 'ListenerSet', 'Listeners', 'listeners']),
          loadBalancerIdFields: ['LoadBalancerId', 'loadBalancerId', 'instanceId'],
          listenerIdFields: ['ListenerId', 'listenerId', 'id'],
          loadBalancerNameFields: ['LoadBalancerName', 'loadBalancerName', 'name'],
          listenerNameFields: ['ListenerName', 'listenerName', 'name'],
          certificateIdFields: ['CertificateId', 'certId', 'CertId', 'certificateId'],
          domainFields: ['Domain', 'domain', 'DomainName'],
          portFields: ['ListenerPort', 'port', 'Port'],
          protocolFields: ['Protocol', 'protocol', 'ListenerProtocol'],
          targetType: 'cloud.tencent.clb.listener',
        }));
        continue;
      }
      if (frameworkType === 'cloud.tencent.live') {
        mergeDiscovery(result, await domainDiscovery({
          providerKey: 'cloud.tencent',
          frameworkType,
          targetType: 'cloud.tencent.live.domain',
          listDomains: async () => arrayFrom(assertProviderResponse(await this.call(context, 'live.DescribeLiveDomains', { PageSize: 100 }), 'cloud.tencent'), ['DomainList', 'Response.DomainList', 'domains']),
          domainFields: ['Name', 'DomainName', 'domain'],
          certificateIdFields: ['CloudCertId', 'CertId', 'CertificateId'],
        }));
      }
    }
    return result;
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    if (target.frameworkType === 'cloud.tencent.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.DescribeDomains', { Filters: [{ Name: 'domain', Value: [target.domain ?? target.resourceId] }] }), 'cloud.tencent');
      return stateFrom(target, response);
    }
    if (target.frameworkType === 'cloud.tencent.live') {
      const response = assertProviderResponse(await this.call(context, 'live.DescribeLiveDomains', { PageSize: 100 }), 'cloud.tencent');
      return stateFromDomainArray(target, response, ['DomainList', 'Response.DomainList'], ['Name', 'DomainName', 'domain'], ['CloudCertId', 'CertId', 'CertificateId']);
    }
    const response = assertProviderResponse(await this.call(context, 'clb.DescribeListeners', { LoadBalancerId: target.metadata?.loadBalancerId ?? target.resourceId }), 'cloud.tencent');
    return listenerStateFrom(target, response, {
      loadBalancerIdFields: ['LoadBalancerId', 'loadBalancerId', 'instanceId'],
      listenerIdFields: ['ListenerId', 'listenerId', 'id'],
      certificateIdFields: ['CertificateId', 'certId', 'CertId', 'certificateId'],
      domainFields: ['Domain', 'domain', 'DomainName'],
      portFields: ['ListenerPort', 'port', 'Port'],
      protocolFields: ['Protocol', 'protocol', 'ListenerProtocol'],
      certificateListFields: ['Response.ListenerSet', 'Response.Listeners', 'ListenerSet', 'Listeners', 'listeners'],
    });
  }

  protected async uploadCertificate(_context: ProviderContext, target: ProviderTargetRef, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    if (certificate.certificateId) return { certificateId: certificate.certificateId };
    if (target.frameworkType === 'cloud.tencent.live') {
      const response = assertProviderResponse(await this.callSsl(_context, 'UploadCertificate', {
        CertificatePublicKey: certificate.certificatePem,
        CertificatePrivateKey: certificate.privateKeyPem,
        Alias: `gcac-live-${Date.now()}`,
      }), 'cloud.tencent');
      return { certificateId: stringValue(response.CertificateId) ?? `tencent-cert-${Date.now()}` };
    }
    if (target.frameworkType !== 'cloud.tencent.cdn') {
      throw new Error('该腾讯云产品需要先提供 certificateId');
    }
    const response = await this.call(_context, 'cdn.UploadCertificate', {
      Certificate: certificate.certificatePem,
      PrivateKey: certificate.privateKeyPem,
      CertificateChain: certificate.chainPem,
    });
    const payload = assertProviderResponse(response, 'cloud.tencent');
    return { certificateId: stringValue(payload.CertificateId) ?? `tencent-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<Record<string, unknown>> {
    if (target.frameworkType === 'cloud.tencent.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.ModifyDomainConfig', {
        Domain: target.domain ?? target.resourceId,
        Certificate: { CertId: certificateId },
      }), 'cloud.tencent');
      const nested = isRecord(response.Response) ? response.Response : undefined;
      const taskId = stringValue(response.TaskId)
        ?? stringValue(response.JobId)
        ?? stringValue(nested?.TaskId)
        ?? stringValue(nested?.JobId);
      return {
        requestId: stringValue(response.RequestId) ?? stringValue(nested?.RequestId),
        certificateId,
        ...(taskId ? { asyncOperation: { operationId: taskId, status: 'RUNNING' } } : {}),
      };
    }
    if (target.frameworkType === 'cloud.tencent.live') {
      const response = assertProviderResponse(await this.call(context, 'live.ModifyLiveDomainCertBindings', {
        DomainInfos: [{ DomainName: target.domain ?? target.resourceId, Status: -1 }],
        CloudCertId: certificateId,
      }), 'cloud.tencent');
      return { requestId: stringValue(response.RequestId), certificateId, responseKeys: Object.keys(response).sort() };
    }
    const response = assertProviderResponse(await this.call(context, 'clb.ModifyListener', {
      LoadBalancerId: target.metadata?.loadBalancerId ?? target.resourceId,
      ListenerId: target.listenerId ?? target.resourceId,
      CertificateId: certificateId,
    }), 'cloud.tencent');
    return { requestId: stringValue(response.RequestId) ?? stringValue(readRecord(response.Response)?.RequestId), certificateId };
  }

  protected async waitForAsyncOperation(
    context: ProviderContext,
    target: ProviderTargetRef,
    operation: ProviderAsyncOperation,
  ): Promise<ProviderAsyncState> {
    const timeoutMs = scopeNumber(context.asset.scope, 'providerAsyncTimeoutMs', 120_000);
    const pollIntervalMs = scopeNumber(context.asset.scope, 'providerAsyncPollIntervalMs', 1_000);
    return this.asyncWaiter.wait({
      providerKey: context.asset.providerKey,
      operationId: operation.operationId,
      timeoutMs,
      pollIntervalMs,
      readState: async () => {
        const response = assertProviderResponse(await this.call(context, 'cdn.DescribeDomainConfig', {
          Domain: target.domain ?? target.resourceId,
          TaskId: operation.operationId,
        }), 'cloud.tencent');
        return { status: providerAsyncStatus(response), detail: response };
      },
    });
  }

  protected async verifyCertificate(context: ProviderContext, target: ProviderTargetRef, input: Record<string, unknown>): Promise<boolean> {
    const state = await this.readTargetState(context, target);
    return !input.certificateId || state.certificateId === input.certificateId || Boolean(state.fingerprintSha256);
  }

  protected async restoreCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<void> {
    await this.applyCertificate(context, target, certificateId);
  }
}

export class HuaweiProviderExtension extends CloudProviderExtension {
  constructor(credentials: ProviderCredentialResolver, transport: ProviderTransport) {
    super(descriptor('cloud.huawei', 'huawei', 'HMAC', ['cloud.huawei.cdn', 'cloud.huawei.elb']), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const product = huaweiProductForAction(action);
    const projectId = context.asset.scope.projectId ?? context.asset.scope.enterpriseProjectId ?? 'default';
    const path = product === 'elb'
      ? huaweiElbPath(action, projectId, payload, context)
      : action === 'connection'
        ? '/v1.0/cdn/domains'
        : `/v1.0/cdn/configuration/domains/${encodeURIComponent(String(payload.domain ?? ''))}`;
    const request = signHuaweiRequest({
      accessKey: required(credential, 'accessKey', 'AK'),
      secretKey: required(credential, 'secretKey', 'SK'),
      method: huaweiMethodForAction(action),
      path,
      payload,
      scope: context.asset.scope,
      endpoint: product === 'elb' ? huaweiElbEndpoint(context.asset.scope) : undefined,
    });
    return this.transport.request(request);
  }

  protected async discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets> {
    const requested = selectFrameworkTypes(this.descriptor.supportedFrameworkTypes, frameworkTypes);
    const result: DiscoveryTargets = emptyDiscoveryTargets();
    for (const frameworkType of requested) {
      if (frameworkType === 'cloud.huawei.cdn') {
        mergeDiscovery(result, cdnDiscovery('cloud.huawei', arrayFrom(assertProviderResponse(await this.call(context, 'connection'), 'cloud.huawei'), ['domains', 'items'])));
        continue;
      }
      if (frameworkType === 'cloud.huawei.elb') {
        mergeDiscovery(result, await listenerDiscovery({
          providerKey: 'cloud.huawei',
          frameworkType,
          listLoadBalancers: async () => arrayFrom(assertProviderResponse(await this.call(context, 'elb.describeLoadBalancers', { project_id: context.asset.scope.projectId ?? context.asset.scope.enterpriseProjectId }), 'cloud.huawei'), ['loadbalancers', 'loadBalancers', 'items']),
          listListeners: async (loadBalancerId) => arrayFrom(assertProviderResponse(await this.call(context, 'elb.describeListeners', { project_id: context.asset.scope.projectId ?? context.asset.scope.enterpriseProjectId, loadbalancer_id: loadBalancerId }), 'cloud.huawei'), ['listeners', 'listenerList', 'items', 'Response.listeners']),
          loadBalancerIdFields: ['loadbalancer_id', 'loadBalancerId', 'id'],
          listenerIdFields: ['listener_id', 'listenerId', 'id'],
          loadBalancerNameFields: ['name', 'loadbalancer_name', 'loadBalancerName'],
          listenerNameFields: ['name', 'listener_name', 'listenerName'],
          certificateIdFields: ['certificate_id', 'certificateId', 'certId'],
          domainFields: ['domain', 'domain_name', 'Domain'],
          portFields: ['protocol_port', 'port', 'listenerPort'],
          protocolFields: ['protocol', 'listener_protocol', 'ListenerProtocol'],
          targetType: 'cloud.huawei.elb.listener',
        }));
      }
    }
    return result;
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    if (target.frameworkType === 'cloud.huawei.cdn') {
      const response = assertProviderResponse(await this.call(context, 'read', { domain: target.domain ?? target.resourceId }), 'cloud.huawei');
      return stateFrom(target, response);
    }
    const projectId = context.asset.scope.projectId ?? context.asset.scope.enterpriseProjectId ?? 'default';
    const response = assertProviderResponse(await this.call(context, 'elb.describeListeners', { project_id: projectId, loadbalancer_id: target.metadata?.loadBalancerId ?? target.resourceId }), 'cloud.huawei');
    return listenerStateFrom(target, response, {
      loadBalancerIdFields: ['loadbalancer_id', 'loadBalancerId', 'id'],
      listenerIdFields: ['listener_id', 'listenerId', 'id'],
      certificateIdFields: ['certificate_id', 'certificateId', 'certId'],
      domainFields: ['domain', 'domain_name', 'Domain'],
      portFields: ['protocol_port', 'port', 'listenerPort'],
      protocolFields: ['protocol', 'listener_protocol', 'ListenerProtocol'],
      certificateListFields: ['listeners', 'listenerList', 'items', 'Response.listeners'],
    });
  }

  protected async uploadCertificate(_context: ProviderContext, target: ProviderTargetRef, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    if (certificate.certificateId) return { certificateId: certificate.certificateId };
    if (target.frameworkType !== 'cloud.huawei.cdn') {
      throw new Error('该华为云产品需要先提供 certificateId');
    }
    return { certificateId: `huawei-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, certificate: CloudCertificateInput, previous: CloudTargetState): Promise<Record<string, unknown>> {
    if (target.frameworkType === 'cloud.huawei.cdn') {
      const response = assertProviderResponse(await this.call(context, 'write', {
        domain: target.domain ?? target.resourceId,
        ...previous.metadata,
        certificateId,
        certificatePem: certificate.certificatePem,
        privateKeyPem: certificate.privateKeyPem,
      }), 'cloud.huawei');
      return { certificateId, preservedFields: Object.keys(previous.metadata ?? {}).sort(), responseKeys: Object.keys(response).sort() };
    }
    const projectId = context.asset.scope.projectId ?? context.asset.scope.enterpriseProjectId ?? 'default';
    const response = assertProviderResponse(await this.call(context, 'elb.modifyListener', {
      project_id: projectId,
      loadbalancer_id: target.metadata?.loadBalancerId ?? target.resourceId,
      listener_id: target.listenerId ?? target.resourceId,
      certificate_id: certificateId,
    }), 'cloud.huawei');
    return { certificateId, responseKeys: Object.keys(response).sort() };
  }

  protected async verifyCertificate(context: ProviderContext, target: ProviderTargetRef, input: Record<string, unknown>): Promise<boolean> {
    const state = await this.readTargetState(context, target);
    return !input.certificateId || state.certificateId === input.certificateId || Boolean(state.fingerprintSha256);
  }

  protected async restoreCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, previous: CloudTargetState): Promise<void> {
    if (target.frameworkType === 'cloud.huawei.cdn') {
      await this.call(context, 'write', { domain: target.domain ?? target.resourceId, ...(previous.metadata ?? {}), certificateId });
      return;
    }
    const projectId = context.asset.scope.projectId ?? context.asset.scope.enterpriseProjectId ?? 'default';
    await this.call(context, 'elb.modifyListener', {
      project_id: projectId,
      loadbalancer_id: target.metadata?.loadBalancerId ?? target.resourceId,
      listener_id: target.listenerId ?? target.resourceId,
      certificate_id: certificateId,
    });
  }
}

export class VolcengineProviderExtension extends CloudProviderExtension {
  constructor(credentials: ProviderCredentialResolver, transport: ProviderTransport) {
    super(descriptor('cloud.volcengine', 'volcengine', 'HMAC', [
      'cloud.volcengine.cdn',
      'cloud.volcengine.alb',
      'cloud.volcengine.clb',
      'cloud.volcengine.live',
      'cloud.volcengine.vod',
    ]), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const product = volcProductForAction(action);
    const request = signVolcengineRequest({
      accessKeyId: required(credential, 'accessKeyId', 'AccessKeyId'),
      secretAccessKey: required(credential, 'secretAccessKey', 'SecretAccessKey'),
      service: product,
      region: context.asset.scope.regions?.[0],
      action: volcActionName(action),
      payload,
      scope: context.asset.scope,
      endpoint: volcEndpointForProduct(product, context.asset.scope),
    });
    return this.transport.request(request);
  }

  private async callCertCenter(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const request = signVolcengineRequest({
      accessKeyId: required(credential, 'accessKeyId', 'AccessKeyId'),
      secretAccessKey: required(credential, 'secretAccessKey', 'SecretAccessKey'),
      service: 'certificate_service',
      region: 'cn-beijing',
      action,
      payload,
      scope: context.asset.scope,
      endpoint: scopeEndpoint(context.asset.scope, 'https://open.volcengineapi.com'),
    });
    return this.transport.request(request);
  }

  private async discoverVodTargets(context: ProviderContext): Promise<DiscoveryTargets> {
    const frameworkType = 'cloud.volcengine.vod';
    const frameworks = [{ stableKey: frameworkType, frameworkType, displayName: 'VOD', metadata: { providerKey: 'cloud.volcengine' } }];
    const sites: DiscoveryTargets['sites'] = [];
    const managedTargets: DiscoveryTargets['managedTargets'] = [];
    const certificates: DiscoveryTargets['certificates'] = [];
    const certificateBindings: DiscoveryTargets['certificateBindings'] = [];
    const spaces = arrayFrom(assertProviderResponse(await this.call(context, 'vod.ListSpace', {}), 'cloud.volcengine'), ['Result', 'spaces']).filter(isRecord);
    for (const space of spaces) {
      const spaceName = firstString(space, ['SpaceName', 'spaceName']) ?? '';
      if (!spaceName) continue;
      for (const domainType of ['vod_play', 'vod_image', 'third']) {
        const response = assertProviderResponse(await this.call(context, 'vod.ListVodDomains', {
          SpaceName: spaceName,
          DomainType: domainType,
          ListCdnDomainsParam: { PageNum: 1, PageSize: 100 },
        }), 'cloud.volcengine');
        const domains = arrayFrom(response, ['Result.VodInfo.Domains', 'Result.Domains', 'domains']).filter(isRecord);
        for (const domainItem of domains) {
          const domain = firstString(domainItem, ['Domain', 'domain', 'DomainName']) ?? '';
          if (!domain) continue;
          const certificateId = firstString(domainItem, ['CertId', 'CertificateId', 'certificateId']);
          const stableKey = `${spaceName}:${domainType}:${domain}`;
          const metadata = { ...domainItem, spaceName, domainType };
          sites.push({
            stableKey,
            frameworkStableKey: frameworkType,
            siteType: 'cloud.volcengine.vod.domain',
            displayName: domain,
            addresses: [domain],
            port: 443,
            protocol: 'HTTPS',
            metadata,
          });
          managedTargets.push({
            stableKey,
            frameworkStableKey: frameworkType,
            siteStableKey: stableKey,
            targetType: 'cloud.volcengine.vod.domain',
            targetKey: domain,
            bindingKey: domain,
            supportedCapabilities: [...CDN_OPERATIONAL_CAPABILITIES],
            executionLocations: ['CONTROL_PLANE'],
            metadata,
          });
          if (certificateId) {
            certificates.push({ stableKey: certificateId, certificateId, displayName: certificateId, metadata: { domain, spaceName, domainType, certificateId } });
            certificateBindings.push({
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
    return { frameworks, sites, managedTargets, certificates, certificateBindings };
  }

  protected async discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets> {
    const requested = selectFrameworkTypes(this.descriptor.supportedFrameworkTypes, frameworkTypes);
    const result: DiscoveryTargets = emptyDiscoveryTargets();
    for (const frameworkType of requested) {
      if (frameworkType === 'cloud.volcengine.cdn') {
        mergeDiscovery(result, cdnDiscovery('cloud.volcengine', arrayFrom(assertProviderResponse(await this.call(context, 'cdn.ListCdnDomains', { PageSize: 100 }), 'cloud.volcengine'), ['Result.Domains', 'Domains', 'domains'])));
        continue;
      }
      if (frameworkType === 'cloud.volcengine.alb' || frameworkType === 'cloud.volcengine.clb') {
        const product = frameworkType.endsWith('.alb') ? 'alb' : 'clb';
        mergeDiscovery(result, await listenerDiscovery({
          providerKey: 'cloud.volcengine',
          frameworkType,
          listLoadBalancers: async () => arrayFrom(assertProviderResponse(await this.call(context, `${product}.DescribeLoadBalancers`, { PageSize: 100 }), 'cloud.volcengine'), ['Result.LoadBalancers', 'Result.loadBalancers', 'LoadBalancers', 'loadBalancers', 'items']),
          listListeners: async (loadBalancerId) => arrayFrom(assertProviderResponse(await this.call(context, `${product}.DescribeListeners`, { LoadBalancerId: loadBalancerId }), 'cloud.volcengine'), ['Result.Listeners', 'Result.listeners', 'Listeners', 'listeners', 'items']),
          loadBalancerIdFields: ['LoadBalancerId', 'loadBalancerId', 'id'],
          listenerIdFields: ['ListenerId', 'listenerId', 'id'],
          loadBalancerNameFields: ['LoadBalancerName', 'loadBalancerName', 'name'],
          listenerNameFields: ['ListenerName', 'listenerName', 'name'],
          certificateIdFields: ['CertificateId', 'certificateId', 'CertId'],
          domainFields: ['Domain', 'domain', 'DomainName'],
          portFields: ['ListenerPort', 'port', 'Port'],
          protocolFields: ['ListenerProtocol', 'protocol', 'Protocol'],
          targetType: `cloud.volcengine.${product}.listener`,
        }));
        continue;
      }
      if (frameworkType === 'cloud.volcengine.live') {
        mergeDiscovery(result, await domainDiscovery({
          providerKey: 'cloud.volcengine',
          frameworkType,
          targetType: 'cloud.volcengine.live.domain',
          listDomains: async () => arrayFrom(assertProviderResponse(await this.call(context, 'live.ListDomainDetail', { PageNum: 1, PageSize: 100 }), 'cloud.volcengine'), ['Result.DomainList', 'DomainList', 'domains']),
          domainFields: ['Domain', 'domain', 'DomainName'],
          certificateIdFields: ['ChainID', 'CertificateId', 'certificateId'],
        }));
        continue;
      }
      if (frameworkType === 'cloud.volcengine.vod') {
        mergeDiscovery(result, await this.discoverVodTargets(context));
      }
    }
    return result;
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    if (target.frameworkType === 'cloud.volcengine.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.GetDomainConfig', { Domain: target.domain ?? target.resourceId }), 'cloud.volcengine');
      return stateFrom(target, response);
    }
    if (target.frameworkType === 'cloud.volcengine.live') {
      const response = assertProviderResponse(await this.call(context, 'live.ListDomainDetail', { PageNum: 1, PageSize: 100 }), 'cloud.volcengine');
      return stateFromDomainArray(target, response, ['Result.DomainList', 'DomainList'], ['Domain', 'domain', 'DomainName'], ['ChainID', 'CertificateId', 'certificateId']);
    }
    if (target.frameworkType === 'cloud.volcengine.vod') {
      const response = assertProviderResponse(await this.call(context, 'vod.ListVodDomains', {
        SpaceName: target.metadata?.spaceName,
        DomainType: target.metadata?.domainType,
        ListCdnDomainsParam: { PageNum: 1, PageSize: 100 },
      }), 'cloud.volcengine');
      return stateFromDomainArray(target, response, ['Result.VodInfo.Domains', 'Result.Domains', 'domains'], ['Domain', 'domain', 'DomainName'], ['CertId', 'CertificateId', 'certificateId']);
    }
    const product = target.frameworkType.endsWith('.alb') ? 'alb' : 'clb';
    const response = assertProviderResponse(await this.call(context, `${product}.DescribeListeners`, { LoadBalancerId: target.metadata?.loadBalancerId ?? target.resourceId }), 'cloud.volcengine');
    return listenerStateFrom(target, response, {
      loadBalancerIdFields: ['LoadBalancerId', 'loadBalancerId', 'id'],
      listenerIdFields: ['ListenerId', 'listenerId', 'id'],
      certificateIdFields: ['CertificateId', 'certificateId', 'CertId'],
      domainFields: ['Domain', 'domain', 'DomainName'],
      portFields: ['ListenerPort', 'port', 'Port'],
      protocolFields: ['ListenerProtocol', 'protocol', 'Protocol'],
      certificateListFields: ['Result.Listeners', 'Result.listeners', 'Listeners', 'listeners', 'items'],
    });
  }

  protected async uploadCertificate(_context: ProviderContext, target: ProviderTargetRef, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    if (certificate.certificateId) return { certificateId: certificate.certificateId };
    if (target.frameworkType === 'cloud.volcengine.live') {
      const response = assertProviderResponse(await this.call(_context, 'live.CreateCert', {
        Rsa: { Pubkey: certificate.certificatePem, Prikey: certificate.privateKeyPem },
        UseWay: 'https',
      }), 'cloud.volcengine');
      const nested = isRecord(response.Result) ? response.Result : response;
      return { certificateId: stringValue(nested.ChainID) ?? `volc-live-cert-${Date.now()}` };
    }
    if (target.frameworkType === 'cloud.volcengine.vod') {
      const response = assertProviderResponse(await this.callCertCenter(_context, 'ImportCertificate', {
        Tag: `gcac-vod-${Date.now()}`,
        Repeatable: false,
        CertificateInfo: {
          CertificateChain: certificate.certificatePem,
          PrivateKey: certificate.privateKeyPem,
        },
      }), 'cloud.volcengine');
      const nested = isRecord(response.Result) ? response.Result : response;
      return { certificateId: stringValue(nested.InstanceId) ?? stringValue(nested.RepeatId) ?? `volc-vod-cert-${Date.now()}` };
    }
    if (target.frameworkType !== 'cloud.volcengine.cdn') {
      throw new Error('该火山引擎产品需要先提供 certificateId');
    }
    const response = assertProviderResponse(await this.call(_context, 'cdn.CertUpload', {
      Certificate: certificate.certificatePem,
      PrivateKey: certificate.privateKeyPem,
      Chain: certificate.chainPem,
    }), 'cloud.volcengine');
    return { certificateId: stringValue(response.Result && isRecord(response.Result) ? response.Result.CertificateId : undefined) ?? `volc-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<Record<string, unknown>> {
    if (target.frameworkType === 'cloud.volcengine.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.UpdateDomainConfig', {
        Domain: target.domain ?? target.resourceId,
        CertificateId: certificateId,
      }), 'cloud.volcengine');
      return { certificateId, responseKeys: Object.keys(response).sort() };
    }
    if (target.frameworkType === 'cloud.volcengine.live') {
      const response = assertProviderResponse(await this.call(context, 'live.BindCert', {
        Domain: target.domain ?? target.resourceId,
        HTTPS: true,
        ChainID: certificateId,
      }), 'cloud.volcengine');
      return { certificateId, responseKeys: Object.keys(response).sort() };
    }
    if (target.frameworkType === 'cloud.volcengine.vod') {
      const response = assertProviderResponse(await this.call(context, 'vod.UpdateVodDomainConfig', {
        SpaceName: target.metadata?.spaceName,
        DomainType: target.metadata?.domainType,
        UpdateCdnConfigParam: {
          Domain: target.domain ?? target.resourceId,
          HTTPS: {
            Switch: true,
            CertInfo: { CertId: certificateId },
          },
        },
      }), 'cloud.volcengine');
      return { certificateId, responseKeys: Object.keys(response).sort() };
    }
    const product = target.frameworkType.endsWith('.alb') ? 'alb' : 'clb';
    const response = assertProviderResponse(await this.call(context, `${product}.ModifyListener`, {
      LoadBalancerId: target.metadata?.loadBalancerId ?? target.resourceId,
      ListenerId: target.listenerId ?? target.resourceId,
      CertificateId: certificateId,
    }), 'cloud.volcengine');
    return { certificateId, responseKeys: Object.keys(response).sort() };
  }

  protected async verifyCertificate(context: ProviderContext, target: ProviderTargetRef, input: Record<string, unknown>): Promise<boolean> {
    const state = await this.readTargetState(context, target);
    return !input.certificateId || state.certificateId === input.certificateId || Boolean(state.fingerprintSha256);
  }

  protected async restoreCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<void> {
    await this.applyCertificate(context, target, certificateId);
  }
}

function descriptor(providerKey: string, name: string, signerType: 'V4' | 'HMAC', products: string[]): ProviderExtensionDescriptor {
  return {
    extensionKey: `gcac.provider-extension.${name}`,
    providerKey,
    version: '1.0.0',
    signerType,
    supportedFrameworkTypes: products,
    supportedOperations: ['provider.connection.test', 'provider.discovery', 'certificate.discover', 'certificate.deploy', 'certificate.verify', 'certificate.rollback'],
    trusted: true,
  };
}

function required(values: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    if (values[key]?.trim()) return values[key]!.trim();
  }
  throw new Error(`Provider credential field missing: ${keys.join('/')}`);
}

function aliProductForFramework(frameworkType: string): 'alb' | 'slb' {
  return frameworkType.endsWith('.alb') ? 'alb' : 'slb';
}

function aliProductForAction(action: string): AliyunRpcProductKey {
  if (action.startsWith('alb.')) return 'alb';
  if (action.startsWith('slb.')) return 'slb';
  if (action.startsWith('waf.')) return 'waf';
  if (action.startsWith('live.')) return 'live';
  if (action.startsWith('vod.')) return 'vod';
  return 'cdn';
}

function aliActionName(action: string): string {
  return action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
}

function aliVersionForAction(action: string): string {
  if (action.startsWith('alb.')) return '2020-06-16';
  if (action.startsWith('slb.')) return '2014-05-15';
  if (action.startsWith('waf.')) return '2021-10-01';
  if (action.startsWith('live.')) return '2016-11-01';
  if (action.startsWith('vod.')) return '2017-03-21';
  return '2018-05-10';
}

function aliEndpointForProduct(product: AliyunRpcProductKey, scope: ProviderScope): string {
  if (product === 'alb') return scopeEndpoint(scope, 'https://alb.aliyuncs.com');
  if (product === 'slb') return scopeEndpoint(scope, 'https://slb.aliyuncs.com');
  if (product === 'waf') return scopeEndpoint(scope, `https://wafopenapi.${scope.regions?.[0] ?? 'cn-hangzhou'}.aliyuncs.com`);
  if (product === 'live') return scopeEndpoint(scope, 'https://live.aliyuncs.com');
  if (product === 'vod') return scopeEndpoint(scope, 'https://vod.cn-shanghai.aliyuncs.com');
  return scopeEndpoint(scope, 'https://cdn.aliyuncs.com');
}

function tencentProductForAction(action: string): ListenerProductKey {
  if (action.startsWith('clb.')) return 'clb';
  if (action.startsWith('live.')) return 'live';
  return 'cdn';
}

function tencentActionName(action: string): string {
  return action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
}

function tencentVersionForAction(action: string): string {
  if (action.startsWith('live.')) return '2018-08-01';
  return action.startsWith('clb.') ? '2018-03-17' : '2018-06-06';
}

function tencentEndpointForProduct(product: ListenerProductKey, scope: ProviderScope): string {
  if (product === 'clb') return scopeEndpoint(scope, 'https://clb.tencentcloudapi.com');
  if (product === 'live') return scopeEndpoint(scope, 'https://live.tencentcloudapi.com');
  return scopeEndpoint(scope, 'https://cdn.tencentcloudapi.com');
}

function huaweiProductForAction(action: string): ListenerProductKey {
  return action.startsWith('elb.') ? 'elb' : 'cdn';
}

function huaweiMethodForAction(action: string): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  if (action.startsWith('elb.describe')) return 'GET';
  if (action.startsWith('elb.connection')) return 'GET';
  return action.startsWith('elb.') ? 'PUT' : action === 'connection' || action === 'read' ? 'GET' : 'PUT';
}

function huaweiElbEndpoint(scope: ProviderScope): string {
  return scopeEndpoint(scope, 'https://elb.myhuaweicloud.com');
}

function huaweiElbPath(action: string, projectId: string, payload: Record<string, unknown>, context: ProviderContext): string {
  const loadBalancerId = stringValue(payload.loadbalancer_id) ?? stringValue(payload.loadBalancerId) ?? context.asset.id;
  const listenerId = stringValue(payload.listener_id) ?? stringValue(payload.listenerId) ?? context.asset.id;
  if (action === 'connection') return `/v3/${projectId}/elb/loadbalancers`;
  if (action.includes('describeListeners')) return `/v3/${projectId}/elb/loadbalancers/${encodeURIComponent(loadBalancerId)}/listeners`;
  if (action.includes('describeLoadBalancers')) return `/v3/${projectId}/elb/loadbalancers`;
  return `/v3/${projectId}/elb/listeners/${encodeURIComponent(listenerId)}`;
}

function volcProductForAction(action: string): ListenerProductKey {
  if (action.startsWith('alb.')) return 'alb';
  if (action.startsWith('clb.')) return 'clb';
  if (action.startsWith('live.')) return 'live';
  if (action.startsWith('vod.')) return 'vod';
  return 'cdn';
}

function volcActionName(action: string): string {
  return action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
}

function volcEndpointForProduct(product: ListenerProductKey, scope: ProviderScope): string {
  return scopeEndpoint(scope, 'https://open.volcengineapi.com');
}

function selectFrameworkTypes(all: string[], requested?: string[]): string[] {
  if (!requested || requested.length === 0) return all;
  const allowed = new Set(all);
  return requested.filter((item) => allowed.has(item));
}

function emptyDiscoveryTargets(): DiscoveryTargets {
  return { frameworks: [], sites: [], managedTargets: [], certificates: [], certificateBindings: [], warnings: [] };
}

function mergeDiscovery(target: DiscoveryTargets, input: DiscoveryTargets): void {
  target.frameworks.push(...input.frameworks);
  target.sites.push(...input.sites);
  target.managedTargets.push(...input.managedTargets);
  target.certificates.push(...input.certificates);
  target.certificateBindings.push(...input.certificateBindings);
  if (input.warnings?.length) target.warnings?.push(...input.warnings);
  if (input.rawFacts) target.rawFacts = { ...(target.rawFacts ?? {}), ...input.rawFacts };
}

async function domainDiscovery(input: {
  providerKey: string;
  frameworkType: string;
  targetType: string;
  listDomains: () => Promise<unknown[]>;
  domainFields: string[];
  certificateIdFields: string[];
}): Promise<DiscoveryTargets> {
  const items = (await input.listDomains()).filter(isRecord);
  const frameworks = [{
    stableKey: input.frameworkType,
    frameworkType: input.frameworkType,
    displayName: input.frameworkType.split('.').at(-1)?.toUpperCase() ?? input.frameworkType,
    metadata: { providerKey: input.providerKey },
  }];
  const sites: DiscoveryTargets['sites'] = [];
  const managedTargets: DiscoveryTargets['managedTargets'] = [];
  const certificates: DiscoveryTargets['certificates'] = [];
  const certificateBindings: DiscoveryTargets['certificateBindings'] = [];
  for (const item of items) {
    const domain = firstString(item, input.domainFields) ?? firstString(item, ['id', 'Id']) ?? '';
    if (!domain) continue;
    const certificateId = firstString(item, input.certificateIdFields);
    const stableKey = domain;
    sites.push({
      stableKey,
      frameworkStableKey: input.frameworkType,
      siteType: input.targetType,
      displayName: domain,
      addresses: [domain],
      port: 443,
      protocol: 'HTTPS',
      metadata: item,
    });
    managedTargets.push({
      stableKey,
      frameworkStableKey: input.frameworkType,
      siteStableKey: stableKey,
      targetType: input.targetType,
      targetKey: domain,
      bindingKey: domain,
      supportedCapabilities: [...CDN_OPERATIONAL_CAPABILITIES],
      executionLocations: ['CONTROL_PLANE'],
      metadata: item,
    });
    if (certificateId) {
      certificates.push({ stableKey: certificateId, certificateId, displayName: certificateId, metadata: { domain, certificateId } });
      certificateBindings.push({
        stableKey: `${stableKey}:${certificateId}`,
        managedTargetStableKey: stableKey,
        certificateStableKey: certificateId,
        bindingName: domain,
        metadata: { domain, certificateId },
      });
    }
  }
  return { frameworks, sites, managedTargets, certificates, certificateBindings };
}

function cdnDiscovery(providerKey: string, values: unknown[]): DiscoveryTargets {
  const items = values.filter(isRecord);
  return {
    frameworks: [{ stableKey: `${providerKey}.cdn`, frameworkType: `${providerKey}.cdn`, displayName: 'CDN', metadata: { providerKey } }],
    sites: items.map((item) => {
      const domain = stringValue(item.DomainName) ?? stringValue(item.domain) ?? stringValue(item.Domain) ?? String(item.id ?? item.Id ?? '');
      return { stableKey: domain, frameworkStableKey: `${providerKey}.cdn`, siteType: 'cloud.cdn.domain', displayName: domain, addresses: [domain], port: 443, protocol: 'HTTPS', metadata: item };
    }),
    managedTargets: items.map((item) => {
      const domain = stringValue(item.DomainName) ?? stringValue(item.domain) ?? stringValue(item.Domain) ?? String(item.id ?? item.Id ?? '');
      return { stableKey: domain, frameworkStableKey: `${providerKey}.cdn`, siteStableKey: domain, targetType: 'cloud.cdn.domain', targetKey: domain, supportedCapabilities: [...CDN_OPERATIONAL_CAPABILITIES], executionLocations: ['CONTROL_PLANE'], metadata: item };
    }),
    certificates: [],
    certificateBindings: [],
  };
}

function toDomainEntries(
  payload: Record<string, unknown>,
  domainFields: string[],
  certificateIdFields: string[],
): Array<{ domain: string; certificateId?: string; metadata: Record<string, unknown> }> {
  const sources = Array.isArray(payload.Cname)
    ? payload.Cname
    : Array.isArray(payload.Domains)
      ? payload.Domains
      : Array.isArray(payload.DomainList)
        ? payload.DomainList
        : isRecord(payload)
          ? [payload]
          : [];
  return sources
    .filter(isRecord)
    .map((item) => ({
      domain: firstString(item, domainFields) ?? '',
      certificateId: firstString(item, certificateIdFields),
      metadata: item,
    }))
    .filter((item) => Boolean(item.domain));
}

function listenerDiscovery(input: {
  providerKey: string;
  frameworkType: string;
  targetType: string;
  listLoadBalancers: () => Promise<unknown[]>;
  listListeners: (loadBalancerId: string) => Promise<unknown[]>;
  loadBalancerIdFields: string[];
  listenerIdFields: string[];
  loadBalancerNameFields: string[];
  listenerNameFields: string[];
  certificateIdFields: string[];
  domainFields: string[];
  portFields: string[];
  protocolFields: string[];
}): Promise<DiscoveryTargets> {
  return (async () => {
    const frameworks = [{ stableKey: input.frameworkType, frameworkType: input.frameworkType, displayName: input.frameworkType.split('.').at(-1)?.toUpperCase() ?? input.frameworkType, metadata: { providerKey: input.providerKey } }];
    const sites: DiscoveryTargets['sites'] = [];
    const managedTargets: DiscoveryTargets['managedTargets'] = [];
    const certificates: DiscoveryTargets['certificates'] = [];
    const certificateBindings: DiscoveryTargets['certificateBindings'] = [];
    const loadBalancers = input.listLoadBalancers().then((values) => values.filter(isRecord));
    const lbs = await loadBalancers;
    for (const lb of lbs) {
      const loadBalancerId = firstString(lb, input.loadBalancerIdFields) ?? firstString(lb, ['id']) ?? firstString(lb, ['InstanceId']) ?? '';
      if (!loadBalancerId) continue;
      const lbName = firstString(lb, input.loadBalancerNameFields) ?? loadBalancerId;
      const listeners = (await input.listListeners(loadBalancerId)).filter(isRecord);
      for (const listener of listeners) {
        const listenerId = firstString(listener, input.listenerIdFields) ?? firstString(listener, ['id']) ?? `${loadBalancerId}:listener`;
        const listenerName = firstString(listener, input.listenerNameFields) ?? firstString(listener, input.domainFields) ?? listenerId;
        const domain = firstString(listener, input.domainFields) ?? listenerName;
        const certificateId = firstString(listener, input.certificateIdFields);
        const port = firstNumber(listener, input.portFields) ?? 443;
        const protocol = firstString(listener, input.protocolFields)?.toUpperCase() ?? 'HTTPS';
        const stableKey = `${loadBalancerId}:${listenerId}`;
        const metadata = { ...listener, loadBalancerId, listenerId, lbName, domain, port, protocol };
        sites.push({ stableKey, frameworkStableKey: input.frameworkType, siteType: input.targetType, displayName: listenerName, addresses: [domain], port, protocol, metadata });
        managedTargets.push({
          stableKey,
          frameworkStableKey: input.frameworkType,
          siteStableKey: stableKey,
          targetType: input.targetType,
          targetKey: listenerId,
          bindingKey: domain,
          supportedCapabilities: [...CDN_OPERATIONAL_CAPABILITIES],
          executionLocations: ['CONTROL_PLANE'],
          metadata,
        });
        if (certificateId) {
          certificates.push({
            stableKey: certificateId,
            certificateId,
            displayName: certificateId,
            metadata: { loadBalancerId, listenerId, domain, certificateId },
          });
          certificateBindings.push({
            stableKey: `${stableKey}:${certificateId}`,
            managedTargetStableKey: stableKey,
            certificateStableKey: certificateId,
            bindingName: listenerName,
            metadata: { loadBalancerId, listenerId, domain, certificateId },
          });
        }
      }
    }
    return { frameworks, sites, managedTargets, certificates, certificateBindings };
  })();
}

function stateFrom(target: ProviderTargetRef, payload: Record<string, unknown>): CloudTargetState {
  const nested = isRecord(payload.Response) ? payload.Response : isRecord(payload.Result) ? payload.Result : payload;
  return {
    target,
    certificateId: firstString(nested, ['CertificateId', 'CertId', 'certificateId', 'DefaultCertId', 'defaultCertId']),
    fingerprintSha256: firstString(nested, ['FingerprintSha256', 'fingerprintSha256']),
    metadata: nested,
  };
}

function stateFromDomainArray(
  target: ProviderTargetRef,
  payload: Record<string, unknown>,
  domainListPaths: string[],
  domainFields: string[],
  certificateIdFields: string[],
): CloudTargetState {
  const domains = arrayCandidates(payload, domainListPaths);
  const matched = domains.find((item) => {
    const domain = firstString(item, domainFields);
    return domain && domain === (target.domain ?? target.resourceId);
  });
  if (!matched) return stateFrom(target, payload);
  return {
    target,
    certificateId: firstString(matched, certificateIdFields),
    fingerprintSha256: firstString(matched, ['FingerprintSha256', 'fingerprintSha256']),
    metadata: matched,
  };
}

function listenerStateFrom(target: ProviderTargetRef, payload: Record<string, unknown>, fields: {
  certificateListFields: string[];
  loadBalancerIdFields: string[];
  listenerIdFields: string[];
  certificateIdFields: string[];
  domainFields: string[];
  portFields: string[];
  protocolFields: string[];
}): CloudTargetState {
  const candidates = arrayCandidates(payload, fields.certificateListFields);
  const items = candidates.length > 0 ? candidates : [payload];
  const listener = items.find((item) => !target.listenerId || firstString(item, fields.listenerIdFields) === target.listenerId || firstString(item, ['id']) === target.listenerId) ?? payload;
  return {
    target,
    certificateId: firstString(listener, fields.certificateIdFields),
    fingerprintSha256: firstString(listener, ['FingerprintSha256', 'fingerprintSha256']),
    metadata: {
      ...listener,
      loadBalancerId: firstString(listener, fields.loadBalancerIdFields) ?? target.metadata?.loadBalancerId,
      listenerId: firstString(listener, fields.listenerIdFields) ?? target.listenerId ?? target.resourceId,
      domain: firstString(listener, fields.domainFields) ?? target.domain,
      port: firstNumber(listener, fields.portFields) ?? target.metadata?.port,
      protocol: firstString(listener, fields.protocolFields) ?? target.metadata?.protocol,
    },
  };
}

function providerAsyncStatus(payload: Record<string, unknown>): ProviderAsyncState['status'] {
  const nested = isRecord(payload.Response) ? payload.Response : payload;
  const value = (
    stringValue(nested.Status)
    ?? stringValue(nested.TaskStatus)
    ?? stringValue(nested.JobStatus)
    ?? ''
  ).toUpperCase();
  if (['SUCCESS', 'SUCCEEDED', 'SUCCESSFUL', 'COMPLETED', 'DONE'].includes(value)) return 'SUCCEEDED';
  if (['FAILED', 'FAILURE', 'ERROR'].includes(value)) return 'FAILED';
  if (['CANCELLED', 'CANCELED', 'ABORTED'].includes(value)) return 'CANCELLED';
  return value === 'RUNNING' ? 'RUNNING' : 'PENDING';
}

function scopeNumber(scope: ProviderScope, key: string, fallback: number): number {
  const value = scope.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function firstString(value: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = stringValue(value[key]);
    if (candidate) return candidate;
  }
  return undefined;
}

function firstNumber(value: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function arrayFrom(payload: Record<string, unknown>, paths: string[]): unknown[] {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, payload);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function arrayCandidates(payload: Record<string, unknown>, paths: string[]): Record<string, unknown>[] {
  return arrayFrom(payload, paths).filter(isRecord);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function targetToAsset(target: ProviderTargetRef) {
  return {
    id: `target-${target.resourceId}`,
    tenantId: 'unknown',
    assetKind: 'cloud.account' as const,
    providerKey: target.frameworkType.split('.').slice(0, 2).join('.'),
    displayName: target.domain ?? target.resourceId,
    credentialRef: 'credential://unknown',
    scope: {},
    status: 'ACTIVE' as const,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}
