import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';

const tlsInspectorPathPrefix = '/tls-inspector';
const hopByHopHeaderNames = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function isTlsInspectorProxyPath(pathname: string): boolean {
  return pathname === tlsInspectorPathPrefix || pathname.startsWith(`${tlsInspectorPathPrefix}/`);
}

export async function proxyTlsInspectorRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: string,
): Promise<void> {
  const targetUrl = new URL(target);
  const requestUrl = request.url ?? '/';
  const upstreamPath = requestUrl.replace(/^\/tls-inspector(?=\/|\?|$)/u, '') || '/';
  const requestProxy = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const upstreamRequest = requestProxy({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      method: request.method,
      path: `${targetUrl.pathname.replace(/\/$/u, '')}${upstreamPath}`,
      headers: filterHopByHopHeaders(request.headers),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, filterHopByHopHeaders(upstreamResponse.headers));
      upstreamResponse.once('error', () => {
        if (!response.writableEnded) response.destroy();
        finish();
      });
      upstreamResponse.once('end', finish);
      upstreamResponse.pipe(response);
    });

    upstreamRequest.once('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ errorCode: 'TLS_INSPECTOR_UNAVAILABLE', message: 'TLS 深度检测服务暂不可用' }));
      } else {
        response.destroy();
      }
      finish();
    });
    response.once('close', () => {
      if (!response.writableEnded) upstreamRequest.destroy();
    });
    request.pipe(upstreamRequest);
  });
}

function filterHopByHopHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const connectionHeader = headers.connection;
  const connectionSpecificHeaders = typeof connectionHeader === 'string'
    ? connectionHeader.split(',').map((item) => item.trim().toLowerCase())
    : [];
  const ignored = new Set([...hopByHopHeaderNames, ...connectionSpecificHeaders, 'host']);
  return Object.fromEntries(
    Object.entries(headers).filter(([name, value]) => value !== undefined && !ignored.has(name.toLowerCase())),
  );
}
