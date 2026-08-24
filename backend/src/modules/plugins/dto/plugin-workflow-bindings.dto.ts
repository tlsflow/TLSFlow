export interface PluginWorkflowBindingRecord {
  pluginVersionId: string;
  capabilityKey: string;
  workflowResourcePath: string;
  workflowTemplateId: string;
  workflowVersionId: string;
  workflowContentSha256: string;
  createdAt: string;
}
