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
  it('展开工作流步骤后仍保留父级 dry-run 检查结论', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-dry-run',
      data: {
        items: [{
          id: 'step-workflow',
          name: 'WORKFLOW target-1',
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
    expect(detail?.steps.value[0]?.name).toBe('login')

    wrapper.unmount()
  })
})
