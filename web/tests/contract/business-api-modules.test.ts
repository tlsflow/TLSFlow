import { afterEach, describe, expect, it, vi } from 'vitest'
import { listCertificates } from '@/api/modules/certificates.api'
import { listAssets } from '@/api/modules/assets.api'
import { listBindings } from '@/api/modules/bindings.api'
import { executeDeploymentPlan, listDeploymentPlans } from '@/api/modules/deployments.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import { listAudits } from '@/api/modules/audits.api'

function mockPage() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: { items: [], page: 1, pageSize: 20, total: 0 },
    requestId: 'req_contract',
    timestamp: '2026-06-08T00:00:00.000Z'
  }), { status: 200 })))
}

describe('业务 API modules', () => {
  afterEach(() => vi.restoreAllMocks())

  it('列表接口使用 apiClient 的 /api/v1 规范路径', async () => {
    mockPage()
    await listCertificates()
    await listAssets()
    await listBindings()
    await listDeploymentPlans()
    await listAudits()

    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual(expect.arrayContaining([
      '/api/v1/certificate-assets?page=1&pageSize=20',
      '/api/v1/hosts?page=1&pageSize=20',
      '/api/v1/certificate-bindings?page=1&pageSize=20',
      '/api/v1/deployment-plans?page=1&pageSize=20',
      '/api/v1/audit-events?page=1&pageSize=20'
    ]))
  })

  it('部署和回滚动作使用集合动作路径并在 body 传 id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'ok' },
      requestId: 'req_action',
      timestamp: '2026-06-08T00:00:00.000Z'
    }), { status: 200 })))

    await executeDeploymentPlan('plan-1', { dryRun: true })
    await rollbackExecution('run-1', { dryRun: true })

    const executeCall = vi.mocked(fetch).mock.calls[0]
    const rollbackCall = vi.mocked(fetch).mock.calls[1]
    expect(executeCall?.[0]).toBe('/api/v1/deployment-plans/execute')
    expect(rollbackCall?.[0]).toBe('/api/v1/execution-runs/rollback')
    expect(JSON.parse(String(executeCall?.[1]?.body))).toMatchObject({ planId: 'plan-1', dryRun: true })
    expect(JSON.parse(String(rollbackCall?.[1]?.body))).toMatchObject({ runId: 'run-1', dryRun: true })
    const headers = executeCall?.[1]?.headers as Headers
    expect(headers.get('X-Idempotency-Key')).toMatch(/^deployment_execute_/)
  })
})
