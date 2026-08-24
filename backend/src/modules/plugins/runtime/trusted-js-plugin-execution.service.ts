import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { AuditService, type WriteAuditInput } from '../../audits/audit.service.js';
import { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import { PluginResourceLockService } from '../../executions/application/plugin-resource-lock.service.js';
import type { CloudAccountAssetsApplicationService } from '../../providers/application/cloud-account-assets.application-service.js';
import type { CloudAccountAsset, ProviderDefinition, ProviderOperationResult, ProviderTargetRef } from '../../providers/dto/providers.dto.js';
import {
  CredentialProfileProviderCredentialResolver,
  FetchProviderTransport,
  SecretProviderCertificateMaterialResolver,
} from '../../providers/runtime/provider-runtime.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { newId } from '../../../shared/id.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { UnifiedPluginsApplicationService, compareSemanticVersions } from '../application/unified-plugins.application-service.js';
import {
  assertTrustedJsHostApiAccess,
  validateTrustedJsConnectionResult,
  validateTrustedJsDiscoveryPayload,
  validateTrustedJsOperationResult,
  type TrustedJsAsyncWaitInput,
  type TrustedJsAsyncWaitResult,
  type TrustedJsConnectionResult,
  type TrustedJsPluginContext,
  type TrustedJsProviderPlugin,
  type TrustedJsProviderPluginFactory,
  type TrustedPluginHostApi,
} from './trusted-js-runtime.contract.js';

export interface TrustedJsProviderPluginSelection {
  providerKey: string;
  frameworkType?: string;
  operationKey?: string;
}

export interface TrustedJsPluginExecutionDependencies {
  db: DatabasePort;
  unifiedPlugins: UnifiedPluginsApplicationService;
  cloudAccounts: Pick<CloudAccountAssetsApplicationService, 'get'>;
  credentials: CredentialsRepository;
  secrets: SecretService;
  audit: AuditService;
}

/**
 * Trusted JS Provider 运行时。
 *
 * 这层的职责只有两件事：
 * 1. 以插件目录为唯一入口选择并装载 Provider 插件。
 * 2. 向插件暴露受控 Host API，不把宿主内部服务直接泄漏给插件代码。
 */
export class TrustedJsPluginExecutionService {
  private readonly credentialResolver: CredentialProfileProviderCredentialResolver;
  private readonly certificateResolver: SecretProviderCertificateMaterialResolver;
  private readonly transport = new FetchProviderTransport();
  private readonly resourceLocks: PluginResourceLockService;
  private readonly extractedDirectories = new Map<string, Promise<string>>();
  private readonly providerBaselines = new Map<string, ProviderDefinition>([
    ['cloud.aliyun', baselineDefinition('cloud.aliyun', 'V4', [
      'cloud.aliyun.cdn',
      'cloud.aliyun.alb',
      'cloud.aliyun.clb',
      'cloud.aliyun.oss',
      'cloud.aliyun.waf-cname',
      'cloud.aliyun.waf-cloud',
      'cloud.aliyun.live',
      'cloud.aliyun.vod',
    ])],
    ['cloud.tencent', baselineDefinition('cloud.tencent', 'V4', [
      'cloud.tencent.cdn',
      'cloud.tencent.clb',
      'cloud.tencent.live',
    ])],
    ['cloud.huawei', baselineDefinition('cloud.huawei', 'HMAC', [
      'cloud.huawei.cdn',
      'cloud.huawei.elb',
    ])],
    ['cloud.volcengine', baselineDefinition('cloud.volcengine', 'HMAC', [
      'cloud.volcengine.cdn',
      'cloud.volcengine.alb',
      'cloud.volcengine.clb',
      'cloud.volcengine.live',
      'cloud.volcengine.vod',
    ])],
  ]);

  constructor(private readonly dependencies: TrustedJsPluginExecutionDependencies) {
    this.credentialResolver = new CredentialProfileProviderCredentialResolver(dependencies.credentials, dependencies.secrets);
    this.certificateResolver = new SecretProviderCertificateMaterialResolver(dependencies.secrets);
    this.resourceLocks = new PluginResourceLockService(dependencies.db);
  }

  listProviders(tenantId: string): Promise<ProviderDefinition[]> {
    return this.listProviderDefinitions(tenantId);
  }

  async requireProvider(tenantId: string, providerKey: string): Promise<ProviderDefinition> {
    const definitions = await this.listProviderDefinitions(tenantId);
    const definition = definitions.find((item) => item.providerKey === providerKey);
    if (!definition) {
      throw new AppError('PROVIDER_NOT_FOUND', 'Provider 未注册', { providerKey });
    }
    return definition;
  }

  async listCapabilities(
    tenantId: string,
    filter: { providerKey?: string; frameworkType?: string; operationKey?: string } = {},
  ) {
    const definitions = await this.listProviderDefinitions(tenantId);
    const items = definitions.flatMap((definition) => definition.supportedProducts.flatMap((frameworkType) => {
      const operations = definition.supportedOperations.filter((operationKey) => operationKey.startsWith('certificate.'));
      return operations.map((operationKey) => ({
        capabilityPluginId: definition.capabilityPluginId,
        version: definition.providerExtensionVersion,
        providerKey: definition.providerKey,
        frameworkType,
        operationKey,
        displayNameKey: `provider.capabilities.${operationKey.replaceAll('.', '_')}`,
        inputSchemaId: `gcac.${operationKey.replaceAll('.', '-')}-input/v1`,
        outputSchemaId: `gcac.${operationKey.replaceAll('.', '-')}-result/v1`,
        executionLocations: definition.executionLocations,
        rollbackMode: operationKey === 'certificate.rollback' ? 'MANUAL_REQUIRED' as const : 'UNSUPPORTED' as const,
        requiredPermissions: operationKey === 'certificate.deploy' || operationKey === 'certificate.rollback'
          ? ['certificate.deploy']
          : ['certificate.read'],
        enabled: true,
      }));
    }));
    return items
      .filter((item) => !filter.providerKey || item.providerKey === filter.providerKey)
      .filter((item) => !filter.frameworkType || item.frameworkType === filter.frameworkType)
      .filter((item) => !filter.operationKey || item.operationKey === filter.operationKey);
  }

  async testConnection(asset: CloudAccountAsset, requestId?: string): Promise<{ reachable: boolean; accountId?: string; details?: Record<string, unknown> }> {
    const plugin = await this.createPluginForSelection(asset.tenantId, { providerKey: asset.providerKey }, asset, 'provider.connection.test');
    const result = plugin.instance.testConnection
      ? await plugin.instance.testConnection(buildPluginContext(asset, 'provider.connection.test', plugin.versionRecord, requestId))
      : await defaultConnectionTest(this.credentialResolver, asset);
    const validated = validateTrustedJsConnectionResult(result);
    return {
      reachable: validated.ok,
      ...(validated.details?.accountId && typeof validated.details.accountId === 'string' ? { accountId: validated.details.accountId } : {}),
      details: validated.details,
    };
  }

  async discover(asset: CloudAccountAsset, frameworkTypes: string[] | undefined, requestId?: string) {
    const preferredFrameworkType = frameworkTypes?.[0];
    const plugin = await this.createPluginForSelection(asset.tenantId, {
      providerKey: asset.providerKey,
      ...(preferredFrameworkType ? { frameworkType: preferredFrameworkType } : {}),
      operationKey: 'certificate.discover',
    }, asset, 'certificate.discover');
    if (!plugin.instance.discover) {
      throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 插件未实现发现能力', { providerKey: asset.providerKey });
    }
    const discovery = await plugin.instance.discover(
      buildPluginContext(asset, 'certificate.discover', plugin.versionRecord, requestId),
      { frameworkTypes: frameworkTypes ?? [] },
    );
    return validateTrustedJsDiscoveryPayload(discovery);
  }

  async execute(input: {
    tenantId: string;
    asset: CloudAccountAsset;
    frameworkType: string;
    operationKey: string;
    target: ProviderTargetRef;
    requestId?: string;
    input?: Record<string, unknown>;
  }): Promise<ProviderOperationResult> {
    if (input.asset.tenantId !== input.tenantId) {
      throw new AppError('TENANT_SCOPE_DENIED', 'Provider Asset 不属于当前租户', { assetId: input.asset.id });
    }
    const plugin = await this.createPluginForSelection(input.tenantId, {
      providerKey: input.asset.providerKey,
      frameworkType: input.frameworkType,
      operationKey: input.operationKey,
    }, input.asset, input.operationKey);
    const pluginContext = buildPluginContext(input.asset, input.operationKey, plugin.versionRecord, input.requestId);
    const payload = {
      frameworkType: input.frameworkType,
      target: input.target,
      ...(input.input ?? {}),
    };
    let rawResult: unknown;
    if (input.operationKey === 'certificate.deploy') {
      if (!plugin.instance.deployCertificate) {
        throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 插件未实现证书部署能力', {
          providerKey: input.asset.providerKey,
          frameworkType: input.frameworkType,
        });
      }
      rawResult = await plugin.instance.deployCertificate(pluginContext, payload);
    } else if (input.operationKey === 'certificate.rollback') {
      if (!plugin.instance.rollbackCertificate) {
        throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 插件未实现证书回滚能力', {
          providerKey: input.asset.providerKey,
          frameworkType: input.frameworkType,
        });
      }
      rawResult = await plugin.instance.rollbackCertificate(pluginContext, payload);
    } else if (input.operationKey === 'certificate.discover') {
      rawResult = {
        operationId: newId('provider'),
        providerKey: input.asset.providerKey,
        operationKey: input.operationKey,
        status: 'SUCCESS',
        resultSummary: await this.discover(input.asset, [input.frameworkType], input.requestId) as unknown as Record<string, unknown>,
      };
    } else {
      throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 插件不支持该操作', {
        providerKey: input.asset.providerKey,
        operationKey: input.operationKey,
      });
    }
    return validateTrustedJsOperationResult(rawResult);
  }

  async executeByAssetId(input: {
    tenantId: string;
    assetId: string;
    frameworkType: string;
    operationKey: string;
    target: ProviderTargetRef;
    requestId?: string;
    input?: Record<string, unknown>;
  }): Promise<ProviderOperationResult> {
    const asset = await this.dependencies.cloudAccounts.get(input.tenantId, input.assetId);
    return this.execute({
      tenantId: input.tenantId,
      asset,
      frameworkType: input.frameworkType,
      operationKey: input.operationKey,
      target: input.target,
      requestId: input.requestId,
      input: input.input,
    });
  }

  private async listProviderDefinitions(tenantId: string): Promise<ProviderDefinition[]> {
    const versions = await this.dependencies.unifiedPlugins.listAccessibleVersions(tenantId);
    const providers = new Map<string, ProviderDefinition>();
    for (const baseline of this.providerBaselines.values()) {
      providers.set(baseline.providerKey, structuredClone(baseline));
    }
    const trustedProviders = versions
      .filter((record) => record.runtime === 'TRUSTED_JS' && record.status === 'ENABLED' && typeof record.manifest.providerKey === 'string');
    for (const record of trustedProviders) {
      const providerKey = record.manifest.providerKey!;
      const existing = providers.get(providerKey) ?? baselineDefinition(providerKey, 'CUSTOM', []);
      providers.set(providerKey, {
        ...existing,
        providerKey,
        capabilityPluginId: record.pluginId,
        providerExtensionKey: record.pluginId,
        providerExtensionVersion: record.version,
        supportedProducts: uniqueStrings([...(existing.supportedProducts ?? []), ...(record.manifest.supportedProducts ?? [])]),
        supportedOperations: uniqueStrings([...(existing.supportedOperations ?? []), ...(record.manifest.supportedOperations ?? [])]),
        executionLocations: uniqueStrings([
          ...existing.executionLocations,
          ...record.manifest.capabilities.flatMap((item) => item.executionLocations),
        ]) as ProviderDefinition['executionLocations'],
      });
    }
    return [...providers.values()].sort((left, right) => left.providerKey.localeCompare(right.providerKey));
  }

  private async createPluginForSelection(
    tenantId: string,
    selection: TrustedJsProviderPluginSelection,
    asset: CloudAccountAsset,
    capabilityKey: string,
  ): Promise<{ instance: TrustedJsProviderPlugin; versionRecord: UnifiedPluginVersionRecord }> {
    const versionRecord = await this.selectProviderPluginVersion(tenantId, selection);
    const hostApi = this.buildHostApi(versionRecord, asset);
    const module = await this.loadEntrypoint(versionRecord);
    const factory = resolvePluginFactory(module, versionRecord.id);
    const plugin = await factory({
      hostApi,
      plugin: {
        pluginId: versionRecord.pluginId,
        pluginVersionId: versionRecord.id,
        capabilityKey,
        providerKey: versionRecord.manifest.providerKey,
        supportedProducts: versionRecord.manifest.supportedProducts,
        supportedOperations: versionRecord.manifest.supportedOperations,
      },
    });
    if (!plugin || typeof plugin !== 'object') {
      throw new AppError('VALIDATION_FAILED', 'TRUSTED_JS 插件入口没有返回 Provider 插件对象', {
        pluginVersionId: versionRecord.id,
      });
    }
    return { instance: plugin, versionRecord };
  }

  private async selectProviderPluginVersion(
    tenantId: string,
    selection: TrustedJsProviderPluginSelection,
  ): Promise<UnifiedPluginVersionRecord> {
    const versions = await this.dependencies.unifiedPlugins.listAccessibleVersions(tenantId);
    const matched = versions
      .filter((record) => record.runtime === 'TRUSTED_JS' && record.status === 'ENABLED')
      .filter((record) => record.manifest.providerKey === selection.providerKey)
      .filter((record) => !selection.frameworkType || (record.manifest.supportedProducts ?? []).includes(selection.frameworkType))
      .filter((record) => !selection.operationKey || (record.manifest.supportedOperations ?? []).includes(selection.operationKey))
      .sort((left, right) => compareSemanticVersions(right.version, left.version) || right.updatedAt.localeCompare(left.updatedAt));
    const selected = matched[0];
    if (!selected) {
      throw new AppError('PROVIDER_EXTENSION_UNAVAILABLE', '没有启用的 Provider 插件可用', selection);
    }
    return selected;
  }

  private async loadEntrypoint(versionRecord: UnifiedPluginVersionRecord): Promise<Record<string, unknown>> {
    const entrypoint = versionRecord.manifest.resources.runtimeEntrypoint;
    if (!entrypoint) {
      throw new AppError('VALIDATION_FAILED', 'TRUSTED_JS 插件缺少 runtimeEntrypoint', { pluginVersionId: versionRecord.id });
    }
    const directory = await this.materializePlugin(versionRecord);
    const moduleUrl = pathToFileURL(resolve(directory, entrypoint)).href;
    const loaded = await import(moduleUrl);
    return loaded as Record<string, unknown>;
  }

  private async materializePlugin(versionRecord: UnifiedPluginVersionRecord): Promise<string> {
    const existing = this.extractedDirectories.get(versionRecord.id);
    if (existing) return existing;
    const pending = (async () => {
      const root = await resolveTrustedJsMaterializeRoot(versionRecord.id);
      for (const [resourcePath, content] of Object.entries(versionRecord.resources)) {
        const targetPath = resolve(root, resourcePath);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, 'utf8');
      }
      return root;
    })();
    this.extractedDirectories.set(versionRecord.id, pending);
    return pending;
  }

  private buildHostApi(versionRecord: UnifiedPluginVersionRecord, asset: CloudAccountAsset): TrustedPluginHostApi {
    const permissions = versionRecord.approvedPermissions;
    const auditWriter = async (event: WriteAuditInput) => this.dependencies.audit.write(event);
    return {
      cloudAccount: {
        get: async (assetId: string) => {
          assertTrustedJsHostApiAccess('cloudAccount.get', permissions);
          if (assetId === asset.id) return structuredClone(asset);
          return this.dependencies.cloudAccounts.get(asset.tenantId, assetId);
        },
      },
      credential: {
        resolveCloudCredential: async (assetId: string) => {
          assertTrustedJsHostApiAccess('credential.resolveCloudCredential', permissions);
          const cloudAsset = assetId === asset.id
            ? asset
            : await this.dependencies.cloudAccounts.get(asset.tenantId, assetId);
          return this.credentialResolver.resolve(cloudAsset);
        },
      },
      artifact: {
        readCertificateMaterial: async (ref: string) => {
          assertTrustedJsHostApiAccess('artifact.readCertificateMaterial', permissions);
          const material = await this.certificateResolver.resolve(ref, asset.tenantId);
          return {
            certificatePem: String(material.certificatePem ?? material.certificate ?? ''),
            privateKeyPem: String(material.privateKeyPem ?? material.privateKey ?? ''),
            ...(material.chainPem ? { certificateChainPem: String(material.chainPem) } : {}),
            ...(material.serialNumber ? { serialNumber: String(material.serialNumber) } : {}),
            ...(material.sha256Fingerprint ? { sha256Fingerprint: String(material.sha256Fingerprint) } : {}),
            ...(material.notBefore ? { notBefore: String(material.notBefore) } : {}),
            ...(material.notAfter ? { notAfter: String(material.notAfter) } : {}),
          };
        },
      },
      http: {
        request: async (input) => {
          assertTrustedJsHostApiAccess('http.request', permissions);
          const url = withQuery(input.url, input.query);
          const response = await this.transport.request({
            method: input.method,
            url,
            headers: input.headers,
            body: input.body,
            timeoutMs: input.timeoutMs,
          });
          return {
            status: response.status,
            headers: response.headers,
            ...(response.body ? { body: response.body } : {}),
          };
        },
      },
      audit: {
        record: async (event) => {
          assertTrustedJsHostApiAccess('audit.record', permissions);
          await auditWriter({
            eventType: 'plugin.trusted_js.audit',
            actorType: 'system',
            actorId: versionRecord.pluginId,
            action: event.action,
            resourceType: 'pluginVersion',
            resourceId: versionRecord.id,
            result: event.status === 'SUCCESS' ? 'success' : event.status === 'FAILED' ? 'failure' : 'denied',
            riskLevel: 'medium',
            context: { tenantId: asset.tenantId },
            detail: {
              summary: event.summary,
              pluginId: versionRecord.pluginId,
              providerKey: asset.providerKey,
            },
          });
        },
      },
      checkpoint: {
        save: async (input) => {
          assertTrustedJsHostApiAccess('checkpoint.save', permissions);
          const ref = `inline://${Buffer.from(JSON.stringify({
            checkpointName: input.checkpointName,
            payload: input.payload,
          }), 'utf8').toString('base64url')}`;
          await auditWriter({
            eventType: 'plugin.trusted_js.checkpoint.saved',
            actorType: 'system',
            actorId: versionRecord.pluginId,
            action: 'plugin.checkpoint.save',
            resourceType: 'pluginVersion',
            resourceId: versionRecord.id,
            result: 'success',
            riskLevel: 'medium',
            context: { tenantId: asset.tenantId },
            detail: { checkpointName: input.checkpointName },
          });
          return { ref };
        },
        load: async (ref) => {
          assertTrustedJsHostApiAccess('checkpoint.load', permissions);
          return decodeInlineCheckpoint(ref);
        },
      },
      lock: {
        acquire: async (resourceKey: string) => {
          assertTrustedJsHostApiAccess('lock.acquire', permissions);
          const record = await this.resourceLocks.acquire({
            tenantId: asset.tenantId,
            resourceKey: normalizePluginLockKey(asset.tenantId, resourceKey),
            mode: 'WRITE',
            ownerRunId: `plugin:${versionRecord.id}`,
            ownerStepId: `asset:${asset.id}`,
            ttlSeconds: 300,
          });
          return { ref: record.id, resourceKey };
        },
        release: async (lockRef) => {
          assertTrustedJsHostApiAccess('lock.release', permissions);
          await this.resourceLocks.release({
            tenantId: asset.tenantId,
            lockId: lockRef.ref,
            ownerRunId: `plugin:${versionRecord.id}`,
            ownerStepId: `asset:${asset.id}`,
          });
        },
      },
      asyncOperation: {
        wait: async (input) => {
          assertTrustedJsHostApiAccess('asyncOperation.wait', permissions);
          return waitForAsyncOperation(input);
        },
      },
    };
  }
}

async function defaultConnectionTest(
  resolver: CredentialProfileProviderCredentialResolver,
  asset: CloudAccountAsset,
): Promise<TrustedJsConnectionResult> {
  const credential = await resolver.resolve(asset);
  return {
    ok: true,
    details: {
      accountId: asset.accountId,
      credentialSlots: Object.keys(credential).sort(),
    },
  };
}

function buildPluginContext(
  asset: CloudAccountAsset,
  capabilityKey: string,
  versionRecord: UnifiedPluginVersionRecord,
  requestId?: string,
): TrustedJsPluginContext {
  return {
    tenantId: asset.tenantId,
    pluginId: versionRecord.pluginId,
    pluginVersionId: versionRecord.id,
    capabilityKey,
    assetId: asset.id,
    ...(requestId ? { requestId } : {}),
  };
}

function resolvePluginFactory(module: Record<string, unknown>, pluginVersionId: string): TrustedJsProviderPluginFactory {
  const candidate = module.default ?? module.createPlugin ?? module.plugin;
  if (typeof candidate === 'function') return candidate as TrustedJsProviderPluginFactory;
  if (candidate && typeof candidate === 'object') {
    return async () => candidate as TrustedJsProviderPlugin;
  }
  throw new AppError('VALIDATION_FAILED', 'TRUSTED_JS 插件入口必须导出对象或工厂函数', { pluginVersionId });
}

function baselineDefinition(
  providerKey: string,
  signerType: ProviderDefinition['signerType'],
  supportedProducts: string[],
): ProviderDefinition {
  const token = providerKey.split('.').at(-1) ?? providerKey;
  return {
    providerKey,
    displayNameKey: `providers.providerNames.${token}`,
    capabilityPluginId: `builtin.${providerKey}`,
    providerExtensionKey: `builtin.${providerKey}`,
    providerExtensionVersion: '1.0.0',
    supportedProducts,
    supportedOperations: ['provider.connection.test', 'certificate.discover', 'certificate.deploy', 'certificate.rollback'],
    credentialSchemaId: `gcac.${token}.credential/v1`,
    scopeSchemaId: `gcac.${token}.scope/v1`,
    executionLocations: ['CONTROL_PLANE'],
    signerType,
    contractVersion: 'gcac.provider-plugin/v1',
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((item) => item.trim() !== ''))];
}

function withQuery(url: string, query?: Record<string, string | number | boolean>): string {
  if (!query || Object.keys(query).length === 0) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
  return target.toString();
}

function decodeInlineCheckpoint(ref: string): Record<string, unknown> {
  if (!ref.startsWith('inline://')) {
    throw new AppError('VALIDATION_FAILED', '当前只支持 inline checkpoint 引用', { ref });
  }
  const encoded = ref.slice('inline://'.length);
  const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  const value = JSON.parse(decoded) as Record<string, unknown>;
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw new AppError('VALIDATION_FAILED', 'checkpoint 载荷无效', { ref });
  }
  return value.payload as Record<string, unknown>;
}

function normalizePluginLockKey(tenantId: string, resourceKey: string): string {
  const normalized = resourceKey.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
  return `tenant:${tenantId}:standalone:${normalized || 'plugin_resource'}`;
}

async function waitForAsyncOperation(input: TrustedJsAsyncWaitInput): Promise<TrustedJsAsyncWaitResult> {
  const startedAt = Date.now();
  const intervalMs = Math.max(250, input.intervalMs ?? 1_000);
  while (Date.now() - startedAt < input.timeoutMs) {
    const mockedStatus = typeof input.metadata?.mockStatus === 'string' ? input.metadata.mockStatus : undefined;
    if (mockedStatus === 'SUCCESS' || mockedStatus === 'FAILED') {
      return { status: mockedStatus, summary: { operationName: input.operationName, requestId: input.requestId } };
    }
    await sleep(intervalMs);
  }
  return {
    status: 'TIMEOUT',
    summary: { operationName: input.operationName, requestId: input.requestId },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function resolveTrustedJsMaterializeRoot(pluginVersionId: string): Promise<string> {
  const candidates = [
    resolve(process.cwd(), '.gcac-trusted-js-runtime'),
    resolve(process.cwd(), 'backend', '.gcac-trusted-js-runtime'),
  ];
  for (const candidate of candidates) {
    const packageJson = resolve(candidate, '..', 'package.json');
    const nodeModules = resolve(candidate, '..', 'node_modules');
    try {
      await access(packageJson);
      await access(nodeModules);
      return resolve(candidate, pluginVersionId);
    } catch {
      // 继续尝试下一个候选目录。
    }
  }
  return resolve(candidates[0]!, pluginVersionId);
}

function readTarget(input: Record<string, unknown>): ProviderTargetRef {
  const value = input.target;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('VALIDATION_FAILED', 'Provider 插件执行输入缺少 target');
  }
  const target = value as Record<string, unknown>;
  if (typeof target.frameworkType !== 'string' || typeof target.resourceId !== 'string') {
    throw new AppError('VALIDATION_FAILED', 'Provider 插件 target 缺少 frameworkType/resourceId');
  }
  return {
    frameworkType: target.frameworkType,
    resourceId: target.resourceId,
    ...(typeof target.domain === 'string' ? { domain: target.domain } : {}),
    ...(typeof target.listenerId === 'string' ? { listenerId: target.listenerId } : {}),
    ...(typeof target.certificateId === 'string' ? { certificateId: target.certificateId } : {}),
    ...(target.metadata && typeof target.metadata === 'object' && !Array.isArray(target.metadata)
      ? { metadata: target.metadata as Record<string, unknown> }
      : {}),
  };
}
