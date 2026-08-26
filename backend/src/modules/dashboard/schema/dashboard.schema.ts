import type { AuditPresentation } from '../../audits/audit-presentation.service.js';

export type DashboardMetricTrend = 'neutral' | 'good' | 'warning' | 'danger';

export interface DashboardMetric {
  key: string;
  title: string;
  value: number;
  description: string;
  trend: DashboardMetricTrend;
  targetPath?: string;
}

export type DashboardCertificateState = 'valid' | 'expiring' | 'critical' | 'expired' | 'unknown';
export type DashboardStatusTone = 'ok' | 'warning' | 'error' | 'unknown' | 'disabled';
export type DashboardStatusDetails =
  | { type: 'certificate'; name: string; issuer?: string; notBefore?: string; notAfter?: string; daysRemaining?: number }
  | { type: 'device'; name: string; connectionStatus: string; version?: string; managementAddress?: string; lastCommunicationAt?: string }
  | { type: 'applicationAsset'; name: string; platform?: string; protocolPort: string; certificateDaysRemaining?: number }
  | { type: 'gateway'; name: string; region?: string; latencyMs?: number };

export interface DashboardStatusBlock {
  id: string;
  label: string;
  status: string;
  tone: DashboardStatusTone;
  detail?: string;
  details?: DashboardStatusDetails;
  updatedAt?: string;
  targetPath?: string;
}

export interface DashboardStatusGroup {
  key: string;
  title: string;
  summary: string;
  total: number;
  blocks: DashboardStatusBlock[];
}

export interface DashboardCertificateStatusItem {
  certificateAssetId: string;
  certificateVersionId?: string;
  name: string;
  primaryDomain: string;
  issuer?: string;
  notBefore?: string;
  notAfter?: string;
  daysRemaining?: number;
  state: DashboardCertificateState;
  chainStatus?: string;
  bindingCount: number;
  updatedAt?: string;
}

export interface DashboardAuditItem {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: string;
  riskLevel: string;
  requestId?: string;
  detail?: unknown;
  presentation: AuditPresentation;
  createdAt: string;
}

export interface DashboardQuickAction {
  key: string;
  title: string;
  description: string;
  path: string;
  permission: string;
}

export interface DashboardSystemResources {
  cpuUsage: number | null;
  memoryUsage: number;
}

export interface DashboardOverview {
  generatedAt: string;
  systemResources: DashboardSystemResources;
  metrics: DashboardMetric[];
  quickActions: DashboardQuickAction[];
  statusGroups: DashboardStatusGroup[];
  certificateStatuses: DashboardCertificateStatusItem[];
  recentAudits: DashboardAuditItem[];
}
