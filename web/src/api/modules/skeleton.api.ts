import { apiClient } from '@/api/client'
import type { PageResult } from '@/api/generated/client-types'

export interface SkeletonEntity {
  readonly id: string
  readonly name: string
  readonly status: string
}

export function listSkeletonEntities(moduleName: string) {
  // 中文说明：占位 API 只声明调用方式，不猜真实后端字段；页面骨架默认使用 mock 数据。
  return apiClient.get<PageResult<SkeletonEntity>>(`/${moduleName}`)
}
