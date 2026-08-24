import { describe, expect, it } from 'vitest'
import type { TaskRun } from '@/api/modules/tasks.api'
import { isAutomationApprovalTask, isQuickTask } from '@/views/tasks/task-events'

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

  it('隐藏监控和后台任务，但不隐藏自动化触发投递任务', () => {
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
