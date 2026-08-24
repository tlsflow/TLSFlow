import type {
  CompatibilityLevel,
  ManagementMode,
  OsType,
  ProviderType,
} from '../../../shared/enums/core.enums.js';

export type HostStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'RETIRED';
export type ServiceInstanceStatus = 'ACTIVE' | 'STALE' | 'UNREACHABLE' | 'RETIRED';
export type ServiceEndpointStatus = 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
export type DiscoverySource = 'AGENT' | 'SSH' | 'MANUAL' | 'GATEWAY';
export type ServiceEndpointProtocol = 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP';

export interface HostDto {
  id: string;
  tenantId: string;
  hostname: string;
  displayName?: string;
  primaryIp?: string;
  ipAddresses: string[];
  osType: OsType;
  osName?: string;
  osVersion?: string;
  arch?: string;
  environment?: string;
  zoneId?: string;
  compatibilityLevel: CompatibilityLevel;
  managementMode: ManagementMode;
  status: HostStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateHostDto {
  hostname: string;
  displayName?: string;
  primaryIp?: string;
  ipAddresses?: string[];
  osType?: OsType;
  osName?: string;
  osVersion?: string;
  arch?: string;
  environment?: string;
  zoneId?: string;
  compatibilityLevel?: CompatibilityLevel;
  managementMode?: ManagementMode;
  status?: HostStatus;
  tags?: string[];
}

export type UpdateHostDto = Partial<CreateHostDto>;

export interface ServiceInstanceDto {
  id: string;
  tenantId: string;
  hostId: string;
  providerType: ProviderType;
  serviceName?: string;
  displayName: string;
  versionText?: string;
  installPath?: string;
  configPath?: string;
  runtimeUser?: string;
  discoverySource: DiscoverySource;
  lastDiscoveredAt?: string;
  status: ServiceInstanceStatus;
  rawFacts: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateServiceInstanceDto {
  hostId: string;
  providerType: ProviderType;
  serviceName?: string;
  displayName: string;
  versionText?: string;
  installPath?: string;
  configPath?: string;
  runtimeUser?: string;
  discoverySource?: DiscoverySource;
  lastDiscoveredAt?: string;
  status?: ServiceInstanceStatus;
  rawFacts?: Record<string, unknown>;
}

export type UpdateServiceInstanceDto = Partial<Omit<CreateServiceInstanceDto, 'hostId'>> & {
  hostId?: string;
};

export interface ServiceEndpointDto {
  id: string;
  tenantId: string;
  serviceInstanceId: string;
  hostId: string;
  protocol: ServiceEndpointProtocol;
  hostName?: string;
  listenIp?: string;
  port: number;
  pathHint?: string;
  status: ServiceEndpointStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}

export interface CreateServiceEndpointDto {
  serviceInstanceId: string;
  protocol: ServiceEndpointProtocol;
  hostName?: string;
  listenIp?: string;
  port: number;
  pathHint?: string;
  status?: ServiceEndpointStatus;
}

export type UpdateServiceEndpointDto = Partial<CreateServiceEndpointDto>;

export interface DiscoverySnapshotDto {
  id: string;
  tenantId: string;
  normalizedHash: string;
  source: DiscoverySource;
  normalizedPayload: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateDiscoverySnapshotDto {
  normalizedHash: string;
  source?: DiscoverySource;
  normalizedPayload?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}

export interface DiscoveryMergePreviewDto {
  snapshot: DiscoverySnapshotDto;
  actions: Array<{
    kind: 'host' | 'service' | 'endpoint' | 'binding';
    action: 'create' | 'update' | 'skip' | 'conflict';
    identityKey: string;
    existingId?: string;
    reason: string;
  }>;
  conflicts: Array<{
    kind: 'host' | 'service' | 'endpoint' | 'binding';
    identityKey: string;
    field: string;
    currentValue: unknown;
    discoveredValue: unknown;
    reason: string;
  }>;
  businessTableMutated: false;
}

export interface PreviewDiscoveryMergeDto extends CreateDiscoverySnapshotDto {}
