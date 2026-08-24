import { listRecords, type BusinessListQuery } from './common'

const RISK_EVENTS_PATH = '/api/v1/monitors/risks'

export function listDashboardRisks(query?: BusinessListQuery) {
  return listRecords(RISK_EVENTS_PATH, query)
}
