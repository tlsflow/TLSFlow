import { apiClient, createIdempotencyKey } from '@/api/client'
import { toClientPath } from './common'

export type AutomationStatus = 'draft' | 'active' | 'disabled' | 'deleted'
export type AutomationRunStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'partially_succeeded' | 'failed' | 'needs_attention' | 'stopped' | 'cancelled'

export interface AutomationConfiguration {
  trigger: { type: 'api' } | { type: 'once'; runAt: string } | { type: 'on_demand' } | { type: 'schedule'; cron: string; timeZone: string; startsAt?: string; endsAt?: string } | { type: 'certificate_version_created'; sources?: Array<'external_source' | 'manual_import' | 'acme_issue'> }
  filters?: Array<{ field: string; operator: 'eq' | 'neq' | 'in' | 'contains_any' | 'contains_all'; value?: unknown }>
  targetResolver: { type: 'certificate_version_targets'; assetIds?: string[] }
  approvalStage?: { type: 'run'; mode?: 'before_actions'; operationType?: string; riskLevel?: 'low' | 'medium' | 'high' | 'critical'; expiresInHours?: number }
  actions: Array<{ type: 'create_deployment_plan' | 'execute_deployment_plan' | 'send_notification'; position: number; config: Record<string, unknown> }>
  guardrails: { maxTargetsPerRun: number; concurrencyLimit: number; requirePreview: boolean; requireDryRun: boolean; requireApproval: boolean; allowManualWhenDisabled?: boolean; allowedEnvironments?: string[]; failureCountThreshold?: number; failureRateThreshold?: number }
}

export interface AutomationTriggerContext {
  deliveryId?: string
  deliveryKey?: string
  eventId?: string
  eventType?: string
  occurredAt?: string
  sourceType?: string
  certificateAssetId?: string
  certificateVersionId?: string
  domains?: string[]
  tags?: string[]
  totalMatched?: number
  executableCount?: number
  excludedCount?: number
  excludedReasons?: Record<string, number>
}

export interface AutomationRunExecutionOptions {
  stopOnError?: boolean
  dryRun?: boolean
}

export interface AutomationRecord {
  id: string
  name: string
  description?: string
  status: AutomationStatus
  currentVersion: number
  version: number
  nextRunAt?: string
  lastRunAt?: string
  configuration: AutomationConfiguration
}

export interface AutomationRunRecord {
  id: string
  automationId: string
  automationNameSnapshot: string
  automationVersion: number
  triggerType: string
  triggerContext?: { deliveryId?: string; deliveryKey?: string; eventId?: string; eventType?: string; occurredAt?: string; sourceType?: string; certificateAssetId?: string; certificateVersionId?: string; domains?: string[]; tags?: string[]; totalMatched?: number; executableCount?: number; excludedCount?: number; excludedReasons?: Record<string, number> }
  status: AutomationRunStatus
  targetSummary: Record<string, number>
  failureStage?: string
  approvalId?: string
  deliveryId?: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  parentRunId?: string
}

export interface AutomationRunTargetRecord {
  id: string
  sequenceNo: number
  targetSnapshot: {
    certificateName: string
    certificateVersionId?: string
    currentCertificateVersionId?: string
    currentCertificateNotAfter?: string
    targetCertificateNotAfter?: string
    certificateVersionImpact?: 'upgrade' | 'same' | 'downgrade' | 'missing_current'
    environment?: string
    assetId?: string
    assetName?: string
  }
  status: string
  currentAction?: string
  failureStage?: string
  errorCode?: string
  errorMessage?: string
  deploymentPlanId?: string
  executionRunId?: string
  notificationRequestIds: string[]
}

export interface AutomationPreviewRecord {
  previewId: string
  totalMatched: number
  executableCount: number
  excludedCount: number
  excludedReasons: Record<string, number>
  versionImpactSummary?: { total: number; upgrade: number; same: number; downgrade: number; missingCurrent: number }
  items: Array<{
    target: AutomationRunTargetRecord['targetSnapshot'] & {
      bindingId?: string
      currentCertificateVersionId?: string
    }
    executable: boolean
    excludedReason?: string
  }>
}

const basePath = '/api/v1/automations'

function requireData<T>(data: T | undefined): T {
  if (data === undefined) throw new Error('AUTOMATION_API_EMPTY_RESPONSE')
  return data
}

export async function listAutomations(): Promise<AutomationRecord[]> {
  return requireData((await apiClient.get<{ items: AutomationRecord[] }>(toClientPath(basePath))).data).items
}

export async function createAutomation(payload: AutomationConfiguration & { name: string; description?: string }): Promise<AutomationRecord> {
  return requireData((await apiClient.post<AutomationRecord>(toClientPath(basePath), payload, { idempotencyKey: createIdempotencyKey('automation_create') })).data)
}

export async function updateAutomation(id: string, payload: { expectedVersion: number; name?: string; description?: string; configuration?: AutomationConfiguration }): Promise<AutomationRecord> {
  return requireData((await apiClient.request<AutomationRecord>(toClientPath(`${basePath}/${id}`), { method: 'PATCH', body: payload, idempotencyKey: createIdempotencyKey('automation_update') })).data)
}

export async function automationAction(id: string, action: 'copy' | 'enable' | 'disable', expectedVersion?: number): Promise<AutomationRecord> {
  return requireData((await apiClient.post<AutomationRecord>(toClientPath(`${basePath}/${id}/actions/${action}`), expectedVersion === undefined ? {} : { expectedVersion }, { idempotencyKey: createIdempotencyKey(`automation_${action}`) })).data)
}

export async function deleteAutomation(id: string, expectedVersion: number): Promise<AutomationRecord> {
  return requireData((await apiClient.request<AutomationRecord>(toClientPath(`${basePath}/${id}`), { method: 'DELETE', body: { expectedVersion }, idempotencyKey: createIdempotencyKey('automation_delete') })).data)
}

export async function previewAutomation(id: string, payload: { page?: number; pageSize?: number; allowCertificateDowngrade?: boolean; triggerContext?: AutomationTriggerContext } = {}): Promise<AutomationPreviewRecord> {
  return requireData((await apiClient.post<AutomationPreviewRecord>(toClientPath(`${basePath}/${id}/preview`), {
    page: payload.page ?? 1,
    pageSize: payload.pageSize ?? 200,
    ...(payload.allowCertificateDowngrade ? { allowCertificateDowngrade: true } : {}),
    ...(payload.triggerContext ? { triggerContext: payload.triggerContext } : {}),
  })).data)
}

export async function runAutomation(id: string, expectedVersion: number, options: { triggerContext?: AutomationTriggerContext; executionOptions?: AutomationRunExecutionOptions; allowCertificateDowngrade?: boolean; confirmCertificateDowngrade?: boolean } = {}): Promise<AutomationRunRecord> {
  return requireData((await apiClient.post<AutomationRunRecord>(toClientPath(`${basePath}/${id}/runs`), {
    expectedVersion,
    idempotencyKey: createIdempotencyKey('automation_run'),
    ...(options.triggerContext ? { triggerContext: options.triggerContext } : {}),
    ...(options.executionOptions ? { executionOptions: options.executionOptions } : {}),
    ...(options.allowCertificateDowngrade ? { allowCertificateDowngrade: true } : {}),
    ...(options.confirmCertificateDowngrade ? { confirmCertificateDowngrade: true } : {}),
  })).data)
}

export async function listAutomationRuns(automationId?: string): Promise<AutomationRunRecord[]> {
  const query = automationId ? `?automationId=${encodeURIComponent(automationId)}` : ''
  return requireData((await apiClient.get<{ items: AutomationRunRecord[] }>(toClientPath(`/api/v1/automation-runs${query}`))).data).items
}

export async function getAutomationRun(id: string): Promise<AutomationRunRecord & { actionResults: unknown[] }> {
  return requireData((await apiClient.get<AutomationRunRecord & { actionResults: unknown[] }>(toClientPath(`/api/v1/automation-runs/${id}`))).data)
}

export async function listAutomationRunTargets(id: string): Promise<AutomationRunTargetRecord[]> {
  return requireData((await apiClient.get<{ items: AutomationRunTargetRecord[] }>(toClientPath(`/api/v1/automation-runs/${id}/targets`))).data).items
}

export async function stopAutomationRun(id: string): Promise<AutomationRunRecord> {
  return requireData((await apiClient.post<AutomationRunRecord>(toClientPath(`/api/v1/automation-runs/${id}/actions/stop`), {}, { idempotencyKey: createIdempotencyKey('automation_stop') })).data)
}

export async function retryAutomationRun(id: string): Promise<AutomationRunRecord> {
  return requireData((await apiClient.post<AutomationRunRecord>(toClientPath(`/api/v1/automation-runs/${id}/actions/retry-failed`), { idempotencyKey: createIdempotencyKey('automation_retry') })).data)
}
