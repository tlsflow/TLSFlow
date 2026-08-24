export interface PresentationFieldV1 {
  key: string;
  labelKey: string;
  valuePath: string;
  type: 'text' | 'number' | 'status' | 'timestamp' | 'link' | 'badge' | 'readonly_text';
  sensitive?: boolean;
}

export interface PresentationColumnV1 {
  key: string;
  labelKey: string;
  valuePath: string;
  type: 'text' | 'number' | 'status' | 'timestamp' | 'link' | 'badge';
}

export interface DevicePresentationSchemaV1 {
  schemaVersion: 'gcac.device-presentation/v1';
  overview: Array<{ id: string; titleKey: string; fields: PresentationFieldV1[] }>;
  tabs: Array<{
    type: 'frameworks' | 'sites' | 'certificate_bindings' | 'device_logs' | 'records';
    id: string;
    titleKey: string;
    recordType?: string;
    queryCapabilities?: string[];
    columns: PresentationColumnV1[];
  }>;
  actions: Array<{ capabilityKey: string; labelKey: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'muted' }>;
}
