export const DEPLOYMENT_INPUT_CONTRACT_API_VERSION = 'gcac.deployment-input/v1' as const;

export type DeploymentVariableType = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'file';
export type DeploymentConfigurationMode = 'required' | 'advanced' | 'runtime';
export type DeploymentInputLifecycle = 'pre_execution' | 'runtime_injected' | 'step_output';
export type DeploymentBindingPolicy = 'fixed' | 'default_overridable' | 'required_binding';
export type DeploymentCredentialKind = 'USERNAME_PASSWORD' | 'SSH_KEY' | 'BEARER_TOKEN' | 'API_KEY' | 'CLIENT_CERTIFICATE' | 'BROWSER_SESSION';
export type DeploymentConnectionTransport = 'http' | 'ssh';
export type DeploymentHttpProtocol = 'http' | 'https';
export type DeploymentArtifactKind = 'certificate' | 'file';

export type DeploymentVariableSourceV1 =
  | { kind: 'asset'; path: string }
  | { kind: 'binding' }
  | { kind: 'default' }
  | { kind: 'derived'; resolver: string }
  | { kind: 'system'; key: string }
  | { kind: 'step_output'; step: string; output: string };

export interface DeploymentInputUiDefinitionV1 {
  labelKey?: string;
  group?: string;
  order?: number;
  helpKey?: string;
}

export interface DeploymentVariableDefinitionV1 {
  type: DeploymentVariableType;
  required: boolean;
  configurationMode: DeploymentConfigurationMode;
  source: DeploymentVariableSourceV1;
  lifecycle: DeploymentInputLifecycle;
  bindingPolicy: DeploymentBindingPolicy;
  default?: unknown;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  sensitive?: boolean;
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentConnectionFieldV1 {
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  configurationMode: DeploymentConfigurationMode;
  source: Exclude<DeploymentVariableSourceV1, { kind: 'step_output' }>;
  lifecycle: Exclude<DeploymentInputLifecycle, 'step_output'>;
  bindingPolicy: DeploymentBindingPolicy;
  default?: string | number | boolean;
  sensitive?: boolean;
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentConnectionDefinitionV1 {
  transport: DeploymentConnectionTransport;
  /** HTTP Connection 允许工作流 URL 使用的协议；未声明时由 Schema 归一化为 https。 */
  allowedProtocols?: DeploymentHttpProtocol[];
  host: DeploymentConnectionFieldV1;
  port: DeploymentConnectionFieldV1;
  username?: DeploymentConnectionFieldV1;
  credentialSlot?: string;
  tls?: {
    enabled?: DeploymentConnectionFieldV1;
    verifyPeer: DeploymentConnectionFieldV1;
    serverName?: DeploymentConnectionFieldV1;
  };
  hostKey?: {
    policy: 'strict' | 'trust_on_first_use' | 'manual_approval_required';
    expectedFingerprint?: DeploymentConnectionFieldV1;
  };
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentCredentialSlotV1 {
  allowedKinds: DeploymentCredentialKind[];
  required: boolean;
  configurationMode: Exclude<DeploymentConfigurationMode, 'runtime'>;
  lifecycle: Exclude<DeploymentInputLifecycle, 'step_output'>;
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentArtifactOutputDefinitionV1 {
  role: string;
  required: boolean;
  format?: string;
  encoding?: string;
  sensitive?: boolean;
  descriptionKey?: string;
}

export interface DeploymentArtifactContractV1 {
  outputs: Record<string, DeploymentArtifactOutputDefinitionV1>;
}

export interface DeploymentArtifactSlotV1 {
  kind: DeploymentArtifactKind;
  required: boolean;
  configurationMode: Exclude<DeploymentConfigurationMode, 'runtime'>;
  lifecycle: Exclude<DeploymentInputLifecycle, 'step_output'>;
  artifactContract: DeploymentArtifactContractV1;
  descriptionKey?: string;
  ui?: DeploymentInputUiDefinitionV1;
}

export interface DeploymentInputContractV1 {
  apiVersion: typeof DEPLOYMENT_INPUT_CONTRACT_API_VERSION;
  variables: Record<string, DeploymentVariableDefinitionV1>;
  connections: Record<string, DeploymentConnectionDefinitionV1>;
  credentials: Record<string, DeploymentCredentialSlotV1>;
  artifacts: Record<string, DeploymentArtifactSlotV1>;
}
