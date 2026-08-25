import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';

export interface CurlHttpClientRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  tls?: {
    verify: boolean;
    ca?: string;
    cert?: string;
    key?: string;
    servername?: string;
  };
}

export interface CurlHttpClientResponse {
  statusCode: number;
  headers?: Record<string, string>;
  /** 原始多值 Set-Cookie，禁止用逗号拼接。 */
  setCookie?: string[];
  body?: unknown;
  bodyText?: string;
  bodyJson?: unknown;
}

export interface CurlHttpClient {
  send(request: CurlHttpClientRequest): Promise<CurlHttpClientResponse>;
}

export class NodeCurlHttpClient implements CurlHttpClient {
  async send(request: CurlHttpClientRequest): Promise<CurlHttpClientResponse> {
    const url = new URL(request.url);
    const useHttps = url.protocol === 'https:';

    return await new Promise<CurlHttpClientResponse>((resolve, reject) => {
      const requestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers: request.headers,
        ...(useHttps ? {
          rejectUnauthorized: request.tls?.verify !== false,
          ca: request.tls?.ca,
          cert: request.tls?.cert,
          key: request.tls?.key,
          servername: request.tls?.servername,
          // verify=false 必须同时跳过 CA 和主机名校验；保留 servername 只用于 SNI。
          ...(request.tls?.verify !== false && request.tls?.servername ? {
            checkServerIdentity: (_host: string, cert: PeerCertificate) => checkServerIdentity(request.tls?.servername ?? '', cert),
          } : {}),
        } : {}),
      };
      const client = (useHttps ? httpsRequest : httpRequest)(requestOptions, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const bodyText = buffer.toString('utf8');
          const normalized = normalizeHeaders(response.headers);
          const headers = normalized.headers;
          const contentType = headers['content-type'] ?? '';
          const bodyJson = contentType.includes('json') ? tryParseJson(bodyText) : undefined;
          resolve({
            statusCode: response.statusCode ?? 0,
            headers,
            ...(normalized.setCookie.length > 0 ? { setCookie: normalized.setCookie } : {}),
            bodyText,
            bodyJson,
            body: bodyJson ?? bodyText,
          });
        });
      });

      client.once('error', reject);
      client.setTimeout(request.timeoutMs, () => {
        client.destroy(new Error(`HTTP request timed out after ${request.timeoutMs}ms`));
      });

      if (request.body && request.body.byteLength > 0) client.write(request.body);
      client.end();
    });
  }
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): { headers: Record<string, string>; setCookie: string[] } {
  const rawSetCookie = Object.entries(headers).find(([key]) => key.toLowerCase() === 'set-cookie')?.[1];
  const setCookie = Array.isArray(rawSetCookie) ? [...rawSetCookie] : rawSetCookie ? [rawSetCookie] : [];
  return {
    headers: Object.fromEntries(
      Object.entries(headers)
        .filter(([key]) => key.toLowerCase() !== 'set-cookie')
        .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
        .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]),
    ),
    setCookie,
  };
}

function tryParseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
