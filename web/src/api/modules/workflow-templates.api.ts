import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiRecord, type BusinessListQuery } from './common'

const WORKFLOWS_PATH = '/api/v1/workflows'
const WORKFLOW_CANVAS_COMPILE_PATH = `${WORKFLOWS_PATH}/canvas/compile`
const WORKFLOW_CANVAS_VALIDATE_PATH = `${WORKFLOWS_PATH}/canvas/validate`

export function listWorkflowTemplates(query?: BusinessListQuery) {
  return listRecords(WORKFLOWS_PATH, query)
}

export function renameWorkflowTemplate(templateId: string, name: string) {
  return apiClient.request<ApiRecord>(toClientPath(`${WORKFLOWS_PATH}/${encodeURIComponent(templateId)}`), {
    method: 'PATCH',
    body: { name },
    idempotencyKey: createIdempotencyKey('workflow_rename'),
  })
}

export function compileWorkflowCanvas(payload: ApiBody) {
  return postAction(WORKFLOW_CANVAS_COMPILE_PATH, payload, 'workflow_canvas_compile')
}

export function validateWorkflowCanvasOnBackend(payload: ApiBody) {
  return postAction(WORKFLOW_CANVAS_VALIDATE_PATH, payload, 'workflow_canvas_validate')
}

export function deleteWorkflowTemplate(templateId: string, payload: ApiBody = {}) {
  return apiClient.request<ApiRecord>(toClientPath(`${WORKFLOWS_PATH}/${encodeURIComponent(templateId)}`), {
    method: 'DELETE',
    ...(Object.keys(payload).length > 0 ? { body: payload } : {}),
    idempotencyKey: createIdempotencyKey('workflow_delete'),
  })
}

export function listPluginWorkflowSources(locale = 'zh-CN') {
  const query = new URLSearchParams({ locale }).toString()
  return apiClient.get<{ items?: readonly ApiRecord[] }>(`${toClientPath('/api/v1/workflow-sources/plugins')}?${query}`)
}

export function getWorkflowExecutionBinding(bindingId: string) {
  return apiClient.get<ApiRecord>(toClientPath(`/api/v1/workflow-execution-bindings/${encodeURIComponent(bindingId)}`))
}

export function createWorkflowFromPlugin(payload: ApiBody) {
  return postAction(`${WORKFLOWS_PATH}/from-plugin`, payload, 'workflow_create_from_plugin')
}

export function createWorkflowDraftFromPlugin(workflowId: string, payload: ApiBody) {
  return postAction(`${WORKFLOWS_PATH}/${encodeURIComponent(workflowId)}/drafts/from-plugin`, payload, 'workflow_draft_from_plugin')
}

export function listWorkflowTemplateVersions(templateId: string) {
  return apiClient.get<{ items?: readonly ApiRecord[] }>(toClientPath(`${WORKFLOWS_PATH}/${encodeURIComponent(templateId)}/versions`))
}

export function createWorkflowTemplateVersion(templateId: string, payload: ApiBody) {
  return postAction(`${WORKFLOWS_PATH}/${encodeURIComponent(templateId)}/versions`, payload, 'workflow_version_create')
}

export function updateCurrentWorkflowTemplateDraftVersion(templateId: string, payload: ApiBody) {
  return apiClient.request<ApiRecord>(toClientPath(`${WORKFLOWS_PATH}/${encodeURIComponent(templateId)}/draft`), {
    method: 'PATCH',
    body: payload,
    idempotencyKey: createIdempotencyKey('workflow_draft_update'),
  })
}

export function updateWorkflowTemplateVersionNote(versionId: string, changeSummary: string) {
  return apiClient.request<ApiRecord>(toClientPath(`${WORKFLOWS_PATH}/versions/${encodeURIComponent(versionId)}`), {
    method: 'PATCH',
    body: { changeSummary },
    idempotencyKey: createIdempotencyKey('workflow_version_note'),
  })
}

export function publishWorkflowTemplateVersion(versionId: string, payload: ApiBody = {}) {
  return postAction(`${WORKFLOWS_PATH}/versions/${encodeURIComponent(versionId)}/publish`, payload, 'workflow_version_publish')
}

export function testWorkflowTemplateStep(payload: ApiBody) {
  return postAction(`${WORKFLOWS_PATH}/runs/test-step`, payload, 'workflow_step_test')
}
