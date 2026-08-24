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

export interface ManagedDeviceDetailDto extends ManagedDeviceSummaryDto {
  statusReason?: string;
  allowedActions: string[];
  publicSummary: {
    hostname?: string;
    osType: string;
    managementMode: string;
    updatedAt: string;
  };
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
  displayName?: string;
  baseUrl?: string;
  managementAddress?: string;
  managementPort?: number;
  username?: string;
  password?: string;
  credentialId?: string;
  authMode?: 'AUTO' | 'SESSION' | 'PER_REQUEST';
  tlsVerify?: boolean;
  insecureTlsAcknowledged?: boolean;
}
