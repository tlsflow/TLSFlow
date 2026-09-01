import type { RiskStatus } from '../../../shared/enums/core.enums.js';
import type {
  AlertRule,
  AlertRuleScope,
  AlertRuleSilence,
  AlertRuleStatus,
  AlertRuleThreshold,
  MonitorMetric,
  MonitorDashboardSnapshot,
  MonitorJob,
  MonitorTarget,
  MonitorTargetStatus,
  RiskEvent,
  RiskEventScope,
  RiskEventType,
  RiskSeverity,
  RiskStatusAction,
  RiskStatusHistory,
} from '../schema/monitors.schema.js';

export interface RiskEventDto extends RiskEvent {}
export interface RiskStatusHistoryDto extends RiskStatusHistory {}

export interface AlertRuleDto extends AlertRule {}

export interface MonitorTargetDto extends MonitorTarget {
  assetId: string;
  /** 已删除应用资产仍可通过监控归档查看的原始摘要。 */
  assetDisplayName?: string;
  assetAddress?: string;
  assetDeletedAt?: string;
}

export interface MonitorTargetPageDto {
  items: MonitorTargetDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListMonitorTargetsQuery {
  tenantId: string;
  page: number;
  pageSize: number;
  sort?: { field: string; direction: 'asc' | 'desc' };
  filter: Record<string, string>;
  includeRemoved?: boolean;
  authorizedServiceAssetIds?: string[];
}

export interface ListMonitorProbeResultsQuery {
  tenantId?: string;
  monitorTargetId?: string;
  serviceAssetId?: string;
  pageSize?: number;
  authorizedServiceAssetIds?: string[];
}

export interface MonitorProbeResultDto {
  id: string;
  tenantId: string;
  monitorTargetId?: string;
  serviceAssetId: string;
  source: 'control_plane' | 'gateway';
  url: string;
  status: 'READY' | 'WARNING' | 'ERROR';
  success: boolean;
  latencyMs: number;
  checkedAt: string;
  message: string;
  httpStatus?: number;
  certificate?: Record<string, unknown>;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface SaveMonitorProbeResultInput {
  tenantId: string;
  monitorTargetId?: string;
  result: ProbeServiceAssetResult;
}

export interface CreateMonitorTargetInput {
  tenantId: string;
  serviceAssetId: string;
  metrics?: MonitorMetric[];
  intervalSeconds: number;
  status?: MonitorTargetStatus;
  createdBy?: string;
}

export interface UpdateMonitorTargetInput {
  tenantId: string;
  id: string;
  metrics?: MonitorMetric[];
  intervalSeconds?: number;
  status?: MonitorTargetStatus;
}

export interface ListRiskEventsQuery {
  tenantId?: string;
  status?: RiskStatus;
  severity?: RiskSeverity;
  type?: RiskEventType;
  authorizedParentObjectIds?: Record<string, string[]>;
}

export interface CreateAlertRuleInput {
  name: string;
  threshold: AlertRuleThreshold;
  scope?: AlertRuleScope;
  status?: AlertRuleStatus;
  silence?: AlertRuleSilence;
  createdBy: string;
}

export interface CollectMonitorRisksInput {
  tenantId?: string;
  scanStartedAt?: string;
  certificateExpiringThresholdDays?: number;
}

export interface UpsertRiskEventInput {
  dedupKey: string;
  type: RiskEventType;
  source: RiskEvent['source'];
  severity: RiskSeverity;
  title: string;
  summary: string;
  scope: RiskEventScope;
  metadata?: Record<string, unknown>;
  detectedAt: string;
}

export interface ChangeRiskStatusInput {
  tenantId: string;
  riskEventId: string;
  action: Exclude<RiskStatusAction, 'created'>;
  reason?: string;
  actorType: 'user' | 'system';
  actorId?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface MonitorDashboardDto extends MonitorDashboardSnapshot {}

export interface MonitorJobDto extends MonitorJob {}

export interface RemoteTlsObservationInput {
  tenantId?: string;
  bindingId: string;
  domainName?: string;
  expectedDomainName?: string;
  observedFingerprintSha256?: string;
  desiredFingerprintSha256?: string;
  chainStatus?: 'valid' | 'invalid' | 'incomplete' | 'unknown';
  checkedAt: string;
}

export interface MonitorTlsProbeRiskInput {
  tenantId?: string;
  serviceAssetId: string;
  domainName?: string;
  url: string;
  verificationError?: string;
  checkedAt: string;
}

export interface AutomationHealthInput {
  tenantId?: string;
  hostId?: string;
  serviceInstanceId?: string;
  capabilityKey?: string;
  agentStatus?: 'ONLINE' | 'OFFLINE' | 'DISABLED' | 'UNKNOWN';
  compatibilityLevel?: string;
  checkedAt: string;
}

export interface ProbeServiceAssetInput {
  tenantId?: string;
  monitorTargetId?: string;
  serviceAssetId: string;
  timeoutMs?: number;
}

export interface ProbeServiceAssetResult {
  serviceAssetId: string;
  source: 'control_plane' | 'gateway';
  url: string;
  status: 'READY' | 'WARNING' | 'ERROR';
  success: boolean;
  latencyMs: number;
  checkedAt: string;
  message: string;
  httpStatus?: number;
  certificate?: {
    fingerprintSha256?: string;
    subject?: string;
    issuer?: string;
    serialNumber?: string;
    notBefore?: string;
    notAfter?: string;
    dnsNames?: string[];
    verified?: boolean;
    verificationError?: string;
    chain?: CertificateChainCertificate[];
    chainStatus?: 'valid' | 'incomplete' | 'invalid' | 'untrusted';
  };
  detail?: Record<string, unknown>;
}

export interface CertificateChainCertificate {
  fingerprintSha256: string;
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  isCa?: boolean;
}

export interface CertificateObservationDto {
  id: string;
  tenantId?: string;
  serviceAssetId: string;
  source: 'control_plane' | 'gateway';
  url: string;
  observedAt: string;
  fingerprintSha256: string;
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  dnsNames?: string[];
  verified?: boolean;
  verificationError?: string;
  chain?: CertificateChainCertificate[];
  chainStatus?: 'valid' | 'incomplete' | 'invalid' | 'untrusted';
  rawResult: Record<string, unknown>;
  createdAt: string;
}

export interface SaveCertificateObservationInput {
  tenantId?: string;
  serviceAssetId: string;
  source: 'control_plane' | 'gateway';
  url: string;
  observedAt: string;
  fingerprintSha256: string;
  subject?: string;
  issuer?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  dnsNames?: string[];
  verified?: boolean;
  verificationError?: string;
  chain?: CertificateChainCertificate[];
  chainStatus?: 'valid' | 'incomplete' | 'invalid' | 'untrusted';
  rawResult?: Record<string, unknown>;
}

export interface ListCertificateObservationsQuery {
  tenantId?: string;
  serviceAssetId?: string;
  pageSize?: number;
  includeRemoved?: boolean;
  authorizedServiceAssetIds?: string[];
}
