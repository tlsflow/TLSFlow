// 中文说明：此文件由 web/scripts/generate-openapi-types.mjs 从 backend/openapi/openapi.json 生成。
// 不要手写修改；需要变更契约时先更新后端 OpenAPI。


export type ApiPath = "/api/v1/health" | "/api/v1/auth/login" | "/api/v1/auth/external-login" | "/api/v1/auth/identity-sources/public" | "/api/v1/auth/logout" | "/api/v1/auth/me" | "/api/v1/auth/permissions" | "/api/v1/auth/permission-context" | "/api/v1/auth/password" | "/api/v1/auth/preferences" | "/api/v1/auth/preferences" | "/api/v1/secrets" | "/api/v1/secrets" | "/api/v1/secrets/metadata" | "/api/v1/approvals" | "/api/v1/approvals/decide" | "/api/v1/audit-events" | "/api/v1/security/users" | "/api/v1/security/users" | "/api/v1/security/users" | "/api/v1/security/groups" | "/api/v1/security/groups" | "/api/v1/security/groups/lookup-external" | "/api/v1/security/groups/external" | "/api/v1/security/users/lookup-external" | "/api/v1/security/users/external" | "/api/v1/security/users/status" | "/api/v1/security/users/roles" | "/api/v1/security/users/delete" | "/api/v1/security/roles" | "/api/v1/security/roles" | "/api/v1/security/roles/delete" | "/api/v1/security/permission-policies" | "/api/v1/security/permission-policies" | "/api/v1/security/object-types" | "/api/v1/security/object-sets" | "/api/v1/security/object-sets" | "/api/v1/security/object-set-members" | "/api/v1/security/role-bindings" | "/api/v1/security/role-bindings" | "/api/v1/security/access-grants" | "/api/v1/security/access-grants" | "/api/v1/security/object-capabilities" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources" | "/api/v1/security/identity-sources/delete" | "/api/v1/security/identity-sources/test" | "/api/v1/security/identity-sources/sync-users" | "/api/v1/security/group-role-mappings" | "/api/v1/security/group-role-mappings" | "/api/v1/deployment-plans" | "/api/v1/deployment-plans" | "/api/v1/deployment-plans/from-application-asset" | "/api/v1/deployment-plans/update-from-application-asset" | "/api/v1/deployment-plans/submit" | "/api/v1/deployment-plans/dry-run" | "/api/v1/deployment-plans/execute" | "/api/v1/deployment-plans/cancel" | "/api/v1/deployment-plans/delete" | "/api/v1/deployment-plans/capabilities/reevaluate" | "/api/v1/execution-runs" | "/api/v1/execution-steps" | "/api/v1/execution-runs/stream" | "/api/v1/execution-workflow-recovery" | "/api/v1/execution-runs/retry" | "/api/v1/execution-runs/rollback" | "/api/v1/hosts" | "/api/v1/hosts" | "/api/v1/hosts" | "/api/v1/hosts/delete" | "/api/v1/framework-instances" | "/api/v1/framework-instances" | "/api/v1/framework-instances" | "/api/v1/framework-instances/delete" | "/api/v1/service-assets" | "/api/v1/service-assets" | "/api/v1/service-assets" | "/api/v1/service-assets/detail" | "/api/v1/service-assets/:id/deployment-strategy" | "/api/v1/service-assets/deployment-strategy" | "/api/v1/service-assets/workflow-binding-projection" | "/api/v1/application-assets/:applicationAssetId/standalone-workflow" | "/api/v1/service-assets/delete" | "/api/v1/application-asset-targets" | "/api/v1/application-asset-targets" | "/api/v1/application-asset-targets" | "/api/v1/application-asset-targets/delete" | "/api/v1/site-assets" | "/api/v1/site-assets" | "/api/v1/site-assets" | "/api/v1/site-assets/delete" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints" | "/api/v1/service-endpoints/delete" | "/api/v1/managed-targets" | "/api/v1/managed-targets" | "/api/v1/managed-targets" | "/api/v1/managed-target-snapshots" | "/api/v1/managed-targets/delete" | "/api/v1/discovery-snapshots" | "/api/v1/discovery-snapshots" | "/api/v1/discovery-snapshots/ingest" | "/api/v1/discovery-snapshots/merge-preview" | "/api/v1/assets/refresh-from-agent" | "/api/v1/asset-conflicts" | "/api/v1/asset-conflicts/resolve" | "/api/v1/device-assets" | "/api/v1/device-assets" | "/api/v1/device-assets" | "/api/v1/device-assets/detail" | "/api/v1/device-assets/delete" | "/api/v1/devices" | "/api/v1/devices/:deviceId/actions" | "/api/v1/devices/onboarding" | "/api/v1/devices/onboarding-platforms" | "/api/v1/devices/:deviceId" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings" | "/api/v1/certificate-bindings/usage" | "/api/v1/certificate-bindings/delete" | "/api/v1/certificate-bindings/drift" | "/api/v1/certificate-bindings/drift-results" | "/api/v1/certificate-bindings/status" | "/api/v1/certificate-formats/capabilities" | "/api/v1/certificate-assets" | "/api/v1/certificate-assets" | "/api/v1/certificate-assets/detail" | "/api/v1/certificate-assets/:id" | "/api/v1/certificate-assets/:id/usage" | "/api/v1/certificate-assets/archive" | "/api/v1/certificate-assets/delete" | "/api/v1/certificate-versions" | "/api/v1/certificate-versions/detail" | "/api/v1/certificate-versions/usage" | "/api/v1/certificate-versions/:id/formats" | "/api/v1/certificate-versions/import" | "/api/v1/certificate-versions/archive" | "/api/v1/certificate-versions/revoke" | "/api/v1/certificate-versions/delete" | "/api/v1/certificate-versions/validate-import" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats" | "/api/v1/certificate-version-formats/export-plan" | "/api/v1/certificate-version-formats/export" | "/api/v1/certificate-version-formats/delete" | "/api/v1/certificate-sources/mock-sync" | "/api/v1/ca-providers" | "/api/v1/ca-providers" | "/api/v1/ca-providers/:id" | "/api/v1/ca-providers/:id/test" | "/api/v1/certificate-authorities" | "/api/v1/certificate-authorities" | "/api/v1/certificate-authorities/preview" | "/api/v1/certificate-profiles" | "/api/v1/certificate-profiles" | "/api/v1/certificate-profiles/:id/versions" | "/api/v1/certificate-requests" | "/api/v1/certificate-requests" | "/api/v1/certificate-requests/:id/approve" | "/api/v1/certificate-requests/:id/retry" | "/api/v1/certificate-requests/:id/query" | "/api/v1/certificate-requests/:id/activate" | "/api/v1/certificate-renewals" | "/api/v1/certificate-renewals/scan" | "/api/v1/certificate-revocations" | "/api/v1/certificate-revocations" | "/api/v1/certificate-revocations/:id/approve" | "/api/v1/ca-trust-distributions" | "/api/v1/ca-trust-distributions" | "/api/v1/ca-trust-distributions/:id/approve" | "/api/v1/ca-trust-distributions/:id/complete" | "/api/v1/reports/certificate-reuse/overview" | "/api/v1/reports/certificate-reuse/items" | "/api/v1/reports/certificate-reuse/export" | "/api/v1/reports/certificate-reuse/:id/remediation-preview" | "/api/v1/ca-nodes" | "/api/v1/ca-nodes/enrollment-tokens" | "/api/v1/ca-nodes/register" | "/api/v1/ca-nodes/heartbeat" | "/api/v1/ca-nodes/tasks/lease" | "/api/v1/ca-nodes/tasks/stream" | "/api/v1/ca-nodes/tasks/:id/result" | "/api/v1/adcs-agents/install-sessions" | "/api/v1/adcs-agents/providers/:id/update-sessions" | "/api/v1/adcs-agents/providers/:id/inspection-tasks" | "/api/v1/adcs-agents/inspection-tasks/:id" | "/api/v1/adcs-agents/install.ps1" | "/api/v1/adcs-agents/binary" | "/api/v1/capabilities/definitions" | "/api/v1/capabilities/declarations" | "/api/v1/capabilities/declarations" | "/api/v1/capabilities/declarations/manual" | "/api/v1/capabilities/requirements" | "/api/v1/capabilities/requirements" | "/api/v1/capabilities/match" | "/api/v1/capabilities/compatibility/evaluate" | "/api/v1/agents" | "/api/v1/agents/detail" | "/api/v1/agents/capabilities" | "/api/v1/agents/capabilities" | "/api/v1/agents/certificates" | "/api/v1/agents/tasks" | "/api/v1/agents/tasks" | "/api/v1/agents/tasks/log-cursor" | "/api/v1/agents/upgrades/suggestion" | "/api/v1/agents/:agentId/rescan" | "/api/v1/agents/enrollment-tokens" | "/api/v1/agents/install-sessions/windows-powershell" | "/api/v1/agents/install-sessions/linux-go" | "/api/v1/agents/gateway-enable-sessions" | "/agent-install.ps1" | "/agent-install" | "/agent-enable-gateway.ps1" | "/agent-enable-gateway" | "/api/v1/agents/install/windows/bootstrap.ps1" | "/api/v1/agents/install/windows/manifest" | "/api/v1/agents/disable" | "/api/v1/agents/register" | "/api/v1/agents/sessions" | "/api/v1/agents/certificate-requests" | "/api/v1/agents/certificates/sign" | "/api/v1/agents/certificates/rotate" | "/api/v1/agents/certificates/revoke" | "/api/v1/agents/heartbeat" | "/api/v1/agents/tasks/pull" | "/api/v1/agents/tasks/ack" | "/api/v1/agents/tasks/logs" | "/api/v1/agents/tasks/logs" | "/api/v1/agents/tasks/log-batches" | "/api/v1/agents/tasks/result" | "/api/v1/agents/versions" | "/api/v1/agents/upgrades/check" | "/api/v1/agents/upgrades/result" | "/api/v1/gateways" | "/api/v1/gateways/detail" | "/api/v1/gateways/target-history" | "/api/v1/gateways/route" | "/api/v1/gateways/probe" | "/api/v1/gateways/status" | "/api/v1/providers" | "/api/v1/providers/discovery-runs" | "/api/v1/provider-discovery-results" | "/api/v1/provider-discovery-result" | "/api/v1/compatibility/catalog" | "/api/v1/plugins/packages" | "/api/v1/plugins/packages" | "/api/v1/plugins/permissions/approve" | "/api/v1/plugins/enable" | "/api/v1/plugins/disable" | "/api/v1/plugins/execute" | "/api/v1/plugins/executions" | "/api/v1/plugins/step-draft" | "/api/v1/plugins/permission-summary" | "/api/v1/plugins/capabilities" | "/api/v1/plugin-catalog" | "/api/v1/plugin-versions" | "/api/v1/plugin-packages/import" | "/api/v1/plugin-versions/approve-permissions" | "/api/v1/plugin-versions/enable" | "/api/v1/plugin-versions/disable" | "/api/v1/plugin-versions/retire" | "/api/v1/plugin-versions/upgrade-diff" | "/api/v1/plugin-bindings" | "/api/v1/plugin-bindings" | "/api/v1/plugin-bindings" | "/api/v1/capability-assignments" | "/api/v1/capability-assignments/resolve" | "/api/v1/plugin-promotions/preview" | "/api/v1/plugin-promotions/confirm" | "/api/v1/plugin-promotions/revoke" | "/api/v1/plugin-promotions" | "/api/v1/plugin-runtime/metrics" | "/api/v1/managed-targets/:managedTargetId/deployment-capabilities/:capabilityKey" | "/api/v1/managed-targets/:managedTargetId/compatible-plugins" | "/api/v1/application-assets/:applicationAssetId/managed-target" | "/api/v1/workflows" | "/api/v1/workflow-sources/plugins" | "/api/v1/workflow-execution-bindings/:bindingId" | "/api/v1/workflows/from-plugin" | "/api/v1/workflows/:workflowId/drafts/from-plugin" | "/api/v1/workflow-templates" | "/api/v1/workflow-templates/rename" | "/api/v1/workflow-templates/canvas/compile" | "/api/v1/workflow-templates/canvas/validate" | "/api/v1/workflow-templates/delete" | "/api/v1/workflow-template-versions" | "/api/v1/workflow-template-versions" | "/api/v1/workflow-template-versions/draft" | "/api/v1/workflow-template-versions/note" | "/api/v1/workflow-template-versions/publish" | "/api/v1/workflow-template-runs/preview" | "/api/v1/workflow-template-runs/test" | "/api/v1/workflow-template-runs/test-step" | "/api/v1/automations" | "/api/v1/automations" | "/api/v1/automations/:id" | "/api/v1/automations/:id" | "/api/v1/automations/:id" | "/api/v1/automations/:id/actions/copy" | "/api/v1/automations/:id/actions/enable" | "/api/v1/automations/:id/actions/disable" | "/api/v1/automations/:id/preview" | "/api/v1/automations/:id/runs" | "/api/v1/automation-runs" | "/api/v1/automation-runs/:id" | "/api/v1/automation-runs/:id/targets" | "/api/v1/automation-runs/:id/actions/stop" | "/api/v1/automation-runs/:id/actions/retry-failed" | "/api/v1/dashboard/overview" | "/api/v1/monitors/targets" | "/api/v1/monitors/targets" | "/api/v1/monitors/targets" | "/api/v1/monitors/targets/delete" | "/api/v1/monitors/scan" | "/api/v1/monitors/probe" | "/api/v1/monitors/risks" | "/api/v1/monitors/risks/:id/acknowledge" | "/api/v1/monitors/risks/:id/suppress" | "/api/v1/monitors/risks/:id/ignore" | "/api/v1/monitors/risks/:id/resolve" | "/api/v1/monitors/risks/:id/reopen" | "/api/v1/monitors/risks/:id/history" | "/api/v1/monitors/probe-results" | "/api/v1/monitors/certificate-observations" | "/api/v1/monitors/dashboard" | "/api/v1/monitors/alert-rules" | "/api/v1/monitors/alert-rules" | "/api/v1/notification-channels" | "/api/v1/notification-channels" | "/api/v1/notification-routes" | "/api/v1/notification-templates" | "/api/v1/notification-silences" | "/api/v1/notification-requests" | "/api/v1/notification-deliveries" | "/api/v1/reports/incident-window/overview" | "/api/v1/reports/incident-window/trends" | "/api/v1/reports/incident-window/items" | "/api/v1/reports/risk-response/overview" | "/api/v1/reports/risk-response/trends" | "/api/v1/reports/risk-response/items" | "/api/v1/reports/automation-effectiveness/overview" | "/api/v1/reports/automation-effectiveness/trends" | "/api/v1/reports/automation-effectiveness/items" | "/api/v1/report-runs" | "/api/v1/report-runs" | "/api/v1/report-runs/:id" | "/api/v1/report-runs/:id/download" | "/api/v1/openapi.json"

export type ApiOperationId = "getHealth" | "login" | "externalLogin" | "listPublicIdentitySources" | "logout" | "getCurrentUser" | "getCurrentPermissions" | "getPermissionContext" | "changeCurrentUserPassword" | "getCurrentUserPreferences" | "updateCurrentUserPreferences" | "listSecrets" | "createSecret" | "getSecretMetadata" | "createApproval" | "decideApproval" | "queryAuditEvents" | "listSecurityUsers" | "createSecurityUser" | "updateSecurityUser" | "listSecurityGroups" | "createSecurityGroup" | "lookupExternalSecurityGroup" | "createExternalSecurityGroup" | "lookupExternalSecurityUser" | "createExternalSecurityUser" | "updateSecurityUserStatus" | "assignSecurityUserRole" | "deleteSecurityUser" | "listSecurityRoles" | "createSecurityRole" | "deleteSecurityRole" | "listSecurityPermissionPolicies" | "createSecurityPermissionPolicy" | "listSecurityObjectTypes" | "listSecurityObjectSets" | "createSecurityObjectSet" | "addSecurityObjectSetMember" | "listSecurityRoleBindings" | "createSecurityRoleBinding" | "listSecurityAccessGrants" | "createSecurityAccessGrant" | "getSecurityObjectCapabilities" | "listIdentitySources" | "createIdentitySource" | "updateIdentitySource" | "deleteIdentitySource" | "testIdentitySource" | "syncIdentitySourceUsers" | "listGroupRoleMappings" | "createGroupRoleMapping" | "listDeploymentPlans" | "createDeploymentPlan" | "createDeploymentPlanFromApplicationAsset" | "updateDeploymentPlanFromApplicationAsset" | "submitDeploymentPlan" | "dryRunDeploymentPlan" | "executeDeploymentPlan" | "cancelDeploymentPlan" | "deleteDraftDeploymentPlan" | "reevaluateDeploymentPlanCapabilities" | "listExecutionRuns" | "listExecutionSteps" | "streamExecutionRunDetail" | "getExecutionWorkflowRecovery" | "retryExecutionRun" | "rollbackExecutionRun" | "listHosts" | "createHost" | "updateHost" | "deleteHost" | "listFrameworkInstances" | "createFrameworkInstance" | "updateFrameworkInstance" | "deleteFrameworkInstance" | "listServiceAssets" | "createServiceAsset" | "updateServiceAsset" | "getServiceAssetDetail" | "updateServiceAssetDeploymentStrategyById" | "updateServiceAssetDeploymentStrategy" | "projectWorkflowBinding" | "saveStandaloneWorkflowExecution" | "deleteServiceAsset" | "listApplicationAssetTargets" | "createApplicationAssetTarget" | "updateApplicationAssetTarget" | "deleteApplicationAssetTarget" | "listSiteAssets" | "createSiteAsset" | "updateSiteAsset" | "deleteSiteAsset" | "listServiceEndpoints" | "createServiceEndpoint" | "updateServiceEndpoint" | "deleteServiceEndpoint" | "listManagedTargets" | "createManagedTarget" | "updateManagedTarget" | "listManagedTargetSnapshots" | "deleteManagedTarget" | "listDiscoverySnapshots" | "upsertDiscoverySnapshot" | "ingestDiscovery" | "previewDiscoveryMerge" | "refreshAssetsFromAgent" | "listAssetConflicts" | "resolveAssetConflict" | "listDeviceAssets" | "createDeviceAsset" | "updateDeviceAsset" | "getDeviceAsset" | "deleteDeviceAsset" | "listManagedDevices" | "executeManagedDeviceCapability" | "onboardManagedDevice" | "listDeviceOnboardingPlatforms" | "getManagedDevice" | "listCertificateBindings" | "createCertificateBinding" | "updateCertificateBinding" | "findCertificateBindingUsages" | "deleteCertificateBinding" | "detectCertificateBindingDrift" | "persistCertificateBindingDrift" | "patchCertificateBindingStatus" | "getCertificateFormatCapabilities" | "listCertificateAssets" | "createCertificateAsset" | "getCertificateAssetDetail" | "getCertificateAssetDetailById" | "getCertificateAssetUsageById" | "archiveCertificateAsset" | "deleteCertificateAsset" | "listCertificateVersions" | "getCertificateVersionDetail" | "getCertificateVersionUsage" | "listCertificateVersionFormatsByVersionId" | "importCertificateVersion" | "archiveCertificateVersion" | "revokeCertificateVersion" | "deleteCertificateVersion" | "validateImportCertificateVersion" | "listCertificateVersionFormats" | "createCertificateVersionFormat" | "updateCertificateVersionFormat" | "planCertificateVersionFormatExport" | "exportCertificateVersionFormatArtifact" | "deleteCertificateVersionFormat" | "mockSyncCertificateSource" | "listCaProviders" | "createCaProvider" | "deleteCaProvider" | "testCaProvider" | "listCertificateAuthorities" | "createCertificateAuthority" | "previewCertificateAuthority" | "listCertificateProfiles" | "createCertificateProfile" | "createCertificateProfileVersion" | "listCertificateRequests" | "createCertificateRequest" | "approveCertificateRequest" | "retryCertificateRequest" | "queryCertificateRequestIssuance" | "activateCertificateRequest" | "listCertificateRenewals" | "scanCertificateRenewals" | "listCertificateRevocations" | "createCertificateRevocation" | "approveCertificateRevocation" | "listCaTrustDistributions" | "createCaTrustDistribution" | "approveCaTrustDistribution" | "completeCaTrustDistribution" | "getCertificateReuseRiskOverview" | "listCertificateReuseRisks" | "exportCertificateReuseRisks" | "previewCertificateReuseRemediation" | "listCaNodes" | "createCaNodeEnrollmentToken" | "registerCaNode" | "heartbeatCaNode" | "leaseCaNodeTask" | "streamCaNodeTasks" | "completeCaNodeTask" | "createAdcsAgentInstallSession" | "createAdcsAgentUpdateSession" | "createAdcsViewInspectionTask" | "getAdcsViewInspectionTask" | "getAdcsAgentInstallScript" | "getAdcsAgentBinary" | "listCapabilityDefinitions" | "listCapabilityDeclarations" | "createCapabilityDeclaration" | "createManualCapabilityDeclaration" | "listCapabilityRequirements" | "createCapabilityRequirement" | "matchCapabilityRequirement" | "evaluateCapabilityCompatibility" | "listAgents" | "getAgentDetail" | "getAgentCapabilities" | "reportAgentCapabilities" | "listAgentCertificates" | "listAgentTaskQueue" | "enqueueAgentTask" | "getAgentTaskLogCursor" | "getAgentUpgradeSuggestion" | "enqueueAgentCapabilityRescanTask" | "createAgentEnrollmentToken" | "createWindowsPowerShellAgentInstallSession" | "createLinuxGoAgentInstallSession" | "createAgentGatewayEnableSession" | "getWindowsPowerShellAgentShortInstall" | "getLinuxGoAgentShortInstall" | "getWindowsAgentGatewayEnableScript" | "getLinuxAgentGatewayEnableScript" | "getWindowsPowerShellAgentBootstrap" | "getWindowsPowerShellAgentInstallManifest" | "disableAgent" | "registerAgent" | "createAgentMtlsSession" | "createAgentCertificateSigningRequest" | "signAgentCertificate" | "rotateAgentCertificate" | "revokeAgentCertificate" | "heartbeatAgent" | "pullAgentTasks" | "ackAgentTask" | "submitAgentTaskLog" | "listAgentTaskLogs" | "submitAgentTaskLogBatch" | "submitAgentTaskResult" | "publishAgentVersion" | "checkAgentUpgrade" | "submitAgentUpgradeResult" | "listGateways" | "getGatewayDetail" | "listGatewayTargetHistory" | "routeGateway" | "probeGatewayReachability" | "updateGatewayStatus" | "listProviders" | "runProviderDiscovery" | "listProviderDiscoveryResults" | "getProviderDiscoveryResult" | "listCompatibilityCatalog" | "listPluginPackages" | "uploadPluginPackage" | "approvePluginPermissions" | "enablePlugin" | "disablePlugin" | "executePluginMockRuntime" | "listPluginExecutions" | "createPluginStepDraft" | "createPluginPermissionSummary" | "publishPluginCapabilities" | "listPluginCatalog" | "listUnifiedPluginVersions" | "importUnifiedPluginVersion" | "approveUnifiedPluginPermissions" | "enableUnifiedPluginVersion" | "disableUnifiedPluginVersion" | "retireUnifiedPluginVersion" | "getUnifiedPluginUpgradeDiff" | "createPluginBinding" | "getPluginBinding" | "updatePluginBinding" | "assignPluginCapability" | "resolvePluginCapability" | "previewPluginPromotion" | "confirmPluginPromotion" | "revokePluginPromotion" | "getPluginPromotion" | "listPluginRuntimeMetrics" | "getManagedTargetEffectiveCapability" | "listManagedTargetCompatiblePlugins" | "saveApplicationAssetManagedTarget" | "listWorkflows" | "listPluginWorkflowSources" | "getWorkflowExecutionBinding" | "createWorkflowFromPlugin" | "createWorkflowDraftFromPlugin" | "listWorkflowTemplates" | "renameWorkflowTemplate" | "compileWorkflowCanvas" | "validateWorkflowCanvas" | "deleteWorkflowTemplate" | "listWorkflowTemplateVersions" | "createWorkflowTemplateVersion" | "updateCurrentWorkflowTemplateDraftVersion" | "updateWorkflowTemplateVersionNote" | "publishWorkflowTemplateVersion" | "previewWorkflowTemplateRun" | "testWorkflowTemplateRun" | "testWorkflowTemplateStep" | "listAutomations" | "createAutomation" | "getAutomation" | "updateAutomation" | "deleteAutomation" | "copyAutomation" | "enableAutomation" | "disableAutomation" | "previewAutomation" | "createAutomationRun" | "listAutomationRuns" | "getAutomationRun" | "listAutomationRunTargets" | "stopAutomationRun" | "retryAutomationRun" | "getDashboardOverview" | "listMonitorTargets" | "createMonitorTarget" | "updateMonitorTarget" | "deleteMonitorTarget" | "scanMonitorRisks" | "probeMonitorServiceAsset" | "listMonitorRisks" | "acknowledgeMonitorRisk" | "suppressMonitorRisk" | "ignoreMonitorRisk" | "resolveMonitorRisk" | "reopenMonitorRisk" | "listMonitorRiskStatusHistory" | "listMonitorProbeResults" | "listMonitorCertificateObservations" | "getMonitorDashboard" | "createMonitorAlertRule" | "listMonitorAlertRules" | "listNotificationChannels" | "createNotificationChannel" | "listNotificationRoutes" | "listNotificationTemplates" | "listNotificationSilences" | "listNotificationRequests" | "listNotificationDeliveries" | "getIncidentWindowOverview" | "getIncidentWindowTrends" | "getIncidentWindowItems" | "getRiskResponseOverview" | "getRiskResponseTrends" | "getRiskResponseItems" | "getAutomationEffectivenessOverview" | "getAutomationEffectivenessTrends" | "getAutomationEffectivenessItems" | "createReportRun" | "listReportRuns" | "getReportRun" | "downloadReportRun" | "getOpenApiDocument"

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
    "path": "/api/v1/auth/permission-context",
    "method": "GET",
    "operationId": "getPermissionContext"
  },
  {
    "path": "/api/v1/auth/password",
    "method": "PUT",
    "operationId": "changeCurrentUserPassword"
  },
  {
    "path": "/api/v1/auth/preferences",
    "method": "GET",
    "operationId": "getCurrentUserPreferences"
  },
  {
    "path": "/api/v1/auth/preferences",
    "method": "PUT",
    "operationId": "updateCurrentUserPreferences"
  },
  {
    "path": "/api/v1/secrets",
    "method": "GET",
    "operationId": "listSecrets"
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
    "path": "/api/v1/security/groups",
    "method": "GET",
    "operationId": "listSecurityGroups"
  },
  {
    "path": "/api/v1/security/groups",
    "method": "POST",
    "operationId": "createSecurityGroup"
  },
  {
    "path": "/api/v1/security/groups/lookup-external",
    "method": "POST",
    "operationId": "lookupExternalSecurityGroup"
  },
  {
    "path": "/api/v1/security/groups/external",
    "method": "POST",
    "operationId": "createExternalSecurityGroup"
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
    "path": "/api/v1/security/roles/delete",
    "method": "DELETE",
    "operationId": "deleteSecurityRole"
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
    "path": "/api/v1/security/object-types",
    "method": "GET",
    "operationId": "listSecurityObjectTypes"
  },
  {
    "path": "/api/v1/security/object-sets",
    "method": "GET",
    "operationId": "listSecurityObjectSets"
  },
  {
    "path": "/api/v1/security/object-sets",
    "method": "POST",
    "operationId": "createSecurityObjectSet"
  },
  {
    "path": "/api/v1/security/object-set-members",
    "method": "POST",
    "operationId": "addSecurityObjectSetMember"
  },
  {
    "path": "/api/v1/security/role-bindings",
    "method": "GET",
    "operationId": "listSecurityRoleBindings"
  },
  {
    "path": "/api/v1/security/role-bindings",
    "method": "POST",
    "operationId": "createSecurityRoleBinding"
  },
  {
    "path": "/api/v1/security/access-grants",
    "method": "GET",
    "operationId": "listSecurityAccessGrants"
  },
  {
    "path": "/api/v1/security/access-grants",
    "method": "POST",
    "operationId": "createSecurityAccessGrant"
  },
  {
    "path": "/api/v1/security/object-capabilities",
    "method": "POST",
    "operationId": "getSecurityObjectCapabilities"
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
    "path": "/api/v1/execution-workflow-recovery",
    "method": "GET",
    "operationId": "getExecutionWorkflowRecovery"
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
    "path": "/api/v1/framework-instances",
    "method": "GET",
    "operationId": "listFrameworkInstances"
  },
  {
    "path": "/api/v1/framework-instances",
    "method": "POST",
    "operationId": "createFrameworkInstance"
  },
  {
    "path": "/api/v1/framework-instances",
    "method": "PATCH",
    "operationId": "updateFrameworkInstance"
  },
  {
    "path": "/api/v1/framework-instances/delete",
    "method": "POST",
    "operationId": "deleteFrameworkInstance"
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
    "path": "/api/v1/service-assets/workflow-binding-projection",
    "method": "POST",
    "operationId": "projectWorkflowBinding"
  },
  {
    "path": "/api/v1/application-assets/:applicationAssetId/standalone-workflow",
    "method": "PUT",
    "operationId": "saveStandaloneWorkflowExecution"
  },
  {
    "path": "/api/v1/service-assets/delete",
    "method": "POST",
    "operationId": "deleteServiceAsset"
  },
  {
    "path": "/api/v1/application-asset-targets",
    "method": "GET",
    "operationId": "listApplicationAssetTargets"
  },
  {
    "path": "/api/v1/application-asset-targets",
    "method": "POST",
    "operationId": "createApplicationAssetTarget"
  },
  {
    "path": "/api/v1/application-asset-targets",
    "method": "PATCH",
    "operationId": "updateApplicationAssetTarget"
  },
  {
    "path": "/api/v1/application-asset-targets/delete",
    "method": "POST",
    "operationId": "deleteApplicationAssetTarget"
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
    "path": "/api/v1/device-assets",
    "method": "GET",
    "operationId": "listDeviceAssets"
  },
  {
    "path": "/api/v1/device-assets",
    "method": "POST",
    "operationId": "createDeviceAsset"
  },
  {
    "path": "/api/v1/device-assets",
    "method": "PATCH",
    "operationId": "updateDeviceAsset"
  },
  {
    "path": "/api/v1/device-assets/detail",
    "method": "GET",
    "operationId": "getDeviceAsset"
  },
  {
    "path": "/api/v1/device-assets/delete",
    "method": "POST",
    "operationId": "deleteDeviceAsset"
  },
  {
    "path": "/api/v1/devices",
    "method": "GET",
    "operationId": "listManagedDevices"
  },
  {
    "path": "/api/v1/devices/:deviceId/actions",
    "method": "POST",
    "operationId": "executeManagedDeviceCapability"
  },
  {
    "path": "/api/v1/devices/onboarding",
    "method": "POST",
    "operationId": "onboardManagedDevice"
  },
  {
    "path": "/api/v1/devices/onboarding-platforms",
    "method": "GET",
    "operationId": "listDeviceOnboardingPlatforms"
  },
  {
    "path": "/api/v1/devices/:deviceId",
    "method": "GET",
    "operationId": "getManagedDevice"
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
    "path": "/api/v1/certificate-version-formats/export-plan",
    "method": "POST",
    "operationId": "planCertificateVersionFormatExport"
  },
  {
    "path": "/api/v1/certificate-version-formats/export",
    "method": "POST",
    "operationId": "exportCertificateVersionFormatArtifact"
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
    "path": "/api/v1/ca-providers",
    "method": "GET",
    "operationId": "listCaProviders"
  },
  {
    "path": "/api/v1/ca-providers",
    "method": "POST",
    "operationId": "createCaProvider"
  },
  {
    "path": "/api/v1/ca-providers/:id",
    "method": "DELETE",
    "operationId": "deleteCaProvider"
  },
  {
    "path": "/api/v1/ca-providers/:id/test",
    "method": "POST",
    "operationId": "testCaProvider"
  },
  {
    "path": "/api/v1/certificate-authorities",
    "method": "GET",
    "operationId": "listCertificateAuthorities"
  },
  {
    "path": "/api/v1/certificate-authorities",
    "method": "POST",
    "operationId": "createCertificateAuthority"
  },
  {
    "path": "/api/v1/certificate-authorities/preview",
    "method": "POST",
    "operationId": "previewCertificateAuthority"
  },
  {
    "path": "/api/v1/certificate-profiles",
    "method": "GET",
    "operationId": "listCertificateProfiles"
  },
  {
    "path": "/api/v1/certificate-profiles",
    "method": "POST",
    "operationId": "createCertificateProfile"
  },
  {
    "path": "/api/v1/certificate-profiles/:id/versions",
    "method": "POST",
    "operationId": "createCertificateProfileVersion"
  },
  {
    "path": "/api/v1/certificate-requests",
    "method": "GET",
    "operationId": "listCertificateRequests"
  },
  {
    "path": "/api/v1/certificate-requests",
    "method": "POST",
    "operationId": "createCertificateRequest"
  },
  {
    "path": "/api/v1/certificate-requests/:id/approve",
    "method": "POST",
    "operationId": "approveCertificateRequest"
  },
  {
    "path": "/api/v1/certificate-requests/:id/retry",
    "method": "POST",
    "operationId": "retryCertificateRequest"
  },
  {
    "path": "/api/v1/certificate-requests/:id/query",
    "method": "POST",
    "operationId": "queryCertificateRequestIssuance"
  },
  {
    "path": "/api/v1/certificate-requests/:id/activate",
    "method": "POST",
    "operationId": "activateCertificateRequest"
  },
  {
    "path": "/api/v1/certificate-renewals",
    "method": "GET",
    "operationId": "listCertificateRenewals"
  },
  {
    "path": "/api/v1/certificate-renewals/scan",
    "method": "POST",
    "operationId": "scanCertificateRenewals"
  },
  {
    "path": "/api/v1/certificate-revocations",
    "method": "GET",
    "operationId": "listCertificateRevocations"
  },
  {
    "path": "/api/v1/certificate-revocations",
    "method": "POST",
    "operationId": "createCertificateRevocation"
  },
  {
    "path": "/api/v1/certificate-revocations/:id/approve",
    "method": "POST",
    "operationId": "approveCertificateRevocation"
  },
  {
    "path": "/api/v1/ca-trust-distributions",
    "method": "GET",
    "operationId": "listCaTrustDistributions"
  },
  {
    "path": "/api/v1/ca-trust-distributions",
    "method": "POST",
    "operationId": "createCaTrustDistribution"
  },
  {
    "path": "/api/v1/ca-trust-distributions/:id/approve",
    "method": "POST",
    "operationId": "approveCaTrustDistribution"
  },
  {
    "path": "/api/v1/ca-trust-distributions/:id/complete",
    "method": "POST",
    "operationId": "completeCaTrustDistribution"
  },
  {
    "path": "/api/v1/reports/certificate-reuse/overview",
    "method": "GET",
    "operationId": "getCertificateReuseRiskOverview"
  },
  {
    "path": "/api/v1/reports/certificate-reuse/items",
    "method": "GET",
    "operationId": "listCertificateReuseRisks"
  },
  {
    "path": "/api/v1/reports/certificate-reuse/export",
    "method": "GET",
    "operationId": "exportCertificateReuseRisks"
  },
  {
    "path": "/api/v1/reports/certificate-reuse/:id/remediation-preview",
    "method": "POST",
    "operationId": "previewCertificateReuseRemediation"
  },
  {
    "path": "/api/v1/ca-nodes",
    "method": "GET",
    "operationId": "listCaNodes"
  },
  {
    "path": "/api/v1/ca-nodes/enrollment-tokens",
    "method": "POST",
    "operationId": "createCaNodeEnrollmentToken"
  },
  {
    "path": "/api/v1/ca-nodes/register",
    "method": "POST",
    "operationId": "registerCaNode"
  },
  {
    "path": "/api/v1/ca-nodes/heartbeat",
    "method": "POST",
    "operationId": "heartbeatCaNode"
  },
  {
    "path": "/api/v1/ca-nodes/tasks/lease",
    "method": "POST",
    "operationId": "leaseCaNodeTask"
  },
  {
    "path": "/api/v1/ca-nodes/tasks/stream",
    "method": "GET",
    "operationId": "streamCaNodeTasks"
  },
  {
    "path": "/api/v1/ca-nodes/tasks/:id/result",
    "method": "POST",
    "operationId": "completeCaNodeTask"
  },
  {
    "path": "/api/v1/adcs-agents/install-sessions",
    "method": "POST",
    "operationId": "createAdcsAgentInstallSession"
  },
  {
    "path": "/api/v1/adcs-agents/providers/:id/update-sessions",
    "method": "POST",
    "operationId": "createAdcsAgentUpdateSession"
  },
  {
    "path": "/api/v1/adcs-agents/providers/:id/inspection-tasks",
    "method": "POST",
    "operationId": "createAdcsViewInspectionTask"
  },
  {
    "path": "/api/v1/adcs-agents/inspection-tasks/:id",
    "method": "GET",
    "operationId": "getAdcsViewInspectionTask"
  },
  {
    "path": "/api/v1/adcs-agents/install.ps1",
    "method": "GET",
    "operationId": "getAdcsAgentInstallScript"
  },
  {
    "path": "/api/v1/adcs-agents/binary",
    "method": "GET",
    "operationId": "getAdcsAgentBinary"
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
    "path": "/api/v1/agents/install-sessions/linux-go",
    "method": "POST",
    "operationId": "createLinuxGoAgentInstallSession"
  },
  {
    "path": "/api/v1/agents/gateway-enable-sessions",
    "method": "POST",
    "operationId": "createAgentGatewayEnableSession"
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
    "path": "/agent-enable-gateway.ps1",
    "method": "GET",
    "operationId": "getWindowsAgentGatewayEnableScript"
  },
  {
    "path": "/agent-enable-gateway",
    "method": "GET",
    "operationId": "getLinuxAgentGatewayEnableScript"
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
    "path": "/api/v1/compatibility/catalog",
    "method": "GET",
    "operationId": "listCompatibilityCatalog"
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
    "path": "/api/v1/plugin-catalog",
    "method": "GET",
    "operationId": "listPluginCatalog"
  },
  {
    "path": "/api/v1/plugin-versions",
    "method": "GET",
    "operationId": "listUnifiedPluginVersions"
  },
  {
    "path": "/api/v1/plugin-packages/import",
    "method": "POST",
    "operationId": "importUnifiedPluginVersion"
  },
  {
    "path": "/api/v1/plugin-versions/approve-permissions",
    "method": "POST",
    "operationId": "approveUnifiedPluginPermissions"
  },
  {
    "path": "/api/v1/plugin-versions/enable",
    "method": "POST",
    "operationId": "enableUnifiedPluginVersion"
  },
  {
    "path": "/api/v1/plugin-versions/disable",
    "method": "POST",
    "operationId": "disableUnifiedPluginVersion"
  },
  {
    "path": "/api/v1/plugin-versions/retire",
    "method": "POST",
    "operationId": "retireUnifiedPluginVersion"
  },
  {
    "path": "/api/v1/plugin-versions/upgrade-diff",
    "method": "GET",
    "operationId": "getUnifiedPluginUpgradeDiff"
  },
  {
    "path": "/api/v1/plugin-bindings",
    "method": "POST",
    "operationId": "createPluginBinding"
  },
  {
    "path": "/api/v1/plugin-bindings",
    "method": "GET",
    "operationId": "getPluginBinding"
  },
  {
    "path": "/api/v1/plugin-bindings",
    "method": "PATCH",
    "operationId": "updatePluginBinding"
  },
  {
    "path": "/api/v1/capability-assignments",
    "method": "POST",
    "operationId": "assignPluginCapability"
  },
  {
    "path": "/api/v1/capability-assignments/resolve",
    "method": "POST",
    "operationId": "resolvePluginCapability"
  },
  {
    "path": "/api/v1/plugin-promotions/preview",
    "method": "POST",
    "operationId": "previewPluginPromotion"
  },
  {
    "path": "/api/v1/plugin-promotions/confirm",
    "method": "POST",
    "operationId": "confirmPluginPromotion"
  },
  {
    "path": "/api/v1/plugin-promotions/revoke",
    "method": "POST",
    "operationId": "revokePluginPromotion"
  },
  {
    "path": "/api/v1/plugin-promotions",
    "method": "GET",
    "operationId": "getPluginPromotion"
  },
  {
    "path": "/api/v1/plugin-runtime/metrics",
    "method": "GET",
    "operationId": "listPluginRuntimeMetrics"
  },
  {
    "path": "/api/v1/managed-targets/:managedTargetId/deployment-capabilities/:capabilityKey",
    "method": "GET",
    "operationId": "getManagedTargetEffectiveCapability"
  },
  {
    "path": "/api/v1/managed-targets/:managedTargetId/compatible-plugins",
    "method": "GET",
    "operationId": "listManagedTargetCompatiblePlugins"
  },
  {
    "path": "/api/v1/application-assets/:applicationAssetId/managed-target",
    "method": "PUT",
    "operationId": "saveApplicationAssetManagedTarget"
  },
  {
    "path": "/api/v1/workflows",
    "method": "GET",
    "operationId": "listWorkflows"
  },
  {
    "path": "/api/v1/workflow-sources/plugins",
    "method": "GET",
    "operationId": "listPluginWorkflowSources"
  },
  {
    "path": "/api/v1/workflow-execution-bindings/:bindingId",
    "method": "GET",
    "operationId": "getWorkflowExecutionBinding"
  },
  {
    "path": "/api/v1/workflows/from-plugin",
    "method": "POST",
    "operationId": "createWorkflowFromPlugin"
  },
  {
    "path": "/api/v1/workflows/:workflowId/drafts/from-plugin",
    "method": "POST",
    "operationId": "createWorkflowDraftFromPlugin"
  },
  {
    "path": "/api/v1/workflow-templates",
    "method": "GET",
    "operationId": "listWorkflowTemplates"
  },
  {
    "path": "/api/v1/workflow-templates/rename",
    "method": "POST",
    "operationId": "renameWorkflowTemplate"
  },
  {
    "path": "/api/v1/workflow-templates/canvas/compile",
    "method": "POST",
    "operationId": "compileWorkflowCanvas"
  },
  {
    "path": "/api/v1/workflow-templates/canvas/validate",
    "method": "POST",
    "operationId": "validateWorkflowCanvas"
  },
  {
    "path": "/api/v1/workflow-templates/delete",
    "method": "POST",
    "operationId": "deleteWorkflowTemplate"
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
    "path": "/api/v1/workflow-template-versions/draft",
    "method": "POST",
    "operationId": "updateCurrentWorkflowTemplateDraftVersion"
  },
  {
    "path": "/api/v1/workflow-template-versions/note",
    "method": "POST",
    "operationId": "updateWorkflowTemplateVersionNote"
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
    "path": "/api/v1/automations",
    "method": "GET",
    "operationId": "listAutomations"
  },
  {
    "path": "/api/v1/automations",
    "method": "POST",
    "operationId": "createAutomation"
  },
  {
    "path": "/api/v1/automations/:id",
    "method": "GET",
    "operationId": "getAutomation"
  },
  {
    "path": "/api/v1/automations/:id",
    "method": "PATCH",
    "operationId": "updateAutomation"
  },
  {
    "path": "/api/v1/automations/:id",
    "method": "DELETE",
    "operationId": "deleteAutomation"
  },
  {
    "path": "/api/v1/automations/:id/actions/copy",
    "method": "POST",
    "operationId": "copyAutomation"
  },
  {
    "path": "/api/v1/automations/:id/actions/enable",
    "method": "POST",
    "operationId": "enableAutomation"
  },
  {
    "path": "/api/v1/automations/:id/actions/disable",
    "method": "POST",
    "operationId": "disableAutomation"
  },
  {
    "path": "/api/v1/automations/:id/preview",
    "method": "POST",
    "operationId": "previewAutomation"
  },
  {
    "path": "/api/v1/automations/:id/runs",
    "method": "POST",
    "operationId": "createAutomationRun"
  },
  {
    "path": "/api/v1/automation-runs",
    "method": "GET",
    "operationId": "listAutomationRuns"
  },
  {
    "path": "/api/v1/automation-runs/:id",
    "method": "GET",
    "operationId": "getAutomationRun"
  },
  {
    "path": "/api/v1/automation-runs/:id/targets",
    "method": "GET",
    "operationId": "listAutomationRunTargets"
  },
  {
    "path": "/api/v1/automation-runs/:id/actions/stop",
    "method": "POST",
    "operationId": "stopAutomationRun"
  },
  {
    "path": "/api/v1/automation-runs/:id/actions/retry-failed",
    "method": "POST",
    "operationId": "retryAutomationRun"
  },
  {
    "path": "/api/v1/dashboard/overview",
    "method": "GET",
    "operationId": "getDashboardOverview"
  },
  {
    "path": "/api/v1/monitors/targets",
    "method": "GET",
    "operationId": "listMonitorTargets"
  },
  {
    "path": "/api/v1/monitors/targets",
    "method": "POST",
    "operationId": "createMonitorTarget"
  },
  {
    "path": "/api/v1/monitors/targets",
    "method": "PATCH",
    "operationId": "updateMonitorTarget"
  },
  {
    "path": "/api/v1/monitors/targets/delete",
    "method": "POST",
    "operationId": "deleteMonitorTarget"
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
    "path": "/api/v1/monitors/risks/:id/acknowledge",
    "method": "POST",
    "operationId": "acknowledgeMonitorRisk"
  },
  {
    "path": "/api/v1/monitors/risks/:id/suppress",
    "method": "POST",
    "operationId": "suppressMonitorRisk"
  },
  {
    "path": "/api/v1/monitors/risks/:id/ignore",
    "method": "POST",
    "operationId": "ignoreMonitorRisk"
  },
  {
    "path": "/api/v1/monitors/risks/:id/resolve",
    "method": "POST",
    "operationId": "resolveMonitorRisk"
  },
  {
    "path": "/api/v1/monitors/risks/:id/reopen",
    "method": "POST",
    "operationId": "reopenMonitorRisk"
  },
  {
    "path": "/api/v1/monitors/risks/:id/history",
    "method": "GET",
    "operationId": "listMonitorRiskStatusHistory"
  },
  {
    "path": "/api/v1/monitors/probe-results",
    "method": "GET",
    "operationId": "listMonitorProbeResults"
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
    "path": "/api/v1/notification-channels",
    "method": "GET",
    "operationId": "listNotificationChannels"
  },
  {
    "path": "/api/v1/notification-channels",
    "method": "POST",
    "operationId": "createNotificationChannel"
  },
  {
    "path": "/api/v1/notification-routes",
    "method": "GET",
    "operationId": "listNotificationRoutes"
  },
  {
    "path": "/api/v1/notification-templates",
    "method": "GET",
    "operationId": "listNotificationTemplates"
  },
  {
    "path": "/api/v1/notification-silences",
    "method": "GET",
    "operationId": "listNotificationSilences"
  },
  {
    "path": "/api/v1/notification-requests",
    "method": "GET",
    "operationId": "listNotificationRequests"
  },
  {
    "path": "/api/v1/notification-deliveries",
    "method": "GET",
    "operationId": "listNotificationDeliveries"
  },
  {
    "path": "/api/v1/reports/incident-window/overview",
    "method": "GET",
    "operationId": "getIncidentWindowOverview"
  },
  {
    "path": "/api/v1/reports/incident-window/trends",
    "method": "GET",
    "operationId": "getIncidentWindowTrends"
  },
  {
    "path": "/api/v1/reports/incident-window/items",
    "method": "GET",
    "operationId": "getIncidentWindowItems"
  },
  {
    "path": "/api/v1/reports/risk-response/overview",
    "method": "GET",
    "operationId": "getRiskResponseOverview"
  },
  {
    "path": "/api/v1/reports/risk-response/trends",
    "method": "GET",
    "operationId": "getRiskResponseTrends"
  },
  {
    "path": "/api/v1/reports/risk-response/items",
    "method": "GET",
    "operationId": "getRiskResponseItems"
  },
  {
    "path": "/api/v1/reports/automation-effectiveness/overview",
    "method": "GET",
    "operationId": "getAutomationEffectivenessOverview"
  },
  {
    "path": "/api/v1/reports/automation-effectiveness/trends",
    "method": "GET",
    "operationId": "getAutomationEffectivenessTrends"
  },
  {
    "path": "/api/v1/reports/automation-effectiveness/items",
    "method": "GET",
    "operationId": "getAutomationEffectivenessItems"
  },
  {
    "path": "/api/v1/report-runs",
    "method": "POST",
    "operationId": "createReportRun"
  },
  {
    "path": "/api/v1/report-runs",
    "method": "GET",
    "operationId": "listReportRuns"
  },
  {
    "path": "/api/v1/report-runs/:id",
    "method": "GET",
    "operationId": "getReportRun"
  },
  {
    "path": "/api/v1/report-runs/:id/download",
    "method": "GET",
    "operationId": "downloadReportRun"
  },
  {
    "path": "/api/v1/openapi.json",
    "method": "GET",
    "operationId": "getOpenApiDocument"
  }
] as const
