import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';
import type { ResolvedManagedTargetTopology } from '../../assets/application/managed-target-context.resolver.js';
import type { DeviceAssetDto } from '../../device-assets/dto/device-assets.dto.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
import {
  DEPLOYMENT_ASSET_CONTEXT_API_VERSION,
  type DeploymentAssetContextV1,
} from '../dto/deployment-asset-context.dto.js';
import { validateDeploymentAssetContextV1 } from '../schema/deployment-asset-context.schema.js';
import { readCertificateLocation } from '../dto/certificate-location.dto.js';

export interface BuildDeploymentAssetContextInput {
  applicationAsset: {
    id: string;
    address: string;
    sniName?: string;
    verifyUrl?: string;
    port: number;
    protocol: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
  };
  managedTargetContext?: ResolvedManagedTargetTopology;
  /** 历史 CertificateBinding 可能保存比 ManagedTarget 投影更完整的部署位置事实。 */
  certificateBinding?: CertificateBindingDto;
}

// ManagedTarget 是部署输入的边界资源；元数据缺失时无法判断证书位置，禁止静默转换为空对象。
export function requireManagedTargetMetadata(input: { id: string; metadata?: unknown }): Record<string, unknown> {
  const metadata = input.metadata;
  if (metadata === undefined || metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new AppError('DEPLOYMENT_ASSET_CONTEXT_INVALID', '受管目标 metadata 必须是对象', {
      code: metadata === undefined || metadata === null ? 'MANAGED_TARGET_METADATA_MISSING' : 'MANAGED_TARGET_METADATA_INVALID',
      path: 'managedTarget.metadata',
      managedTargetId: input.id,
      valueType: metadata === null ? 'null' : Array.isArray(metadata) ? 'array' : typeof metadata,
    });
  }
  return metadata as Record<string, unknown>;
}

export class DeploymentAssetContextBuilder {
  build(input: BuildDeploymentAssetContextInput): DeploymentAssetContextV1 {
    const application = buildApplication(input.applicationAsset);
    const topology = input.managedTargetContext;
    const site = topology?.siteAsset;
    const managedTarget = topology?.managedTarget;
    const managedTargetMetadata = managedTarget ? requireManagedTargetMetadata(managedTarget) : undefined;
    const targetMetadata = managedTargetMetadata
      ? mergeFrameworkTypeFact(
        mergeManagedTargetListenerFacts(
          mergeSiteRuntimeFacts(
            mergeCertificateBindingFacts(managedTargetMetadata, input.certificateBinding),
            site?.metadata,
          ),
        ),
        topology?.frameworkType,
      )
      : undefined;
    const workflowTargetSiteName = readWorkflowTargetSiteName(input.applicationAsset.metadata);
    const certificateLocation = targetMetadata
      ? readCertificateLocation(
        mergeFrameworkRuntimeFacts(targetMetadata, topology?.serviceInstance?.rawFacts),
        managedTarget?.updatedAt || new Date(0).toISOString(),
      )
      : undefined;
    const deploymentTargetName = site?.siteName
      ?? managedTarget?.targetKey
      ?? workflowTargetSiteName
      ?? input.applicationAsset.displayName
      ?? application.serverName;
    const deploymentServerName = site?.hostHeader ?? application.serverName;

    return validateDeploymentAssetContextV1({
      apiVersion: DEPLOYMENT_ASSET_CONTEXT_API_VERSION,
      application,
      host: topology?.host ? {
        id: topology.host.id,
        hostname: topology.host.hostname,
        primaryIp: topology.host.primaryIp,
        osType: topology.host.osType,
      } : undefined,
      site: site ? {
        id: site.id,
        type: site.siteType,
        name: site.siteName,
        key: site.siteKey,
        // ManagedTarget.bindingKey 是宿主稳定标识（例如 iis:*:443:example.com），
        // 不是 IIS ServerManager 返回的原生 BindingInformation。原生事实缺失时
        // 必须让输入门禁失败关闭，不能把稳定标识伪装成可写入的绑定。
        bindingInformation: site.bindingInformation ?? readNonEmptyString(targetMetadata?.bindingInformation),
        hostHeader: site.hostHeader,
        listenIp: site.listenIp,
        port: site.port,
        protocol: site.protocol,
        metadata: { ...site.metadata },
      } : undefined,
      target: managedTarget ? {
        id: managedTarget.id,
        type: managedTarget.targetType,
        key: managedTarget.targetKey,
        bindingKey: managedTarget.bindingKey,
        certificateLocation,
        metadata: { ...targetMetadata },
      } : undefined,
      deployment: {
        targets: [{
          id: managedTarget?.id,
          name: deploymentTargetName,
          serverName: deploymentServerName,
          port: site?.port ?? application.port,
          sni: deploymentServerName.length > 0,
          certificateLocation,
          metadata: targetMetadata ? { ...targetMetadata } : {},
        }],
        certificateResourceName: buildCertificateResourceName(application.serverName),
      },
    });
  }

  buildForDevice(device: Pick<DeviceAssetDto, 'id' | 'hostId' | 'displayName' | 'managementAddress' | 'managementPort'>): DeploymentAssetContextV1 {
    const serverName = device.managementAddress.trim();
    return validateDeploymentAssetContextV1({
      apiVersion: DEPLOYMENT_ASSET_CONTEXT_API_VERSION,
      application: {
        id: device.id,
        address: serverName,
        serverName,
        port: device.managementPort,
        protocol: device.managementPort === 443 ? 'https' : 'http',
      },
      host: {
        id: device.hostId,
        hostname: device.displayName,
        primaryIp: serverName,
      },
      deployment: {
        targets: [{
          id: device.id,
          name: device.displayName,
          serverName,
          port: device.managementPort,
          sni: false,
          metadata: {},
        }],
        certificateResourceName: buildCertificateResourceName(serverName),
      },
    });
  }
}

export const deploymentAssetContextBuilder = new DeploymentAssetContextBuilder();

function buildApplication(
  applicationAsset: BuildDeploymentAssetContextInput['applicationAsset'],
): DeploymentAssetContextV1['application'] {
  const configuredServerName = applicationAsset.sniName?.trim();
  const accessDomain = applicationAsset.address.trim();
  // 旧版表单未填写 SNI 时会把连接 IP 持久化为 sniName；访问域名才是资产的证书身份。
  const legacyAddressSni = configuredServerName
    && isIP(configuredServerName) !== 0
    && isIP(accessDomain) === 0;
  const serverName = legacyAddressSni
    ? accessDomain
    : configuredServerName || accessDomain;
  return {
    id: applicationAsset.id,
    address: applicationAsset.address,
    serverName,
    port: applicationAsset.port,
    protocol: applicationAsset.protocol,
  };
}

function buildCertificateResourceName(serverName: string): string {
  const normalized = serverName.trim().toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'application';
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 10);
  return `certificate-${slug}-${digest}`;
}

function readWorkflowTargetSiteName(metadata: Record<string, unknown> | undefined): string | undefined {
  const target = metadata?.workflowTarget;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  const siteName = (target as Record<string, unknown>).siteName;
  if (typeof siteName !== 'string') return undefined;
  const normalized = siteName.trim();
  return normalized || undefined;
}

// FrameworkInstance 是当前框架事实的可信来源，但不能覆盖历史 Target 已保存的事实。
// 保留已有值可以让输入门禁继续发现并拒绝框架冲突，而不是把错误数据静默修正掉。
function mergeFrameworkTypeFact(metadata: Record<string, unknown>, frameworkType: string | undefined): Record<string, unknown> {
  if (readNonEmptyString(metadata.frameworkType) || !frameworkType?.trim()) return { ...metadata };
  return { ...metadata, frameworkType: frameworkType.trim() };
}

/**
 * 标准发现会把框架运行摘要同时写入 Site metadata。旧 Target 只有证书位置时，
 * 允许 Site 事实补齐缺失字段，但不覆盖 Target 自己已经确认的值。
 */
function mergeSiteRuntimeFacts(metadata: Record<string, unknown>, siteMetadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!siteMetadata) return { ...metadata };
  const listeners = Array.isArray(siteMetadata.listeners)
    ? siteMetadata.listeners.map(asRecord).filter((value): value is Record<string, unknown> => Boolean(value))
    : [];
  const listener = listeners.find((value) => readNonEmptyString(value.protocol)?.toUpperCase() === 'HTTPS') ?? listeners[0];
  const siteFacts = {
    ...pickCertificateLocationRuntimeFacts(listener),
    ...pickCertificateLocationRuntimeFacts(siteMetadata),
  };
  const promoted = Object.fromEntries(Object.entries(siteFacts).filter(([key, value]) => isMissingRuntimeFact(metadata[key]) && value !== undefined));
  return { ...metadata, ...promoted };
}

/**
 * 旧版发现结果可能只把证书路径写入 Target，运行参数仍保留在同一
 * Framework 的 rawFacts 中。这里仅补齐缺失事实，绝不覆盖 Target 已确认值。
 */
function mergeFrameworkRuntimeFacts(
  metadata: Record<string, unknown>,
  rawFacts: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const currentLocation = asRecord(metadata.certificateLocation);
  const frameworkLocation = asRecord(rawFacts?.certificateLocation);
  const runtimeFacts = {
    ...pickCertificateLocationRuntimeFacts(metadata),
    ...pickCertificateLocationRuntimeFacts(rawFacts),
  };
  if (!rawFacts && !currentLocation) return metadata;
  if (currentLocation) {
    // 历史投影可能把未识别字段写成空字符串；空值不是 Agent 已确认事实，
    // 不能覆盖 Framework rawFacts 中的有效服务名、程序路径等运行事实。
    const meaningfulCurrentLocation = omitEmptyRuntimeFacts(currentLocation);
    const meaningfulFrameworkLocation = omitEmptyRuntimeFacts(frameworkLocation);
    return {
      ...metadata,
      certificateLocation: {
        ...runtimeFacts,
        ...meaningfulFrameworkLocation,
        ...meaningfulCurrentLocation,
      },
    };
  }
  return { ...rawFacts, ...metadata };
}

/**
 * 旧版资产投影可能没有把 CertificateBinding 的部署位置提升到 ManagedTarget。
 * 绑定是补充事实源：只补齐缺失字段，不能覆盖 Agent 已确认的 Target 事实。
 */
function mergeCertificateBindingFacts(
  metadata: Record<string, unknown>,
  binding: CertificateBindingDto | undefined,
): Record<string, unknown> {
  if (!binding) return { ...metadata };
  const bindingMetadata = asRecord(binding.metadata);
  const bindingLocation = asRecord(bindingMetadata?.certificateLocation)
    ?? asRecord(bindingMetadata?.deploymentTarget);
  const topLevelLocation = {
    ...(binding.keystorePath ? { keystorePath: binding.keystorePath } : {}),
    ...(binding.keystoreType ? { keystoreType: binding.keystoreType } : {}),
    ...(binding.certPath ? { certificatePath: binding.certPath } : {}),
    ...(binding.keyPath ? { privateKeyPath: binding.keyPath } : {}),
    ...(binding.chainPath ? { chainPath: binding.chainPath } : {}),
    ...(binding.storeLocation ? { storeLocation: binding.storeLocation } : {}),
    ...(binding.storeName ? { storeName: binding.storeName } : {}),
    ...(binding.storeThumbprint ? { storeThumbprint: binding.storeThumbprint } : {}),
    ...(binding.localConfigPath ? { sourceConfigPath: binding.localConfigPath } : {}),
    ...(binding.localConfigFingerprint ? { configFingerprint: binding.localConfigFingerprint } : {}),
    ...(binding.reloadCommand ? { reloadCommand: binding.reloadCommand } : {}),
  };
  const bindingFacts = {
    ...pickCertificateLocationRuntimeFacts(bindingMetadata),
    ...topLevelLocation,
    ...pickCertificateLocationRuntimeFacts(bindingLocation),
  };
  const currentLocation = asRecord(metadata.certificateLocation);
  const promoted = Object.fromEntries(Object.entries(bindingFacts).filter(([key, value]) => isMissingRuntimeFact(metadata[key]) && value !== undefined));
  const mergedLocation = Object.keys(bindingFacts).length > 0 || currentLocation
    ? { ...bindingFacts, ...omitEmptyRuntimeFacts(currentLocation) }
    : undefined;
  return {
    ...metadata,
    ...promoted,
    ...(mergedLocation ? { certificateLocation: mergedLocation } : {}),
  };
}

/**
 * 历史投影把证书位置存成嵌套对象，但把运行事实保留在 Target/listener 顶层。
 * 只提取证书位置合同允许的字段，避免把 listener、厂商字段复制进位置对象。
 * Framework rawFacts 优先于 Target 顶层事实，当前嵌套 certificateLocation 最终优先。
 */
function pickCertificateLocationRuntimeFacts(source: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!source) return {};
  const keys = [
    'storageKind',
    'keystoreType',
    'keyAlias',
    'storeName',
    'storeLocation',
    'storeThumbprint',
    'sourceConfigPath',
    'configPath',
    'serviceName',
    'programPath',
    'programSha256',
    'workingDirectory',
    'testCommand',
    'reloadCommand',
    'configFingerprint',
  ] as const;
  return Object.fromEntries(keys.flatMap((key) => {
    const value = source[key];
    if (value === undefined) return [];
    if (key === 'configPath' && source.sourceConfigPath !== undefined) return [];
    return [[key === 'configPath' ? 'sourceConfigPath' : key, value]];
  }));
}

/**
 * 标准发现投影会把监听器原始事实保存在 metadata.listener 中。
 * 证书输入合同消费的是统一 Target metadata，因此只提升标准运行事实，
 * 不把厂商字段或监听器对象整体复制到合同上下文。
 */
function mergeManagedTargetListenerFacts(metadata: Record<string, unknown>): Record<string, unknown> {
  const listener = asRecord(metadata.listener);
  if (!listener) return { ...metadata };
  const runtimeFactKeys = [
    'bindingInformation',
    'serviceName',
    'programPath',
    'programSha256',
    'programDigest',
    'workingDirectory',
    'programWorkingDirectory',
    'configCheckArgs',
    'configCheckArgsTemplate',
    'testArgs',
    'configFingerprint',
  ] as const;
  const promoted = Object.fromEntries(runtimeFactKeys.flatMap((key) => (
    isMissingRuntimeFact(metadata[key]) && listener[key] !== undefined ? [[key, listener[key]]] : []
  )));
  return { ...metadata, ...promoted };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function isMissingRuntimeFact(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.trim() === '');
}

function omitEmptyRuntimeFacts(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => !isMissingRuntimeFact(item)));
}
