import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { useExecutionDetail } from '@/composables/useExecutionDetail'
import { formatBrowserLocalTime } from '@/utils/browser-local-time'

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

  it('工作流失败投影展示数据库中的 detail.logs，并按大写失败状态显示错误', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-workflow-failed',
      data: {
        items: [{
          id: 'step-workflow-failed',
          name: 'WORKFLOW target-1',
          stepType: 'INSTALL',
          status: 'FAILED',
          lastErrorCode: 'HTTP_NON_SUCCESS_STATUS',
          lastErrorMessage: '工作流节点 installIntermediates 失败：HTTP 响应未满足成功策略',
          inputSnapshot: {
            resultDetail: {
              workflowExecutionSteps: [{
                name: 'installIntermediates',
                status: 'FAILED',
                stepType: 'INSTALL',
                errorCode: 'HTTP_NON_SUCCESS_STATUS',
                errorMessage: 'HTTP 响应未满足成功策略',
                detail: {
                  logs: [
                    '[2026/08/03 14:15:14] [error] [installIntermediates] HTTP_NON_SUCCESS_STATUS',
                    '[2026/08/03 14:15:14] [error] [installIntermediates[0].createIntermediateCertKey] 证书密钥创建失败',
                  ],
                },
              }],
            },
          },
        }],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })

    const selectedRow = ref({
      id: 'run-workflow-failed',
      raw: { id: 'run-workflow-failed', status: 'FAILED' },
    })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => {
      expect(detail?.lines.value.some((line) => line.message.includes('createIntermediateCertKey'))).toBe(true)
    })
    expect(detail?.lines.value.find((line) => line.step === 'installIntermediates')?.message).toContain('HTTP_NON_SUCCESS_STATUS')
    expect(detail?.lines.value.find((line) => line.step === 'installIntermediates')?.message).not.toBe('工作流节点执行成功。')
    expect(detail?.lines.value.some((line) => line.message.includes('证书密钥创建失败'))).toBe(true)

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

  it('未知写入结果展示错误码、核验状态和结构化恢复日志', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-unknown-write',
      data: {
        items: [{
          id: 'step-install-unknown',
          name: 'INSTALL target-1',
          stepType: 'INSTALL',
          status: 'RUNNING',
          lastErrorCode: 'PLUGIN_OPERATION_UNKNOWN_STATE',
          lastErrorMessage: 'Plugin Runner 返回结果不明，必须进入恢复流程',
          lastErrorDetails: {
            executionStatus: 'UNKNOWN',
            reason: 'runner_timeout',
          },
          inputSnapshot: {
            executorType: 'AGENT',
            dispatchDetail: { agentTaskId: 'agent-task-unknown-write' },
            resultDetail: {
              executionStatus: 'UNKNOWN',
              unknownReason: 'Plugin Runner 返回结果不明',
            },
          },
        }],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({
      data: [{ taskId: 'agent-task-unknown-write', message: 'Agent 已完成回执写入' }],
    })

    const selectedRow = ref({ id: 'run-unknown-write', raw: { id: 'run-unknown-write', status: 'RUNNING' } })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => expect(detail?.hasUnknownResult.value).toBe(true))
    expect(detail?.steps.value[0]?.unknownResult).toBe(true)
    expect(detail?.steps.value[0]?.detail).toContain('PLUGIN_OPERATION_UNKNOWN_STATE')
    expect(detail?.steps.value[0]?.detail).toContain('系统不会自动重放')
    expect(detail?.steps.value[0]?.diagnostics?.some((item) => item.label === 'errorCode')).toBe(true)
    expect(detail?.steps.value[0]?.structuredDetail).toContain('runner_timeout')
    expect(detail?.lines.value.some((line) => line.message.includes('executionStatus'))).toBe(true)
    expect(apiMocks.listAgentTaskLogsByTaskId).toHaveBeenCalledWith('agent-task-unknown-write')
    expect(detail?.lines.value.some((line) => line.message.includes('Agent 已完成回执写入'))).toBe(true)

    wrapper.unmount()
  })

  it('旧 SSE 快照不会把已完成步骤回退为 PENDING', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-stale-snapshot',
      data: {
        items: [{
          id: 'step-discover',
          name: 'DISCOVER target-1',
          stepType: 'DISCOVER',
          status: 'SUCCESS',
          version: 3,
          updatedAt: '2026-08-03T00:00:01.000Z',
          inputSnapshot: { dryRun: true },
        }],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })
    apiMocks.streamExecutionDetail.mockImplementation(async (_runId: string, handlers: any) => {
      handlers.onSnapshot?.({
        run: { status: 'RUNNING' },
        steps: [{
          id: 'step-discover',
          name: 'DISCOVER target-1',
          stepType: 'DISCOVER',
          status: 'PENDING',
          version: 2,
          updatedAt: '2026-08-03T00:00:00.000Z',
          inputSnapshot: { dryRun: true },
        }],
      })
      return () => undefined
    })

    const selectedRow = ref({
      id: 'run-stale-snapshot',
      raw: { id: 'run-stale-snapshot', status: 'RUNNING' },
    })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => expect(detail?.steps.value).toHaveLength(1))
    expect(detail?.steps.value[0]?.status).toBe('SUCCESS')

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

  it('工作流投影缺少父步骤时间时，按子步骤时间关联步骤和运行边界', async () => {
    const firstStartedAt = '2026-08-18T01:16:29.000Z'
    const firstFinishedAt = '2026-08-18T01:16:31.000Z'
    const lastFinishedAt = '2026-08-18T01:16:43.000Z'
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-workflow-time-fallback',
      data: {
        items: [{
          id: 'step-workflow-time-fallback',
          name: 'WORKFLOW target-1',
          stepType: 'INSTALL',
          status: 'SUCCESS',
          inputSnapshot: {
            resultDetail: {
              workflowExecutionSteps: [
                { name: 'prepare', status: 'SUCCESS', startedAt: firstStartedAt, finishedAt: firstFinishedAt },
                { name: 'verify', status: 'SUCCESS', startedAt: '2026-08-18T01:16:38.000Z', finishedAt: lastFinishedAt },
              ],
            },
          },
        }],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })

    const selectedRow = ref({ id: 'run-workflow-time-fallback', raw: { id: 'run-workflow-time-fallback', status: 'SUCCESS' } })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => expect(detail?.steps.value).toHaveLength(1))
    expect(detail?.steps.value[0]?.startedAt).toBe(formatBrowserLocalTime(firstStartedAt))
    expect(detail?.steps.value[0]?.finishedAt).toBe(formatBrowserLocalTime(lastFinishedAt))
    expect(detail?.runStartedAt.value).toBe(firstStartedAt)
    expect(detail?.runFinishedAt.value).toBe(lastFinishedAt)

    wrapper.unmount()
  })

  it('运行记录没有目标字段时，从部署输入快照解析目标并去重', async () => {
    apiMocks.listExecutionStepsByRunId.mockResolvedValue({
      requestId: 'req-target-snapshot',
      data: {
        items: [
          {
            id: 'step-target-snapshot',
            status: 'SUCCESS',
            inputSnapshot: {
              resolvedDeploymentInput: {
                assetContext: {
                  application: {
                    serverName: 'cloud.jacksonz.cn',
                    address: '10.0.0.8',
                  },
                  deployment: { targets: [] },
                },
              },
            },
          },
          {
            id: 'step-target-runtime-snapshot',
            status: 'SUCCESS',
            inputSnapshot: {
              executionRuntimeSnapshot: {
                resolvedDeploymentInput: {
                  assetContext: {
                    application: { serverName: 'cloud.jacksonz.cn' },
                    deployment: { targets: [{ name: 'Default Web Site', serverName: 'cloud.jacksonz.cn' }] },
                  },
                },
              },
            },
          },
        ],
      },
    })
    apiMocks.listAgentTaskLogsByTaskId.mockResolvedValue({ data: [] })

    const selectedRow = ref({
      id: 'run-target-snapshot',
      raw: { id: 'run-target-snapshot', status: 'SUCCESS' },
    })
    let detail: ReturnType<typeof useExecutionDetail> | undefined
    const wrapper = mount(defineComponent({
      setup() {
        detail = useExecutionDetail(selectedRow as never)
        return () => h('div')
      },
    }))

    await vi.waitFor(() => expect(detail?.runTargetLabel.value).toBe('cloud.jacksonz.cn'))

    wrapper.unmount()
  })
})
