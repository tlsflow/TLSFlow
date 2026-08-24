export type SshHostKeyPolicy = 'strict' | 'trust_on_first_use' | 'manual_approval' | 'manual_approval_required';

export type SshHostKeyDecision = 'verified' | 'trust_on_first_use' | 'manual_approval_required';

export type SshPlatform = 'LINUX' | 'WINDOWS_OPENSSH' | 'UNKNOWN';

export type SshCredentialKind = 'password' | 'private_key';

export type SshStructuredErrorCode =
  | 'SSH_CONNECT_FAILED'
  | 'SSH_AUTH_FAILED'
  | 'HOST_KEY_MISMATCH'
  | 'HOST_KEY_UNKNOWN'
  | 'HOST_KEY_APPROVAL_REQUIRED'
  | 'COMMAND_TIMEOUT'
  | 'SSH_COMMAND_FAILED'
  | 'SSH_SECRET_RESOLVE_FAILED'
  | 'SSH_VALIDATION_FAILED';

export interface SSHConnectionProfile {
  host: string;
  port?: number;
  username: string;
  credentialSecretRef: string;
  privateKeyPassphraseSecretRef?: string;
  expectedHostKeyFingerprint?: string;
  observedHostKeyFingerprint?: string;
  hostKeyPolicy?: SshHostKeyPolicy;
  platform?: SshPlatform;
  connectTimeoutMs?: number;
  hostId?: string;
}

export interface ResolvedSshCredential {
  kind: SshCredentialKind;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  secretRefs: string[];
}

export interface SshSecretResolverContext {
  runId?: string;
  stepId?: string;
  actorId?: string;
  tenantId?: string;
}

export interface SshSecretResolver {
  resolveSecret(secretRef: string, purpose: string, context?: SshSecretResolverContext): Promise<string>;
}

export interface SshConnectionConfig extends SSHConnectionProfile {
  credential: ResolvedSshCredential;
}

export interface SshHostKeyInfo {
  algorithm: string;
  fingerprint: string;
  rawKey?: Buffer;
}

export interface KnownHostRecord {
  id: string;
  hostId?: string;
  address: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  status: 'trusted' | 'pending' | 'revoked' | 'mismatch';
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SshCommandRequest {
  command?: string;
  commands?: string[];
  script?: string;
  workingDirectory?: string;
  environment?: Record<string, string>;
  timeoutMs: number;
  successExitCodes?: number[];
  sensitiveValues?: string[];
}

export interface SshCommandResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  sanitizedCommand: string;
  errorCode?: SshStructuredErrorCode;
  errorMessage?: string;
}

export interface SshCommandBatchResult extends SshCommandResult {
  commandResults?: SshCommandResult[];
}

export interface SshStructuredFailureDetail {
  code: SshStructuredErrorCode;
  stage: 'validation' | 'secret' | 'connect' | 'host_key' | 'auth' | 'command';
  target?: string;
  category: string;
  suggestion: string;
  cause?: string;
}

export class SshOperationError extends Error {
  readonly detail: SshStructuredFailureDetail;

  constructor(detail: SshStructuredFailureDetail, message?: string) {
    super(message ?? detail.cause ?? detail.code);
    this.name = 'SshOperationError';
    this.detail = detail;
  }
}
