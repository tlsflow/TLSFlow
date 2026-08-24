import { RiskStatuses, type RiskStatus } from '../../../shared/enums/core.enums.js';

export const riskStatus = RiskStatuses;
export const severity = ['low', 'medium', 'high', 'critical'] as const;
export const riskEventTypes = [
  'certificate_expiring',
  'certificate_expired',
  'binding_drift',
  'binding_unknown_certificate',
  'execution_failed',
  'tls_chain_invalid',
  'tls_domain_mismatch',
  'tls_fingerprint_mismatch',
  'agent_offline',
  'capability_degraded',
] as const;
export const alertRuleStatuses = ['active', 'disabled'] as const;
export const monitorTargetStatuses = ['active', 'paused'] as const;
export const monitorMetrics = ['availability', 'latency', 'certificate', 'certificateHistory'] as const;

export type RiskSeverity = (typeof severity)[number];
export type RiskEventType = (typeof riskEventTypes)[number];
export type AlertRuleStatus = (typeof alertRuleStatuses)[number];
export type MonitorTargetStatus = (typeof monitorTargetStatuses)[number];
export type MonitorMetric = (typeof monitorMetrics)[number];

export interface RiskEventScope {
  tenantId?: string;
  certificateAssetId?: string;
  certificateVersionId?: string;
  bindingId?: string;
  serviceAssetId?: string;
  executionRunId?: string;
  serviceInstanceId?: string;
  hostId?: string;
}

export interface RiskEvent {
  id: string;
  dedupKey: string;
  type: RiskEventType;
  source: 'certificate' | 'binding' | 'monitor' | 'execution' | 'agent' | 'capability';
  status: RiskStatus;
  severity: RiskSeverity;
  title: string;
  summary: string;
  scope: RiskEventScope;
  metadata: Record<string, unknown>;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt?: string;
  occurrenceCount: number;
}

export const riskStatusActions = ['created', 'acknowledged', 'suppressed', 'ignored', 'resolved', 'reopened'] as const;
export type RiskStatusAction = (typeof riskStatusActions)[number];

export interface RiskStatusHistory {
  id: string;
  tenantId: string;
  riskEventId: string;
  action: RiskStatusAction;
  fromStatus?: RiskStatus;
  toStatus: RiskStatus;
  reason?: string;
  actorType: 'user' | 'system';
  actorId?: string;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface AlertRuleThreshold {
  metric: 'count';
  operator: 'gte';
  value: number;
}

export interface AlertRuleScope {
  tenantId?: string;
  riskTypes?: RiskEventType[];
  severities?: RiskSeverity[];
  certificateAssetId?: string;
  certificateVersionId?: string;
  bindingId?: string;
  serviceInstanceId?: string;
  hostId?: string;
}

export interface AlertRuleSilence {
  startsAt?: string;
  endsAt?: string;
  reason?: string;
  createdAt?: string;
  createdBy?: string;
}

export interface AlertRule {
  id: string;
  name: string;
  threshold: AlertRuleThreshold;
  scope: AlertRuleScope;
  status: AlertRuleStatus;
  silence?: AlertRuleSilence;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorDashboardSnapshot {
  expiringCount: number;
  expiredCount: number;
  driftCount: number;
  failedCount: number;
  unknownCertificateCount: number;
  tlsIssueCount: number;
  automationBlockedCount: number;
  totalActiveCount: number;
  lastScannedAt?: string;
}

export interface MonitorJob {
  id: string;
  tenantId?: string;
  kind: 'certificate' | 'binding' | 'execution' | 'agent' | 'capability';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
  scope: AlertRuleScope;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
}

export interface MonitorTarget {
  id: string;
  tenantId: string;
  serviceAssetId: string;
  metrics: MonitorMetric[];
  intervalSeconds: number;
  status: MonitorTargetStatus;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  version: number;
}
