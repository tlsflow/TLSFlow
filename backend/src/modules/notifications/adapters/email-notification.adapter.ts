import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { AppError } from '../../../common/errors/app-error.js';
import { NotificationsDomainService } from '../domain/notifications.domain-service.js';
import type { NotificationChannelAdapter, NotificationSendInput, NotificationSendResult } from '../application/channel-adapter-registry.js';
import type { NotificationChannel } from '../schema/notifications.schema.js';

export class EmailNotificationAdapter implements NotificationChannelAdapter {
  readonly type = 'email' as const;
  constructor(private readonly domain = new NotificationsDomainService()) {}

  async validateConfig(channel: NotificationChannel): Promise<void> {
    const host = String(channel.config.host ?? '');
    const port = Number(channel.config.port ?? 0);
    const from = String(channel.config.from ?? '');
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Email 渠道缺少有效的 host、port 或 from');
    }
    this.domain.assertSafeEmailHeader(from, 'from');
    if (channel.secretRefs.username && !channel.secretRefs.password) {
      throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Email 认证必须同时配置密码 SecretRef');
    }
  }

  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const recipients = readRecipients(input.delivery.targetSnapshot);
    const from = String(input.channel.config.from);
    const subject = input.delivery.renderedTitle ?? '';
    this.domain.assertSafeEmailHeader(from, 'from');
    this.domain.assertSafeEmailHeader(subject, 'subject');
    recipients.forEach((recipient) => this.domain.assertSafeEmailHeader(recipient, 'to'));
    const session = new SmtpSession({
      host: String(input.channel.config.host),
      port: Number(input.channel.config.port),
      secure: input.channel.config.secure === true,
      startTls: input.channel.config.startTls === true,
      rejectUnauthorized: input.channel.config.rejectUnauthorized !== false,
      connectTimeoutMs: Number(input.channel.config.connectTimeoutMs ?? 5000),
      responseTimeoutMs: Number(input.channel.config.responseTimeoutMs ?? 10000),
    });
    try {
      await session.connect();
      await session.command(`EHLO gcac.local`, [250]);
      if (input.channel.config.startTls === true) {
        await session.command('STARTTLS', [220]);
        await session.upgradeTls();
        await session.command('EHLO gcac.local', [250]);
      }
      if (input.secrets.username) await session.authLogin(input.secrets.username, requiredSecret(input, 'password'));
      await session.command(`MAIL FROM:<${from}>`, [250]);
      for (const recipient of recipients) await session.command(`RCPT TO:<${recipient}>`, [250, 251]);
      await session.command('DATA', [354]);
      const message = buildMessage(from, recipients, subject, input.delivery.renderedBody ?? '');
      await session.command(`${message}\r\n.`, [250]);
      await session.command('QUIT', [221]);
      return { success: true, retryable: false, responseSummary: { acceptedRecipients: recipients.length } };
    } catch (error) {
      const code = error instanceof SmtpError ? error.statusCode : undefined;
      return {
        success: false,
        retryable: code === undefined || code >= 400 && code < 500,
        statusCode: code,
        failureCategory: code === 535 ? 'authentication' : code && code >= 500 ? 'rejected' : 'network',
        failureMessage: error instanceof Error ? error.message.slice(0, 300) : 'SMTP 发送失败',
      };
    } finally {
      session.close();
    }
  }
}

interface SmtpOptions {
  host: string; port: number; secure: boolean; startTls: boolean; rejectUnauthorized: boolean; connectTimeoutMs: number; responseTimeoutMs: number;
}

class SmtpSession {
  private socket?: net.Socket | tls.TLSSocket;
  private buffer = '';
  constructor(private readonly options: SmtpOptions) {}

  async connect(): Promise<void> {
    this.socket = this.options.secure
      ? tls.connect({ host: this.options.host, port: this.options.port, servername: this.options.host, rejectUnauthorized: this.options.rejectUnauthorized })
      : net.connect({ host: this.options.host, port: this.options.port });
    this.socket.setTimeout(this.options.responseTimeoutMs, () => this.socket?.destroy(Object.assign(new Error('SMTP 响应超时'), { code: 'ETIMEDOUT' })));
    const timer = setTimeout(() => this.socket?.destroy(Object.assign(new Error('SMTP 连接超时'), { code: 'ETIMEDOUT' })), this.options.connectTimeoutMs);
    await once(this.socket, this.options.secure ? 'secureConnect' : 'connect');
    clearTimeout(timer);
    await this.readResponse([220]);
  }

  async upgradeTls(): Promise<void> {
    if (!this.socket) throw new Error('SMTP 未连接');
    this.socket.removeAllListeners('data');
    this.socket = tls.connect({ socket: this.socket, servername: this.options.host, rejectUnauthorized: this.options.rejectUnauthorized });
    await once(this.socket, 'secureConnect');
  }

  async authLogin(username: string, password: string): Promise<void> {
    await this.command('AUTH LOGIN', [334]);
    await this.command(Buffer.from(username).toString('base64'), [334]);
    await this.command(Buffer.from(password).toString('base64'), [235]);
  }

  async command(command: string, expected: number[]): Promise<void> {
    if (!this.socket) throw new Error('SMTP 未连接');
    this.socket.write(`${command}\r\n`);
    await this.readResponse(expected);
  }

  close(): void { this.socket?.destroy(); }

  private async readResponse(expected: number[]): Promise<void> {
    const line = await this.readFinalLine();
    const statusCode = Number(line.slice(0, 3));
    if (!expected.includes(statusCode)) throw new SmtpError(statusCode, line.slice(4));
  }

  private readFinalLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('SMTP 未连接'));
      const consume = () => {
        const lines = this.buffer.split('\r\n');
        this.buffer = lines.pop() ?? '';
        const final = [...lines].reverse().find((line: string) => /^\d{3} /.test(line));
        if (final) { cleanup(); resolve(final); }
      };
      const onData = (chunk: Buffer) => { this.buffer += chunk.toString('utf8'); consume(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => { this.socket?.off('data', onData); this.socket?.off('error', onError); };
      this.socket.on('data', onData);
      this.socket.on('error', onError);
      consume();
    });
  }
}

class SmtpError extends Error { constructor(readonly statusCode: number, message: string) { super(`SMTP ${statusCode}: ${message}`); } }

function readRecipients(target: Record<string, unknown>): string[] {
  const value = target.to ?? target.recipients;
  const recipients = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' ? [value] : [];
  if (!recipients.length) throw new AppError('NOTIFICATION_CHANNEL_INVALID', 'Email 投递缺少收件人');
  return recipients;
}
function requiredSecret(input: NotificationSendInput, key: string): string {
  const value = input.secrets[key];
  if (!value) throw new AppError('NOTIFICATION_CHANNEL_INVALID', '通知渠道 Secret 未配置', { key });
  return value;
}
function buildMessage(from: string, recipients: string[], subject: string, body: string): string {
  const safeBody = body.replace(/^\./gm, '..');
  return [`From: ${from}`, `To: ${recipients.join(', ')}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', safeBody].join('\r\n');
}
