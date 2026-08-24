import { describe, expect, it } from 'vitest'
import { buildManagedTargetDeploymentStrategy, resolveDeploymentStrategyMode } from '@/views/assets/asset-deployment-strategy.model'

describe('应用资产部署策略语义', () => {
  it('新受管目标请求只发送目标 ID 和证书产物', () => {
    expect(buildManagedTargetDeploymentStrategy(' target_1 ', ' format_1 ')).toEqual({
      type: 'MANAGED_TARGET',
      managedTarget: { managedTargetId: 'target_1', certificateFormatId: 'format_1' },
    })
  })

  it('旧 AGENT 策略在编辑界面映射为受管目标', () => {
    expect(resolveDeploymentStrategyMode({ type: 'AGENT' })).toBe('MANAGED_TARGET')
    expect(resolveDeploymentStrategyMode({ type: 'MANAGED_TARGET' })).toBe('MANAGED_TARGET')
    expect(resolveDeploymentStrategyMode({ type: 'WORKFLOW' })).toBe('WORKFLOW')
  })
})
