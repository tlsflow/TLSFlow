import { Client, type ConnectConfig } from 'ssh2';
import { AppError } from '../../../common/errors/app-error.js';
import { HostKeyVerifier, sha256Fingerprint } from './ssh.known-hosts.js';
import { resolveSshCredential } from './ssh.secret-resolver.js';
import type { SSHConnectionProfile, SshConnectionConfig, SshHostKeyDecision, SshSecretResolver, SshSecretResolverContext } from './ssh.types.js';

export interface SshSession {
  client: Client;
  config: SshConnectionConfig;
  hostKeyDecision: SshHostKeyDecision;
  sensitiveValues: string[];
  close(): void;
}

export interface SshConnectionManagerOptions {
  secretResolver?: SshSecretResolver;
  hostKeyVerifier?: HostKeyVerifier;
}

export class SshConnectionManager {
  private readonly hostKeyVerifier: HostKeyVerifier;

  constructor(private readonly options: SshConnectionManagerOptions = {}) {
    this.hostKeyVerifier = options.hostKeyVerifier ?? new HostKeyVerifier();
  }

  async connect(connection: SSHConnectionProfile, context: SshSecretResolverContext = {}): Promise<SshSession> {
    if (!this.options.secretResolver) {
      throw new AppError('VALIDATION_FAILED', '真实 SSH 执行必须配置 SecretResolver', {
        sshErrorCode: 'SSH_SECRET_RESOLVE_FAILED',
        stage: 'secret',
        target: targetOf(connection),
      });
    }

    const credential = await resolveSshCredential(connection, this.options.secretResolver, context).catch((error: unknown) => {
      throw new AppError('VALIDATION_FAILED', 'SSH 凭据解析失败', {
        sshErrorCode: 'SSH_SECRET_RESOLVE_FAILED',
        stage: 'secret',
        target: targetOf(connection),
        cause: error instanceof Error ? error.message : String(error),
        suggestion: '确认 SecretRef 存在、有授权，并且类型为密码或私钥',
      });
    });

    let hostKeyDecision: SshHostKeyDecision | undefined;
    let hostKeyVerificationError: unknown;
    const client = new Client();
    const connectTimeoutMs = connection.connectTimeoutMs ?? 15_000;
    const config: SshConnectionConfig = { ...connection, credential };
    const sshConfig: ConnectConfig = {
      host: connection.host,
      port: connection.port ?? 22,
      username: connection.username,
      readyTimeout: connectTimeoutMs,
      keepaliveInterval: 0,
      password: credential.password,
      privateKey: credential.privateKey,
      passphrase: credential.passphrase,
      hostVerifier: (key: Buffer, verify: (result: boolean) => void) => {
        const fingerprint = sha256Fingerprint(key);
        this.hostKeyVerifier.verify(connection, { algorithm: 'unknown', fingerprint, rawKey: key })
          .then((result) => {
            hostKeyDecision = result.decision;
            verify(true);
          })
          .catch((error: unknown) => {
            hostKeyVerificationError = error;
            verify(false);
          });
      },
    };

    return await new Promise<SshSession>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
      };

      const timer = setTimeout(() => {
        client.end();
        finish(() => reject(sshAppError('SSH_CONNECT_FAILED', 'connect', connection, `SSH 连接超时：${connectTimeoutMs}ms`, '检查网络、端口、防火墙和目标 sshd 状态')));
      }, connectTimeoutMs + 1_000);

      client.once('ready', () => {
        clearTimeout(timer);
        finish(() => resolve({
          client,
          config,
          hostKeyDecision: hostKeyDecision ?? 'verified',
          sensitiveValues: [credential.password, credential.privateKey, credential.passphrase].filter((item): item is string => Boolean(item)),
          close: () => client.end(),
        }));
      });

      client.once('error', (error: Error & { level?: string }) => {
        clearTimeout(timer);
        client.end();
        if (hostKeyVerificationError instanceof AppError) {
          finish(() => reject(hostKeyVerificationError));
          return;
        }
        const isAuth = /auth/i.test(error.level ?? '') || /authentication|auth/i.test(error.message);
        finish(() => reject(sshAppError(isAuth ? 'SSH_AUTH_FAILED' : 'SSH_CONNECT_FAILED', isAuth ? 'auth' : 'connect', connection, error.message, isAuth ? '检查用户名、密码、私钥和私钥口令' : '检查网络、端口、防火墙和 SSH 服务端配置')));
      });

      client.connect(sshConfig);
    });
  }
}

function sshAppError(code: string, stage: 'connect' | 'auth', connection: SSHConnectionProfile, cause: string, suggestion: string): AppError {
  return new AppError(code === 'SSH_AUTH_FAILED' ? 'AUTH_FORBIDDEN' : 'EXECUTION_TARGET_UNAVAILABLE', code === 'SSH_AUTH_FAILED' ? 'SSH 认证失败' : 'SSH 连接失败', {
    sshErrorCode: code,
    stage,
    target: targetOf(connection),
    category: code === 'SSH_AUTH_FAILED' ? 'authentication' : 'network',
    cause,
    suggestion,
  });
}

function targetOf(connection: SSHConnectionProfile): string {
  return `${connection.host}:${connection.port ?? 22}`;
}
