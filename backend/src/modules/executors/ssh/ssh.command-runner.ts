import type { ClientChannel } from 'ssh2';
import { AppError } from '../../../common/errors/app-error.js';
import { redactSshText } from './ssh.redaction.js';
import type { SshCommandBatchResult, SshCommandRequest, SshCommandResult } from './ssh.types.js';
import type { SshSession } from './ssh.connection-manager.js';

export class SshCommandRunner {
  async run(session: SshSession, request: SshCommandRequest): Promise<SshCommandBatchResult> {
    if (request.commands?.length) return this.runBatch(session, request);
    return this.runSingle(session, request);
  }

  private async runBatch(session: SshSession, request: SshCommandRequest): Promise<SshCommandBatchResult> {
    const startedAt = new Date();
    const results: SshCommandResult[] = [];
    for (const command of request.commands ?? []) {
      const result = await this.runSingle(session, { ...request, command, commands: undefined, script: undefined });
      results.push(result);
      if (!result.success) break;
    }
    const endedAt = new Date();
    const last = results[results.length - 1];
    const success = results.length === (request.commands?.length ?? 0) && results.every((item) => item.success);
    return {
      success,
      exitCode: last?.exitCode ?? null,
      stdout: results.map((item) => item.stdout).filter(Boolean).join('\n'),
      stderr: results.map((item) => item.stderr).filter(Boolean).join('\n'),
      timedOut: results.some((item) => item.timedOut),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      sanitizedCommand: results.map((item) => item.sanitizedCommand).join('\n'),
      errorCode: success ? undefined : last?.errorCode ?? 'SSH_COMMAND_FAILED',
      errorMessage: success ? undefined : last?.errorMessage ?? 'SSH 命令组执行失败',
      commandResults: results,
    };
  }

  private async runSingle(session: SshSession, request: SshCommandRequest): Promise<SshCommandResult> {
    const startedAt = new Date();
    const rawCommand = buildCommand(request);
    const sensitiveValues = [...session.sensitiveValues, ...(request.sensitiveValues ?? []), ...Object.values(request.environment ?? {})];
    const sanitizedCommand = redactSshText(rawCommand, sensitiveValues);
    const timeoutMs = request.timeoutMs;
    const successExitCodes = new Set(request.successExitCodes ?? [0]);

    return await new Promise<SshCommandResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let streamRef: ClientChannel | undefined;

      const finish = (result: Omit<SshCommandResult, 'durationMs' | 'startedAt' | 'endedAt' | 'sanitizedCommand'>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const endedAt = new Date();
        resolve({
          ...result,
          stdout: redactSshText(result.stdout, sensitiveValues),
          stderr: redactSshText(result.stderr, sensitiveValues),
          durationMs: endedAt.getTime() - startedAt.getTime(),
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          sanitizedCommand,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        streamRef?.close();
        finish({
          success: false,
          exitCode: null,
          stdout,
          stderr,
          timedOut: true,
          errorCode: 'COMMAND_TIMEOUT',
          errorMessage: `SSH 命令执行超时：${timeoutMs}ms`,
        });
      }, timeoutMs);

      session.client.exec(rawCommand, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          reject(new AppError('EXECUTION_TARGET_UNAVAILABLE', 'SSH 命令启动失败', {
            sshErrorCode: 'SSH_COMMAND_FAILED',
            stage: 'command',
            target: `${session.config.host}:${session.config.port ?? 22}`,
            category: 'remote_command',
            cause: error.message,
            suggestion: '检查远端 shell、PATH、工作目录和命令权限',
          }));
          return;
        }
        streamRef = stream;
        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf8');
        });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });
        stream.on('close', (code: number | null) => {
          if (timedOut) return;
          const exitCode = typeof code === 'number' ? code : 0;
          const success = successExitCodes.has(exitCode);
          finish({
            success,
            exitCode,
            stdout,
            stderr,
            timedOut: false,
            errorCode: success ? undefined : 'SSH_COMMAND_FAILED',
            errorMessage: success ? undefined : `SSH 命令退出码非零：${exitCode}`,
          });
        });
      });
    });
  }
}

function buildCommand(request: SshCommandRequest): string {
  if (!request.command && !request.script) {
    throw new AppError('VALIDATION_FAILED', 'SSH 命令执行必须提供 command 或 script');
  }
  const body = request.command ?? request.script ?? '';
  const envPrefix = Object.entries(request.environment ?? {})
    .map(([key, value]) => `${assertEnvName(key)}=${shellQuote(value)}`)
    .join(' ');
  const cdPrefix = request.workingDirectory ? `cd ${shellQuote(request.workingDirectory)} && ` : '';
  return `${envPrefix ? `${envPrefix} ` : ''}${cdPrefix}${body}`;
}

function assertEnvName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new AppError('VALIDATION_FAILED', 'SSH 环境变量名不合法', { name });
  return name;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
