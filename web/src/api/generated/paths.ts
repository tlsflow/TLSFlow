// 中文说明：此文件由 web/scripts/generate-openapi-types.mjs 从 backend/openapi/openapi.json 生成。
// 不要手写修改；需要变更契约时先更新后端 OpenAPI。


export type ApiPath = "/api/v1/health" | "/api/v1/secrets" | "/api/v1/secrets/metadata" | "/api/v1/approvals" | "/api/v1/approvals/decide" | "/api/v1/audit-events" | "/api/v1/openapi.json"

export type ApiOperationId = "getHealth" | "createSecret" | "getSecretMetadata" | "createApproval" | "decideApproval" | "queryAuditEvents" | "getOpenApiDocument"

export const apiOperations = [
  {
    "path": "/api/v1/health",
    "method": "GET",
    "operationId": "getHealth"
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
    "path": "/api/v1/openapi.json",
    "method": "GET",
    "operationId": "getOpenApiDocument"
  }
] as const
