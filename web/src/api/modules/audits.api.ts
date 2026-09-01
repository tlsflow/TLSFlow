import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const AUDIT_EVENTS_PATH = '/api/v1/audit-events'

export function listAudits(query?: BusinessListQuery) {
  return listRecords(AUDIT_EVENTS_PATH, query)
}

export function exportAuditEvidence(payload: ApiBody) {
  return postAction(`${AUDIT_EVENTS_PATH}:export`, payload, 'audit_export')
}
