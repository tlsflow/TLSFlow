import { describe, expect, it } from 'vitest'
import { buildDeviceOnboardingPayload, validateDeviceOnboarding, type DeviceOnboardingPlatform } from '@/views/devices/device-onboarding.model'

const citrix: DeviceOnboardingPlatform = {
  key: 'citrix-adc', displayNameKey: 'devices.platforms.citrixAdc', productFamily: 'Citrix ADC', managementMethod: 'NITRO_API',
  onboardingKind: 'API_CONNECTION', supportStatus: 'SUPPORTED', formSchema: [
    { key: 'managementAddress', type: 'TEXT', required: true },
    { key: 'username', type: 'TEXT', required: true },
    { key: 'password', type: 'SECRET_INPUT', required: true },
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
})
