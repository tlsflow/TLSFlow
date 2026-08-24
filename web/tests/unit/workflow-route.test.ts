import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'

describe('工作流路由', () => {
  it('不再依赖不存在的系统特性开关', () => {
    const workflowRoute = businessRoutes.find((route) => route.path === '/workflows')
    expect(workflowRoute?.meta?.featureFlag).toBeUndefined()
  })
})
