import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'

describe('部署计划兼容入口', () => {
  it('无定位参数时保留旧路由名并把 query/hash 原样重定向到应用资产', () => {
    const route = businessRoutes.find((item) => item.path === '/deployment-plans')
    expect(route?.name).toBe('deployment.plan.list')
    expect(typeof route?.redirect).toBe('function')

    const redirect = (route?.redirect as (to: { query: Record<string, string>; hash: string }) => unknown)({
      query: { filter: 'legacy' },
      hash: '#deployment',
    })
    expect(redirect).toEqual({ path: '/applications', query: { filter: 'legacy' }, hash: '#deployment' })
  })

  it('旧计划和运行详情链接转到执行记录并保留定位参数', () => {
    const route = businessRoutes.find((item) => item.path === '/deployment-plans')
    const redirect = route?.redirect as (to: { query: Record<string, string>; hash: string }) => unknown
    expect(redirect({ query: { id: 'plan_legacy' }, hash: '' })).toEqual({
      path: '/executions',
      query: { id: 'plan_legacy', planId: 'plan_legacy' },
      hash: '',
    })
    expect(redirect({ query: { runId: 'run_legacy', planId: 'plan_legacy' }, hash: '#run' })).toEqual({
      path: '/executions',
      query: { runId: 'run_legacy', planId: 'plan_legacy' },
      hash: '#run',
    })
  })
})
