import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';

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
      const client = (useHttps ? httpsRequest : httpRequest)({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        method: request.method,
        headers: request.headers,
        rejectUnauthorized: request.tls?.verify !== false,
        ca: request.tls?.ca,
        cert: request.tls?.cert,
        key: request.tls?.key,
        servername: request.tls?.servername,
        checkServerIdentity: request.tls?.servername
          ? (_host, cert) => checkServerIdentity(request.tls?.servername ?? '', cert)
          : undefined,
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const bodyText = buffer.toString('utf8');
          const headers = normalizeHeaders(response.headers);
          const contentType = headers['content-type'] ?? '';
          const bodyJson = contentType.includes('json') ? tryParseJson(bodyText) : undefined;
          resolve({
            statusCode: response.statusCode ?? 0,
            headers,
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

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]),
  );
}

function tryParseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
