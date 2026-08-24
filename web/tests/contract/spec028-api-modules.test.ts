import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeploymentPlan, dryRunDeploymentPlan, executeDeploymentPlan, submitDeploymentPlan } from '@/api/modules/deployments.api'
import { listExecutionSteps, retryExecution } from '@/api/modules/executions.api'
import { listCapabilities } from '@/api/modules/assets.api'
import { listMonitors } from '@/api/modules/monitors.api'

function mockOk(data: unknown = { id: 'ok' }) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data,
    requestId: 'req_spec028',
    timestamp: '2026-06-08T00:00:00.000Z'
  }), { status: 200 })))
}

describe('spec028 API modules', () => {
  afterEach(() => vi.restoreAllMocks())

  it('capability、monitor 和 execution steps 走现有集合路径', async () => {
    mockOk({ items: [], page: 1, pageSize: 20, total: 0 })
    await listCapabilities()
    await listMonitors()
    await listExecutionSteps({ filters: { runId: 'run-1' } })

    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual(expect.arrayContaining([
      '/api/v1/capabilities/definitions?page=1&pageSize=20',
      '/api/v1/monitors/risks?page=1&pageSize=20',
      '/api/v1/execution-steps?page=1&pageSize=20&filter%5BrunId%5D=run-1'
    ]))
  })

  it('部署向导相关动作使用集合 action 路径并在 body 传标识', async () => {
    mockOk({ id: 'plan-1' })

    await createDeploymentPlan({ certificateId: 'cert-1', bindingIds: ['binding-1'] })
    await dryRunDeploymentPlan({ planId: 'plan-1' })
    await submitDeploymentPlan('plan-1', { certificateId: 'cert-1' })
    await executeDeploymentPlan('plan-1', { approvalId: 'approval-1' })
    await retryExecution('run-1', { reason: 'manual' })

    const calls = vi.mocked(fetch).mock.calls
    expect(calls[0]?.[0]).toBe('/api/v1/deployment-plans')
    expect(calls[1]?.[0]).toBe('/api/v1/deployment-plans/dry-run')
    expect(calls[2]?.[0]).toBe('/api/v1/deployment-plans/submit')
    expect(calls[3]?.[0]).toBe('/api/v1/deployment-plans/execute')
    expect(calls[4]?.[0]).toBe('/api/v1/execution-runs/retry')
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toMatchObject({ planId: 'plan-1', certificateId: 'cert-1' })
    expect(JSON.parse(String(calls[4]?.[1]?.body))).toMatchObject({ runId: 'run-1', reason: 'manual' })
  })
})
