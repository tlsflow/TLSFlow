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

export interface InputVariableProjectionV1 {
  name: string
  type: string
  configurationMode: 'required' | 'advanced'
  value?: unknown
  status: 'resolved' | 'unresolved'
  source: { kind: string; path?: string }
  bindingPolicy?: string
  sensitive: boolean
  editable: boolean
}

export interface InputConnectionProjectionV1 {
  name: string
  protocol: string
  host?: string
  port?: number
  username?: string
  credentialSlot?: string
  hostKey?: {
    expectedFingerprint?: string
  }
  configurationMode: 'required' | 'advanced'
  status: 'resolved' | 'unresolved'
  fieldModes: {
    host?: 'required' | 'advanced'
    port?: 'required' | 'advanced'
    username?: 'required' | 'advanced'
    credential?: 'required' | 'advanced'
    hostKey?: 'required' | 'advanced'
  }
}

export interface InputBindingProjectionV1 {
  required: InputVariableProjectionV1[]
  advanced: InputVariableProjectionV1[]
  runtime: Array<{ name: string; type: string; source: string }>
  basicConnections: InputConnectionProjectionV1[]
  advancedConnections: InputConnectionProjectionV1[]
  diagnostics: Array<{ code: string; name?: string }>
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

export function projectInputBindingsV1(contractValue: unknown, bindings: InputBindingsV1): InputBindingProjectionV1 {
  const contract = readRecord(contractValue) ?? {}
  const required: InputVariableProjectionV1[] = []
  const advanced: InputVariableProjectionV1[] = []
  const runtime: InputBindingProjectionV1['runtime'] = []
  const diagnostics: InputBindingProjectionV1['diagnostics'] = []

  for (const [name, rawDefinition] of Object.entries(readRecord(contract.variables) ?? {})) {
    const definition = readRecord(rawDefinition)
    if (!definition) continue
    const mode = readMode(definition.configurationMode)
    const source = readRecord(definition.source) ?? {}
    const sourceKind = String(source.kind ?? '')
    if (mode === 'runtime') {
      runtime.push({ name, type: String(definition.type ?? 'string'), source: sourceKind })
      continue
    }
    if (definition.bindingPolicy === 'fixed') continue
    const value = ownValue(bindings.variables, name) ?? definition.default
    const item: InputVariableProjectionV1 = {
      name,
      type: String(definition.type ?? 'string'),
      configurationMode: mode,
      value: definition.sensitive ? undefined : value,
      status: value === undefined || value === '' ? 'unresolved' : 'resolved',
      source: { kind: sourceKind, ...(typeof source.path === 'string' ? { path: source.path } : {}) },
      bindingPolicy: typeof definition.bindingPolicy === 'string' ? definition.bindingPolicy : undefined,
      sensitive: Boolean(definition.sensitive),
      editable: true,
    }
    ;(mode === 'required' ? required : advanced).push(item)
    if (item.status === 'unresolved' && mode === 'required') diagnostics.push({ code: 'DEPLOYMENT_INPUT_REQUIRED', name })
  }

  for (const [name, rawDefinition] of Object.entries(readRecord(contract.credentials) ?? {})) {
    const definition = readRecord(rawDefinition)
    if (!definition || definition.configurationMode === 'runtime') continue
    const mode = readFieldMode(definition.configurationMode) ?? 'advanced'
    const credentialId = bindings.credentials[name]?.credentialId
    const item: InputVariableProjectionV1 = {
      name,
      type: 'credential',
      configurationMode: mode,
      value: undefined,
      status: credentialId ? 'resolved' : 'unresolved',
      source: { kind: 'binding' },
      bindingPolicy: 'required_binding',
      sensitive: true,
      editable: true,
    }
    ;(mode === 'required' ? required : advanced).push(item)
    if (item.status === 'unresolved' && mode === 'required') diagnostics.push({ code: 'DEPLOYMENT_INPUT_REQUIRED', name })
  }

  const basicConnections: InputConnectionProjectionV1[] = []
  const advancedConnections: InputConnectionProjectionV1[] = []
  for (const [name, rawDefinition] of Object.entries(readRecord(contract.connections) ?? {})) {
    const definition = readRecord(rawDefinition)
    if (!definition || !hasEditableConnectionField(definition)) continue
    const binding = bindings.connections[name] ?? {}
    const credentialSlot = typeof definition.credentialSlot === 'string' ? definition.credentialSlot : undefined
    const fieldModes = {
      host: editableFieldMode(definition.host),
      port: editableFieldMode(definition.port),
      username: editableFieldMode(definition.username),
      credential: credentialSlot && readRecord(contract.credentials)?.[credentialSlot] ? readFieldMode(readRecord(readRecord(contract.credentials)?.[credentialSlot])?.configurationMode) : undefined,
      hostKey: editableFieldMode(readRecord(definition.hostKey)?.expectedFingerprint),
    }
    const requiredConnection = Object.values(fieldModes).includes('required')
    const credentialId = credentialSlot ? bindings.credentials[credentialSlot]?.credentialId : undefined
    const requiresHost = fieldModes.host === 'required'
    const requiresPort = fieldModes.port === 'required'
    const requiresUsername = fieldModes.username === 'required'
    const requiresCredential = fieldModes.credential === 'required'
    const resolved = (!requiresHost || Boolean(binding.host))
      && (!requiresPort || binding.port !== undefined)
      && (!requiresUsername || Boolean(binding.username))
      && (!requiresCredential || Boolean(credentialId))
    const item: InputConnectionProjectionV1 = {
      name,
      protocol: String(definition.transport ?? ''),
      host: binding.host ?? fieldDefault(definition.host) as string | undefined,
      port: binding.port ?? fieldDefault(definition.port) as number | undefined,
      username: binding.username ?? fieldDefault(definition.username) as string | undefined,
      credentialSlot,
      hostKey: binding.hostKey ?? { expectedFingerprint: fieldDefault(readRecord(definition.hostKey)?.expectedFingerprint) as string | undefined },
      configurationMode: requiredConnection ? 'required' : 'advanced',
      status: resolved ? 'resolved' : 'unresolved',
      fieldModes,
    }
    ;(requiredConnection ? basicConnections : advancedConnections).push(item)
    if (!resolved) diagnostics.push({ code: 'DEPLOYMENT_CONNECTION_REQUIRED', name })
  }

  return { required, advanced, runtime, basicConnections, advancedConnections, diagnostics }
}

function hasEditableConnectionField(definition: Record<string, unknown>): boolean {
  return [definition.host, definition.port, definition.username, readRecord(definition.hostKey)?.expectedFingerprint]
    .some((field) => editableFieldMode(field) !== undefined)
    || typeof definition.credentialSlot === 'string'
}

function editableFieldMode(value: unknown): 'required' | 'advanced' | undefined {
  const field = readRecord(value)
  if (!field || field.bindingPolicy === 'fixed') return undefined
  return readFieldMode(field.configurationMode)
}

function fieldDefault(value: unknown): unknown {
  return readRecord(value)?.default
}

function readMode(value: unknown): 'required' | 'advanced' | 'runtime' {
  return value === 'runtime' ? 'runtime' : value === 'required' ? 'required' : 'advanced'
}

function readFieldMode(value: unknown): 'required' | 'advanced' | undefined {
  return value === 'required' || value === 'advanced' ? value : undefined
}

function ownValue(input: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
