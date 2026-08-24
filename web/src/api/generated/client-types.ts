// 中文说明：前端统一 API 响应契约，占位对齐 004 设计文档。
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
