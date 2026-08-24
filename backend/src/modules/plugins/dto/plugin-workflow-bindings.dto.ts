export interface PluginWorkflowBindingRecord {
  pluginVersionId: string;
  /** 仅用于跨历史模板记录合并展示，不参与绑定写入。 */
  pluginId?: string;
  ownerType?: 'SYSTEM' | 'TENANT';
  ownerId?: string;
  capabilityKey: string;
  workflowResourcePath: string;
  workflowTemplateId: string;
  workflowVersionId: string;
  workflowContentSha256: string;
  createdAt: string;
}
