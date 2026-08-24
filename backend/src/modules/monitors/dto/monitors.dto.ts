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
