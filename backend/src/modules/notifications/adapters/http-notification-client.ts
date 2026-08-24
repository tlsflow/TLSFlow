import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { AppError } from '../../../common/errors/app-error.js';
import { WebhookTargetPolicy } from '../security/webhook-target-policy.js';

export interface SafeHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body: string;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  trustedPrivateOrigins?: string[];
}

export interface SafeHttpResponse {
  statusCode: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

export interface HttpNotificationClientPort {
  request(input: SafeHttpRequest): Promise<SafeHttpResponse>;
}

export class HttpNotificationClient implements HttpNotificationClientPort {
  constructor(private readonly policy = new WebhookTargetPolicy()) {}

  async request(input: SafeHttpRequest): Promise<SafeHttpResponse> {
    return this.requestRedirect(input, 0);
  }

  private async requestRedirect(input: SafeHttpRequest, redirects: number): Promise<SafeHttpResponse> {
    const validated = await this.policy.validateUrl(input.url, { trustedPrivateOrigins: input.trustedPrivateOrigins });
    const response = await this.requestOnce(input, validated.url, validated.addresses, validated.allowPrivateNetwork);
    const location = response.headers.location;
    if (location && [301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (redirects >= (input.maxRedirects ?? 2)) throw new AppError('NOTIFICATION_SECURITY_BLOCKED', 'Webhook 重定向次数超限');
      const target = new URL(location, validated.url);
      this.policy.assertRedirect(validated.url, target);
      return this.requestRedirect({ ...input, url: target.toString() }, redirects + 1);
    }
    return response;
  }

  private requestOnce(input: SafeHttpRequest, url: URL, expectedAddresses: string[], allowPrivateNetwork: boolean): Promise<SafeHttpResponse> {
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const lookup: LookupFunction = (hostname, options, callback) => {
        dnsLookup(hostname, { all: false }, (error, address, family) => {
          if (error) return callback(error, address, family);
          if (typeof address !== 'string') return callback(new Error('DNS 返回了非预期结果'), '', 4);
          try {
            this.policy.assertResolvedAddress(address, expectedAddresses, allowPrivateNetwork);
            callback(null, address, family);
          } catch (policyError) {
            callback(policyError as Error, address, family);
          }
        });
      };
      const request = transport.request(url, {
        method: input.method ?? 'POST',
        headers: input.headers,
        lookup,
        servername: url.hostname,
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > (input.maxResponseBytes ?? 64 * 1024)) {
            request.destroy(new AppError('NOTIFICATION_DELIVERY_REJECTED', '外部响应体超过允许大小'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: response.headers,
        }));
      });
      request.setTimeout(input.responseTimeoutMs ?? 10_000, () => request.destroy(Object.assign(new Error('响应超时'), { code: 'ETIMEDOUT' })));
      request.on('socket', (socket) => socket.setTimeout(input.connectTimeoutMs ?? 5_000));
      request.on('error', reject);
      request.end(input.body);
    });
  }
}
