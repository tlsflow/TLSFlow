import { basename } from 'node:path';
import type { ClientChannel } from 'ssh2';
import { AppError } from '../../../common/errors/app-error.js';
import type { RemoteFileClient, RemoteFileMetadata, FileTransferProtocol } from './ssh.file-transfer.js';
import type { SshSession } from './ssh.connection-manager.js';

export class SshScpRemoteFileClient implements RemoteFileClient {
  constructor(private readonly session: SshSession) {}

  async exists(remotePath: string): Promise<boolean> {
    const result = await runShell(this.session, `test -e ${shellQuote(remotePath)}`);
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    throw scpError('SCP 文件存在性检查失败', 'exists', remotePath, { stderr: result.stderr, exitCode: result.exitCode });
  }

  async stat(remotePath: string): Promise<RemoteFileMetadata> {
    const result = await runShell(this.session, `LC_ALL=C stat -c '%s\t%a\t%U\t%G\t%Y' -- ${shellQuote(remotePath)}`);
    if (result.exitCode !== 0) {
      throw scpError('SCP 远端文件元数据读取失败', 'stat', remotePath, { stderr: result.stderr, exitCode: result.exitCode });
    }
    const [size, mode, owner, group, mtime] = result.stdout.trim().split('\t');
    if (!size || !mtime) {
      throw scpError('SCP 远端文件元数据格式非法', 'stat', remotePath, { stdout: result.stdout });
    }
    return {
      size: Number(size),
      mode,
      owner,
      group,
      mtime: new Date(Number(mtime) * 1000).toISOString(),
    };
  }

  async readFile(remotePath: string): Promise<Buffer> {
    const channel = await openExecChannel(this.session, `scp -f -- ${shellQuote(remotePath)}`);
    try {
      channel.stream.write(Buffer.from([0]));
      const header = await readScpHeader(channel.reader, remotePath, channel.stderr);
      channel.stream.write(Buffer.from([0]));
      const content = await channel.reader.readExactly(header.size);
      const endByte = await channel.reader.readByte();
      if (endByte !== 0) {
        throw scpProtocolError('download', remotePath, endByte, channel.stderr);
      }
      channel.stream.write(Buffer.from([0]));
      channel.stream.end();
      await channel.closed;
      return content;
    } catch (error) {
      abortChannel(channel.stream);
      throw wrapScpFailure('SCP 下载失败', 'download', remotePath, error, channel.stderr);
    }
  }

  async writeFile(remotePath: string, content: Buffer, _protocol: FileTransferProtocol): Promise<void> {
    const channel = await openExecChannel(this.session, `scp -t -- ${shellQuote(remotePath)}`);
    try {
      await readAck(channel.reader, remotePath, channel.stderr, 'upload_init');
      channel.stream.write(`C0644 ${content.byteLength} ${basename(remotePath)}\n`);
      await readAck(channel.reader, remotePath, channel.stderr, 'upload_header');
      channel.stream.write(content);
      channel.stream.write(Buffer.from([0]));
      await readAck(channel.reader, remotePath, channel.stderr, 'upload_content');
      channel.stream.end();
      await channel.closed;
    } catch (error) {
      abortChannel(channel.stream);
      throw wrapScpFailure('SCP 上传失败', 'upload', remotePath, error, channel.stderr);
    }
  }

  async rename(sourcePath: string, targetPath: string): Promise<void> {
    await expectShellOk(this.session, `mv -f -- ${shellQuote(sourcePath)} ${shellQuote(targetPath)}`, 'rename', targetPath);
  }

  async deleteFile(remotePath: string): Promise<void> {
    await expectShellOk(this.session, `rm -f -- ${shellQuote(remotePath)}`, 'delete', remotePath);
  }

  async chmod(remotePath: string, mode: string): Promise<void> {
    await expectShellOk(this.session, `chmod ${mode} -- ${shellQuote(remotePath)}`, 'chmod', remotePath);
  }

  async chown(remotePath: string, owner?: string, group?: string): Promise<void> {
    if (owner && group) {
      await expectShellOk(this.session, `chown ${shellQuote(`${owner}:${group}`)} -- ${shellQuote(remotePath)}`, 'chown', remotePath);
      return;
    }
    if (owner) {
      await expectShellOk(this.session, `chown ${shellQuote(owner)} -- ${shellQuote(remotePath)}`, 'chown', remotePath);
      return;
    }
    if (group) {
      await expectShellOk(this.session, `chgrp ${shellQuote(group)} -- ${shellQuote(remotePath)}`, 'chown', remotePath);
    }
  }
}

interface ExecChannel {
  stream: ClientChannel;
  reader: ChannelReader;
  stderr: { text: string };
  closed: Promise<number | null>;
}

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function openExecChannel(session: SshSession, command: string): Promise<ExecChannel> {
  return await new Promise<ExecChannel>((resolve, reject) => {
    session.client.exec(command, (error, stream) => {
      if (error) {
        reject(scpError('SCP 会话启动失败', 'exec', undefined, { cause: error.message, command }));
        return;
      }
      const stderr = { text: '' };
      stream.stderr.on('data', (chunk: Buffer) => {
        stderr.text += chunk.toString('utf8');
      });
      resolve({
        stream,
        reader: new ChannelReader(stream),
        stderr,
        closed: new Promise<number | null>((resolveClose, rejectClose) => {
          stream.once('close', (code: number | null) => resolveClose(code));
          stream.once('error', rejectClose);
        }),
      });
    });
  });
}

async function runShell(session: SshSession, command: string): Promise<ShellResult> {
  const channel = await openExecChannel(session, command);
  let stdout = '';
  channel.stream.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  const exitCode = await channel.closed;
  return { stdout, stderr: channel.stderr.text, exitCode };
}

async function expectShellOk(session: SshSession, command: string, stage: string, remotePath: string): Promise<void> {
  const result = await runShell(session, command);
  if (result.exitCode !== 0) {
    throw scpError('SCP shell 补偿操作失败', stage, remotePath, { stderr: result.stderr, exitCode: result.exitCode });
  }
}

async function readAck(reader: ChannelReader, remotePath: string, stderr: { text: string }, stage: string): Promise<void> {
  const byte = await reader.readByte();
  if (byte === 0) return;
  throw scpProtocolError(stage, remotePath, byte, stderr);
}

async function readScpHeader(reader: ChannelReader, remotePath: string, stderr: { text: string }): Promise<{ size: number }> {
  for (;;) {
    const lineBuffer = await reader.readUntilNewline();
    const marker = lineBuffer[0];
    if (marker === 0) continue;
    if (marker === 1 || marker === 2) {
      const reason = lineBuffer.subarray(1).toString('utf8').trim();
      throw scpError('SCP 下载被远端拒绝', 'download', remotePath, { cause: reason || stderr.text.trim() || 'remote error' });
    }
    const line = lineBuffer.toString('utf8').trimEnd();
    if (line.startsWith('T')) continue;
    const matched = /^C\d{4} (\d+) .+$/.exec(line);
    if (!matched) {
      throw scpError('SCP 下载响应格式非法', 'download', remotePath, { response: line });
    }
    return { size: Number(matched[1]) };
  }
}

function scpProtocolError(stage: string, remotePath: string, byte: number, stderr: { text: string }): AppError {
  return scpError('SCP 协议握手失败', stage, remotePath, { marker: byte, stderr: stderr.text.trim() || undefined });
}

function wrapScpFailure(message: string, stage: string, remotePath: string, error: unknown, stderr: { text: string }): AppError {
  if (error instanceof AppError) return error;
  return scpError(message, stage, remotePath, { cause: error instanceof Error ? error.message : String(error), stderr: stderr.text.trim() || undefined });
}

function abortChannel(stream: ClientChannel): void {
  try {
    stream.close();
  } catch {
    // 忽略中断时的二次错误
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function scpError(message: string, stage: string, remotePath?: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('EXECUTION_TARGET_UNAVAILABLE', message, { sshErrorCode: 'SCP_OPERATION_FAILED', stage, remotePath, ...details });
}

class ChannelReader {
  private buffer = Buffer.alloc(0);
  private ended = false;
  private readonly waiters: Array<() => void> = [];
  private error?: Error;

  constructor(stream: ClientChannel) {
    stream.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
      this.flush();
    });
    stream.on('end', () => {
      this.ended = true;
      this.flush();
    });
    stream.on('close', () => {
      this.ended = true;
      this.flush();
    });
    stream.on('error', (error: Error) => {
      this.error = error;
      this.ended = true;
      this.flush();
    });
  }

  async readByte(): Promise<number> {
    const buffer = await this.readExactly(1);
    return buffer[0] ?? 0;
  }

  async readExactly(length: number): Promise<Buffer> {
    await this.waitFor(() => this.buffer.byteLength >= length);
    if (this.buffer.byteLength < length) {
      throw new Error('unexpected EOF while reading SCP payload');
    }
    return this.take(length);
  }

  async readUntilNewline(): Promise<Buffer> {
    await this.waitFor(() => this.buffer.includes(0x0a));
    const index = this.buffer.indexOf(0x0a);
    if (index < 0) throw new Error('unexpected EOF while reading SCP header');
    return this.take(index + 1);
  }

  private async waitFor(predicate: () => boolean): Promise<void> {
    while (!predicate()) {
      if (this.error) throw this.error;
      if (this.ended) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  private take(length: number): Buffer {
    const result = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return Buffer.from(result);
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      this.waiters.shift()?.();
    }
  }
}
