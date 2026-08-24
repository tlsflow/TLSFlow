export type JobType =
  | 'CERTIFICATE_PARSE'
  | 'CERTIFICATE_IMPORT'
  | 'ASSET_DISCOVER'
  | 'CAPABILITY_PROBE'
  | 'DEPLOYMENT_EXECUTE'
  | 'AGENT_COMMAND_DISPATCH'
  | 'MONITOR_CHECK'
  | 'WORKFLOW_RUN'
  | 'REPORT_EXPORT';

export interface RetryPolicy {
  maxAttempts: number;
  backoffSeconds: number;
}

export interface JobPayload<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  jobId: string;
  jobType: JobType;
  attempt: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'retrying';
  tenantId?: string;
  actorId?: string;
  requestId: string;
  traceId?: string;
  resourceType?: string;
  resourceId?: string;
  idempotencyKey?: string;
  payload: TPayload;
  retryPolicy: RetryPolicy;
  timeoutSeconds: number;
}

export interface JobResult {
  jobId: string;
  success: boolean;
  attempt?: number;
  willRetry?: boolean;
  errorCode?: string;
  details?: unknown;
}
