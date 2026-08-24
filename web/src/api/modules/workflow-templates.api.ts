import { apiClient, createIdempotencyKey } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiRecord, type BusinessListQuery } from './common'

const WORKFLOW_TEMPLATES_PATH = '/api/v1/workflow-templates'
const WORKFLOW_FILE_TEMPLATES_PATH = '/api/v1/workflow-file-templates'
const WORKFLOW_TEMPLATE_VERSIONS_PATH = '/api/v1/workflow-template-versions'
const WORKFLOW_TEMPLATE_PUBLISH_PATH = '/api/v1/workflow-template-versions/publish'
const WORKFLOW_TEMPLATE_STEP_TEST_PATH = '/api/v1/workflow-template-runs/test-step'
const WORKFLOWS_PATH = '/api/v1/workflows'
const WORKFLOW_RUNS_PATH = '/api/v1/workflow-runs'

export function listWorkflowTemplates(query?: BusinessListQuery) {
  return listRecords(WORKFLOW_TEMPLATES_PATH, query)
}

export function createWorkflowTemplate(payload: ApiBody) {
  return postAction(WORKFLOW_TEMPLATES_PATH, payload, 'workflow_template_create')
}

export function listWorkflowFileTemplates() {
  return apiClient.get<{ items?: readonly ApiRecord[] }>(toClientPath(WORKFLOW_FILE_TEMPLATES_PATH))
}

export function createWorkflowTemplateFromFile(payload: ApiBody) {
  return postAction(`${WORKFLOW_FILE_TEMPLATES_PATH}/create`, payload, 'workflow_template_file_create')
}

export function applyWorkflowTemplateFromFile(payload: ApiBody) {
  return postAction(`${WORKFLOW_FILE_TEMPLATES_PATH}/apply`, payload, 'workflow_template_file_apply')
}

export function listWorkflowTemplateVersions(templateId: string) {
  const query = new URLSearchParams({ templateId }).toString()
  return apiClient.get<{ items?: readonly ApiRecord[] }>(`${toClientPath(WORKFLOW_TEMPLATE_VERSIONS_PATH)}?${query}`)
}

export function createWorkflowTemplateVersion(payload: ApiBody) {
  return postAction(WORKFLOW_TEMPLATE_VERSIONS_PATH, payload, 'workflow_template_version_create')
}

export function publishWorkflowTemplateVersion(versionId: string, payload: ApiBody = {}) {
  return postAction(WORKFLOW_TEMPLATE_PUBLISH_PATH, { ...payload, versionId }, 'workflow_template_publish')
}

export function testWorkflowTemplateStep(payload: ApiBody) {
  return postAction(WORKFLOW_TEMPLATE_STEP_TEST_PATH, payload, 'workflow_template_step_test')
}

// 中文说明：新产品语义叫“工作流”，迁移期仍保留上面的 workflow-template 旧接口命名。
// 后端新 /workflows API 完成前，页面保存草稿会继续通过 createWorkflowTemplateVersion 兼容落 DSL。
export function saveWorkflowDraftCanvas(workflowId: string, canvas: ApiBody) {
  return apiClient.request<ApiRecord>(toClientPath(`${WORKFLOWS_PATH}/${workflowId}/draft/canvas`), {
    method: 'PUT',
    body: canvas,
    idempotencyKey: createIdempotencyKey('workflow_canvas_save'),
  })
}

export function validateWorkflowDraftCanvas(workflowId: string, canvas: ApiBody) {
  return postAction(`${WORKFLOWS_PATH}/${workflowId}/draft/validate`, canvas, 'workflow_canvas_validate')
}

export function preflightWorkflowVersion(workflowId: string, versionId: string, payload: ApiBody = {}) {
  return postAction(`${WORKFLOWS_PATH}/${workflowId}/versions/${versionId}/preflight`, payload, 'workflow_preflight')
}

export function diffWorkflowVersions(workflowId: string, fromVersionId: string, toVersionId: string) {
  const query = new URLSearchParams({ from: fromVersionId, to: toVersionId }).toString()
  return apiClient.get<ApiRecord>(`${toClientPath(`${WORKFLOWS_PATH}/${workflowId}/versions/diff`)}?${query}`)
}

export function getWorkflowRuntimeGraph(runId: string) {
  return apiClient.get<ApiRecord>(toClientPath(`${WORKFLOW_RUNS_PATH}/${runId}/runtime-graph`))
}
