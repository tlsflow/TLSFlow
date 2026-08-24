import type { ClientChannel } from 'ssh2';
import { AppError } from '../../../common/errors/app-error.js';
import { redactSshText } from './ssh.redaction.js';
import { SSH_ARGUMENT_TEMPLATES, SSH_FILE_OPERATION_TEMPLATES, type SshCommandBatchResult, type SshCommandRequest, type SshCommandResult, type SshFileOperationTemplate } from './ssh.types.js';
import type { SshSession } from './ssh.connection-manager.js';

export class SshCommandRunner {
  async run(session: SshSession, request: SshCommandRequest): Promise<SshCommandBatchResult> {
    return this.runSingle(session, request);
  }

  private async runSingle(session: SshSession, request: SshCommandRequest): Promise<SshCommandResult> {
    const startedAt = new Date();
    const rawCommand = buildSafeInvocation(request);
    const commandTemplate = SSH_ARGUMENT_TEMPLATES[request.argumentTemplate];
    const sensitiveValues = [...session.sensitiveValues, ...(request.sensitiveValues ?? [])];
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
          audit: result.audit ?? {
            operation: 'command',
            target: `${session.config.host}:${session.config.port ?? 22}`,
            program: request.program,
            argumentTemplate: request.argumentTemplate,
            arguments: request.args.map((value) => redactSshText(value, sensitiveValues)),
            remotePaths: [],
            services: 'valueKind' in commandTemplate && (commandTemplate.valueKind === 'service' || commandTemplate.valueKind === 'serviceAction')
              ? [request.args[0] ?? '']
              : [],
          },
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

export function buildSafeInvocation(request: SshCommandRequest): string {
  const template = SSH_ARGUMENT_TEMPLATES[request.argumentTemplate];
  if (!template || template.program !== request.program) {
    throw new AppError('VALIDATION_FAILED', 'SSH 程序与参数模板不匹配', { program: request.program, argumentTemplate: request.argumentTemplate });
  }
  if (request.args.length !== template.valueCount) {
    throw new AppError('VALIDATION_FAILED', 'SSH 参数数量与参数模板不匹配', { program: request.program, argumentTemplate: request.argumentTemplate });
  }
  const valueKind = 'valueKind' in template ? template.valueKind : undefined;
  for (const arg of request.args) assertSafeArgument(arg);
  if (valueKind === 'service' && !isServiceName(request.args[0]!)) {
    throw new AppError('VALIDATION_FAILED', 'SSH 服务名参数不合法');
  }
  if (valueKind === 'serviceAction') {
    const [service, action] = request.args;
    if (!isServiceName(service!) || !['reload', 'restart'].includes(action!)) {
      throw new AppError('VALIDATION_FAILED', 'SSH 服务动作参数不合法');
    }
    if (!request.argumentTemplate.endsWith(`.${action}`)) {
      throw new AppError('VALIDATION_FAILED', 'SSH 服务动作与参数模板不匹配');
    }
  }
  return buildFixedInvocation(template, request.args, assertSafeArgument);
}

export function buildSafeFileInvocation(templateName: SshFileOperationTemplate, args: readonly string[]): string {
  const template = SSH_FILE_OPERATION_TEMPLATES[templateName];
  if (!template || args.length !== template.valueCount) {
    throw new AppError('VALIDATION_FAILED', 'SSH 文件操作与固定模板不匹配', { templateName });
  }
  return buildFixedInvocation(template, args, (value) => assertSafeFileArgument(value, template.valueKind));
}

function buildFixedInvocation(template: { program: string; fixedArgs: readonly string[]; valueCount?: number }, args: readonly string[], validateArgument: (value: string) => void): string {
  if (template.valueCount !== undefined && args.length !== template.valueCount) {
    throw new AppError('VALIDATION_FAILED', 'SSH 固定模板参数数量不匹配');
  }
  for (const value of args) validateArgument(value);
  return [template.program, ...template.fixedArgs, ...args].map((value, index) => index === 0 ? value : shellQuote(value)).join(' ');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertSafeArgument(value: string): void {
  if (!value || /[\0\r\n;&|`$()<>*?{}[\]\\!]/.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'SSH 参数包含 shell 元字符或控制字符');
  }
  if (/^(?:sh|bash|dash|zsh|fish|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|python|python3|perl|ruby|node|wscript|cscript)(?:\.exe)?$/i.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'SSH 参数不得调用解释器');
  }
}

function assertSafeFileArgument(value: string, valueKind: 'path' | 'metadata'): void {
  if (!value || /[\0\r\n;&|`$()<>*?{}[\]\\!]/.test(value)) {
    throw new AppError('VALIDATION_FAILED', 'SSH 文件操作参数包含 shell 元字符或控制字符', { valueKind });
  }
}

function isServiceName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value);
}
