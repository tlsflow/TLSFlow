export const INPUT_BINDINGS_API_VERSION = 'gcac.input-bindings/v1' as const;

export interface DeploymentConnectionBindingV1 {
  host?: string;
  port?: number;
  username?: string;
  tls?: {
    verifyPeer?: boolean;
    serverName?: string;
  };
  hostKey?: {
    expectedFingerprint?: string;
  };
}

export interface DeploymentCredentialBindingV1 {
  credentialId: string;
}

export interface DeploymentArtifactBindingV1 {
  certificateFormatId?: string;
  outputBindings: Record<string, string>;
}

export interface InputBindingsV1 {
  apiVersion: typeof INPUT_BINDINGS_API_VERSION;
  variables: Record<string, unknown>;
  connections: Record<string, DeploymentConnectionBindingV1>;
  credentials: Record<string, DeploymentCredentialBindingV1>;
  artifacts: Record<string, DeploymentArtifactBindingV1>;
}

export function emptyInputBindingsV1(): InputBindingsV1 {
  return {
    apiVersion: INPUT_BINDINGS_API_VERSION,
    variables: {},
    connections: {},
    credentials: {},
    artifacts: {},
  };
}
