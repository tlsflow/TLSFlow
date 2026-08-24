import { listRecords, postAction, type ApiBody, type BusinessListQuery } from './common'

const CERTIFICATE_BINDINGS_PATH = '/api/v1/certificate-bindings'

export function listBindings(query?: BusinessListQuery) {
  return listRecords(CERTIFICATE_BINDINGS_PATH, query)
}

export function verifyBinding(bindingId: string, payload: ApiBody = {}) {
  return postAction(`${CERTIFICATE_BINDINGS_PATH}/${encodeURIComponent(bindingId)}:verify`, payload, 'binding_verify')
}
