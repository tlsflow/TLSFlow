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

type ListenerProductKey = 'cdn' | 'alb' | 'clb' | 'elb';

const CDN_OPERATIONAL_CAPABILITIES = ['certificate.deploy', 'certificate.verify', 'certificate.rollback'] as const;

export class AliyunProviderExtension extends CloudProviderExtension {
  constructor(credentials: ProviderCredentialResolver, transport: ProviderTransport) {
    super(descriptor('cloud.aliyun', 'aliyun', 'V4', ['cloud.aliyun.cdn', 'cloud.aliyun.alb', 'cloud.aliyun.clb']), credentials, transport);
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

  protected async discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets> {
    const requested = selectFrameworkTypes(this.descriptor.supportedFrameworkTypes, frameworkTypes);
    const result: DiscoveryTargets = emptyDiscoveryTargets();
    for (const frameworkType of requested) {
      if (frameworkType === 'cloud.aliyun.cdn') {
        mergeDiscovery(result, cdnDiscovery('cloud.aliyun', arrayFrom(assertProviderResponse(await this.call(context, 'cdn.DescribeUserDomains', { PageSize: 50 }), 'cloud.aliyun'), ['Domains', 'domains'])));
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
      }
    }
    return result;
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    if (target.frameworkType === 'cloud.aliyun.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.DescribeDomainCertificateInfo', { DomainName: target.domain ?? target.resourceId }), 'cloud.aliyun');
      return stateFrom(target, response);
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
    if (target.frameworkType !== 'cloud.aliyun.cdn') {
      throw new Error('该阿里云产品需要先提供 certificateId');
    }
    return { certificateId: `aliyun-cert-${Date.now()}` };
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
    super(descriptor('cloud.tencent', 'tencent', 'V4', ['cloud.tencent.cdn', 'cloud.tencent.clb']), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const product = tencentProductForAction(action);
    const request = signTencentTc3({
      secretId: required(credential, 'secretId', 'SecretId'),
      secretKey: required(credential, 'secretKey', 'SecretKey'),
      service: product === 'clb' ? 'clb' : 'cdn',
      action: tencentActionName(action),
      version: tencentVersionForAction(action),
      region: context.asset.scope.regions?.[0],
      payload,
      scope: context.asset.scope,
      endpoint: tencentEndpointForProduct(product, context.asset.scope),
    });
    return this.transport.request(request);
  }

  protected async discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets> {
    const requested = selectFrameworkTypes(this.descriptor.supportedFrameworkTypes, frameworkTypes);
    const result: DiscoveryTargets = emptyDiscoveryTargets();
    for (const frameworkType of requested) {
      if (frameworkType === 'cloud.tencent.cdn') {
        mergeDiscovery(result, cdnDiscovery('cloud.tencent', arrayFrom(assertProviderResponse(await this.call(context, 'cdn.DescribeDomains', { Limit: 100 }), 'cloud.tencent'), ['Response', 'Domains', 'domains'])));
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
      }
    }
    return result;
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    if (target.frameworkType === 'cloud.tencent.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.DescribeDomains', { Filters: [{ Name: 'domain', Value: [target.domain ?? target.resourceId] }] }), 'cloud.tencent');
      return stateFrom(target, response);
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
    super(descriptor('cloud.volcengine', 'volcengine', 'HMAC', ['cloud.volcengine.cdn', 'cloud.volcengine.alb', 'cloud.volcengine.clb']), credentials, transport);
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

  protected async discoverTargets(context: ProviderContext, frameworkTypes?: string[]): Promise<DiscoveryTargets> {
    const requested = selectFrameworkTypes(this.descriptor.supportedFrameworkTypes, frameworkTypes);
    const result: DiscoveryTargets = emptyDiscoveryTargets();
    for (const frameworkType of requested) {
      if (frameworkType === 'cloud.volcengine.cdn') {
        mergeDiscovery(result, cdnDiscovery('cloud.volcengine', arrayFrom(assertProviderResponse(await this.call(context, 'cdn.ListCdnDomains', { PageSize: 100 }), 'cloud.volcengine'), ['Result', 'Domains', 'domains'])));
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
      }
    }
    return result;
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    if (target.frameworkType === 'cloud.volcengine.cdn') {
      const response = assertProviderResponse(await this.call(context, 'cdn.GetDomainConfig', { Domain: target.domain ?? target.resourceId }), 'cloud.volcengine');
      return stateFrom(target, response);
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

function aliProductForAction(action: string): 'cdn' | 'alb' | 'slb' {
  return action.startsWith('alb.') ? 'alb' : action.startsWith('slb.') ? 'slb' : 'cdn';
}

function aliActionName(action: string): string {
  return action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
}

function aliVersionForAction(action: string): string {
  if (action.startsWith('alb.')) return '2020-06-16';
  if (action.startsWith('slb.')) return '2014-05-15';
  return '2018-05-10';
}

function aliEndpointForProduct(product: 'cdn' | 'alb' | 'slb', scope: ProviderScope): string {
  if (product === 'alb') return scopeEndpoint(scope, 'https://alb.aliyuncs.com');
  if (product === 'slb') return scopeEndpoint(scope, 'https://slb.aliyuncs.com');
  return scopeEndpoint(scope, 'https://cdn.aliyuncs.com');
}

function tencentProductForAction(action: string): ListenerProductKey {
  return action.startsWith('clb.') ? 'clb' : 'cdn';
}

function tencentActionName(action: string): string {
  return action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
}

function tencentVersionForAction(action: string): string {
  return action.startsWith('clb.') ? '2018-03-17' : '2018-06-06';
}

function tencentEndpointForProduct(product: ListenerProductKey, scope: ProviderScope): string {
  if (product === 'clb') return scopeEndpoint(scope, 'https://clb.tencentcloudapi.com');
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
  return 'cdn';
}

function volcActionName(action: string): string {
  return action.includes('.') ? action.slice(action.indexOf('.') + 1) : action;
}

function volcEndpointForProduct(product: ListenerProductKey, scope: ProviderScope): string {
  if (product === 'alb') return scopeEndpoint(scope, 'https://alb.volcengineapi.com');
  if (product === 'clb') return scopeEndpoint(scope, 'https://clb.volcengineapi.com');
  return scopeEndpoint(scope, 'https://cdn.volcengineapi.com');
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
