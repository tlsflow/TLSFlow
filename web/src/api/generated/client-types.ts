// 中文说明：此文件由 web/scripts/generate-openapi-types.mjs 从 backend/openapi/openapi.json 生成。
// 不要手写修改；需要变更契约时先更新后端 OpenAPI。

export interface ApiResult<T> {
  readonly data?: T
  readonly errorCode?: string
  readonly message?: string
  readonly requestId: string
  readonly timestamp: string
}

export interface PageResult<T> {
  readonly items: readonly T[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface ApiContractMetadata {
  readonly title: string
  readonly version: string
  readonly paths: readonly string[]
}

export const apiContractMetadata: ApiContractMetadata = {
  "title": "GCAC 后端 API",
  "version": "v1",
  "paths": [
    "/api/v1/agents",
    "/api/v1/agents/capabilities",
    "/api/v1/agents/detail",
    "/api/v1/agents/disable",
    "/api/v1/agents/enrollment-tokens",
    "/api/v1/agents/heartbeat",
    "/api/v1/agents/register",
    "/api/v1/agents/sessions",
    "/api/v1/agents/tasks",
    "/api/v1/agents/tasks/ack",
    "/api/v1/agents/tasks/logs",
    "/api/v1/agents/tasks/pull",
    "/api/v1/agents/tasks/result",
    "/api/v1/agents/upgrades/check",
    "/api/v1/agents/upgrades/result",
    "/api/v1/agents/upgrades/suggestion",
    "/api/v1/agents/versions",
    "/api/v1/approvals",
    "/api/v1/approvals/decide",
    "/api/v1/asset-conflicts",
    "/api/v1/asset-conflicts/resolve",
    "/api/v1/audit-events",
    "/api/v1/auth/external-login",
    "/api/v1/auth/identity-sources/public",
    "/api/v1/auth/login",
    "/api/v1/auth/logout",
    "/api/v1/auth/me",
    "/api/v1/auth/permissions",
    "/api/v1/capabilities/compatibility/evaluate",
    "/api/v1/capabilities/declarations",
    "/api/v1/capabilities/declarations/manual",
    "/api/v1/capabilities/definitions",
    "/api/v1/capabilities/match",
    "/api/v1/capabilities/requirements",
    "/api/v1/certificate-assets",
    "/api/v1/certificate-assets/archive",
    "/api/v1/certificate-assets/delete",
    "/api/v1/certificate-assets/detail",
    "/api/v1/certificate-bindings",
    "/api/v1/certificate-bindings/delete",
    "/api/v1/certificate-bindings/drift",
    "/api/v1/certificate-bindings/drift-results",
    "/api/v1/certificate-bindings/status",
    "/api/v1/certificate-bindings/usage",
    "/api/v1/certificate-formats/capabilities",
    "/api/v1/certificate-sources/mock-sync",
    "/api/v1/certificate-version-formats",
    "/api/v1/certificate-version-formats/export-plan",
    "/api/v1/certificate-versions",
    "/api/v1/certificate-versions/archive",
    "/api/v1/certificate-versions/delete",
    "/api/v1/certificate-versions/detail",
    "/api/v1/certificate-versions/import",
    "/api/v1/certificate-versions/revoke",
    "/api/v1/certificate-versions/usage",
    "/api/v1/deployment-plans",
    "/api/v1/deployment-plans/cancel",
    "/api/v1/deployment-plans/capabilities/reevaluate",
    "/api/v1/deployment-plans/dry-run",
    "/api/v1/deployment-plans/execute",
    "/api/v1/deployment-plans/submit",
    "/api/v1/discovery-snapshots",
    "/api/v1/discovery-snapshots/ingest",
    "/api/v1/discovery-snapshots/merge-preview",
    "/api/v1/execution-runs",
    "/api/v1/execution-runs/retry",
    "/api/v1/execution-runs/rollback",
    "/api/v1/execution-steps",
    "/api/v1/gateways",
    "/api/v1/gateways/detail",
    "/api/v1/gateways/probe",
    "/api/v1/gateways/route",
    "/api/v1/gateways/status",
    "/api/v1/health",
    "/api/v1/hosts",
    "/api/v1/hosts/delete",
    "/api/v1/monitors/alert-rules",
    "/api/v1/monitors/dashboard",
    "/api/v1/monitors/risks",
    "/api/v1/monitors/scan",
    "/api/v1/openapi.json",
    "/api/v1/plugins/capabilities",
    "/api/v1/plugins/disable",
    "/api/v1/plugins/enable",
    "/api/v1/plugins/execute",
    "/api/v1/plugins/executions",
    "/api/v1/plugins/packages",
    "/api/v1/plugins/permission-summary",
    "/api/v1/plugins/permissions/approve",
    "/api/v1/plugins/step-draft",
    "/api/v1/provider-discovery-result",
    "/api/v1/provider-discovery-results",
    "/api/v1/providers",
    "/api/v1/providers/discovery-runs",
    "/api/v1/secrets",
    "/api/v1/secrets/metadata",
    "/api/v1/security/group-role-mappings",
    "/api/v1/security/identity-sources",
    "/api/v1/security/identity-sources/test",
    "/api/v1/security/permission-policies",
    "/api/v1/security/roles",
    "/api/v1/security/users",
    "/api/v1/security/users/roles",
    "/api/v1/security/users/status",
    "/api/v1/service-endpoints",
    "/api/v1/service-endpoints/delete",
    "/api/v1/service-instances",
    "/api/v1/service-instances/delete",
    "/api/v1/workflow-template-runs/preview",
    "/api/v1/workflow-template-runs/test",
    "/api/v1/workflow-template-versions",
    "/api/v1/workflow-template-versions/publish",
    "/api/v1/workflow-templates"
  ]
} as const
