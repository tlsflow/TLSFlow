import type { RiskStatus } from '../../../shared/enums/core.enums.js';
import type {
  AlertRule,
  AlertRuleScope,
  AlertRuleSilence,
  AlertRuleStatus,
  AlertRuleThreshold,
  MonitorDashboardSnapshot,
  MonitorJob,
  RiskEvent,
  RiskEventScope,
  RiskEventType,
  RiskSeverity,
} from '../schema/monitors.schema.js';

export interface RiskEventDto extends RiskEvent {}

export interface AlertRuleDto extends AlertRule {}

export interface ListRiskEventsQuery {
  tenantId?: string;
  status?: RiskStatus;
  severity?: RiskSeverity;
  type?: RiskEventType;
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
  };
  detail?: Record<string, unknown>;
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
  rawResult?: Record<string, unknown>;
}

export interface ListCertificateObservationsQuery {
  tenantId?: string;
  serviceAssetId?: string;
  pageSize?: number;
}
