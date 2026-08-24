import { describe, expect, it } from 'vitest'
import { buildDeviceOnboardingPayload, normalizeDeviceOnboardingResult, validateDeviceOnboarding, type DeviceOnboardingPlatform } from '@/views/devices/device-onboarding.model'

const citrix: DeviceOnboardingPlatform = {
  key: 'citrix-adc', displayNameKey: 'devices.platforms.citrixAdc', productFamily: 'Citrix ADC', managementMethod: 'NITRO_API',
  onboardingKind: 'API_CONNECTION', supportStatus: 'SUPPORTED', formSchema: [
    { key: 'managementAddress', type: 'TEXT', required: true },
    { key: 'username', type: 'TEXT', required: true },
    { key: 'password', type: 'SECRET_INPUT', required: true },
    { key: 'tlsVerify', type: 'BOOLEAN', required: false },
  ],
}

describe('设备添加向导模型', () => {
  it('API 分支只提交后端描述允许的字段', () => {
    expect(buildDeviceOnboardingPayload(citrix, {
      managementAddress: '10.255.0.49', username: 'nsroot', password: 'secret', baseUrl: 'forbidden', extra: 'forbidden',
    }, 'https://gcac.example.com')).toEqual({
      platformKey: 'citrix-adc', managementAddress: '10.255.0.49', username: 'nsroot', password: 'secret',
    })
  })

  it('未支持平台和缺少必填字段不能提交', () => {
    expect(validateDeviceOnboarding({ ...citrix, supportStatus: 'UNSUPPORTED' }, {})).toEqual(['UNSUPPORTED_PLATFORM'])
    expect(validateDeviceOnboarding(citrix, { managementAddress: '10.255.0.49' })).toEqual(['username', 'password'])
  })

  it('关闭 TLS 校验时要求显式风险确认', () => {
    expect(validateDeviceOnboarding(citrix, {
      managementAddress: '10.255.0.49', username: 'nsroot', password: 'secret', tlsVerify: false,
    })).toContain('insecureTlsAcknowledged')
    expect(buildDeviceOnboardingPayload(citrix, {
      managementAddress: '10.255.0.49', username: 'nsroot', password: 'secret', tlsVerify: false, insecureTlsAcknowledged: true,
    }, 'https://gcac.example.com')).toMatchObject({ tlsVerify: false, insecureTlsAcknowledged: true })
  })

  it('插件设备不套用旧 API 连接的 TLS 风险确认字段', () => {
    const pluginPlatform: DeviceOnboardingPlatform = {
      ...citrix,
      key: 'plugin:citrix-adc',
      pluginVersionId: 'uplgv_citrix_adc',
      formSchema: [],
    }
    expect(validateDeviceOnboarding(pluginPlatform, { tlsVerify: false })).toEqual([])
    expect(buildDeviceOnboardingPayload(pluginPlatform, {
      displayName: 'TEST-ADC',
      address: '10.255.0.49',
      port: 443,
      credential: 'cred_citrix_adc',
      tlsVerify: false,
    }, 'https://gcac.example.com')).toEqual({
      platformKey: 'plugin',
      pluginVersionId: 'uplgv_citrix_adc',
      formValues: {
        displayName: 'TEST-ADC',
        address: '10.255.0.49',
        port: 443,
        credential: 'cred_citrix_adc',
        tlsVerify: false,
      },
    })
  })

  it('Agent 安装分支保留控制面地址用于生成安装命令', () => {
    const windows: DeviceOnboardingPlatform = {
      key: 'windows', displayNameKey: 'devices.platforms.windows', productFamily: 'Windows Server', managementMethod: 'AGENT',
      onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }
    expect(buildDeviceOnboardingPayload(windows, {}, 'https://gcac.example.com')).toEqual({
      platformKey: 'windows', baseUrl: 'https://gcac.example.com',
    })
    expect(validateDeviceOnboarding(windows, {})).toEqual([])
  })

  it('兼容统一 onboarding 的嵌套安装会话和旧顶层命令响应', () => {
    const windows: DeviceOnboardingPlatform = {
      key: 'windows', displayNameKey: 'devices.platforms.windows', productFamily: 'Windows Server', managementMethod: 'AGENT',
      onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }
    expect(normalizeDeviceOnboardingResult(windows, { installSession: { installCommand: 'irm install.ps1 | iex' } }).installCommand).toBe('irm install.ps1 | iex')
    expect(normalizeDeviceOnboardingResult(windows, { installCommand: 'legacy-command' }).installCommand).toBe('legacy-command')
  })
})
