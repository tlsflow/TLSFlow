import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelDeploymentPlan, createDeploymentPlan, dryRunDeploymentPlan, executeDeploymentPlan, submitDeploymentPlan } from '@/api/modules/deployments.api'
import { listExecutionSteps, retryExecution, rollbackExecution } from '@/api/modules/executions.api'
import { evaluateCapabilityCompatibility, listCapabilityDeclarations, listCapabilityRequirements, listCapabilities, matchCapabilityRequirement } from '@/api/modules/assets.api'
import { createMonitorTarget, deleteMonitorTarget, listMonitors, listMonitorTargets, updateMonitorTarget } from '@/api/modules/monitors.api'
import { deleteBinding, listBindingUsages, persistBindingDriftResult } from '@/api/modules/bindings.api'

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
    await listCapabilityDeclarations({ filters: { hostId: 'host-1' } })
    await listCapabilityRequirements({ filters: { operation: 'deploy' } })
    await listBindingUsages({ filters: { certificateVersionId: 'certver-1' } })
    await listMonitors()
    await listMonitorTargets()
    await listExecutionSteps({ filters: { runId: 'run-1' } })

    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual(expect.arrayContaining([
      '/api/v1/capabilities/definitions?page=1&pageSize=20',
      '/api/v1/capabilities/declarations?page=1&pageSize=20&filter%5BhostId%5D=host-1',
      '/api/v1/capabilities/requirements?page=1&pageSize=20&filter%5Boperation%5D=deploy',
      '/api/v1/certificate-bindings/usage?page=1&pageSize=20&filter%5BcertificateVersionId%5D=certver-1',
      '/api/v1/monitors/risks?page=1&pageSize=20',
      '/api/v1/monitors/targets?page=1&pageSize=20',
      '/api/v1/execution-steps?page=1&pageSize=20&filter%5BrunId%5D=run-1'
    ]))
  })

  it('监控目标新增、更新、删除走后端持久化接口', async () => {
    mockOk({ id: 'target-1' })

    await createMonitorTarget({ serviceAssetId: 'asset-1', intervalSeconds: 60 })
    await updateMonitorTarget('target-1', { intervalSeconds: 120 })
    await deleteMonitorTarget('target-1')

    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map((call) => String(call[0]))).toEqual([
      '/api/v1/monitors/targets',
      '/api/v1/monitors/targets',
      '/api/v1/monitors/targets/delete'
    ])
    expect(calls[0]?.[1]?.method).toBe('POST')
    expect(calls[1]?.[1]?.method).toBe('PATCH')
    expect(calls[2]?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({ id: 'target-1', intervalSeconds: 120 })
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toMatchObject({ id: 'target-1' })
  })

  it('部署向导相关动作使用集合 action 路径并在 body 传标识', async () => {
    mockOk({ id: 'plan-1' })

    await createDeploymentPlan({ certificateId: 'cert-1', bindingIds: ['binding-1'] })
    await dryRunDeploymentPlan({ planId: 'plan-1' })
    await submitDeploymentPlan('plan-1', { certificateId: 'cert-1' })
    await executeDeploymentPlan('plan-1', { approvalId: 'approval-1' })
    await cancelDeploymentPlan('plan-1', { reason: 'manual-cancel' })
    await retryExecution('run-1', { planId: 'plan-1', reason: 'manual' })
    await rollbackExecution('run-1', { planId: 'plan-1', reason: 'manual' })

    const calls = vi.mocked(fetch).mock.calls
    expect(calls[0]?.[0]).toBe('/api/v1/deployment-plans')
    expect(calls[1]?.[0]).toBe('/api/v1/deployment-plans/dry-run')
    expect(calls[2]?.[0]).toBe('/api/v1/deployment-plans/submit')
    expect(calls[3]?.[0]).toBe('/api/v1/deployment-plans/execute')
    expect(calls[4]?.[0]).toBe('/api/v1/deployment-plans/cancel')
    expect(calls[5]?.[0]).toBe('/api/v1/execution-runs/retry')
    expect(calls[6]?.[0]).toBe('/api/v1/execution-runs/rollback')
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toMatchObject({ planId: 'plan-1', certificateId: 'cert-1' })
    expect(JSON.parse(String(calls[3]?.[1]?.body))).toMatchObject({ planId: 'plan-1', approvalId: 'approval-1' })
    expect(JSON.parse(String(calls[3]?.[1]?.body))).not.toHaveProperty('dryRun')
    expect(JSON.parse(String(calls[4]?.[1]?.body))).toMatchObject({ planId: 'plan-1', reason: 'manual-cancel' })
    expect(JSON.parse(String(calls[5]?.[1]?.body))).toMatchObject({ runId: 'run-1', planId: 'plan-1', reason: 'manual' })
    expect(JSON.parse(String(calls[6]?.[1]?.body))).toMatchObject({ runId: 'run-1', planId: 'plan-1', reason: 'manual' })
  })

  it('资产能力匹配与绑定验证动作使用集合 action 路径', async () => {
    mockOk({ id: 'ok' })

    await matchCapabilityRequirement({ targetId: 'host-1', requiredCapabilities: ['service.reload'] })
    await evaluateCapabilityCompatibility({ targetId: 'host-1', operation: 'deploy' })
    await persistBindingDriftResult({ bindingId: 'binding-1', remoteFingerprintSha256: 'a'.repeat(64) })
    await deleteBinding('binding-1', { reason: 'manual' })

    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map((call) => String(call[0]))).toEqual([
      '/api/v1/capabilities/match',
      '/api/v1/capabilities/compatibility/evaluate',
      '/api/v1/certificate-bindings/drift-results',
      '/api/v1/certificate-bindings/delete'
    ])
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({ targetId: 'host-1', requiredCapabilities: ['service.reload'] })
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({ targetId: 'host-1', operation: 'deploy' })
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toMatchObject({ bindingId: 'binding-1', remoteFingerprintSha256: 'a'.repeat(64) })
    expect(JSON.parse(String(calls[3]?.[1]?.body))).toMatchObject({ bindingId: 'binding-1', reason: 'manual' })
    expect((calls[0]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^capability_match_/)
    expect((calls[2]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^binding_drift_result_/)
  })
})
