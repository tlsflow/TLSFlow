import { describe, expect, it } from 'vitest'
import type { TaskRun } from '@/api/modules/tasks.api'
import { isAutomationApprovalTask, isDeploymentApprovalTask, isDeploymentExecutionTask, isDeploymentRunTask, isQuickTask, isTerminalTaskStatus, RECENT_TASK_LIMIT } from '@/views/tasks/task-events'

function task(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'task-1',
    tenantId: 'tenant-1',
    taskType: 'REPORT_EXPORT',
    definitionVersion: 1,
    category: 'SYSTEM',
    status: 'RUNNING',
    triggerSource: 'test',
    createdAt: '2026-08-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('任务快速区范围', () => {
  it('最近完成任务统一保留十条', () => {
    expect(RECENT_TASK_LIMIT).toBe(10)
  })

  it('成功、失败和取消都属于可展示的完成状态', () => {
    expect(['SUCCEEDED', 'FAILED', 'CANCELLED'].every((status) => isTerminalTaskStatus(status as TaskRun['status']))).toBe(true)
    expect(isTerminalTaskStatus('RUNNING')).toBe(false)
  })

  it('显示执行类任务', () => {
    expect(isQuickTask(task({
      taskType: 'CERTIFICATE_DEPLOY',
      category: 'EXECUTION',
    }))).toBe(true)
  })

  it('显示自动化运行任务，包括等待审批的任务', () => {
    const approvalTask = task({
      taskType: 'AUTOMATION_RUN',
      resourceSummary: {
        approvalId: 'approval-1',
        status: 'waiting_approval',
      },
    })

    expect(isQuickTask(approvalTask)).toBe(true)
    expect(isAutomationApprovalTask(approvalTask)).toBe(true)
  })

  it('部署审批占位任务不能被识别为真实证书部署运行', () => {
    const legacyApprovalTask = task({
      taskType: 'CERTIFICATE_DEPLOY',
      category: 'EXECUTION',
      status: 'SUCCEEDED',
      resourceSummary: { approvalId: 'approval-1', executionType: 'approval', status: 'approved' },
    })
    const executionTask = task({
      taskType: 'CERTIFICATE_DEPLOY',
      category: 'EXECUTION',
      payload: { runId: 'run-1', executionType: 'apply' },
    })

    expect(isDeploymentApprovalTask(legacyApprovalTask)).toBe(true)
    expect(isDeploymentExecutionTask(legacyApprovalTask)).toBe(false)
    expect(isDeploymentRunTask(legacyApprovalTask)).toBe(false)
    expect(isDeploymentRunTask(executionTask)).toBe(true)
  })

  it('显示 ACME 续签并隐藏无关的监控和后台任务', () => {
    expect(isQuickTask(task({
      taskType: 'CERTIFICATE_ISSUE',
      category: 'SYSTEM',
      payload: { applicationAssetId: 'app-1' },
    }))).toBe(true)
    expect(isQuickTask(task({
      taskType: 'ACME_CERTIFICATE_ISSUE',
      category: 'SYSTEM',
    }))).toBe(true)
    expect(isQuickTask(task({
      taskType: 'ACME_CERTIFICATE_RENEWAL',
      category: 'SYSTEM',
    }))).toBe(true)
    expect(isQuickTask(task({
      taskType: 'MONITORING_BATCH',
      category: 'MONITORING',
    }))).toBe(false)
    expect(isQuickTask(task({
      taskType: 'REPORT_EXPORT',
      category: 'SYSTEM',
    }))).toBe(false)
    expect(isQuickTask(task({
      taskType: 'AUTOMATION_TRIGGER_DELIVERY',
      category: 'SYSTEM',
    }))).toBe(false)
  })
})
