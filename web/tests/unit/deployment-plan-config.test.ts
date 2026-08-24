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

  it('删除动作只对未提交草稿可见', () => {
    const deleteAction = deploymentPlanUiActions.find((action) => action.key === 'delete')

    expect(deleteAction?.visibleWhen).toEqual(['DRAFT', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED'])
  })
})
