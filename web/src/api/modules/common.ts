import { apiClient, createIdempotencyKey } from '@/api/client'
import type { ApiResult, PageResult } from '@/api/generated/client-types'
import type { PageResponse } from '@/api/generated/schemas'

// 中文说明：业务契约还没有全部进入 OpenAPI generated 文件；页面层只能依赖通用 PageResponse 的 Record 形态，不能猜测具体 DTO。
export type ApiRecord = PageResponse['items'][number]
export type ApiPage = PageResult<ApiRecord>
export type ApiRecordResult = ApiResult<ApiRecord>
export type ApiPageResult = ApiResult<ApiPage>

export interface BusinessListQuery {
  readonly page?: number
  readonly pageSize?: number
  readonly sort?: string
  readonly keyword?: string
  readonly filters?: Readonly<Record<string, string | number | boolean | null | undefined>>
}

export type ApiBody = Readonly<Record<string, unknown>>

export function buildListPath(path: string, query: BusinessListQuery = {}): string {
  const params = new URLSearchParams()
  params.set('page', String(query.page ?? 1))
  params.set('pageSize', String(query.pageSize ?? 20))
  if (query.sort) params.set('sort', query.sort)
  if (query.keyword) params.set('keyword', query.keyword)

  Object.entries(query.filters ?? {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(`filter[${key}]`, String(value))
  })

  const queryString = params.toString()
  return `${toClientPath(path)}${queryString ? `?${queryString}` : ''}`
}

export function toClientPath(path: string): string {
  // 中文说明：apiClient 默认 baseUrl 是 /api，所以模块常量保留 /api/v1 文档路径，发请求前去掉 /api，最终 URL 仍是 /api/v1/*。
  return path.startsWith('/api/') ? path.slice('/api'.length) : path
}

export function listRecords(path: string, query?: BusinessListQuery): Promise<ApiPageResult> {
  return apiClient.get<ApiPage>(buildListPath(path, query))
}

export function postAction(path: string, body: ApiBody = {}, idempotencyPrefix = 'action', options?: { publicBaseUrl?: string }): Promise<ApiRecordResult> {
  return apiClient.post<ApiRecord>(toClientPath(path), body, {
    idempotencyKey: createIdempotencyKey(idempotencyPrefix),
    publicBaseUrl: options?.publicBaseUrl
  })
}
