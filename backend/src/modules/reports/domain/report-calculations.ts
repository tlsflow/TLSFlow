import type { RiskEvent, RiskStatusHistory } from '../../monitors/schema/monitors.schema.js';
import type {
  AutomationFailureStage,
  CertificateReadinessStage,
  CertificateUsageStatus,
} from '../schema/reports.schema.js';

export interface IncidentCertificateFact {
  certificateAssetId: string;
  certificateVersionId: string;
  name: string;
  primaryDomain: string;
  notAfter: string;
  usageStatus: CertificateUsageStatus;
  readinessStage: CertificateReadinessStage;
  environment?: string;
  ownerId?: string;
  tags: string[];
  publicExposure?: boolean;
  bindingIds: string[];
}

export interface RiskSlaPolicyFact {
  version: number;
  severity: RiskEvent['severity'];
  acknowledgementSeconds: number;
  resolutionSeconds: number;
}

export interface RiskResponseFact {
  risk: RiskEvent;
  history: RiskStatusHistory[];
  slaPolicy: RiskSlaPolicyFact;
}

export interface RiskTimingResult {
  acknowledgementSeconds: number;
  resolutionSeconds: number;
  acknowledgementComplete: boolean;
  resolutionComplete: boolean;
  acknowledgementWithinSla: boolean;
  resolutionWithinSla: boolean;
  reopenedCount: number;
}

export interface AutomationRunFact {
  id: string;
  automationId: string;
  automationVersion: number;
  automationNameSnapshot: string;
  triggerType: 'schedule' | 'on_demand' | 'retry';
  status: 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'partially_succeeded' | 'failed' | 'stopped' | 'cancelled';
  failureStage?: AutomationFailureStage;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface AutomationRunTargetFact {
  id: string;
  runId: string;
  automationId: string;
  targetSnapshot: Record<string, unknown>;
  status: 'pending' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  actionType: 'create_deployment_plan' | 'execute_deployment_plan' | 'send_notification';
  failureStage?: AutomationFailureStage;
  deploymentPlanId?: string;
  executionRunId?: string;
  notificationRequestIds: string[];
  attemptCount: number;
  rollbackStatus?: 'succeeded' | 'failed';
  manualIntervention: boolean;
  createdAt: string;
  finishedAt?: string;
}

export function incidentWindowMetricKey(notAfter: string, asOf: string, usageStatus: CertificateUsageStatus): string | undefined {
  const daysRemaining = calendarDaysBetween(asOf, notAfter);
  if (daysRemaining < 0) return usageStatus === 'in_use' ? 'certificates.expired.in_use' : undefined;
  if (daysRemaining <= 1) return 'certificates.expiring.1d';
  if (daysRemaining <= 3) return 'certificates.expiring.3d';
  if (daysRemaining <= 7) return 'certificates.expiring.7d';
  if (daysRemaining <= 15) return 'certificates.expiring.15d';
  if (daysRemaining <= 30) return 'certificates.expiring.30d';
  return undefined;
}

export function calendarDaysBetween(asOf: string, target: string): number {
  const asOfDate = new Date(asOf);
  const targetDate = new Date(target);
  if (!Number.isFinite(asOfDate.getTime()) || !Number.isFinite(targetDate.getTime())) {
    throw new Error('时间格式不合法');
  }
  const startDay = Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate());
  const targetDay = Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate());
  return Math.floor((targetDay - startDay) / 86_400_000);
}

export function calculateRiskTiming(fact: RiskResponseFact, asOf: string): RiskTimingResult {
  const firstDetectedAt = Date.parse(fact.risk.firstDetectedAt);
  const cutoff = Date.parse(asOf);
  const acknowledgement = firstHistoryAt(fact.history, ['acknowledged', 'suppressed']);
  const resolution = firstHistoryAt(fact.history, ['resolved']);
  const acknowledgementEnd = acknowledgement ?? cutoff;
  const resolutionEnd = resolution ?? cutoff;
  const acknowledgementSeconds = elapsedSeconds(firstDetectedAt, acknowledgementEnd);
  const resolutionSeconds = elapsedSeconds(firstDetectedAt, resolutionEnd);
  return {
    acknowledgementSeconds,
    resolutionSeconds,
    acknowledgementComplete: acknowledgement !== undefined,
    resolutionComplete: resolution !== undefined && fact.risk.status === 'RESOLVED',
    acknowledgementWithinSla: acknowledgement !== undefined && acknowledgementSeconds <= fact.slaPolicy.acknowledgementSeconds,
    resolutionWithinSla: resolution !== undefined && resolutionSeconds <= fact.slaPolicy.resolutionSeconds,
    reopenedCount: fact.history.filter((item) => item.action === 'reopened').length,
  };
}

export function isAutomationRunTerminal(status: AutomationRunFact['status']): boolean {
  return ['succeeded', 'partially_succeeded', 'failed', 'stopped'].includes(status);
}

export function isAutomationTargetDenominator(status: AutomationRunTargetFact['status']): boolean {
  return status === 'succeeded' || status === 'failed';
}

export function isDeploymentSuccessTarget(target: AutomationRunTargetFact): boolean {
  return target.actionType === 'execute_deployment_plan' && target.status === 'succeeded';
}

function firstHistoryAt(history: RiskStatusHistory[], actions: RiskStatusHistory['action'][]): number | undefined {
  const timestamps = history
    .filter((item) => actions.includes(item.action))
    .map((item) => Date.parse(item.occurredAt))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  return timestamps[0];
}

function elapsedSeconds(start: number, end: number): number {
  return Math.max(0, Math.floor((end - start) / 1000));
}
