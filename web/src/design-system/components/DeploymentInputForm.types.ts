export interface DeploymentInputSourceV1 {
  kind: 'asset' | 'binding' | 'default' | 'derived' | 'system' | 'step_output'
  path?: string
  resolver?: string
  key?: string
  step?: string
  output?: string
}

export interface DeploymentInputUiV1 {
  labelKey?: string
  group?: string
  order?: number
  helpKey?: string
}

export interface DeploymentInputFieldProjectionV1 {
  slot: string
  type: string
  required: boolean
  configurationMode: 'required' | 'advanced' | 'runtime'
  bindingPolicy: 'fixed' | 'default_overridable' | 'required_binding'
  source: DeploymentInputSourceV1
  default?: unknown
  enum?: unknown[]
  sensitive?: boolean
  descriptionKey?: string
  ui?: DeploymentInputUiV1
  value?: unknown
}

export interface DeploymentConnectionProjectionV1 {
  slot: string
  transport: 'http' | 'ssh'
  credentialSlot?: string
  fields: Record<string, DeploymentInputFieldProjectionV1>
  descriptionKey?: string
  ui?: DeploymentInputUiV1
}

export interface DeploymentCredentialProjectionV1 {
  slot: string
  allowedKinds: string[]
  required: boolean
  configurationMode: 'required' | 'advanced'
  selectedCredentialId?: string
  descriptionKey?: string
  ui?: DeploymentInputUiV1
}

export interface DeploymentArtifactProjectionV1 {
  slot: string
  kind: 'certificate' | 'file'
  required: boolean
  configurationMode: 'required' | 'advanced'
  outputs: Record<string, {
    role: string
    required: boolean
    format?: string
    encoding?: string
    sensitive?: boolean
    descriptionKey?: string
  }>
  binding?: {
    certificateFormatId?: string
    outputBindings: Record<string, string>
  }
  descriptionKey?: string
  ui?: DeploymentInputUiV1
}

export interface DeploymentInputIssueV1 {
  category: string
  code: string
  severity: 'ERROR' | 'WARNING'
  slot?: string
  path?: string
  bindingLayer?: string
  messageKey: string
  params?: Record<string, string | number>
}

export interface DeploymentInputProjectionV1 {
  contractVersion: string
  requiredVariables: DeploymentInputFieldProjectionV1[]
  advancedVariables: DeploymentInputFieldProjectionV1[]
  connections: DeploymentConnectionProjectionV1[]
  credentials: DeploymentCredentialProjectionV1[]
  artifacts: DeploymentArtifactProjectionV1[]
  fixedValues: Array<{ slot: string; value: unknown; source: DeploymentInputSourceV1 }>
  runtimeValues: Array<{ slot: string; source: DeploymentInputSourceV1; lifecycle: 'runtime_injected' | 'step_output' }>
  issues: DeploymentInputIssueV1[]
  saveable: boolean
}

export interface DeploymentInputBindingsV1 {
  apiVersion: 'gcac.input-bindings/v1'
  variables: Record<string, unknown>
  connections: Record<string, DeploymentInputConnectionBindingV1>
  credentials: Record<string, { credentialId: string }>
  artifacts: Record<string, { certificateFormatId?: string; outputBindings: Record<string, string> }>
}

export interface DeploymentInputConnectionBindingV1 {
  host?: string
  port?: number
  username?: string
  tls?: { verifyPeer?: boolean; serverName?: string }
  hostKey?: { expectedFingerprint?: string }
}

export interface DeploymentCredentialOption {
  id: string
  label: string
  kind?: string
}

export interface DeploymentArtifactOption {
  id: string
  label: string
  outputs: Array<{ key: string; label: string }>
}
