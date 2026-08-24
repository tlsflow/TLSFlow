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

export interface AgentInstallMaterialsView {
  readonly installationId: string
  readonly expiresAt: string
  readonly enrollmentToken: string
  readonly materials: readonly Readonly<Record<string, unknown>>[]
  readonly task: Readonly<Record<string, unknown>>
}

export interface DeviceOnboardingResultView {
  readonly onboardingKind: 'AGENT_INSTALL' | 'API_CONNECTION' | 'PLUGIN_MANAGED'
  readonly installMaterials?: AgentInstallMaterialsView
  readonly connectionSucceeded: boolean
  readonly connectionErrorCode: string
}

export function normalizeDeviceOnboardingResult(
  platform: DeviceOnboardingPlatform,
  response: Readonly<Record<string, unknown>>,
): DeviceOnboardingResultView {
  const installMaterials = normalizeAgentInstallMaterials(response.installMaterials)
  const connection = asRecord(response.connection)
  const connectionSucceeded = connection.reachable === true
    && connection.authenticated === true
    && connection.productMatched === true

  return {
    onboardingKind: response.onboardingKind === 'PLUGIN_MANAGED' ? 'PLUGIN_MANAGED' : platform.onboardingKind,
    installMaterials,
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
  if (platform.pluginVersionId) return []
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

function normalizeAgentInstallMaterials(value: unknown): AgentInstallMaterialsView | undefined {
  const record = asRecord(value)
  const materials = Array.isArray(record.materials) ? record.materials.filter(isRecord) : []
  const task = asRecord(record.task)
  const installationId = text(record.installationId)
  const expiresAt = text(record.expiresAt)
  const enrollmentToken = text(record.enrollmentToken)
  if (!installationId || !expiresAt || !enrollmentToken || materials.length === 0 || Object.keys(task).length === 0) return undefined
  return { installationId, expiresAt, enrollmentToken, materials, task }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
