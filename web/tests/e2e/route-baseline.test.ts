import { describe, expect, it } from 'vitest'
import { businessRoutes } from '@/router/modules/business'
import { coreRoutes } from '@/router/modules/core'

describe('核心路由基线', () => {
  it('包含 004 要求的核心页面入口', () => {
    const paths = [...coreRoutes, ...businessRoutes].map((route) => route.path)
    expect(paths).toEqual(expect.arrayContaining([
      '/dashboard', '/certificates', '/assets', '/bindings', '/deployment-plans', '/executions',
      '/agents', '/gateways', '/plugins', '/workflow-templates', '/monitors', '/audits', '/settings', '/settings/notifications'
    ]))
  })
})
