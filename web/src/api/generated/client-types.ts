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
    "/api/v1/approvals",
    "/api/v1/approvals/decide",
    "/api/v1/audit-events",
    "/api/v1/health",
    "/api/v1/openapi.json",
    "/api/v1/secrets",
    "/api/v1/secrets/metadata"
  ]
} as const
