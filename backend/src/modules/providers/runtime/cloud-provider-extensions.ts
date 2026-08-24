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

export class AliyunProviderExtension extends CloudProviderExtension {
  constructor(credentials: ProviderCredentialResolver, transport: ProviderTransport) {
    super(descriptor('cloud.aliyun', 'aliyun', 'V4', ['cloud.aliyun.cdn', 'cloud.aliyun.oss', 'cloud.aliyun.alb', 'cloud.aliyun.clb']), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const request = signAliyunRpc({
      accessKeyId: required(credential, 'accessKeyId', 'AccessKeyId'),
      accessKeySecret: required(credential, 'accessKeySecret', 'AccessKeySecret'),
      action: action === 'connection' ? 'DescribeUserDomains' : action,
      version: '2018-05-10',
      params: flattenRpcParams(payload),
      scope: context.asset.scope,
    });
    return this.transport.request(request);
  }

  protected async discoverTargets(context: ProviderContext): Promise<DiscoveryTargets> {
    const response = assertProviderResponse(await this.call(context, 'DescribeUserDomains', { PageSize: 50 }), 'cloud.aliyun');
    const domains = arrayFrom(response, ['Domains', 'domains']);
    return cdnDiscovery('cloud.aliyun', domains);
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    const response = assertProviderResponse(await this.call(context, 'DescribeDomainCertificateInfo', { DomainName: target.domain ?? target.resourceId }), 'cloud.aliyun');
    return stateFrom(target, response);
  }

  protected async uploadCertificate(context: ProviderContext, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    if (certificate.certificateId) return { certificateId: certificate.certificateId };
    const response = assertProviderResponse(await this.call(context, 'SetDomainServerCertificate', {
      DomainName: 'placeholder.invalid',
      CertName: `gcac-${Date.now()}`,
      SSLPub: certificate.certificatePem,
      SSLPri: certificate.privateKeyPem,
      CertType: 'upload',
    }), 'cloud.aliyun');
    return { certificateId: stringValue(response.CertId) ?? stringValue(response.CertificateId) ?? `aliyun-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, certificate: CloudCertificateInput): Promise<Record<string, unknown>> {
    const response = assertProviderResponse(await this.call(context, 'SetDomainServerCertificate', {
      DomainName: target.domain ?? target.resourceId,
      CertId: certificateId,
      SSLPub: certificate.certificatePem,
      SSLPri: certificate.privateKeyPem,
      CertType: 'upload',
      Enable: 'on',
    }), 'cloud.aliyun');
    return { requestId: stringValue(response.RequestId), certificateId };
  }

  protected async verifyCertificate(context: ProviderContext, target: ProviderTargetRef, input: Record<string, unknown>): Promise<boolean> {
    const state = await this.readTargetState(context, target);
    return !input.certificateId || state.certificateId === input.certificateId || Boolean(state.fingerprintSha256);
  }

  protected async restoreCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<void> {
    await this.applyCertificate(context, target, certificateId, { certificatePem: '', certificateId });
  }
}

export class TencentProviderExtension extends CloudProviderExtension {
  constructor(
    credentials: ProviderCredentialResolver,
    transport: ProviderTransport,
    private readonly asyncWaiter = new ProviderAsyncWaiter(),
  ) {
    super(descriptor('cloud.tencent', 'tencent', 'V4', ['cloud.tencent.cdn', 'cloud.tencent.oss', 'cloud.tencent.alb', 'cloud.tencent.clb']), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const request = signTencentTc3({
      secretId: required(credential, 'secretId', 'SecretId'),
      secretKey: required(credential, 'secretKey', 'SecretKey'),
      service: 'cdn',
      action: action === 'connection' ? 'DescribeDomains' : action,
      version: '2018-06-06',
      region: context.asset.scope.regions?.[0],
      payload,
      scope: context.asset.scope,
    });
    return this.transport.request(request);
  }

  protected async discoverTargets(context: ProviderContext): Promise<DiscoveryTargets> {
    const response = assertProviderResponse(await this.call(context, 'DescribeDomains', { Limit: 100 }), 'cloud.tencent');
    const domains = arrayFrom(response, ['Response', 'Domains', 'domains']);
    return cdnDiscovery('cloud.tencent', domains);
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    const response = assertProviderResponse(await this.call(context, 'DescribeDomains', { Filters: [{ Name: 'domain', Value: [target.domain ?? target.resourceId] }] }), 'cloud.tencent');
    return stateFrom(target, response);
  }

  protected async uploadCertificate(context: ProviderContext, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    if (certificate.certificateId) return { certificateId: certificate.certificateId };
    const response = assertProviderResponse(await this.call(context, 'DeployCertificate', {
      Certificate: certificate.certificatePem,
      PrivateKey: certificate.privateKeyPem,
    }), 'cloud.tencent');
    return { certificateId: stringValue(response.Response && isRecord(response.Response) ? response.Response.CertificateId : undefined) ?? `tencent-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<Record<string, unknown>> {
    const response = assertProviderResponse(await this.call(context, 'ModifyDomainConfig', {
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
        const response = assertProviderResponse(await this.call(context, 'DescribeDomainConfig', {
          Domain: target.domain ?? target.resourceId,
          TaskId: operation.operationId,
        }), 'cloud.tencent');
        return {
          status: providerAsyncStatus(response),
          detail: response,
        };
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
    super(descriptor('cloud.huawei', 'huawei', 'HMAC', ['cloud.huawei.cdn', 'cloud.huawei.oss', 'cloud.huawei.alb', 'cloud.huawei.clb']), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const path = action === 'connection'
      ? '/v1.0/cdn/domains'
      : `/v1.0/cdn/configuration/domains/${encodeURIComponent(String(payload.domain ?? ''))}`;
    const request = signHuaweiRequest({
      accessKey: required(credential, 'accessKey', 'AK'),
      secretKey: required(credential, 'secretKey', 'SK'),
      method: action === 'read' || action === 'connection' ? 'GET' : 'PUT',
      path,
      payload,
      scope: context.asset.scope,
    });
    return this.transport.request(request);
  }

  protected async discoverTargets(context: ProviderContext): Promise<DiscoveryTargets> {
    const response = assertProviderResponse(await this.call(context, 'connection'), 'cloud.huawei');
    return cdnDiscovery('cloud.huawei', arrayFrom(response, ['domains', 'items']));
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    const response = assertProviderResponse(await this.call(context, 'read', { domain: target.domain ?? target.resourceId }), 'cloud.huawei');
    return stateFrom(target, response);
  }

  protected async uploadCertificate(_context: ProviderContext, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    return { certificateId: certificate.certificateId ?? `huawei-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, certificate: CloudCertificateInput): Promise<Record<string, unknown>> {
    const previous = await this.readTargetState(context, target);
    const response = assertProviderResponse(await this.call(context, 'write', {
      domain: target.domain ?? target.resourceId,
      ...previous.metadata,
      certificateId,
      certificatePem: certificate.certificatePem,
      privateKeyPem: certificate.privateKeyPem,
    }), 'cloud.huawei');
    return { certificateId, preservedFields: Object.keys(previous.metadata ?? {}).sort(), responseKeys: Object.keys(response).sort() };
  }

  protected async verifyCertificate(context: ProviderContext, target: ProviderTargetRef, input: Record<string, unknown>): Promise<boolean> {
    const state = await this.readTargetState(context, target);
    return !input.certificateId || state.certificateId === input.certificateId || Boolean(state.fingerprintSha256);
  }

  protected async restoreCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string, previous: CloudTargetState): Promise<void> {
    await this.call(context, 'write', { domain: target.domain ?? target.resourceId, ...(previous.metadata ?? {}), certificateId });
  }
}

export class VolcengineProviderExtension extends CloudProviderExtension {
  constructor(credentials: ProviderCredentialResolver, transport: ProviderTransport) {
    super(descriptor('cloud.volcengine', 'volcengine', 'HMAC', ['cloud.volcengine.cdn', 'cloud.volcengine.oss', 'cloud.volcengine.alb', 'cloud.volcengine.clb']), credentials, transport);
  }

  protected async call(context: ProviderContext, action: string, payload: Record<string, unknown> = {}): Promise<ProviderHttpResponse> {
    const credential = await this.credential(context);
    const request = signVolcengineRequest({
      accessKeyId: required(credential, 'accessKeyId', 'AccessKeyId'),
      secretAccessKey: required(credential, 'secretAccessKey', 'SecretAccessKey'),
      service: 'cdn',
      action: action === 'connection' ? 'ListCdnDomains' : action,
      region: context.asset.scope.regions?.[0],
      payload,
      scope: context.asset.scope,
    });
    return this.transport.request(request);
  }

  protected async discoverTargets(context: ProviderContext): Promise<DiscoveryTargets> {
    const response = assertProviderResponse(await this.call(context, 'ListCdnDomains', { PageSize: 100 }), 'cloud.volcengine');
    return cdnDiscovery('cloud.volcengine', arrayFrom(response, ['Result', 'Domains', 'domains']));
  }

  protected async readTargetState(context: ProviderContext, target: ProviderTargetRef): Promise<CloudTargetState> {
    const response = assertProviderResponse(await this.call(context, 'GetDomainConfig', { Domain: target.domain ?? target.resourceId }), 'cloud.volcengine');
    return stateFrom(target, response);
  }

  protected async uploadCertificate(context: ProviderContext, certificate: CloudCertificateInput): Promise<{ certificateId: string }> {
    if (certificate.certificateId) return { certificateId: certificate.certificateId };
    const response = assertProviderResponse(await this.call(context, 'CertUpload', {
      Certificate: certificate.certificatePem,
      PrivateKey: certificate.privateKeyPem,
    }), 'cloud.volcengine');
    return { certificateId: stringValue(response.Result && isRecord(response.Result) ? response.Result.CertificateId : undefined) ?? `volc-cert-${Date.now()}` };
  }

  protected async applyCertificate(context: ProviderContext, target: ProviderTargetRef, certificateId: string): Promise<Record<string, unknown>> {
    const response = assertProviderResponse(await this.call(context, 'UpdateDomainConfig', {
      Domain: target.domain ?? target.resourceId,
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

function flattenRpcParams(payload: Record<string, unknown>): Record<string, string | number | undefined> {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === 'string' || typeof value === 'number' ? value : value === undefined ? undefined : JSON.stringify(value)]));
}

function arrayFrom(payload: Record<string, unknown>, paths: string[]): unknown[] {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, payload);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function cdnDiscovery(providerKey: string, values: unknown[]): DiscoveryTargets {
  const items = values.filter(isRecord);
  return {
    frameworks: [{ stableKey: `${providerKey}.cdn`, frameworkType: `${providerKey}.cdn`, displayName: 'CDN', metadata: { providerKey } }],
    sites: items.map((item) => {
      const domain = stringValue(item.DomainName) ?? stringValue(item.domain) ?? stringValue(item.Domain) ?? String(item.id ?? item.Id ?? '');
      return { stableKey: domain, frameworkStableKey: `${providerKey}.cdn`, siteType: 'cloud.cdn', displayName: domain, addresses: [domain], port: 443, protocol: 'HTTPS', metadata: item };
    }),
    managedTargets: items.map((item) => {
      const domain = stringValue(item.DomainName) ?? stringValue(item.domain) ?? stringValue(item.Domain) ?? String(item.id ?? item.Id ?? '');
      return { stableKey: domain, frameworkStableKey: `${providerKey}.cdn`, siteStableKey: domain, targetType: 'cloud.cdn.domain', targetKey: domain, supportedCapabilities: ['certificate.deploy', 'certificate.verify', 'certificate.rollback'], executionLocations: ['CONTROL_PLANE'], metadata: item };
    }),
    certificates: [],
    certificateBindings: [],
  };
}

function stateFrom(target: ProviderTargetRef, payload: Record<string, unknown>): CloudTargetState {
  const nested = isRecord(payload.Response) ? payload.Response : isRecord(payload.Result) ? payload.Result : payload;
  return {
    target,
    certificateId: stringValue(nested.CertificateId) ?? stringValue(nested.CertId) ?? stringValue(nested.certificateId),
    fingerprintSha256: stringValue(nested.FingerprintSha256) ?? stringValue(nested.fingerprintSha256),
    metadata: nested,
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
