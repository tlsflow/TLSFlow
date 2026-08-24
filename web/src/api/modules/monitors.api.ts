import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiRecord, type ApiRecordResult, type BusinessListQuery } from './common'

const MONITOR_TARGETS_PATH = '/api/v1/monitors/targets'
const MONITOR_RISKS_PATH = '/api/v1/monitors/risks'
const MONITOR_SCAN_PATH = '/api/v1/monitors/scan'
const MONITOR_PROBE_PATH = '/api/v1/monitors/probe'
const MONITOR_PROBE_RESULTS_PATH = '/api/v1/monitors/probe-results'
const MONITOR_CERTIFICATE_OBSERVATIONS_PATH = '/api/v1/monitors/certificate-observations'
const MONITOR_ALERT_RULES_PATH = '/api/v1/monitors/alert-rules'

export function listMonitors(query?: BusinessListQuery) {
  return listRiskEvents(query)
}

export function listMonitorTargets(query?: BusinessListQuery) {
  return listRecords(MONITOR_TARGETS_PATH, query)
}

export function createMonitorTarget(payload: ApiBody) {
  return postAction(MONITOR_TARGETS_PATH, payload, 'monitor_target_create')
}

export function updateMonitorTarget(monitorTargetId: string, payload: ApiBody): Promise<ApiRecordResult> {
  return apiClient.request<ApiRecord>(toClientPath(MONITOR_TARGETS_PATH), {
    method: 'PATCH',
    body: { ...payload, id: monitorTargetId },
    idempotencyKey: createIdempotencyKey('monitor_target_update'),
  })
}

export function deleteMonitorTarget(monitorTargetId: string, payload: ApiBody = {}) {
  return postAction(`${MONITOR_TARGETS_PATH}/delete`, { ...payload, id: monitorTargetId }, 'monitor_target_delete')
}

export function listRiskEvents(query?: BusinessListQuery) {
  return listRecords(MONITOR_RISKS_PATH, query)
}

export function scanMonitorRisks(payload: ApiBody = {}) {
  return postAction(MONITOR_SCAN_PATH, payload, 'monitor_scan')
}

export function probeMonitorServiceAsset(payload: ApiBody) {
  return postAction(MONITOR_PROBE_PATH, payload, 'monitor_probe')
}

export function listMonitorProbeResults(query?: BusinessListQuery) {
  return listRecords(MONITOR_PROBE_RESULTS_PATH, query)
}

export function listMonitorCertificateObservations(query?: BusinessListQuery) {
  return listRecords(MONITOR_CERTIFICATE_OBSERVATIONS_PATH, query)
}

export function createMonitorAlertRule(payload: ApiBody) {
  return postAction(MONITOR_ALERT_RULES_PATH, payload, 'monitor_alert_rule')
}
