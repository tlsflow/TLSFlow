export type ManagedDeviceCategory = 'SERVER' | 'NETWORK_APPLIANCE' | 'SECURITY_APPLIANCE';
export type ManagedDeviceHealth = 'HEALTHY' | 'DEGRADED' | 'UNREACHABLE' | 'DISABLED' | 'UNKNOWN';
export type ManagedDeviceExtensionType = 'AGENT' | 'NETWORK_APPLIANCE';

export interface ManagedDeviceSummaryDto {
  id: string;
  displayName: string;
  category: ManagedDeviceCategory;
  productFamily: string;
  managementMethod: string;
  managementAddress?: string;
  health: ManagedDeviceHealth;
  sourceStatus: string;
  softwareVersion?: string;
  lastContactAt?: string;
  applicationAssetCount: number;
  capabilities: string[];
  extensionType: ManagedDeviceExtensionType;
}

export interface ManagedDeviceListQuery {
  page: number;
  pageSize: number;
  sort?: { field: string; direction: 'asc' | 'desc' };
  filter: Partial<Record<'category' | 'productFamily' | 'managementMethod' | 'health', string>>;
  authorizedHostIds?: string[];
}

export interface ManagedDevicePageDto {
  items: ManagedDeviceSummaryDto[];
  page: number;
  pageSize: number;
  total: number;
}

export type ManagedDeviceInformationValueType = 'TEXT' | 'STATUS' | 'DATETIME' | 'BOOLEAN' | 'NUMBER';
export type ManagedDeviceSiteKind = 'IIS' | 'NGINX' | 'APACHE' | 'TOMCAT' | 'LB' | 'VPN';

export interface ManagedDeviceOverviewDto {
  deviceId: string;
  displayName: string;
  deviceType: string;
  productFamily?: string;
  managementMode: string;
  status: string;
  updatedAt: string;
}

export interface ManagedDeviceInformationFieldDto {
  key: string;
  value: string | number | boolean | null;
  valueType: ManagedDeviceInformationValueType;
  copyable?: boolean;
}

export interface ManagedDeviceInformationSectionDto {
  key: string;
  fields: ManagedDeviceInformationFieldDto[];
}

export interface ManagedDeviceBoundCertificateDto {
  certificateAssetId?: string;
  certificateVersionId?: string;
  name?: string;
  subject?: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  fingerprintSha256?: string;
  status?: string;
}

export interface ManagedDeviceSiteBindingDto {
  id: string;
  bindingKey: string;
  bindingType: string;
  hostName?: string;
  status: string;
  certificate?: ManagedDeviceBoundCertificateDto;
  replacement: {
    allowed: boolean;
    managedTargetId?: string;
    reasonCode?: string;
  };
}

export interface ManagedDeviceSiteDto {
  id: string;
  siteAssetId: string;
  managedTargetId?: string;
  kind: ManagedDeviceSiteKind;
  name: string;
  status?: string;
  endpoint?: {
    address?: string;
    hostName?: string;
    port?: number;
    protocol?: string;
  };
  configPath?: string;
  bindings: ManagedDeviceSiteBindingDto[];
  metadata: Record<string, unknown>;
}

export interface ManagedDeviceCertificateDto extends ManagedDeviceBoundCertificateDto {
  id: string;
}

export interface ManagedDeviceLogDto {
  id: string;
  eventType: string;
  result?: string;
  summary?: string;
  occurredAt: string;
  actorId?: string;
  metadata: Record<string, unknown>;
}

export type ManagedDeviceExtensionDto =
  | { type: 'AGENT'; agentId: string; agentType?: string }
  | { type: 'CITRIX_ADC'; deviceAssetId: string; deviceFamily: string }
  | { type: 'GENERIC'; rawType?: string };

export interface ManagedDeviceDetailDto extends ManagedDeviceSummaryDto {
  statusReason?: string;
  allowedActions: string[];
  publicSummary: {
    hostname?: string;
    osType: string;
    managementMode: string;
    updatedAt: string;
  };
  overview: ManagedDeviceOverviewDto;
  informationSections: ManagedDeviceInformationSectionDto[];
  sites: ManagedDeviceSiteDto[];
  certificates: ManagedDeviceCertificateDto[];
  logs: ManagedDeviceLogDto[];
  extension: ManagedDeviceExtensionDto;
  extensionSummary: Record<string, unknown>;
}

export type DeviceOnboardingKind = 'AGENT_INSTALL' | 'API_CONNECTION';
export type DevicePlatformSupportStatus = 'SUPPORTED' | 'PREVIEW' | 'UNSUPPORTED';
export type DeviceOnboardingFieldType = 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SECRET_INPUT' | 'SECRET_REF';

export interface DeviceOnboardingFieldDescriptor {
  key: string;
  type: DeviceOnboardingFieldType;
  required: boolean;
}

export interface DeviceOnboardingPlatformDescriptor {
  key: string;
  displayNameKey: string;
  productFamily: string;
  managementMethod: string;
  onboardingKind: DeviceOnboardingKind;
  supportStatus: DevicePlatformSupportStatus;
  formSchema: DeviceOnboardingFieldDescriptor[];
  handlerKey?: string;
}

export interface CreateManagedDeviceOnboardingDto {
  platformKey: string;
  baseUrl?: string;
  pluginVersionId?: string;
  formValues?: Record<string, unknown>;
}
