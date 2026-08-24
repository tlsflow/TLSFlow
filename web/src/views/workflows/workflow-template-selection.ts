import type { ApiRecord } from '@/api/modules/common'

export type WorkflowTemplateOrigin = 'plugin_internal' | 'user'

/**
 * 将接口来源值归一化为当前前端工作流目录使用的两种来源。
 * 未知来源按用户工作流处理，兼容历史接口记录和已有资产绑定。
 */
export function normalizeWorkflowTemplateOrigin(value: unknown): WorkflowTemplateOrigin {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_')
  return normalized === 'plugin_internal' ? 'plugin_internal' : 'user'
}

export function workflowTemplateCapabilities(record: ApiRecord): string[] {
  const capabilities = record.capabilities
  return Array.isArray(capabilities) ? capabilities.map((capability) => String(capability)) : []
}

/**
 * 工作流管理页和应用资产选择器默认都只面向证书部署能力。
 * 用户工作流无法仅凭目录摘要判断用途，因此继续保留；插件内置工作流必须明确声明 certificate.deploy。
 */
export function isCertificateDeploymentWorkflow(record: ApiRecord): boolean {
  if (normalizeWorkflowTemplateOrigin(record.origin) === 'user') return true
  return workflowTemplateCapabilities(record).includes('certificate.deploy')
}

export function filterCertificateDeploymentWorkflows(
  records: readonly ApiRecord[],
  options: { preserveWorkflowId?: string } = {},
): ApiRecord[] {
  const preserveWorkflowId = options.preserveWorkflowId?.trim() ?? ''
  return records.filter((record) =>
    isCertificateDeploymentWorkflow(record)
      || (preserveWorkflowId !== '' && String(record.id ?? '') === preserveWorkflowId),
  )
}
