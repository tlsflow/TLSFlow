import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';
import type { ResolvedManagedTargetTopology } from '../../assets/application/managed-target-context.resolver.js';
import type { DeviceAssetDto } from '../../device-assets/dto/device-assets.dto.js';
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
      ? mergeFrameworkTypeFact(mergeManagedTargetListenerFacts(managedTargetMetadata), topology?.frameworkType)
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
      host: topology ? {
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
    return {
      ...metadata,
      certificateLocation: {
        ...runtimeFacts,
        ...frameworkLocation,
        ...currentLocation,
      },
    };
  }
  return { ...rawFacts, ...metadata };
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
    metadata[key] === undefined && listener[key] !== undefined ? [[key, listener[key]]] : []
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
