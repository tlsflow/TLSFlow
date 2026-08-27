import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'
import { coreRoutes } from '@/router/modules/core'

describe('核心路由基线', () => {
  it('包含 004 要求的核心页面入口', () => {
    const paths = [...coreRoutes, ...businessRoutes].map((route) => route.path)
    expect(paths).toEqual(expect.arrayContaining([
      '/dashboard', '/certificates', '/applications', '/assets', '/providers', '/bindings', '/deployment-plans', '/executions',
      '/agents', '/gateways', '/plugins', '/workflows', '/monitors', '/audits', '/settings',
      '/settings/version', '/settings/notifications',
      '/reports/incident-window', '/reports/risk-response', '/reports/automation-effectiveness'
    ]))
  })

  it('三个报表路由统一要求 report.read 权限', () => {
    const reportRoutes = businessRoutes.filter((route) => route.path.startsWith('/reports/'))

    expect(reportRoutes).toHaveLength(3)
    expect(reportRoutes.every((route) => route.meta?.permission === 'report.read')).toBe(true)
  })

  it('旧 Provider URL 只兼容跳转到统一应用接入向导', () => {
    const providerRoute = businessRoutes.find((route) => route.path === '/providers')
    expect(providerRoute?.redirect).toBeTypeOf('function')
    const redirected = (providerRoute?.redirect as (to: { query: Record<string, unknown>; hash?: string }) => { path: string; query: Record<string, unknown> })({ query: {} })
    expect(redirected).toMatchObject({ path: '/applications', query: { onboarding: '1' } })
  })
})
