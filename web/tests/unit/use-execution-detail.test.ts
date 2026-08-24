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
          inputSnapshot: {
            dryRun: true,
            resultDetail: {
              workflowIdentity: {
                pluginId: 'builtin.workflow.apache-8444-cert-switch',
                pluginVersion: '1.2.6',
                pluginVersionId: 'uplgv-apache-1-2-6',
                workflowName: 'apache-8444-cert-switch',
                workflowDslVersion: '1.2.6',
                workflowVersion: 9,
                workflowVersionId: 'wftplv-apache-v9',
              },
            },
          },
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
    expect(detail?.steps.value[0]?.detail).toContain('builtin.workflow.apache-8444-cert-switch@1.2.6')
    expect(detail?.steps.value[0]?.detail).not.toContain('V9')
    expect(detail?.steps.value[0]?.detail).not.toContain('wftplv-apache-v9')
    expect(detail?.steps.value[0]?.detail).not.toContain('dryRunPending.failed')

    wrapper.unmount()
  })

  it('失败步骤展示结构化输入问题的槽位、路径、来源和修复位置', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-input-issues',
      data: {
        items: [{
          id: 'step-input-issues',
          name: 'INSTALL target-1',
          status: 'FAILED',
          lastErrorCode: 'VALIDATION_FAILED',
          lastErrorMessage: '部署输入校验失败',
          lastErrorDetails: {
            issues: [{
              category: 'CONNECTION',
              slot: 'management',
              path: 'connections.management.host',
              bindingLayer: 'DEVICE',
              messageKey: 'deploymentInputs.issues.CONNECTION_FIELD_MISSING',
            }],
          },
          inputSnapshot: { dryRun: true },
        }],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })

    const selectedRow = ref({ id: 'run-input-issues', raw: { id: 'run-input-issues', status: 'FAILED' } })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => expect(detail?.steps.value).toHaveLength(1))
    expect(detail?.steps.value[0]?.detail).toContain('management')
    expect(detail?.steps.value[0]?.detail).toContain('connections.management.host')
    expect(detail?.steps.value[0]?.detail).toContain('DEVICE')
    expect(detail?.steps.value[0]?.detail).toContain('deploymentInputs.issues.CONNECTION_FIELD_MISSING')

    wrapper.unmount()
  })

  it('TLS Grant 缺失时标记预检已完成但仍保留安全失败', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-tls-grant-required',
      data: {
        items: [
          {
            id: 'step-install',
            name: 'INSTALL target-1',
            stepType: 'INSTALL',
            status: 'FAILED',
            lastErrorCode: 'AUTH_FORBIDDEN',
            lastErrorMessage: 'TLS 跳过校验必须携带宿主签发的 ExecutionGrant',
            lastErrorDetails: {
              policy: 'workflow.tls.insecure',
              reason: 'execution_grant_required',
            },
            inputSnapshot: { dryRun: true },
          },
          {
            id: 'step-reload',
            name: 'RELOAD target-1',
            stepType: 'RELOAD',
            status: 'SKIPPED',
            lastErrorCode: 'SKIPPED_AFTER_RUN_FAILURE',
            lastErrorMessage: '执行运行已失败，跳过未执行步骤',
            inputSnapshot: { dryRun: true },
          },
        ],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })

    const selectedRow = ref({
      id: 'run-tls-grant-required',
      raw: { id: 'run-tls-grant-required', status: 'FAILED' },
    })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => expect(detail?.steps.value).toHaveLength(2))
    expect(detail?.dryRunSummary.value?.state).toBe('failed')
    expect(detail?.dryRunSummary.value?.label).toBe('Dry-run 已完成，但需要宿主授权')
    expect(detail?.steps.value[1]?.status).toBe('SKIPPED')
    expect(detail?.steps.value[1]?.detail).toContain('SKIPPED_AFTER_RUN_FAILURE')

    wrapper.unmount()
  })
})
