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
    const workflowTargetSiteName = readWorkflowTargetSiteName(input.applicationAsset.metadata);
    const certificateLocation = managedTargetMetadata
      ? readCertificateLocation(
        mergeFrameworkRuntimeFacts(managedTargetMetadata, topology?.serviceInstance?.rawFacts),
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
        bindingInformation: site.bindingInformation ?? managedTarget?.bindingKey,
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
        metadata: { ...managedTargetMetadata },
      } : undefined,
      deployment: {
        targets: [{
          id: managedTarget?.id,
          name: deploymentTargetName,
          serverName: deploymentServerName,
          port: site?.port ?? application.port,
          sni: deploymentServerName.length > 0,
          certificateLocation,
          metadata: managedTargetMetadata ? { ...managedTargetMetadata } : {},
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

/**
 * 旧版发现结果可能只把证书路径写入 Target，运行参数仍保留在同一
 * Framework 的 rawFacts 中。这里仅补齐缺失事实，绝不覆盖 Target 已确认值。
 */
function mergeFrameworkRuntimeFacts(
  metadata: Record<string, unknown>,
  rawFacts: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!rawFacts) return metadata;
  const currentLocation = asRecord(metadata.certificateLocation);
  const frameworkLocation = asRecord(rawFacts.certificateLocation);
  if (currentLocation) {
    return {
      ...metadata,
      certificateLocation: {
        ...rawFacts,
        ...frameworkLocation,
        ...currentLocation,
      },
    };
  }
  return { ...rawFacts, ...metadata };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
