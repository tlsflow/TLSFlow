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
  readonly pluginVersionId?: string
  readonly pluginId?: string
}

export interface DeviceOnboardingResultView {
  readonly onboardingKind: 'AGENT_INSTALL' | 'API_CONNECTION' | 'PLUGIN_MANAGED'
  readonly installCommand: string
  readonly expiresAt: string
  readonly connectionSucceeded: boolean
  readonly connectionErrorCode: string
}

export function normalizeDeviceOnboardingResult(
  platform: DeviceOnboardingPlatform,
  response: Readonly<Record<string, unknown>>,
): DeviceOnboardingResultView {
  const installSession = asRecord(response.installSession)
  const connection = asRecord(response.connection)
  const connectionSucceeded = connection.reachable === true
    && connection.authenticated === true
    && connection.productMatched === true

  return {
    onboardingKind: response.onboardingKind === 'PLUGIN_MANAGED' ? 'PLUGIN_MANAGED' : platform.onboardingKind,
    installCommand: text(installSession.installCommand ?? response.installCommand),
    expiresAt: text(installSession.expiresAt ?? response.expiresAt),
    connectionSucceeded: response.onboardingKind === 'PLUGIN_MANAGED' || connectionSucceeded,
    connectionErrorCode: text(connection.errorCode),
  }
}

export function buildDeviceOnboardingPayload(
  platform: DeviceOnboardingPlatform,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (platform.pluginVersionId) {
    return { platformKey: 'plugin', pluginVersionId: platform.pluginVersionId, formValues: values }
  }
  const payload: Record<string, unknown> = { platformKey: platform.key }
  for (const field of platform.formSchema) {
    const value = values[field.key]
    if (value === undefined || value === '') continue
    payload[field.key] = value
  }
  if (platform.onboardingKind === 'API_CONNECTION' && values.tlsVerify === false) {
    payload.insecureTlsAcknowledged = values.insecureTlsAcknowledged === true
  }
  return payload
}

export function validateDeviceOnboarding(
  platform: DeviceOnboardingPlatform,
  values: Readonly<Record<string, unknown>>,
): string[] {
  if (platform.supportStatus !== 'SUPPORTED') return ['UNSUPPORTED_PLATFORM']
  if (platform.pluginVersionId || platform.onboardingKind === 'AGENT_INSTALL') return []
  const missing = platform.formSchema
    .filter((field) => field.required && (values[field.key] === undefined || String(values[field.key]).trim() === ''))
    .map((field) => field.key)
  if (platform.onboardingKind === 'API_CONNECTION' && values.tlsVerify === false && values.insecureTlsAcknowledged !== true) {
    missing.push('insecureTlsAcknowledged')
  }
  return missing
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
