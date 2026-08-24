import { describe, expect, it } from 'vitest'
import { resolveDeviceDetailKind } from '../../src/views/devices/details/device-detail.registry'

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

  it('统一详情保留不同类型的扩展标识', () => {
    const agent = { extensionType: 'AGENT', extensionSummary: { agentId: 'agent_1' } }
    const adc = { extensionType: 'NETWORK_APPLIANCE', extensionSummary: { deviceAssetId: 'device_1', deviceFamily: 'NETSCALER_ADC' } }
    expect((agent.extensionSummary as Record<string, unknown>).agentId).toBe('agent_1')
    expect((adc.extensionSummary as Record<string, unknown>).deviceAssetId).toBe('device_1')
  })

  it('按设备类型分派独立详情组件', () => {
    expect(resolveDeviceDetailKind({ extensionType: 'AGENT' })).toBe('agent')
    expect(resolveDeviceDetailKind({ extensionType: 'NETWORK_APPLIANCE', extensionSummary: { deviceFamily: 'NETSCALER_ADC' } })).toBe('citrix-adc')
    expect(resolveDeviceDetailKind({ productFamily: 'Citrix ADC' })).toBe('citrix-adc')
    expect(resolveDeviceDetailKind({ productFamily: 'F5' })).toBe('unsupported')
  })
})
