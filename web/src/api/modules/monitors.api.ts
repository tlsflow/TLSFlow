import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const MONITOR_RISKS_PATH = '/api/v1/monitors/risks'
const MONITOR_SCAN_PATH = '/api/v1/monitors/scan'
const MONITOR_PROBE_PATH = '/api/v1/monitors/probe'
const MONITOR_CERTIFICATE_OBSERVATIONS_PATH = '/api/v1/monitors/certificate-observations'
const MONITOR_ALERT_RULES_PATH = '/api/v1/monitors/alert-rules'

export function listMonitors(query?: BusinessListQuery) {
  return listRiskEvents(query)
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

export function listMonitorCertificateObservations(query?: BusinessListQuery) {
  return listRecords(MONITOR_CERTIFICATE_OBSERVATIONS_PATH, query)
}

export function createMonitorAlertRule(payload: ApiBody) {
  return postAction(MONITOR_ALERT_RULES_PATH, payload, 'monitor_alert_rule')
}
