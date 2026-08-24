// 中文说明：此文件由 web/scripts/generate-openapi-types.mjs 从 backend/openapi/openapi.json 生成。
// 不要手写修改；需要变更契约时先更新后端 OpenAPI。


export type ApiPath = "/api/v1/health" | "/api/v1/auth/login" | "/api/v1/auth/external-login" | "/api/v1/auth/identity-sources/public" | "/api/v1/auth/logout" | "/api/v1/auth/me" | "/api/v1/auth/permissions" | "/api/v1/secrets" | "/api/v1/secrets/metadata" | "/api/v1/approvals" | "/api/v1/approvals/decide" | "/api/v1/audit-events" | "/api/v1/security/users" | "/api/v1/security/users" | "/api/v1/security/users/status" | "/api/v1/security/users/roles" | "/api/v1/security/roles" | "/api/v1/security/roles" | "/api/v1/security/permission-policies" | "/api/v1/security/permission-policies" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources/test" | "/api/v1/security/group-role-mappings" | "/api/v1/security/group-role-mappings" | "/api/v1/deployment-plans" | "/api/v1/deployment-plans" | "/api/v1/deployment-plans/submit" | "/api/v1/deployment-plans/dry-run" | "/api/v1/deployment-plans/execute" | "/api/v1/deployment-plans/cancel" | "/api/v1/deployment-plans/capabilities/reevaluate" | "/api/v1/execution-runs" | "/api/v1/execution-steps" | "/api/v1/execution-runs/retry" | "/api/v1/execution-runs/rollback" | "/api/v1/hosts" | "/api/v1/hosts" | "/api/v1/hosts" | "/api/v1/hosts/delete" | "/api/v1/service-instances" | "/api/v1/service-instances" | "/api/v1/service-instances" | "/api/v1/service-instances/delete" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints/delete" | "/api/v1/discovery-snapshots" | "/api/v1/discovery-snapshots" | "/api/v1/discovery-snapshots/merge-preview" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings/usage" | "/api/v1/certificate-bindings/drift" | "/api/v1/certificate-bindings/status" | "/api/v1/certificate-assets" | "/api/v1/certificate-assets" | "/api/v1/certificate-versions" | "/api/v1/certificate-versions/import" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats/export-plan" | "/api/v1/certificate-sources/mock-sync" | "/api/v1/capabilities/definitions" | "/api/v1/capabilities/declarations" | "/api/v1/capabilities/declarations" | "/api/v1/capabilities/declarations/manual" | "/api/v1/capabilities/requirements" | "/api/v1/capabilities/requirements" | "/api/v1/capabilities/match" | "/api/v1/capabilities/compatibility/evaluate" | "/api/v1/agents" | "/api/v1/agents/enrollment-tokens" | "/api/v1/agents/register" | "/api/v1/agents/sessions" | "/api/v1/agents/heartbeat" | "/api/v1/agents/capabilities" | "/api/v1/agents/tasks" | "/api/v1/agents/tasks/pull" | "/api/v1/agents/tasks/ack" | "/api/v1/agents/tasks/logs" | "/api/v1/agents/tasks/logs" | "/api/v1/agents/tasks/result" | "/api/v1/agents/versions" | "/api/v1/agents/upgrades/check" | "/api/v1/agents/upgrades/result" | "/api/v1/providers" | "/api/v1/providers/discovery-runs" | "/api/v1/provider-discovery-results" | "/api/v1/provider-discovery-result" | "/api/v1/plugins/packages" | "/api/v1/plugins/packages" | "/api/v1/plugins/permissions/approve" | "/api/v1/plugins/enable" | "/api/v1/plugins/disable" | "/api/v1/plugins/execute" | "/api/v1/plugins/executions" | "/api/v1/plugins/step-draft" | "/api/v1/plugins/permission-summary" | "/api/v1/plugins/capabilities" | "/api/v1/workflow-templates" | "/api/v1/workflow-templates" | "/api/v1/workflow-template-versions" | "/api/v1/workflow-template-versions" | "/api/v1/workflow-template-versions/publish" | "/api/v1/workflow-template-runs/preview" | "/api/v1/workflow-template-runs/test" | "/api/v1/monitors/scan" | "/api/v1/monitors/risks" | "/api/v1/monitors/dashboard" | "/api/v1/monitors/alert-rules" | "/api/v1/monitors/alert-rules" | "/api/v1/openapi.json"

export type ApiOperationId = "getHealth" | "login" | "externalLogin" | "listPublicIdentitySources" | "logout" | "getCurrentUser" | "getCurrentPermissions" | "createSecret" | "getSecretMetadata" | "createApproval" | "decideApproval" | "queryAuditEvents" | "listSecurityUsers" | "createSecurityUser" | "updateSecurityUserStatus" | "assignSecurityUserRole" | "listSecurityRoles" | "createSecurityRole" | "listSecurityPermissionPolicies" | "createSecurityPermissionPolicy" | "listIdentitySources" | "createIdentitySource" | "testIdentitySource" | "listGroupRoleMappings" | "createGroupRoleMapping" | "listDeploymentPlans" | "createDeploymentPlan" | "submitDeploymentPlan" | "dryRunDeploymentPlan" | "executeDeploymentPlan" | "cancelDeploymentPlan" | "reevaluateDeploymentPlanCapabilities" | "listExecutionRuns" | "listExecutionSteps" | "retryExecutionRun" | "rollbackExecutionRun" | "listHosts" | "createHost" | "updateHost" | "deleteHost" | "listServiceInstances" | "createServiceInstance" | "updateServiceInstance" | "deleteServiceInstance" | "listServiceEndpoints" | "createServiceEndpoint" | "updateServiceEndpoint" | "deleteServiceEndpoint" | "listDiscoverySnapshots" | "upsertDiscoverySnapshot" | "previewDiscoveryMerge" | "listCertificateBindings" | "createCertificateBinding" | "findCertificateBindingUsages" | "detectCertificateBindingDrift" | "patchCertificateBindingStatus" | "listCertificateAssets" | "createCertificateAsset" | "listCertificateVersions" | "importCertificateVersion" | "listCertificateVersionFormats" | "createCertificateVersionFormat" | "requestCertificateFormatExport" | "mockSyncCertificateSource" | "listCapabilityDefinitions" | "listCapabilityDeclarations" | "createCapabilityDeclaration" | "createManualCapabilityDeclaration" | "listCapabilityRequirements" | "createCapabilityRequirement" | "matchCapabilityRequirement" | "evaluateCapabilityCompatibility" | "listAgents" | "createAgentEnrollmentToken" | "registerAgent" | "createAgentMtlsSession" | "heartbeatAgent" | "reportAgentCapabilities" | "enqueueAgentTask" | "pullAgentTasks" | "ackAgentTask" | "submitAgentTaskLog" | "listAgentTaskLogs" | "submitAgentTaskResult" | "publishAgentVersion" | "checkAgentUpgrade" | "submitAgentUpgradeResult" | "listProviders" | "runProviderDiscovery" | "listProviderDiscoveryResults" | "getProviderDiscoveryResult" | "listPluginPackages" | "uploadPluginPackage" | "approvePluginPermissions" | "enablePlugin" | "disablePlugin" | "executePluginMockRuntime" | "listPluginExecutions" | "createPluginStepDraft" | "createPluginPermissionSummary" | "publishPluginCapabilities" | "listWorkflowTemplates" | "createWorkflowTemplate" | "listWorkflowTemplateVersions" | "createWorkflowTemplateVersion" | "publishWorkflowTemplateVersion" | "previewWorkflowTemplateRun" | "testWorkflowTemplateRun" | "scanMonitorRisks" | "listMonitorRisks" | "getMonitorDashboard" | "createMonitorAlertRule" | "listMonitorAlertRules" | "getOpenApiDocument"

export const apiOperations = [
  {
    "path": "/api/v1/health",
    "method": "GET",
    "operationId": "getHealth"
  },
  {
    "path": "/api/v1/auth/login",
    "method": "POST",
    "operationId": "login"
  },
  {
    "path": "/api/v1/auth/external-login",
    "method": "POST",
    "operationId": "externalLogin"
  },
  {
    "path": "/api/v1/auth/identity-sources/public",
    "method": "GET",
    "operationId": "listPublicIdentitySources"
  },
  {
    "path": "/api/v1/auth/logout",
    "method": "POST",
    "operationId": "logout"
  },
  {
    "path": "/api/v1/auth/me",
    "method": "GET",
    "operationId": "getCurrentUser"
  },
  {
    "path": "/api/v1/auth/permissions",
    "method": "GET",
    "operationId": "getCurrentPermissions"
  },
  {
    "path": "/api/v1/secrets",
    "method": "POST",
    "operationId": "createSecret"
  },
  {
    "path": "/api/v1/secrets/metadata",
    "method": "GET",
    "operationId": "getSecretMetadata"
  },
  {
    "path": "/api/v1/approvals",
    "method": "POST",
    "operationId": "createApproval"
  },
  {
    "path": "/api/v1/approvals/decide",
    "method": "POST",
    "operationId": "decideApproval"
  },
  {
    "path": "/api/v1/audit-events",
    "method": "GET",
    "operationId": "queryAuditEvents"
  },
  {
    "path": "/api/v1/security/users",
    "method": "GET",
    "operationId": "listSecurityUsers"
  },
  {
    "path": "/api/v1/security/users",
    "method": "POST",
    "operationId": "createSecurityUser"
  },
  {
    "path": "/api/v1/security/users/status",
    "method": "PATCH",
    "operationId": "updateSecurityUserStatus"
  },
  {
    "path": "/api/v1/security/users/roles",
    "method": "POST",
    "operationId": "assignSecurityUserRole"
  },
  {
    "path": "/api/v1/security/roles",
    "method": "GET",
    "operationId": "listSecurityRoles"
  },
  {
    "path": "/api/v1/security/roles",
    "method": "POST",
    "operationId": "createSecurityRole"
  },
  {
    "path": "/api/v1/security/permission-policies",
    "method": "GET",
    "operationId": "listSecurityPermissionPolicies"
  },
  {
    "path": "/api/v1/security/permission-policies",
    "method": "POST",
    "operationId": "createSecurityPermissionPolicy"
  },
  {
    "path": "/api/v1/security/identity-sources",
    "method": "GET",
    "operationId": "listIdentitySources"
  },
  {
    "path": "/api/v1/security/identity-sources",
    "method": "POST",
    "operationId": "createIdentitySource"
  },
  {
    "path": "/api/v1/security/identity-sources/test",
    "method": "POST",
    "operationId": "testIdentitySource"
  },
  {
    "path": "/api/v1/security/group-role-mappings",
    "method": "GET",
    "operationId": "listGroupRoleMappings"
  },
  {
    "path": "/api/v1/security/group-role-mappings",
    "method": "POST",
    "operationId": "createGroupRoleMapping"
  },
  {
    "path": "/api/v1/deployment-plans",
    "method": "GET",
    "operationId": "listDeploymentPlans"
  },
  {
    "path": "/api/v1/deployment-plans",
    "method": "POST",
    "operationId": "createDeploymentPlan"
  },
  {
    "path": "/api/v1/deployment-plans/submit",
    "method": "POST",
    "operationId": "submitDeploymentPlan"
  },
  {
    "path": "/api/v1/deployment-plans/dry-run",
    "method": "POST",
    "operationId": "dryRunDeploymentPlan"
  },
  {
    "path": "/api/v1/deployment-plans/execute",
    "method": "POST",
    "operationId": "executeDeploymentPlan"
  },
  {
    "path": "/api/v1/deployment-plans/cancel",
    "method": "POST",
    "operationId": "cancelDeploymentPlan"
  },
  {
    "path": "/api/v1/deployment-plans/capabilities/reevaluate",
    "method": "POST",
    "operationId": "reevaluateDeploymentPlanCapabilities"
  },
  {
    "path": "/api/v1/execution-runs",
    "method": "GET",
    "operationId": "listExecutionRuns"
  },
  {
    "path": "/api/v1/execution-steps",
    "method": "GET",
    "operationId": "listExecutionSteps"
  },
  {
    "path": "/api/v1/execution-runs/retry",
    "method": "POST",
    "operationId": "retryExecutionRun"
  },
  {
    "path": "/api/v1/execution-runs/rollback",
    "method": "POST",
    "operationId": "rollbackExecutionRun"
  },
  {
    "path": "/api/v1/hosts",
    "method": "GET",
    "operationId": "listHosts"
  },
  {
    "path": "/api/v1/hosts",
    "method": "POST",
    "operationId": "createHost"
  },
  {
    "path": "/api/v1/hosts",
    "method": "PATCH",
    "operationId": "updateHost"
  },
  {
    "path": "/api/v1/hosts/delete",
    "method": "POST",
    "operationId": "deleteHost"
  },
  {
    "path": "/api/v1/service-instances",
    "method": "GET",
    "operationId": "listServiceInstances"
  },
  {
    "path": "/api/v1/service-instances",
    "method": "POST",
    "operationId": "createServiceInstance"
  },
  {
    "path": "/api/v1/service-instances",
    "method": "PATCH",
    "operationId": "updateServiceInstance"
  },
  {
    "path": "/api/v1/service-instances/delete",
    "method": "POST",
    "operationId": "deleteServiceInstance"
  },
  {
    "path": "/api/v1/service-endpoints",
    "method": "GET",
    "operationId": "listServiceEndpoints"
  },
  {
    "path": "/api/v1/service-endpoints",
    "method": "POST",
    "operationId": "createServiceEndpoint"
  },
  {
    "path": "/api/v1/service-endpoints",
    "method": "PATCH",
    "operationId": "updateServiceEndpoint"
  },
  {
    "path": "/api/v1/service-endpoints/delete",
    "method": "POST",
    "operationId": "deleteServiceEndpoint"
  },
  {
    "path": "/api/v1/discovery-snapshots",
    "method": "GET",
    "operationId": "listDiscoverySnapshots"
  },
  {
    "path": "/api/v1/discovery-snapshots",
    "method": "POST",
    "operationId": "upsertDiscoverySnapshot"
  },
  {
    "path": "/api/v1/discovery-snapshots/merge-preview",
    "method": "POST",
    "operationId": "previewDiscoveryMerge"
  },
  {
    "path": "/api/v1/certificate-bindings",
    "method": "GET",
    "operationId": "listCertificateBindings"
  },
  {
    "path": "/api/v1/certificate-bindings",
    "method": "POST",
    "operationId": "createCertificateBinding"
  },
  {
    "path": "/api/v1/certificate-bindings/usage",
    "method": "GET",
    "operationId": "findCertificateBindingUsages"
  },
  {
    "path": "/api/v1/certificate-bindings/drift",
    "method": "POST",
    "operationId": "detectCertificateBindingDrift"
  },
  {
    "path": "/api/v1/certificate-bindings/status",
    "method": "PATCH",
    "operationId": "patchCertificateBindingStatus"
  },
  {
    "path": "/api/v1/certificate-assets",
    "method": "GET",
    "operationId": "listCertificateAssets"
  },
  {
    "path": "/api/v1/certificate-assets",
    "method": "POST",
    "operationId": "createCertificateAsset"
  },
  {
    "path": "/api/v1/certificate-versions",
    "method": "GET",
    "operationId": "listCertificateVersions"
  },
  {
    "path": "/api/v1/certificate-versions/import",
    "method": "POST",
    "operationId": "importCertificateVersion"
  },
  {
    "path": "/api/v1/certificate-version-formats",
    "method": "GET",
    "operationId": "listCertificateVersionFormats"
  },
  {
    "path": "/api/v1/certificate-version-formats",
    "method": "POST",
    "operationId": "createCertificateVersionFormat"
  },
  {
    "path": "/api/v1/certificate-version-formats/export-plan",
    "method": "POST",
    "operationId": "requestCertificateFormatExport"
  },
  {
    "path": "/api/v1/certificate-sources/mock-sync",
    "method": "POST",
    "operationId": "mockSyncCertificateSource"
  },
  {
    "path": "/api/v1/capabilities/definitions",
    "method": "GET",
    "operationId": "listCapabilityDefinitions"
  },
  {
    "path": "/api/v1/capabilities/declarations",
    "method": "GET",
    "operationId": "listCapabilityDeclarations"
  },
  {
    "path": "/api/v1/capabilities/declarations",
    "method": "POST",
    "operationId": "createCapabilityDeclaration"
  },
  {
    "path": "/api/v1/capabilities/declarations/manual",
    "method": "POST",
    "operationId": "createManualCapabilityDeclaration"
  },
  {
    "path": "/api/v1/capabilities/requirements",
    "method": "GET",
    "operationId": "listCapabilityRequirements"
  },
  {
    "path": "/api/v1/capabilities/requirements",
    "method": "POST",
    "operationId": "createCapabilityRequirement"
  },
  {
    "path": "/api/v1/capabilities/match",
    "method": "POST",
    "operationId": "matchCapabilityRequirement"
  },
  {
    "path": "/api/v1/capabilities/compatibility/evaluate",
    "method": "POST",
    "operationId": "evaluateCapabilityCompatibility"
  },
  {
    "path": "/api/v1/agents",
    "method": "GET",
    "operationId": "listAgents"
  },
  {
    "path": "/api/v1/agents/enrollment-tokens",
    "method": "POST",
    "operationId": "createAgentEnrollmentToken"
  },
  {
    "path": "/api/v1/agents/register",
    "method": "POST",
    "operationId": "registerAgent"
  },
  {
    "path": "/api/v1/agents/sessions",
    "method": "POST",
    "operationId": "createAgentMtlsSession"
  },
  {
    "path": "/api/v1/agents/heartbeat",
    "method": "POST",
    "operationId": "heartbeatAgent"
  },
  {
    "path": "/api/v1/agents/capabilities",
    "method": "POST",
    "operationId": "reportAgentCapabilities"
  },
  {
    "path": "/api/v1/agents/tasks",
    "method": "POST",
    "operationId": "enqueueAgentTask"
  },
  {
    "path": "/api/v1/agents/tasks/pull",
    "method": "GET",
    "operationId": "pullAgentTasks"
  },
  {
    "path": "/api/v1/agents/tasks/ack",
    "method": "POST",
    "operationId": "ackAgentTask"
  },
  {
    "path": "/api/v1/agents/tasks/logs",
    "method": "POST",
    "operationId": "submitAgentTaskLog"
  },
  {
    "path": "/api/v1/agents/tasks/logs",
    "method": "GET",
    "operationId": "listAgentTaskLogs"
  },
  {
    "path": "/api/v1/agents/tasks/result",
    "method": "POST",
    "operationId": "submitAgentTaskResult"
  },
  {
    "path": "/api/v1/agents/versions",
    "method": "POST",
    "operationId": "publishAgentVersion"
  },
  {
    "path": "/api/v1/agents/upgrades/check",
    "method": "POST",
    "operationId": "checkAgentUpgrade"
  },
  {
    "path": "/api/v1/agents/upgrades/result",
    "method": "POST",
    "operationId": "submitAgentUpgradeResult"
  },
  {
    "path": "/api/v1/providers",
    "method": "GET",
    "operationId": "listProviders"
  },
  {
    "path": "/api/v1/providers/discovery-runs",
    "method": "POST",
    "operationId": "runProviderDiscovery"
  },
  {
    "path": "/api/v1/provider-discovery-results",
    "method": "GET",
    "operationId": "listProviderDiscoveryResults"
  },
  {
    "path": "/api/v1/provider-discovery-result",
    "method": "GET",
    "operationId": "getProviderDiscoveryResult"
  },
  {
    "path": "/api/v1/plugins/packages",
    "method": "GET",
    "operationId": "listPluginPackages"
  },
  {
    "path": "/api/v1/plugins/packages",
    "method": "POST",
    "operationId": "uploadPluginPackage"
  },
  {
    "path": "/api/v1/plugins/permissions/approve",
    "method": "POST",
    "operationId": "approvePluginPermissions"
  },
  {
    "path": "/api/v1/plugins/enable",
    "method": "POST",
    "operationId": "enablePlugin"
  },
  {
    "path": "/api/v1/plugins/disable",
    "method": "POST",
    "operationId": "disablePlugin"
  },
  {
    "path": "/api/v1/plugins/execute",
    "method": "POST",
    "operationId": "executePluginMockRuntime"
  },
  {
    "path": "/api/v1/plugins/executions",
    "method": "GET",
    "operationId": "listPluginExecutions"
  },
  {
    "path": "/api/v1/plugins/step-draft",
    "method": "POST",
    "operationId": "createPluginStepDraft"
  },
  {
    "path": "/api/v1/plugins/permission-summary",
    "method": "POST",
    "operationId": "createPluginPermissionSummary"
  },
  {
    "path": "/api/v1/plugins/capabilities",
    "method": "POST",
    "operationId": "publishPluginCapabilities"
  },
  {
    "path": "/api/v1/workflow-templates",
    "method": "GET",
    "operationId": "listWorkflowTemplates"
  },
  {
    "path": "/api/v1/workflow-templates",
    "method": "POST",
    "operationId": "createWorkflowTemplate"
  },
  {
    "path": "/api/v1/workflow-template-versions",
    "method": "GET",
    "operationId": "listWorkflowTemplateVersions"
  },
  {
    "path": "/api/v1/workflow-template-versions",
    "method": "POST",
    "operationId": "createWorkflowTemplateVersion"
  },
  {
    "path": "/api/v1/workflow-template-versions/publish",
    "method": "POST",
    "operationId": "publishWorkflowTemplateVersion"
  },
  {
    "path": "/api/v1/workflow-template-runs/preview",
    "method": "POST",
    "operationId": "previewWorkflowTemplateRun"
  },
  {
    "path": "/api/v1/workflow-template-runs/test",
    "method": "POST",
    "operationId": "testWorkflowTemplateRun"
  },
  {
    "path": "/api/v1/monitors/scan",
    "method": "POST",
    "operationId": "scanMonitorRisks"
  },
  {
    "path": "/api/v1/monitors/risks",
    "method": "GET",
    "operationId": "listMonitorRisks"
  },
  {
    "path": "/api/v1/monitors/dashboard",
    "method": "GET",
    "operationId": "getMonitorDashboard"
  },
  {
    "path": "/api/v1/monitors/alert-rules",
    "method": "POST",
    "operationId": "createMonitorAlertRule"
  },
  {
    "path": "/api/v1/monitors/alert-rules",
    "method": "GET",
    "operationId": "listMonitorAlertRules"
  },
  {
    "path": "/api/v1/openapi.json",
    "method": "GET",
    "operationId": "getOpenApiDocument"
  }
] as const
