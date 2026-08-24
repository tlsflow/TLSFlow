export type SshHostKeyPolicy = 'strict' | 'trust_on_first_use' | 'manual_approval' | 'manual_approval_required';

export type SshHostKeyDecision = 'verified' | 'trust_on_first_use' | 'manual_approval_required';

export type SshPlatform = 'LINUX' | 'WINDOWS_OPENSSH' | 'UNKNOWN';

export type SshCredentialKind = 'password' | 'private_key';

/** SSH 远端程序白名单。只保留操作系统通用服务原语，不能由工作流自由指定可执行文件。 */
export const SSH_ALLOWED_PROGRAMS = ['systemctl', 'service', 'sc.exe'] as const;
export type SshAllowedProgram = typeof SSH_ALLOWED_PROGRAMS[number];

/** 参数模板白名单。模板只描述受控动作，不是可执行的 shell 文本。 */
export const SSH_ARGUMENT_TEMPLATES = {
  'systemctl.reload': { program: 'systemctl', fixedArgs: ['reload'], valueCount: 1, valueKind: 'service' },
  'systemctl.restart': { program: 'systemctl', fixedArgs: ['restart'], valueCount: 1, valueKind: 'service' },
  'service.reload': { program: 'service', fixedArgs: [], valueCount: 2, valueKind: 'serviceAction' },
  'service.restart': { program: 'service', fixedArgs: [], valueCount: 2, valueKind: 'serviceAction' },
  'sc.query': { program: 'sc.exe', fixedArgs: ['query'], valueCount: 1, valueKind: 'service' },
} as const satisfies Record<string, { program: SshAllowedProgram; fixedArgs: readonly string[]; valueCount: number; valueKind?: 'service' | 'serviceAction' }>;
export type SshArgumentTemplate = keyof typeof SSH_ARGUMENT_TEMPLATES;

/** SCP fallback 只能使用这些固定的远端程序和参数模板。模板名不是 shell 文本。 */
export const SSH_FILE_OPERATION_TEMPLATES = {
  'file.exists': { program: 'test', fixedArgs: ['-e'], valueCount: 1, valueKind: 'path' },
  'file.stat': { program: 'stat', fixedArgs: ['-c', '%s\t%a\t%U\t%G\t%Y', '--'], valueCount: 1, valueKind: 'path' },
  'scp.download': { program: 'scp', fixedArgs: ['-f', '--'], valueCount: 1, valueKind: 'path' },
  'scp.upload': { program: 'scp', fixedArgs: ['-t', '--'], valueCount: 1, valueKind: 'path' },
  'file.rename': { program: 'mv', fixedArgs: ['-f', '--'], valueCount: 2, valueKind: 'path' },
  'file.delete': { program: 'rm', fixedArgs: ['-f', '--'], valueCount: 1, valueKind: 'path' },
  'file.chmod': { program: 'chmod', fixedArgs: [], valueCount: 3, valueKind: 'metadata' },
  'file.chown': { program: 'chown', fixedArgs: [], valueCount: 3, valueKind: 'metadata' },
  'file.chgrp': { program: 'chgrp', fixedArgs: [], valueCount: 3, valueKind: 'metadata' },
} as const;
export type SshFileOperationTemplate = keyof typeof SSH_FILE_OPERATION_TEMPLATES;

export interface SshExecutionAudit {
  operation: 'command' | 'file_transfer' | 'backup' | 'rollback';
  target: string;
  idempotencyKey?: string;
  program?: string;
  argumentTemplate?: string;
  arguments: string[];
  remotePaths: string[];
  services: string[];
}

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
  program: SshAllowedProgram;
  args: string[];
  argumentTemplate: SshArgumentTemplate;
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
  /** 只记录固定程序、模板和脱敏后的参数摘要，不记录凭据。 */
  audit?: SshExecutionAudit;
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
