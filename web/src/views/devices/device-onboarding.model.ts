export interface DeviceOnboardingField {
  readonly key: string
  readonly type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SECRET_INPUT' | 'SECRET_REF'
  readonly required: boolean
}

export interface DeviceOnboardingPlatform {
  readonly key: string
  readonly displayNameKey: string
  readonly productFamily: string
  readonly managementMethod: string
  readonly onboardingKind: 'AGENT_INSTALL' | 'API_CONNECTION'
  readonly supportStatus: 'SUPPORTED' | 'PREVIEW' | 'UNSUPPORTED'
  readonly formSchema: readonly DeviceOnboardingField[]
}

export function buildDeviceOnboardingPayload(
  platform: DeviceOnboardingPlatform,
  values: Readonly<Record<string, string | number | boolean>>,
  baseUrl: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { platformKey: platform.key }
  for (const field of platform.formSchema) {
    const value = values[field.key]
    if (value === undefined || value === '') continue
    payload[field.key] = value
  }
  if (platform.onboardingKind === 'AGENT_INSTALL') payload.baseUrl = baseUrl
  return payload
}

export function validateDeviceOnboarding(
  platform: DeviceOnboardingPlatform,
  values: Readonly<Record<string, string | number | boolean>>,
): string[] {
  if (platform.supportStatus !== 'SUPPORTED') return ['UNSUPPORTED_PLATFORM']
  return platform.formSchema
    .filter((field) => field.required && (values[field.key] === undefined || String(values[field.key]).trim() === ''))
    .map((field) => field.key)
}
