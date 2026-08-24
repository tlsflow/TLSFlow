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
