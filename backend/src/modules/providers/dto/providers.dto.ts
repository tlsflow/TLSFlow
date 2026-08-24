import type { ProviderType } from '../../../shared/enums/core.enums.js';
import type { DiscoverySource } from '../../assets/dto/assets.dto.js';

export type ProviderCapability =
  | 'DISCOVERY'
  | 'STEP_DRAFT_MAPPING'
  | 'SNAPSHOT_PERSISTENCE';

export type ProviderStage = 'HOST' | 'SERVICE' | 'ENDPOINT' | 'BINDING';
export type DiscoveryNodeKind = 'HOST' | 'SERVICE' | 'ENDPOINT' | 'BINDING';
export type DeploymentStepAction =
  | 'CONNECT'
  | 'BACKUP'
  | 'VALIDATE'
  | 'INSTALL_CERTIFICATE'
  | 'INSTALL_PRIVATE_KEY'
  | 'INSTALL_CERTIFICATE_CHAIN'
  | 'UPDATE_CONFIG'
  | 'RELOAD_SERVICE'
  | 'VERIFY_BINDING'
  | 'ROLLBACK'
  | 'RENDER_COMMAND'
  | 'RENDER_FILE'
  | 'HTTP_REQUEST'
  | 'MANUAL_APPROVAL'
  | 'MANUAL_CHECK';

export interface ProviderMetadata {
  id: string;
  type: ProviderType;
  displayName: string;
  description: string;
  version: string;
  capabilities: ProviderCapability[];
  supportedDiscoverySources: DiscoverySource[];
  supportedStages: ProviderStage[];
  tags: string[];
  priority?: number;
}

export interface ProviderDescriptor {
  metadata: ProviderMetadata;
  matchRules: {
    providerType: ProviderType;
    serviceNames?: string[];
    configPathPatterns?: string[];
    endpointProtocols?: string[];
    hostnamePatterns?: string[];
    tags?: string[];
  };
}

export interface DiscoveryHostResult {
  key: string;
  hostname: string;
  displayName?: string;
  primaryIp?: string;
  ipAddresses: string[];
  osType?: string;
  osName?: string;
  osVersion?: string;
  environment?: string;
  zoneId?: string;
  tags: string[];
  rawFacts?: Record<string, unknown>;
}

export interface DiscoveryServiceResult {
  key: string;
  hostKey: string;
  providerType: ProviderType;
  serviceName?: string;
  displayName: string;
  versionText?: string;
  installPath?: string;
  configPath?: string;
  runtimeUser?: string;
  status?: string;
  rawFacts?: Record<string, unknown>;
}

export interface DiscoveryEndpointResult {
  key: string;
  serviceKey: string;
  protocol: string;
  hostName?: string;
  listenIp?: string;
  port: number;
  pathHint?: string;
  status?: string;
  rawFacts?: Record<string, unknown>;
}

export interface DiscoveryBindingResult {
  key: string;
  endpointKey: string;
  bindingType: string;
  domainName?: string;
  certificateRef?: string;
  privateKeyRef?: string;
  configPath?: string;
  rawFacts?: Record<string, unknown>;
}

export type DiscoveryServiceInstanceResult = DiscoveryServiceResult;
export type DiscoveryCertificateBindingResult = DiscoveryBindingResult;

export interface DiscoveryServiceAssetResult {
  key: string;
  serviceKey: string;
  endpointKey?: string;
  address: string;
  addressType?: 'DNS' | 'IPV4' | 'IPV6' | 'UNKNOWN';
  port: number;
  protocol: 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP';
  sniName?: string;
  displayName?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED';
  rawFacts?: Record<string, unknown>;
}

export interface DiscoverySiteAssetResult {
  key: string;
  serviceKey: string;
  serviceAssetKey?: string;
  agentKey?: string;
  siteType: 'WEB_SITE' | 'VHOST' | 'CONNECTOR' | 'CUSTOM';
  siteName: string;
  siteKey?: string;
  bindingInformation?: string;
  hostHeader?: string;
  listenIp?: string;
  port?: number;
  protocol?: 'HTTPS' | 'TLS' | 'STARTTLS' | 'HTTP';
  configPath?: string;
  runtimeStatus?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN' | 'STALE' | 'DISABLED' | 'RETIRED';
  rawFacts?: Record<string, unknown>;
}

export interface DiscoveryRiskEventResult {
  key: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  message: string;
  serviceKey?: string;
  endpointKey?: string;
  serviceAssetKey?: string;
  bindingKey?: string;
  rawFacts?: Record<string, unknown>;
}

export interface DiscoveryCapabilityGapResult {
  key: string;
  capability: string;
  reason: string;
  providerStrategy?: 'AGENT' | 'SSH' | 'WINRM' | 'GATEWAY' | 'MANUAL' | 'SCRIPT_PACKAGE' | 'MONITOR_ONLY';
  serviceKey?: string;
  endpointKey?: string;
  serviceAssetKey?: string;
  bindingKey?: string;
  rawFacts?: Record<string, unknown>;
}

export interface DiscoveryResult {
  providerId: string;
  providerType: ProviderType;
  source: DiscoverySource;
  discoveredAt: string;
  scope?: Record<string, string>;
  hosts: DiscoveryHostResult[];
  services: DiscoveryServiceResult[];
  serviceInstances?: DiscoveryServiceInstanceResult[];
  endpoints: DiscoveryEndpointResult[];
  bindings: DiscoveryBindingResult[];
  serviceAssets?: DiscoveryServiceAssetResult[];
  siteAssets?: DiscoverySiteAssetResult[];
  certificateBindings?: DiscoveryCertificateBindingResult[];
  riskEvents?: DiscoveryRiskEventResult[];
  capabilityGaps?: DiscoveryCapabilityGapResult[];
  rawPayload?: Record<string, unknown>;
}

export interface DeploymentStepDraft {
  id: string;
  title: string;
  action: DeploymentStepAction;
  providerType: ProviderType;
  serviceKey?: string;
  endpointKey?: string;
  bindingKey?: string;
  target: {
    hostKey?: string;
    serviceKey?: string;
    endpointKey?: string;
    bindingKey?: string;
  };
  inputs: Record<string, unknown>;
  dependsOn: string[];
  requiredCapabilities?: string[];
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  idempotencyKey?: string;
  rollbackHint?: string;
}

export interface DeploymentDraftBundle {
  providerId: string;
  providerType: ProviderType;
  steps: DeploymentStepDraft[];
  summary: {
    hostCount: number;
    serviceCount: number;
    endpointCount: number;
    bindingCount: number;
    stepCount: number;
  };
}

export interface DiscoveryExecutionContext {
  tenantId: string;
  actorId?: string;
  requestId?: string;
}

export interface ProviderListItemDto {
  id: string;
  type: ProviderType;
  displayName: string;
  description: string;
  version: string;
  capabilities: ProviderCapability[];
  supportedDiscoverySources: DiscoverySource[];
  supportedStages: ProviderStage[];
  tags: string[];
}

export interface RunDiscoveryInput {
  providerId: string;
  source?: DiscoverySource;
  scope?: Record<string, string>;
  payload?: Record<string, unknown>;
}

export interface DiscoveryResultRecordDto {
  id: string;
  tenantId: string;
  providerId: string;
  providerType: ProviderType;
  snapshotId: string;
  normalizedHash: string;
  source: DiscoverySource;
  status: 'ACCEPTED' | 'REJECTED';
  rejectionReason?: string;
  scope: Record<string, string>;
  draftBundle: DeploymentDraftBundle;
  result: DiscoveryResult;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ProviderFixture {
  name: string;
  context: DiscoveryExecutionContext;
  input: RunDiscoveryInput;
  expected: {
    hostCount?: number;
    serviceCount?: number;
    endpointCount?: number;
    bindingCount?: number;
    minStepCount?: number;
  };
}

export interface ProviderFixtureReport {
  fixtureName: string;
  providerId: string;
  passed: boolean;
  diagnostics: string[];
  summary: DeploymentDraftBundle['summary'];
}
