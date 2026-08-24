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
  readonly "dependencies"?: Record<string, unknown>
}

export type PageResponse = {
  readonly "items": readonly Record<string, unknown>[]
  readonly "page": number
  readonly "pageSize": number
  readonly "total": number
}
