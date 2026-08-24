import { request as httpsRequest } from 'node:https';

export interface OutboundHttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface OutboundHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  bodyText: string;
  body: unknown;
}

export interface OutboundHttpClient {
  request(input: OutboundHttpRequest): Promise<OutboundHttpResponse>;
}

/**
 * Plugin Runner 使用的宿主通用 HTTPS 出口。
 * 该客户端不跟随重定向、不接受明文 HTTP，并在读取响应时执行字节上限。
 */
export class NodeOutboundHttpClient implements OutboundHttpClient {
  async request(input: OutboundHttpRequest): Promise<OutboundHttpResponse> {
    const url = new URL(input.url);
    if (url.protocol !== 'https:') throw new Error('Outbound HTTP 只允许 HTTPS');

    return await new Promise<OutboundHttpResponse>((resolve, reject) => {
      let settled = false;
      let responseBytes = 0;
      const chunks: Buffer[] = [];
      const finishReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const client = httpsRequest({
        protocol: 'https:',
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: input.headers,
        rejectUnauthorized: true,
      }, (response) => {
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseBytes += buffer.byteLength;
          if (responseBytes > input.maxResponseBytes) {
            finishReject(new Error('Outbound HTTP 响应超过大小上限'));
            response.destroy();
            return;
          }
          chunks.push(buffer);
        });
        response.on('error', finishReject);
        response.on('end', () => {
          if (settled) return;
          settled = true;
          const buffer = Buffer.concat(chunks);
          const bodyText = buffer.toString('utf8');
          const headers = normalizeHeaders(response.headers);
          resolve({
            statusCode: response.statusCode ?? 0,
            headers,
            bodyText,
            body: parseJsonBody(bodyText, headers['content-type']),
          });
        });
      });

      client.once('error', finishReject);
      client.setTimeout(input.timeoutMs, () => client.destroy(new Error('Outbound HTTP 请求超时')));
      if (input.body !== undefined) client.write(input.body, 'utf8');
      client.end();
    });
  }
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]),
  );
}

function parseJsonBody(bodyText: string, contentType: string | undefined): unknown {
  if (!bodyText || !contentType?.toLowerCase().includes('json')) return bodyText;
  try {
    return JSON.parse(bodyText) as unknown;
  } catch {
    return bodyText;
  }
}
