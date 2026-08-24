import { describe, expect, it } from 'vitest'
import {
  buildDeviceOnboardingPayload,
  normalizeDeviceOnboardingResult,
  validateDeviceOnboarding,
  type DeviceOnboardingPlatform,
} from '@/views/devices/device-onboarding.model'

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
    })).toEqual({
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
    })).toMatchObject({ tlsVerify: false, insecureTlsAcknowledged: true })
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
    })).toEqual({
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

  it('Agent 安装分支不接受控制面地址，只提交平台类型', () => {
    const windows: DeviceOnboardingPlatform = {
      key: 'windows', displayNameKey: 'devices.platforms.windows', productFamily: 'Windows Server', managementMethod: 'AGENT',
      onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }
    expect(buildDeviceOnboardingPayload(windows, { baseUrl: 'forbidden' })).toEqual({
      platformKey: 'windows',
    })
    expect(validateDeviceOnboarding(windows, {})).toEqual([])
  })

  it('Agent 安装结果只解析服务端生成的安装命令', () => {
    const linux: DeviceOnboardingPlatform = {
      key: 'linux', displayNameKey: 'devices.platforms.linux', productFamily: 'Linux Server', managementMethod: 'AGENT',
      onboardingKind: 'AGENT_INSTALL', supportStatus: 'SUPPORTED', formSchema: [],
    }
    const result = normalizeDeviceOnboardingResult(linux, {
      onboardingKind: 'AGENT_INSTALL',
      installSession: {
        installCommand: "curl -fsSL 'https://gcac.example.test/agent-install?token=abc' | sudo bash",
        expiresAt: '2026-08-13T08:00:00.000Z',
      },
      installMaterials: {
        enrollmentToken: 'must-not-be-read',
      },
    })
    expect(result.installCommand).toContain('/agent-install?token=')
    expect(result.expiresAt).toBe('2026-08-13T08:00:00.000Z')
    expect('installMaterials' in result).toBe(false)
  })
})
