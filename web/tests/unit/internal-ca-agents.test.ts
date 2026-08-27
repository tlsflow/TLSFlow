import { describe, expect, it } from 'vitest'
import { isWindowsAdcsAgent } from '@/views/internal-ca/internal-ca-agents'

describe('Windows AD CS Agent 识别', () => {
  it('兼容控制面返回的大写 WINDOWS_ADCS 平台值', () => {
    expect(isWindowsAdcsAgent({ role: 'adcs_agent', descriptor: { osType: 'WINDOWS_ADCS' } })).toBe(true)
  })

  it('拒绝其它角色或平台', () => {
    expect(isWindowsAdcsAgent({ role: 'full_agent', descriptor: { osType: 'WINDOWS_ADCS' } })).toBe(false)
    expect(isWindowsAdcsAgent({ role: 'adcs_agent', descriptor: { osType: 'WINDOWS' } })).toBe(false)
  })
})
