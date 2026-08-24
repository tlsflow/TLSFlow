export const reportTypes = [
  'incident_window',
  'risk_response',
  'automation_effectiveness',
] as const;

export const reportMetricValueTypes = ['count', 'duration_seconds', 'rate'] as const;

export const reportMetricTimeSemantics = [
  'as_of',
  'event_occurred_in_period',
  'state_at_period_end',
] as const;

export const reportDimensionKeys = [
  'environment',
  'owner_id',
  'asset_id',
  'business_system',
  'tag',
  'public_exposure',
  'usage_status',
  'readiness_stage',
  'severity',
  'risk_type',
  'automation_id',
  'action_type',
  'failure_stage',
] as const;

export type ReportType = (typeof reportTypes)[number];
export type ReportMetricValueType = (typeof reportMetricValueTypes)[number];
export type ReportMetricTimeSemantic = (typeof reportMetricTimeSemantics)[number];
export type ReportDimensionKey = (typeof reportDimensionKeys)[number];

export interface MetricRatioDefinition {
  numerator: string;
  denominator: string;
  excludedStatuses: readonly string[];
}

export interface MetricDefinition {
  key: string;
  version: number;
  reportType: ReportType;
  valueType: ReportMetricValueType;
  objectType: 'certificate_asset' | 'risk_event' | 'automation_run' | 'automation_run_target';
  timeSemantic: ReportMetricTimeSemantic;
  description: string;
  dimensions: readonly ReportDimensionKey[];
  ratio?: MetricRatioDefinition;
}

export interface MetricValue {
  metricKey: string;
  metricVersion: number;
  value: number;
  sampleCount: number;
}

export interface MetricSnapshot {
  tenantId: string;
  snapshotDate: string;
  asOf: string;
  metricKey: string;
  metricVersion: number;
  dimensions: Readonly<Record<string, string | boolean | null>>;
  value: number;
  sampleCount: number;
  generatedAt: string;
}

export type CertificateUsageStatus = 'in_use' | 'idle' | 'unknown';
export type CertificateReadinessStage =
  | 'missing_replacement'
  | 'replacement_ready'
  | 'plan_missing'
  | 'plan_draft'
  | 'waiting_approval'
  | 'ready_to_execute'
  | 'running'
  | 'verification_failed'
  | 'completed'
  | 'blocked';

export type AutomationFailureStage =
  | 'selection'
  | 'plan_creation'
  | 'dry_run'
  | 'approval'
  | 'execution'
  | 'verification'
  | 'rollback'
  | 'notification';

export interface ReportQuery {
  tenantId: string;
  dateFrom: string;
  dateTo: string;
  asOf: string;
  metricKey?: string;
  environment?: string;
  ownerId?: string;
  assetId?: string;
  tag?: string;
  severity?: string;
  riskType?: string;
  automationId?: string;
  failureStage?: AutomationFailureStage;
  page: number;
  pageSize: number;
}

export interface ReportMetricResult extends MetricValue {
  labelKey: string;
  incompleteSampleCount?: number;
  numerator?: number;
  denominator?: number;
}

export interface ReportOverview {
  reportType: ReportType;
  asOf: string;
  metricVersions: Record<string, number>;
  metrics: ReportMetricResult[];
  groups: Array<{ dimension: string; value: string; count: number }>;
  warnings: string[];
}

export interface ReportTrendPoint {
  snapshotDate: string;
  metrics: MetricValue[];
  complete: boolean;
}

export interface ReportItemPage<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
  asOf: string;
}

export type ReportRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'expired';

export interface ReportRun {
  id: string;
  tenantId: string;
  reportType: ReportType;
  status: ReportRunStatus;
  filters: Record<string, unknown>;
  columns: string[];
  metricVersions: Record<string, number>;
  slaPolicyVersion?: number;
  timeZone: string;
  dataAsOf: string;
  artifactId?: string;
  errorMessage?: string;
  createdBy: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface ReportArtifact {
  id: string;
  tenantId: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
  expiresAt: string;
  createdAt: string;
}
