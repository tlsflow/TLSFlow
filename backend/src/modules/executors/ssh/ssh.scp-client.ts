import { basename } from 'node:path';
import type { ClientChannel } from 'ssh2';
import { AppError } from '../../../common/errors/app-error.js';
import { normalizeRemotePath, type RemoteFileClient, type RemoteFileMetadata, type FileTransferProtocol } from './ssh.file-transfer.js';
import { buildSafeFileInvocation } from './ssh.command-runner.js';
import type { SshSession } from './ssh.connection-manager.js';

export class SshScpRemoteFileClient implements RemoteFileClient {
  constructor(private readonly session: SshSession) {}

  async exists(remotePath: string): Promise<boolean> {
    remotePath = normalizeRemotePath(remotePath);
    const result = await runFixedOperation(this.session, 'file.exists', [remotePath]);
    if (result.exitCode === 0) return true;
    if (result.exitCode === 1) return false;
    throw scpError('SCP 文件存在性检查失败', 'exists', remotePath, { stderr: result.stderr, exitCode: result.exitCode });
  }

  async stat(remotePath: string): Promise<RemoteFileMetadata> {
    remotePath = normalizeRemotePath(remotePath);
    const result = await runFixedOperation(this.session, 'file.stat', [remotePath]);
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
    remotePath = normalizeRemotePath(remotePath);
    const channel = await openExecChannel(this.session, 'scp.download', [remotePath]);
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
    remotePath = normalizeRemotePath(remotePath);
    const channel = await openExecChannel(this.session, 'scp.upload', [remotePath]);
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
    sourcePath = normalizeRemotePath(sourcePath);
    targetPath = normalizeRemotePath(targetPath);
    await expectFixedOperation(this.session, 'file.rename', [sourcePath, targetPath], 'rename', targetPath);
  }

  async deleteFile(remotePath: string): Promise<void> {
    remotePath = normalizeRemotePath(remotePath);
    await expectFixedOperation(this.session, 'file.delete', [remotePath], 'delete', remotePath);
  }

  async chmod(remotePath: string, mode: string): Promise<void> {
    remotePath = normalizeRemotePath(remotePath);
    if (!/^[0-7]{3,4}$/.test(mode)) throw scpError('SCP chmod mode 不合法', 'chmod', remotePath, { mode });
    await expectFixedOperation(this.session, 'file.chmod', [mode, '--', remotePath], 'chmod', remotePath);
  }

  async chown(remotePath: string, owner?: string, group?: string): Promise<void> {
    remotePath = normalizeRemotePath(remotePath);
    if (owner && group) {
      assertMetadataValue(owner, 'owner', remotePath);
      assertMetadataValue(group, 'group', remotePath);
      await expectFixedOperation(this.session, 'file.chown', [`${owner}:${group}`, '--', remotePath], 'chown', remotePath);
      return;
    }
    if (owner) {
      assertMetadataValue(owner, 'owner', remotePath);
      await expectFixedOperation(this.session, 'file.chown', [owner, '--', remotePath], 'chown', remotePath);
      return;
    }
    if (group) {
      assertMetadataValue(group, 'group', remotePath);
      await expectFixedOperation(this.session, 'file.chgrp', [group, '--', remotePath], 'chown', remotePath);
    }
  }
}

interface ExecChannel {
  stream: ClientChannel;
  reader: ChannelReader;
  stderr: { text: string };
  closed: Promise<number | null>;
}

interface FixedOperationResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function openExecChannel(session: SshSession, templateName: Parameters<typeof buildSafeFileInvocation>[0], args: readonly string[]): Promise<ExecChannel> {
  const command = buildSafeFileInvocation(templateName, args);
  return await new Promise<ExecChannel>((resolve, reject) => {
    session.client.exec(command, (error, stream) => {
      if (error) {
        reject(scpError('SCP 会话启动失败', 'exec', undefined, { cause: error.message, templateName }));
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

async function runFixedOperation(session: SshSession, templateName: Parameters<typeof buildSafeFileInvocation>[0], args: readonly string[]): Promise<FixedOperationResult> {
  const channel = await openExecChannel(session, templateName, args);
  let stdout = '';
  channel.stream.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  const exitCode = await channel.closed;
  return { stdout, stderr: channel.stderr.text, exitCode };
}

async function expectFixedOperation(session: SshSession, templateName: Parameters<typeof buildSafeFileInvocation>[0], args: readonly string[], stage: string, remotePath: string): Promise<void> {
  const result = await runFixedOperation(session, templateName, args);
  if (result.exitCode !== 0) {
    throw scpError('SCP 固定文件操作失败', stage, remotePath, { stderr: result.stderr, exitCode: result.exitCode, templateName });
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

function scpError(message: string, stage: string, remotePath?: string, details: Record<string, unknown> = {}): AppError {
  return new AppError('EXECUTION_TARGET_UNAVAILABLE', message, { sshErrorCode: 'SCP_OPERATION_FAILED', stage, remotePath, ...details });
}

function assertMetadataValue(value: string, field: 'owner' | 'group', remotePath: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(value) && !/^\d+$/.test(value)) {
    throw scpError('SCP 文件属主参数不合法', 'chown', remotePath, { field });
  }
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
