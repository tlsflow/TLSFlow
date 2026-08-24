import { apiClient } from '@/api/client'
import { listRecords, postAction, toClientPath, type ApiBody, type ApiRecord, type BusinessListQuery } from './common'

const WORKFLOW_TEMPLATES_PATH = '/api/v1/workflow-templates'
const WORKFLOW_TEMPLATE_VERSIONS_PATH = '/api/v1/workflow-template-versions'
const WORKFLOW_TEMPLATE_PUBLISH_PATH = '/api/v1/workflow-template-versions/publish'

export function listWorkflowTemplates(query?: BusinessListQuery) {
  return listRecords(WORKFLOW_TEMPLATES_PATH, query)
}

export function createWorkflowTemplate(payload: ApiBody) {
  return postAction(WORKFLOW_TEMPLATES_PATH, payload, 'workflow_template_create')
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
