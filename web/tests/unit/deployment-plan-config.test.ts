import { describe, expect, it } from 'vitest'
import { deploymentPlanUiActions } from '@/views/deployments/deployment-plan.config'

describe('deployment-plan.config', () => {
  it('Dry-run 影响预览必须是普通动作，不要求 PREVIEW 二次确认', () => {
    const dryRunAction = deploymentPlanUiActions.find((action) => action.key === 'dry-run')

    expect(dryRunAction).toBeTruthy()
    expect(dryRunAction?.label).toContain('Dry-run')
    expect(Boolean(dryRunAction?.danger)).toBe(false)
    expect(dryRunAction?.confirmText).toBeUndefined()
  })

  it('删除动作对所有部署计划状态可见', () => {
    const deleteAction = deploymentPlanUiActions.find((action) => action.key === 'delete')

    expect(deleteAction?.visibleWhen).toEqual([
      'DRAFT',
      'DRY_RUN_PASSED',
      'DRY_RUN_FAILED',
      'PENDING_APPROVAL',
      'APPROVED',
      'READY',
      'RUNNING',
      'SUCCESS',
      'PARTIAL_SUCCESS',
      'FAILED',
      'CANCELLED',
      'CANCELED',
      'ROLLED_BACK',
      'ROLLBACK_FAILED',
    ])
  })

  it('待审批计划显示执行部署动作，但必须保持禁用直到审批通过', () => {
    const executeAction = deploymentPlanUiActions.find((action) => action.key === 'execute')
    const row = {
      id: 'plan-pending-approval',
      name: '待审批计划',
      status: 'PENDING_APPROVAL',
      risk: 'HIGH' as const,
      raw: {
        id: 'plan-pending-approval',
        status: 'PENDING_APPROVAL',
        latestRun: { type: 'dry_run', status: 'SUCCESS' },
      },
    }

    expect(executeAction?.visibleWhen).toContain('PENDING_APPROVAL')
    expect(executeAction?.disabledReason?.(row)).toBe('缺少审批通过信息，不能执行。')
  })

  it('待审批计划即使已有审批单也不能直接执行', () => {
    const executeAction = deploymentPlanUiActions.find((action) => action.key === 'execute')
    const row = {
      id: 'plan-pending-approval-with-request',
      name: '等待审批计划',
      status: 'PENDING_APPROVAL',
      risk: 'HIGH' as const,
      raw: {
        id: 'plan-pending-approval-with-request',
        status: 'PENDING_APPROVAL',
        approvalStatus: 'PENDING',
        approvalId: 'approval-pending-1',
      },
    }

    expect(executeAction?.disabledReason?.(row)).toBe('审批申请已提交，等待审批人批准后才能执行。')
  })

  it('审批通过但最新运行不是 dry-run 时允许点击并交给后端返回 dry-run 引导', () => {
    const executeAction = deploymentPlanUiActions.find((action) => action.key === 'execute')
    const row = {
      id: 'plan-approved-with-apply',
      name: '已审批计划',
      status: 'APPROVED',
      risk: 'HIGH' as const,
      raw: {
        id: 'plan-approved-with-apply',
        status: 'APPROVED',
        approvalStatus: 'APPROVED',
        approvalId: 'approval-1',
        latestRun: { type: 'apply', status: 'SUCCESS' },
      },
    }

    expect(executeAction?.disabledReason?.(row)).toBe('')
  })
})
