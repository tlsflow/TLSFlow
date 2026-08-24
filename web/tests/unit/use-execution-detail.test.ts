import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useExecutionDetail } from '@/composables/useExecutionDetail'

const apiMocks = vi.hoisted(() => ({
  listExecutionStepsByRunId: vi.fn(),
  listAgentTaskLogsByTaskId: vi.fn(),
  streamExecutionDetail: vi.fn(),
}))

vi.mock('@/api/modules/executions.api', () => ({
  listExecutionStepsByRunId: apiMocks.listExecutionStepsByRunId,
  listAgentTaskLogsByTaskId: apiMocks.listAgentTaskLogsByTaskId,
  streamExecutionDetail: apiMocks.streamExecutionDetail,
}))

describe('useExecutionDetail', () => {
  it('主进度保留平台阶段，工作流子步骤仅用于详细记录', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-dry-run',
      data: {
        items: [{
          id: 'step-workflow',
          name: 'WORKFLOW target-1',
          stepType: 'INSTALL',
          status: 'SUCCESS',
          startedAt: '2026-07-21T03:45:49.000Z',
          finishedAt: '2026-07-21T03:45:50.000Z',
          inputSnapshot: {
            dryRun: true,
            resultDetail: {
              dryRunChecks: [{
                key: 'workflow_step_1_login',
                label: '工作流节点预览：login',
                status: 'passed',
                detail: '准备阶段请求已解析：POST https://nas.example.test/login；响应策略包含 1 项断言、1 项变量提取，未发送真实请求。',
              }],
              dryRunSummary: { passed: 1, warning: 0, failed: 0, unknown: 0 },
              workflowRun: {
                id: 'wfrun-dry-run',
                status: 'success',
                stepResults: [{
                  name: 'login',
                  type: 'http',
                  stage: 'prepare',
                  status: 'success',
                  attempts: 1,
                  assertions: [],
                  logs: ['step:login:attempt:1:status:success'],
                  startedAt: '2026-07-21T03:45:49.000Z',
                  finishedAt: '2026-07-21T03:45:50.000Z',
                }],
                rollbackResults: [],
              },
            },
          },
        }],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })

    const selectedRow = ref({
      id: 'run-dry-run',
      raw: { id: 'run-dry-run', status: 'SUCCESS' },
    })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => {
      expect(detail?.dryRunChecks.value).toHaveLength(1)
    })
    expect(detail?.dryRunChecks.value[0]?.label).toBe('工作流节点预览：login')
    expect(detail?.dryRunSummary.value?.state).toBe('passed')
    expect(detail?.dryRunSummary.value?.passed).toBe(1)
    expect(detail?.steps.value).toHaveLength(1)
    expect(detail?.steps.value[0]?.name).toBe('WORKFLOW target-1')
    expect(detail?.steps.value[0]?.stepType).toBe('INSTALL')
    expect(detail?.lines.value.some((line) => line.step === 'login')).toBe(true)

    wrapper.unmount()
  })

  it('dry-run 失败时优先展示真实错误而不是通用等待文案', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-dry-run-failed',
      data: {
        items: [{
          id: 'step-atomic-failed',
          name: 'CUSTOM target-1',
          status: 'FAILED',
          lastErrorCode: 'VALIDATION_FAILED',
          lastErrorMessage: 'Agent task 缺少 actionType/type，不能直连执行',
          inputSnapshot: { dryRun: true },
        }],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })

    const selectedRow = ref({
      id: 'run-dry-run-failed',
      raw: { id: 'run-dry-run-failed', status: 'FAILED' },
    })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => {
      expect(detail?.steps.value).toHaveLength(1)
    })
    expect(detail?.steps.value[0]?.detail).toContain('VALIDATION_FAILED')
    expect(detail?.steps.value[0]?.detail).toContain('Agent task 缺少 actionType/type，不能直连执行')
    expect(detail?.steps.value[0]?.detail).not.toContain('dryRunPending.failed')

    wrapper.unmount()
  })
})
