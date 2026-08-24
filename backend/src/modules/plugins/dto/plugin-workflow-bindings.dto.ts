export interface PluginWorkflowBindingRecord {
  pluginVersionId: string;
  ownerType?: 'SYSTEM' | 'TENANT';
  ownerId?: string;
  capabilityKey: string;
  workflowResourcePath: string;
  workflowTemplateId: string;
  workflowVersionId: string;
  workflowContentSha256: string;
  createdAt: string;
}
