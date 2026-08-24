// 中文说明：此文件由 web/scripts/generate-openapi-types.mjs 从 backend/openapi/openapi.json 生成。
// 不要手写修改；需要变更契约时先更新后端 OpenAPI。


export type ApiPath = "/api/v1/health" | "/api/v1/auth/login" | "/api/v1/auth/external-login" | "/api/v1/auth/identity-sources/public" | "/api/v1/auth/logout" | "/api/v1/auth/me" | "/api/v1/auth/permissions" | "/api/v1/secrets" | "/api/v1/secrets/metadata" | "/api/v1/approvals" | "/api/v1/approvals/decide" | "/api/v1/audit-events" | "/api/v1/security/users" | "/api/v1/security/users" | "/api/v1/security/users" | "/api/v1/security/users/lookup-external" | "/api/v1/security/users/external" | "/api/v1/security/users/status" | "/api/v1/security/users/roles" | "/api/v1/security/users/delete" | "/api/v1/security/roles" | "/api/v1/security/roles" | "/api/v1/security/permission-policies" | "/api/v1/security/permission-policies" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources/delete" | "/api/v1/security/identity-sources/test" | "/api/v1/security/identity-sources/sync-users" | "/api/v1/security/group-role-mappings" | "/api/v1/security/group-role-mappings" | "/api/v1/deployment-plans" | "/api/v1/deployment-plans" | "/api/v1/deployment-plans/from-application-asset" | "/api/v1/deployment-plans/update-from-application-asset" | "/api/v1/deployment-plans/submit" | "/api/v1/deployment-plans/dry-run" | "/api/v1/deployment-plans/execute" | "/api/v1/deployment-plans/cancel" | "/api/v1/deployment-plans/delete" | "/api/v1/deployment-plans/capabilities/reevaluate" | "/api/v1/execution-runs" | "/api/v1/execution-steps" | "/api/v1/execution-runs/stream" | "/api/v1/execution-runs/retry" | "/api/v1/execution-runs/rollback" | "/api/v1/hosts" | "/api/v1/hosts" | "/api/v1/hosts" | "/api/v1/hosts/delete" | "/api/v1/service-instances" | "/api/v1/service-instances" | "/api/v1/service-instances" | "/api/v1/service-instances/delete" | "/api/v1/service-assets" | "/api/v1/service-assets" | "/api/v1/service-assets" | "/api/v1/service-assets/detail" | "/api/v1/service-assets/:id/deployment-strategy" | "/api/v1/service-assets/deployment-strategy" | "/api/v1/service-assets/delete" | "/api/v1/site-assets" | "/api/v1/site-assets" | "/api/v1/site-assets" | "/api/v1/site-assets/delete" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints/delete" | "/api/v1/managed-targets" | "/api/v1/managed-targets" | "/api/v1/managed-targets" | "/api/v1/managed-target-snapshots" | "/api/v1/managed-targets/delete" | "/api/v1/discovery-snapshots" | "/api/v1/discovery-snapshots" | "/api/v1/discovery-snapshots/ingest" | "/api/v1/discovery-snapshots/merge-preview" | "/api/v1/assets/refresh-from-agent" | "/api/v1/asset-conflicts" | "/api/v1/asset-conflicts/resolve" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings/usage" | "/api/v1/certificate-bindings/delete" | "/api/v1/certificate-bindings/drift" | "/api/v1/certificate-bindings/drift-results" | "/api/v1/certificate-bindings/status" | "/api/v1/certificate-formats/capabilities" | "/api/v1/certificate-assets" | "/api/v1/certificate-assets" | "/api/v1/certificate-assets/detail" | "/api/v1/certificate-assets/:id" | "/api/v1/certificate-assets/:id/usage" | "/api/v1/certificate-assets/archive" | "/api/v1/certificate-assets/delete" | "/api/v1/certificate-versions" | "/api/v1/certificate-versions/detail" | "/api/v1/certificate-versions/usage" | "/api/v1/certificate-versions/:id/formats" | "/api/v1/certificate-versions/import" | "/api/v1/certificate-versions/archive" | "/api/v1/certificate-versions/revoke" | "/api/v1/certificate-versions/delete" | "/api/v1/certificate-versions/validate-import" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats/delete" | "/api/v1/certificate-sources/mock-sync" | "/api/v1/capabilities/definitions" | "/api/v1/capabilities/declarations" | "/api/v1/capabilities/declarations" | "/api/v1/capabilities/declarations/manual" | "/api/v1/capabilities/requirements" | "/api/v1/capabilities/requirements" | "/api/v1/capabilities/match" | "/api/v1/capabilities/compatibility/evaluate" | "/api/v1/agents" | "/api/v1/agents/detail" | "/api/v1/agents/capabilities" | "/api/v1/agents/capabilities" | "/api/v1/agents/certificates" | "/api/v1/agents/tasks" | "/api/v1/agents/tasks" | "/api/v1/agents/tasks/log-cursor" | "/api/v1/agents/upgrades/suggestion" | "/api/v1/agents/:agentId/rescan" | "/api/v1/agents/enrollment-tokens" | "/api/v1/agents/install-sessions/windows-powershell" | "/agent-install.ps1" | "/agent-install" | "/api/v1/agents/install/windows/bootstrap.ps1" | "/api/v1/agents/install/windows/manifest" | "/api/v1/agents/disable" | "/api/v1/agents/register" | "/api/v1/agents/sessions" | "/api/v1/agents/certificate-requests" | "/api/v1/agents/certificates/sign" | "/api/v1/agents/certificates/rotate" | "/api/v1/agents/certificates/revoke" | "/api/v1/agents/heartbeat" | "/api/v1/agents/tasks/pull" | "/api/v1/agents/tasks/ack" | "/api/v1/agents/tasks/logs" | "/api/v1/agents/tasks/logs" | "/api/v1/agents/tasks/log-batches" | "/api/v1/agents/tasks/result" | "/api/v1/agents/versions" | "/api/v1/agents/upgrades/check" | "/api/v1/agents/upgrades/result" | "/api/v1/gateways" | "/api/v1/gateways/detail" | "/api/v1/gateways/target-history" | "/api/v1/gateways/route" | "/api/v1/gateways/probe" | "/api/v1/gateways/status" | "/api/v1/providers" | "/api/v1/providers/discovery-runs" | "/api/v1/provider-discovery-results" | "/api/v1/provider-discovery-result" | "/api/v1/plugins/packages" | "/api/v1/plugins/packages" | "/api/v1/plugins/permissions/approve" | "/api/v1/plugins/enable" | "/api/v1/plugins/disable" | "/api/v1/plugins/execute" | "/api/v1/plugins/executions" | "/api/v1/plugins/step-draft" | "/api/v1/plugins/permission-summary" | "/api/v1/plugins/capabilities" | "/api/v1/workflow-templates" | "/api/v1/workflow-templates" | "/api/v1/workflow-template-versions" | "/api/v1/workflow-template-versions" | "/api/v1/workflow-template-versions/publish" | "/api/v1/workflow-template-runs/preview" | "/api/v1/workflow-template-runs/test" | "/api/v1/workflow-template-runs/test-step" | "/api/v1/dashboard/overview" | "/api/v1/monitors/scan" | "/api/v1/monitors/probe" | "/api/v1/monitors/risks" | "/api/v1/monitors/certificate-observations" | "/api/v1/monitors/dashboard" | "/api/v1/monitors/alert-rules" | "/api/v1/monitors/alert-rules" | "/api/v1/openapi.json"

export type ApiOperationId = "getHealth" | "login" | "externalLogin" | "listPublicIdentitySources" | "logout" | "getCurrentUser" | "getCurrentPermissions" | "createSecret" | "getSecretMetadata" | "createApproval" | "decideApproval" | "queryAuditEvents" | "listSecurityUsers" | "createSecurityUser" | "updateSecurityUser" | "lookupExternalSecurityUser" | "createExternalSecurityUser" | "updateSecurityUserStatus" | "assignSecurityUserRole" | "deleteSecurityUser" | "listSecurityRoles" | "createSecurityRole" | "listSecurityPermissionPolicies" | "createSecurityPermissionPolicy" | "listIdentitySources" | "createIdentitySource" | "updateIdentitySource" | "deleteIdentitySource" | "testIdentitySource" | "syncIdentitySourceUsers" | "listGroupRoleMappings" | "createGroupRoleMapping" | "listDeploymentPlans" | "createDeploymentPlan" | "createDeploymentPlanFromApplicationAsset" | "updateDeploymentPlanFromApplicationAsset" | "submitDeploymentPlan" | "dryRunDeploymentPlan" | "executeDeploymentPlan" | "cancelDeploymentPlan" | "deleteDraftDeploymentPlan" | "reevaluateDeploymentPlanCapabilities" | "listExecutionRuns" | "listExecutionSteps" | "streamExecutionRunDetail" | "retryExecutionRun" | "rollbackExecutionRun" | "listHosts" | "createHost" | "updateHost" | "deleteHost" | "listServiceInstances" | "createServiceInstance" | "updateServiceInstance" | "deleteServiceInstance" | "listServiceAssets" | "createServiceAsset" | "updateServiceAsset" | "getServiceAssetDetail" | "updateServiceAssetDeploymentStrategyById" | "updateServiceAssetDeploymentStrategy" | "deleteServiceAsset" | "listSiteAssets" | "createSiteAsset" | "updateSiteAsset" | "deleteSiteAsset" | "listServiceEndpoints" | "createServiceEndpoint" | "updateServiceEndpoint" | "deleteServiceEndpoint" | "listManagedTargets" | "createManagedTarget" | "updateManagedTarget" | "listManagedTargetSnapshots" | "deleteManagedTarget" | "listDiscoverySnapshots" | "upsertDiscoverySnapshot" | "ingestDiscovery" | "previewDiscoveryMerge" | "refreshAssetsFromAgent" | "listAssetConflicts" | "resolveAssetConflict" | "listCertificateBindings" | "createCertificateBinding" | "updateCertificateBinding" | "findCertificateBindingUsages" | "deleteCertificateBinding" | "detectCertificateBindingDrift" | "persistCertificateBindingDrift" | "patchCertificateBindingStatus" | "getCertificateFormatCapabilities" | "listCertificateAssets" | "createCertificateAsset" | "getCertificateAssetDetail" | "getCertificateAssetDetailById" | "getCertificateAssetUsageById" | "archiveCertificateAsset" | "deleteCertificateAsset" | "listCertificateVersions" | "getCertificateVersionDetail" | "getCertificateVersionUsage" | "listCertificateVersionFormatsByVersionId" | "importCertificateVersion" | "archiveCertificateVersion" | "revokeCertificateVersion" | "deleteCertificateVersion" | "validateImportCertificateVersion" | "listCertificateVersionFormats" | "createCertificateVersionFormat" | "updateCertificateVersionFormat" | "deleteCertificateVersionFormat" | "mockSyncCertificateSource" | "listCapabilityDefinitions" | "listCapabilityDeclarations" | "createCapabilityDeclaration" | "createManualCapabilityDeclaration" | "listCapabilityRequirements" | "createCapabilityRequirement" | "matchCapabilityRequirement" | "evaluateCapabilityCompatibility" | "listAgents" | "getAgentDetail" | "getAgentCapabilities" | "reportAgentCapabilities" | "listAgentCertificates" | "listAgentTaskQueue" | "enqueueAgentTask" | "getAgentTaskLogCursor" | "getAgentUpgradeSuggestion" | "enqueueAgentCapabilityRescanTask" | "createAgentEnrollmentToken" | "createWindowsPowerShellAgentInstallSession" | "getWindowsPowerShellAgentShortInstall" | "getLinuxGoAgentShortInstall" | "getWindowsPowerShellAgentBootstrap" | "getWindowsPowerShellAgentInstallManifest" | "disableAgent" | "registerAgent" | "createAgentMtlsSession" | "createAgentCertificateSigningRequest" | "signAgentCertificate" | "rotateAgentCertificate" | "revokeAgentCertificate" | "heartbeatAgent" | "pullAgentTasks" | "ackAgentTask" | "submitAgentTaskLog" | "listAgentTaskLogs" | "submitAgentTaskLogBatch" | "submitAgentTaskResult" | "publishAgentVersion" | "checkAgentUpgrade" | "submitAgentUpgradeResult" | "listGateways" | "getGatewayDetail" | "listGatewayTargetHistory" | "routeGateway" | "probeGatewayReachability" | "updateGatewayStatus" | "listProviders" | "runProviderDiscovery" | "listProviderDiscoveryResults" | "getProviderDiscoveryResult" | "listPluginPackages" | "uploadPluginPackage" | "approvePluginPermissions" | "enablePlugin" | "disablePlugin" | "executePluginMockRuntime" | "listPluginExecutions" | "createPluginStepDraft" | "createPluginPermissionSummary" | "publishPluginCapabilities" | "listWorkflowTemplates" | "createWorkflowTemplate" | "listWorkflowTemplateVersions" | "createWorkflowTemplateVersion" | "publishWorkflowTemplateVersion" | "previewWorkflowTemplateRun" | "testWorkflowTemplateRun" | "testWorkflowTemplateStep" | "getDashboardOverview" | "scanMonitorRisks" | "probeMonitorServiceAsset" | "listMonitorRisks" | "listMonitorCertificateObservations" | "getMonitorDashboard" | "createMonitorAlertRule" | "listMonitorAlertRules" | "getOpenApiDocument"

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
    "path": "/api/v1/security/users",
    "method": "PATCH",
    "operationId": "updateSecurityUser"
  },
  {
    "path": "/api/v1/security/users/lookup-external",
    "method": "POST",
    "operationId": "lookupExternalSecurityUser"
  },
  {
    "path": "/api/v1/security/users/external",
    "method": "POST",
    "operationId": "createExternalSecurityUser"
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
    "path": "/api/v1/security/users/delete",
    "method": "DELETE",
    "operationId": "deleteSecurityUser"
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
    "path": "/api/v1/security/identity-sources",
    "method": "PATCH",
    "operationId": "updateIdentitySource"
  },
  {
    "path": "/api/v1/security/identity-sources/delete",
    "method": "DELETE",
    "operationId": "deleteIdentitySource"
  },
  {
    "path": "/api/v1/security/identity-sources/test",
    "method": "POST",
    "operationId": "testIdentitySource"
  },
  {
    "path": "/api/v1/security/identity-sources/sync-users",
    "method": "POST",
    "operationId": "syncIdentitySourceUsers"
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
    "path": "/api/v1/deployment-plans/from-application-asset",
    "method": "POST",
    "operationId": "createDeploymentPlanFromApplicationAsset"
  },
  {
    "path": "/api/v1/deployment-plans/update-from-application-asset",
    "method": "POST",
    "operationId": "updateDeploymentPlanFromApplicationAsset"
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
    "path": "/api/v1/deployment-plans/delete",
    "method": "POST",
    "operationId": "deleteDraftDeploymentPlan"
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
    "path": "/api/v1/execution-runs/stream",
    "method": "GET",
    "operationId": "streamExecutionRunDetail"
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
    "path": "/api/v1/service-assets",
    "method": "GET",
    "operationId": "listServiceAssets"
  },
  {
    "path": "/api/v1/service-assets",
    "method": "POST",
    "operationId": "createServiceAsset"
  },
  {
    "path": "/api/v1/service-assets",
    "method": "PATCH",
    "operationId": "updateServiceAsset"
  },
  {
    "path": "/api/v1/service-assets/detail",
    "method": "GET",
    "operationId": "getServiceAssetDetail"
  },
  {
    "path": "/api/v1/service-assets/:id/deployment-strategy",
    "method": "PATCH",
    "operationId": "updateServiceAssetDeploymentStrategyById"
  },
  {
    "path": "/api/v1/service-assets/deployment-strategy",
    "method": "PATCH",
    "operationId": "updateServiceAssetDeploymentStrategy"
  },
  {
    "path": "/api/v1/service-assets/delete",
    "method": "POST",
    "operationId": "deleteServiceAsset"
  },
  {
    "path": "/api/v1/site-assets",
    "method": "GET",
    "operationId": "listSiteAssets"
  },
  {
    "path": "/api/v1/site-assets",
    "method": "POST",
    "operationId": "createSiteAsset"
  },
  {
    "path": "/api/v1/site-assets",
    "method": "PATCH",
    "operationId": "updateSiteAsset"
  },
  {
    "path": "/api/v1/site-assets/delete",
    "method": "POST",
    "operationId": "deleteSiteAsset"
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
    "path": "/api/v1/managed-targets",
    "method": "GET",
    "operationId": "listManagedTargets"
  },
  {
    "path": "/api/v1/managed-targets",
    "method": "POST",
    "operationId": "createManagedTarget"
  },
  {
    "path": "/api/v1/managed-targets",
    "method": "PATCH",
    "operationId": "updateManagedTarget"
  },
  {
    "path": "/api/v1/managed-target-snapshots",
    "method": "GET",
    "operationId": "listManagedTargetSnapshots"
  },
  {
    "path": "/api/v1/managed-targets/delete",
    "method": "POST",
    "operationId": "deleteManagedTarget"
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
    "path": "/api/v1/discovery-snapshots/ingest",
    "method": "POST",
    "operationId": "ingestDiscovery"
  },
  {
    "path": "/api/v1/discovery-snapshots/merge-preview",
    "method": "POST",
    "operationId": "previewDiscoveryMerge"
  },
  {
    "path": "/api/v1/assets/refresh-from-agent",
    "method": "POST",
    "operationId": "refreshAssetsFromAgent"
  },
  {
    "path": "/api/v1/asset-conflicts",
    "method": "GET",
    "operationId": "listAssetConflicts"
  },
  {
    "path": "/api/v1/asset-conflicts/resolve",
    "method": "POST",
    "operationId": "resolveAssetConflict"
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
    "path": "/api/v1/certificate-bindings",
    "method": "PATCH",
    "operationId": "updateCertificateBinding"
  },
  {
    "path": "/api/v1/certificate-bindings/usage",
    "method": "GET",
    "operationId": "findCertificateBindingUsages"
  },
  {
    "path": "/api/v1/certificate-bindings/delete",
    "method": "POST",
    "operationId": "deleteCertificateBinding"
  },
  {
    "path": "/api/v1/certificate-bindings/drift",
    "method": "POST",
    "operationId": "detectCertificateBindingDrift"
  },
  {
    "path": "/api/v1/certificate-bindings/drift-results",
    "method": "POST",
    "operationId": "persistCertificateBindingDrift"
  },
  {
    "path": "/api/v1/certificate-bindings/status",
    "method": "PATCH",
    "operationId": "patchCertificateBindingStatus"
  },
  {
    "path": "/api/v1/certificate-formats/capabilities",
    "method": "GET",
    "operationId": "getCertificateFormatCapabilities"
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
    "path": "/api/v1/certificate-assets/detail",
    "method": "GET",
    "operationId": "getCertificateAssetDetail"
  },
  {
    "path": "/api/v1/certificate-assets/:id",
    "method": "GET",
    "operationId": "getCertificateAssetDetailById"
  },
  {
    "path": "/api/v1/certificate-assets/:id/usage",
    "method": "GET",
    "operationId": "getCertificateAssetUsageById"
  },
  {
    "path": "/api/v1/certificate-assets/archive",
    "method": "POST",
    "operationId": "archiveCertificateAsset"
  },
  {
    "path": "/api/v1/certificate-assets/delete",
    "method": "DELETE",
    "operationId": "deleteCertificateAsset"
  },
  {
    "path": "/api/v1/certificate-versions",
    "method": "GET",
    "operationId": "listCertificateVersions"
  },
  {
    "path": "/api/v1/certificate-versions/detail",
    "method": "GET",
    "operationId": "getCertificateVersionDetail"
  },
  {
    "path": "/api/v1/certificate-versions/usage",
    "method": "GET",
    "operationId": "getCertificateVersionUsage"
  },
  {
    "path": "/api/v1/certificate-versions/:id/formats",
    "method": "GET",
    "operationId": "listCertificateVersionFormatsByVersionId"
  },
  {
    "path": "/api/v1/certificate-versions/import",
    "method": "POST",
    "operationId": "importCertificateVersion"
  },
  {
    "path": "/api/v1/certificate-versions/archive",
    "method": "POST",
    "operationId": "archiveCertificateVersion"
  },
  {
    "path": "/api/v1/certificate-versions/revoke",
    "method": "POST",
    "operationId": "revokeCertificateVersion"
  },
  {
    "path": "/api/v1/certificate-versions/delete",
    "method": "DELETE",
    "operationId": "deleteCertificateVersion"
  },
  {
    "path": "/api/v1/certificate-versions/validate-import",
    "method": "POST",
    "operationId": "validateImportCertificateVersion"
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
    "path": "/api/v1/certificate-version-formats",
    "method": "PATCH",
    "operationId": "updateCertificateVersionFormat"
  },
  {
    "path": "/api/v1/certificate-version-formats/delete",
    "method": "POST",
    "operationId": "deleteCertificateVersionFormat"
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
    "path": "/api/v1/agents/detail",
    "method": "GET",
    "operationId": "getAgentDetail"
  },
  {
    "path": "/api/v1/agents/capabilities",
    "method": "GET",
    "operationId": "getAgentCapabilities"
  },
  {
    "path": "/api/v1/agents/capabilities",
    "method": "POST",
    "operationId": "reportAgentCapabilities"
  },
  {
    "path": "/api/v1/agents/certificates",
    "method": "GET",
    "operationId": "listAgentCertificates"
  },
  {
    "path": "/api/v1/agents/tasks",
    "method": "GET",
    "operationId": "listAgentTaskQueue"
  },
  {
    "path": "/api/v1/agents/tasks",
    "method": "POST",
    "operationId": "enqueueAgentTask"
  },
  {
    "path": "/api/v1/agents/tasks/log-cursor",
    "method": "GET",
    "operationId": "getAgentTaskLogCursor"
  },
  {
    "path": "/api/v1/agents/upgrades/suggestion",
    "method": "GET",
    "operationId": "getAgentUpgradeSuggestion"
  },
  {
    "path": "/api/v1/agents/:agentId/rescan",
    "method": "POST",
    "operationId": "enqueueAgentCapabilityRescanTask"
  },
  {
    "path": "/api/v1/agents/enrollment-tokens",
    "method": "POST",
    "operationId": "createAgentEnrollmentToken"
  },
  {
    "path": "/api/v1/agents/install-sessions/windows-powershell",
    "method": "POST",
    "operationId": "createWindowsPowerShellAgentInstallSession"
  },
  {
    "path": "/agent-install.ps1",
    "method": "GET",
    "operationId": "getWindowsPowerShellAgentShortInstall"
  },
  {
    "path": "/agent-install",
    "method": "GET",
    "operationId": "getLinuxGoAgentShortInstall"
  },
  {
    "path": "/api/v1/agents/install/windows/bootstrap.ps1",
    "method": "GET",
    "operationId": "getWindowsPowerShellAgentBootstrap"
  },
  {
    "path": "/api/v1/agents/install/windows/manifest",
    "method": "GET",
    "operationId": "getWindowsPowerShellAgentInstallManifest"
  },
  {
    "path": "/api/v1/agents/disable",
    "method": "POST",
    "operationId": "disableAgent"
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
    "path": "/api/v1/agents/certificate-requests",
    "method": "POST",
    "operationId": "createAgentCertificateSigningRequest"
  },
  {
    "path": "/api/v1/agents/certificates/sign",
    "method": "POST",
    "operationId": "signAgentCertificate"
  },
  {
    "path": "/api/v1/agents/certificates/rotate",
    "method": "POST",
    "operationId": "rotateAgentCertificate"
  },
  {
    "path": "/api/v1/agents/certificates/revoke",
    "method": "POST",
    "operationId": "revokeAgentCertificate"
  },
  {
    "path": "/api/v1/agents/heartbeat",
    "method": "POST",
    "operationId": "heartbeatAgent"
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
    "path": "/api/v1/agents/tasks/log-batches",
    "method": "POST",
    "operationId": "submitAgentTaskLogBatch"
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
    "path": "/api/v1/gateways",
    "method": "GET",
    "operationId": "listGateways"
  },
  {
    "path": "/api/v1/gateways/detail",
    "method": "GET",
    "operationId": "getGatewayDetail"
  },
  {
    "path": "/api/v1/gateways/target-history",
    "method": "GET",
    "operationId": "listGatewayTargetHistory"
  },
  {
    "path": "/api/v1/gateways/route",
    "method": "POST",
    "operationId": "routeGateway"
  },
  {
    "path": "/api/v1/gateways/probe",
    "method": "POST",
    "operationId": "probeGatewayReachability"
  },
  {
    "path": "/api/v1/gateways/status",
    "method": "POST",
    "operationId": "updateGatewayStatus"
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
    "path": "/api/v1/workflow-template-runs/test-step",
    "method": "POST",
    "operationId": "testWorkflowTemplateStep"
  },
  {
    "path": "/api/v1/dashboard/overview",
    "method": "GET",
    "operationId": "getDashboardOverview"
  },
  {
    "path": "/api/v1/monitors/scan",
    "method": "POST",
    "operationId": "scanMonitorRisks"
  },
  {
    "path": "/api/v1/monitors/probe",
    "method": "POST",
    "operationId": "probeMonitorServiceAsset"
  },
  {
    "path": "/api/v1/monitors/risks",
    "method": "GET",
    "operationId": "listMonitorRisks"
  },
  {
    "path": "/api/v1/monitors/certificate-observations",
    "method": "GET",
    "operationId": "listMonitorCertificateObservations"
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
