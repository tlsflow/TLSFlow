export interface DeviceOnboardingField {
  readonly key: string
  readonly type: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'SECRET_INPUT' | 'SECRET_REF'
  readonly required: boolean
}

/** 应用接入向导传入的设备向导预选入口，来源必须是已加载插件配方。 */
export type DeviceOnboardingInitialSelection =
  | { readonly kind: 'AGENT_INSTALL'; readonly platformKey: string }
  | { readonly kind: 'AGENT_INSTALL'; readonly platformKeys: readonly string[] }
  | { readonly kind: 'PLUGIN_MANAGED'; readonly pluginId: string }

export interface DeviceOnboardingPlatform {
  readonly key: string
  readonly displayNameKey: string
  readonly supportDescriptionKey?: string
  readonly productFamily: string
  readonly managementMethod: string
  readonly group?: 'AGENT' | 'OTHER'
  readonly onboardingKind: 'AGENT_INSTALL' | 'API_CONNECTION' | 'CLOUD_ACCOUNT'
  readonly supportStatus: 'SUPPORTED' | 'PREVIEW' | 'UNSUPPORTED'
  readonly formSchema: readonly DeviceOnboardingField[]
  readonly logoUrl?: string
  readonly logoSquareUrl?: string
  readonly pluginVersionId?: string
  readonly pluginId?: string
  readonly displayName?: string
  readonly description?: string
  readonly cloudProviderKey?: string
}

export interface DeviceOnboardingResultView {
  readonly onboardingKind: 'AGENT_INSTALL' | 'API_CONNECTION' | 'CLOUD_ACCOUNT' | 'PLUGIN_MANAGED'
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
