import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const MONITOR_RISKS_PATH = '/api/v1/monitors/risks'
const MONITOR_SCAN_PATH = '/api/v1/monitors/scan'
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

export function createMonitorAlertRule(payload: ApiBody) {
  return postAction(MONITOR_ALERT_RULES_PATH, payload, 'monitor_alert_rule')
}
