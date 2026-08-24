import { describe, expect, it } from 'vitest'

function visibleActions(detail: Record<string, unknown>): string[] {
  return Array.isArray(detail.allowedActions) ? detail.allowedActions.map(String) : []
}

describe('统一设备详情动作边界', () => {
  it('Agent 与网络设备动作不串线', () => {
    const agent = visibleActions({ extensionType: 'AGENT', allowedActions: ['UPGRADE_AGENT', 'DISABLE_DEVICE'] })
    const adc = visibleActions({ extensionType: 'NETWORK_APPLIANCE', allowedActions: ['TEST_CONNECTION', 'REFRESH_DISCOVERY', 'DISABLE_DEVICE'] })
    expect(agent).toContain('UPGRADE_AGENT')
    expect(agent).not.toContain('TEST_CONNECTION')
    expect(adc).toContain('TEST_CONNECTION')
    expect(adc).not.toContain('UPGRADE_AGENT')
  })
})
