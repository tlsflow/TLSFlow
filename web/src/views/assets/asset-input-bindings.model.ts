export const INPUT_BINDINGS_API_VERSION = 'gcac.input-bindings/v1' as const

export interface InputConnectionBindingV1 {
  host?: string
  port?: number
  username?: string
  tls?: {
    verifyPeer?: boolean
    serverName?: string
  }
  hostKey?: {
    expectedFingerprint?: string
  }
}

export interface InputCredentialBindingV1 {
  credentialId: string
}

export interface InputArtifactBindingV1 {
  certificateFormatId?: string
  outputBindings: Record<string, string>
}

export interface InputBindingsV1 {
  apiVersion: typeof INPUT_BINDINGS_API_VERSION
  variables: Record<string, unknown>
  connections: Record<string, InputConnectionBindingV1>
  credentials: Record<string, InputCredentialBindingV1>
  artifacts: Record<string, InputArtifactBindingV1>
}

export function createInputBindingsV1(input: Partial<Omit<InputBindingsV1, 'apiVersion'>> = {}): InputBindingsV1 {
  return {
    apiVersion: INPUT_BINDINGS_API_VERSION,
    variables: input.variables ?? {},
    connections: input.connections ?? {},
    credentials: input.credentials ?? {},
    artifacts: input.artifacts ?? {},
  }
}

export function readInputBindingsV1(value: unknown): InputBindingsV1 | null {
  const record = readRecord(value)
  if (record?.apiVersion !== INPUT_BINDINGS_API_VERSION) return null
  const variables = readRecord(record.variables)
  const connections = readRecord(record.connections)
  const credentials = readRecord(record.credentials)
  const artifacts = readRecord(record.artifacts)
  if (!variables || !connections || !credentials || !artifacts) return null
  return {
    apiVersion: INPUT_BINDINGS_API_VERSION,
    variables,
    connections: connections as Record<string, InputConnectionBindingV1>,
    credentials: credentials as Record<string, InputCredentialBindingV1>,
    artifacts: artifacts as Record<string, InputArtifactBindingV1>,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
