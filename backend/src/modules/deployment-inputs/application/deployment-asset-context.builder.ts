import { createHash } from 'node:crypto';
import type { ResolvedManagedTargetTopology } from '../../assets/application/managed-target-context.resolver.js';
import type { ServiceAssetDto } from '../../assets/dto/assets.dto.js';
import {
  DEPLOYMENT_ASSET_CONTEXT_API_VERSION,
  type DeploymentAssetContextV1,
} from '../dto/deployment-asset-context.dto.js';
import { validateDeploymentAssetContextV1 } from '../schema/deployment-asset-context.schema.js';

export interface BuildDeploymentAssetContextInput {
  applicationAsset: Pick<ServiceAssetDto, 'id' | 'address' | 'sniName' | 'port' | 'protocol' | 'displayName'>;
  managedTargetContext?: ResolvedManagedTargetTopology;
}

export class DeploymentAssetContextBuilder {
  build(input: BuildDeploymentAssetContextInput): DeploymentAssetContextV1 {
    const application = buildApplication(input.applicationAsset);
    const topology = input.managedTargetContext;
    const site = topology?.siteAsset;
    const managedTarget = topology?.managedTarget;
    const deploymentTargetName = site?.siteName ?? managedTarget?.targetKey ?? input.applicationAsset.displayName ?? application.serverName;
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
        metadata: { ...managedTarget.metadata },
      } : undefined,
      deployment: {
        targets: [{
          id: managedTarget?.id,
          name: deploymentTargetName,
          serverName: deploymentServerName,
          port: site?.port ?? application.port,
          sni: deploymentServerName.length > 0,
          metadata: managedTarget ? { ...managedTarget.metadata } : {},
        }],
        certificateResourceName: buildCertificateResourceName(application.serverName),
      },
    });
  }
}

export const deploymentAssetContextBuilder = new DeploymentAssetContextBuilder();

function buildApplication(
  applicationAsset: BuildDeploymentAssetContextInput['applicationAsset'],
): DeploymentAssetContextV1['application'] {
  return {
    id: applicationAsset.id,
    address: applicationAsset.address,
    serverName: applicationAsset.sniName?.trim() || applicationAsset.address,
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
