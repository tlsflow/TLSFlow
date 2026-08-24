import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const AUDIT_EVENTS_PATH = '/api/v1/audit-events'
const APPROVALS_PATH = '/api/v1/approvals'
const APPROVAL_DECIDE_PATH = '/api/v1/approvals/decide'

export function listAudits(query?: BusinessListQuery) {
  return listRecords(AUDIT_EVENTS_PATH, query)
}

export function listApprovals(query?: BusinessListQuery) {
  return listRecords(APPROVALS_PATH, query)
}

export function decideApproval(payload: ApiBody) {
  return postAction(APPROVAL_DECIDE_PATH, payload, 'approval_decide')
}

export function exportAuditEvidence(payload: ApiBody) {
  return postAction(`${AUDIT_EVENTS_PATH}:export`, payload, 'audit_export')
}
