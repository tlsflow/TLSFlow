// 中文说明：此文件由 web/scripts/generate-openapi-types.mjs 从 backend/openapi/openapi.json 生成。
// 不要手写修改；需要变更契约时先更新后端 OpenAPI。

export type ErrorResponse = {
  readonly "errorCode": string
  readonly "message": string
  readonly "details"?: Record<string, unknown>
  readonly "requestId": string
  readonly "traceId"?: string
  readonly "timestamp": string
}

export type HealthResponse = {
  readonly "status": "OK" | "DEGRADED"
  readonly "service": string
  readonly "version": string
  readonly "timestamp": string
  readonly "dependencies"?: Record<string, string>
  readonly "deploymentArchitecture": "small" | "standard"
  readonly "features": {
  readonly "browserRuntime": boolean
}
}

export type PageResponse = {
  readonly "items": ReadonlyArray<Record<string, unknown>>
  readonly "page": number
  readonly "pageSize": number
  readonly "total": number
}

export type PluginCatalogItem = {
  readonly "id": string
  readonly "catalogType": string
  readonly "pluginId": string
  readonly "pluginVersionId": string
  readonly "version": string
  readonly "manifestSha256": string
  readonly "packageSha256": string
  readonly "resourceSha256": Record<string, string>
  readonly "name": string
  readonly "displayNameKey": string
  readonly "descriptionKey"?: string
  readonly "displayName"?: string
  readonly "description"?: string
  readonly "logoUrl"?: string
  readonly "logoSquareUrl"?: string
  readonly "tags": ReadonlyArray<string>
  readonly "platforms": ReadonlyArray<string>
  readonly "stepCount": number
  readonly "rollbackCount": number
  readonly "configuration"?: Record<string, unknown>
  readonly "source": string
  readonly "runtime": string
  readonly "scope": string
  readonly "trust": string
  readonly "support": string
  readonly "status": string
  readonly "capabilities": ReadonlyArray<{
  readonly "key": string
  readonly "contractVersion": string
  readonly "actionContractId": string
  readonly "riskLevel": "LOW" | "MEDIUM" | "HIGH"
  readonly "executionLocations": ReadonlyArray<"AGENT" | "CONTROL_PLANE" | "GATEWAY">
  readonly "compatibility"?: Record<string, unknown>
}>
  readonly "compatibility"?: Record<string, unknown>
  readonly "detailRef": {
  readonly "pluginVersionId": string
}
}

export type PluginVersionRecord = {
  readonly "id": string
  readonly "tenantId": string
  readonly "ownerType"?: "SYSTEM" | "TENANT"
  readonly "ownerId"?: string
  readonly "pluginId": string
  readonly "pluginVersionId": string
  readonly "version": string
  readonly "manifestSha256": string
  readonly "packageSha256": string
  readonly "resourceSha256": Record<string, string>
  readonly "source": "BUILTIN" | "USER"
  readonly "runtime": "AGENT_PLAN" | "WORKFLOW_DSL"
  readonly "scope": "MANAGED" | "STANDALONE" | "BOTH"
  readonly "trust": string
  readonly "support": string
  readonly "manifest": {
  readonly "apiVersion": string
  readonly "kind": string
  readonly "pluginId": string
  readonly "version": string
  readonly "displayNameKey": string
  readonly "descriptionKey"?: string
  readonly "logoUrl"?: string
  readonly "logoSquareUrl"?: string
  readonly "defaultLocale"?: string
  readonly "publisher": string
  readonly "runtime": "AGENT_PLAN" | "WORKFLOW_DSL"
  readonly "source": "BUILTIN" | "USER"
  readonly "scope": "MANAGED" | "STANDALONE" | "BOTH"
  readonly "trust": "OFFICIAL_SIGNED" | "USER_SIGNED" | "UNSIGNED"
  readonly "support": "OFFICIAL" | "COMMUNITY" | "SELF_MANAGED"
  readonly "minGcacVersion"?: string
  readonly "capabilities": ReadonlyArray<{
  readonly "key": string
  readonly "contractVersion": string
  readonly "actionContractId": string
  readonly "riskLevel": "LOW" | "MEDIUM" | "HIGH"
  readonly "executionLocations": ReadonlyArray<"AGENT" | "CONTROL_PLANE" | "GATEWAY">
  readonly "compatibility"?: Record<string, unknown>
}>
  readonly "permissions": ReadonlyArray<string>
  readonly "compatibility"?: {
  readonly "productFamilies"?: ReadonlyArray<string>
  readonly "frameworkTypes"?: ReadonlyArray<string>
  readonly "targetTypes"?: ReadonlyArray<string>
  readonly "managementMethods"?: ReadonlyArray<string>
  readonly "executionLocations"?: ReadonlyArray<string>
  readonly "artifactContracts"?: ReadonlyArray<string>
}
  readonly "resources": {
  readonly "logos"?: {
  readonly "horizontal": string
  readonly "square": string
}
  readonly "runtimeEntrypoint"?: string
  readonly "agentPlans"?: Record<string, string>
  readonly "workflows"?: Record<string, string>
  readonly "inputContracts"?: Record<string, string>
  readonly "actionContracts"?: Record<string, string>
  readonly "forms"?: Record<string, string>
  readonly "presentations"?: Record<string, string>
  readonly "locales"?: Record<string, string>
  readonly "discoveryMappings"?: Record<string, string>
  readonly "agentDiscoveryMappings"?: Record<string, string>
  readonly "onboarding"?: Record<string, unknown>
}
}
  readonly "resources": Record<string, string>
  readonly "status": string
  readonly "permissionApprovalStatus": string
  readonly "approvedPermissions": ReadonlyArray<string>
  readonly "validationReport": {
  readonly "valid": boolean
  readonly "errors": ReadonlyArray<Record<string, unknown>>
  readonly "warnings": ReadonlyArray<Record<string, unknown>>
  readonly "manifestSha256": string
  readonly "resourceSha256": Record<string, string>
}
  readonly "createdAt": string
  readonly "updatedAt": string
}

export type PluginRuntimeMetric = {
  readonly "tenantId": string
  readonly "pluginVersionId": string
  readonly "capabilityKey": string
  readonly "started": number
  readonly "succeeded": number
  readonly "failed": number
  readonly "rejected": number
  readonly "inFlight": number
  readonly "circuitState": "CLOSED" | "OPEN"
  readonly "lastDurationMilliseconds"?: number
  readonly "lastError"?: string
}
