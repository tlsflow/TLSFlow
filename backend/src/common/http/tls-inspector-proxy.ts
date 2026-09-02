import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

interface TlsInspectorProxyOptions {
  readonly dataDir?: string;
}

type StoredRecord = Record<string, unknown>;

export function isTlsInspectorProxyPath(pathname: string): boolean {
  return pathname === tlsInspectorPathPrefix || pathname.startsWith(`${tlsInspectorPathPrefix}/`);
}

export async function proxyTlsInspectorRequest(
  request: IncomingMessage,
  response: ServerResponse,
  target: string,
  options: TlsInspectorProxyOptions = {},
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
      if (request.method === 'GET' && (upstreamResponse.statusCode ?? 0) >= 500) {
        const chunks: Buffer[] = [];
        upstreamResponse.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        upstreamResponse.once('error', () => {
          writeUnavailableResponse(response);
          finish();
        });
        upstreamResponse.once('end', () => {
          void serveStoredTlsInspectorData(response, request, upstreamPath, options.dataDir)
            .then((served) => {
              if (!served && !response.headersSent && !response.writableEnded) {
                response.writeHead(upstreamResponse.statusCode ?? 502, filterHopByHopHeaders(upstreamResponse.headers));
                response.end(Buffer.concat(chunks));
              }
              finish();
            })
            .catch(() => {
              writeUnavailableResponse(response);
              finish();
            });
        });
        return;
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, filterHopByHopHeaders(upstreamResponse.headers));
      upstreamResponse.once('error', () => {
        if (!response.writableEnded) response.destroy();
        finish();
      });
      upstreamResponse.once('end', finish);
      upstreamResponse.pipe(response);
    });

    upstreamRequest.once('error', () => {
      void serveStoredTlsInspectorData(response, request, upstreamPath, options.dataDir)
        .then((served) => {
          if (!served) writeUnavailableResponse(response);
          finish();
        })
        .catch(() => {
          writeUnavailableResponse(response);
          finish();
        });
    });
    response.once('close', () => {
      if (!response.writableEnded) upstreamRequest.destroy();
    });
    request.pipe(upstreamRequest);
  });
}

async function serveStoredTlsInspectorData(
  response: ServerResponse,
  request: IncomingMessage,
  upstreamPath: string,
  dataDir: string | undefined,
): Promise<boolean> {
  if (request.method !== 'GET') return false;
  const state = await readStoredState(dataDir);
  if (!state) return false;
  const url = new URL(upstreamPath, 'http://localhost');
  const tenantId = request.headers['x-tenant-id']?.toString() || 'default';
  const targets = state.targets.filter((item) => item.tenantId === tenantId);
  const targetId = url.pathname.match(/^\/api\/v1\/tls-inspector\/targets\/([^/]+)(?:\/|$)/u)?.[1];
  const snapshotId = url.pathname.match(/^\/api\/v1\/tls-inspector\/snapshots\/([^/]+)$/u)?.[1];

  if (url.pathname === '/api/v1/tls-inspector/targets') {
    writeStoredJson(response, pagePayload(targets.map((target) => targetSummary(target, state.snapshots)), url));
    return true;
  }
  if (url.pathname.endsWith('/latest') && targetId) {
    const snapshot = latestUsableSnapshot(state.snapshots, targetId, tenantId);
    if (!snapshot) return writeStoredNotFound(response);
    writeStoredJson(response, snapshot);
    return true;
  }
  if (url.pathname.endsWith('/snapshots') && targetId) {
    const items = state.snapshots
      .filter((item) => item.targetId === targetId && item.tenantId === tenantId)
      .map((item) => pickSnapshotListFields(item));
    writeStoredJson(response, pagePayload(items, url));
    return true;
  }
  if (snapshotId) {
    const snapshot = state.snapshots.find((item) => item.id === snapshotId && item.tenantId === tenantId);
    if (!snapshot) return writeStoredNotFound(response);
    writeStoredJson(response, snapshot);
    return true;
  }
  return false;
}

async function readStoredState(dataDir: string | undefined): Promise<{ targets: StoredRecord[]; snapshots: StoredRecord[] } | undefined> {
  const directories = [...new Set([
    dataDir,
    resolve(process.cwd(), 'data', 'tls-inspector'),
    resolve(process.cwd(), '..', 'data', 'tls-inspector'),
    '/app/data/tls-inspector',
  ].filter((value): value is string => Boolean(value)))];
  for (const directory of directories) {
    try {
      const parsed = JSON.parse(await readFile(join(directory, 'store.json'), 'utf8')) as Record<string, unknown>;
      if (!Array.isArray(parsed.targets) || !Array.isArray(parsed.snapshots)) continue;
      return {
        targets: parsed.targets.filter(isStoredRecord),
        snapshots: parsed.snapshots.filter(isStoredRecord),
      };
    } catch {
      // 中文说明：开发模式和容器模式的工作目录不同，继续尝试下一个标准数据目录。
    }
  }
  return undefined;
}

function isStoredRecord(value: unknown): value is StoredRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function targetSummary(target: StoredRecord, snapshots: StoredRecord[]): StoredRecord {
  const latest = latestSnapshot(snapshots, String(target.id ?? ''), String(target.tenantId ?? ''));
  const ratingSnapshot = latest?.status === 'failed'
    ? latestUsableSnapshot(snapshots, String(target.id ?? ''), String(target.tenantId ?? ''))
    : latest;
  return {
    ...target,
    latestSummary: latest?.summary ?? null,
    latestRating: calculateStoredRating(ratingSnapshot),
    latestSnapshotId: latest?.id ?? null,
    latestStatus: latest?.status ?? null,
  };
}

function latestSnapshot(snapshots: StoredRecord[], targetId: string, tenantId: string): StoredRecord | undefined {
  return snapshots.find((item) => item.targetId === targetId && item.tenantId === tenantId);
}

function latestUsableSnapshot(snapshots: StoredRecord[], targetId: string, tenantId: string): StoredRecord | undefined {
  return snapshots.find((item) => item.targetId === targetId && item.tenantId === tenantId && (item.status === 'succeeded' || item.status === 'partial'));
}

function pickSnapshotListFields(snapshot: StoredRecord): StoredRecord {
  return {
    id: snapshot.id,
    targetId: snapshot.targetId,
    status: snapshot.status,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    summary: snapshot.summary,
    riskSummary: snapshot.riskSummary,
  };
}

function calculateStoredRating(snapshot: StoredRecord | undefined): string | null {
  if (!snapshot) return null;
  const certificate = isStoredRecord(snapshot.certificate) ? snapshot.certificate : undefined;
  const trustPaths = Array.isArray(snapshot.trustPaths) ? snapshot.trustPaths.filter(isStoredRecord) : [];
  let certificateScore = certificate ? 100 : 30;
  certificateScore -= Math.min(trustPaths.filter((item) => ['untrusted', 'incomplete'].includes(String(item.status).toLowerCase())).length * 15, 45);
  const expiresAt = Date.parse(String(certificate?.notAfter ?? ''));
  if (Number.isFinite(expiresAt)) {
    const remainingDays = Math.ceil((expiresAt - Date.now()) / 86_400_000);
    if (remainingDays < 0) certificateScore -= 40;
    else if (remainingDays <= 7) certificateScore -= 8;
  }

  const summary = isStoredRecord(snapshot.summary) ? snapshot.summary : {};
  const riskSummary = isStoredRecord(snapshot.riskSummary) ? snapshot.riskSummary : {};
  const protocols = Array.isArray(snapshot.protocols) ? snapshot.protocols.filter(isStoredRecord) : [];
  let protocolScore = 100;
  if (!(typeof riskSummary.tls13Supported === 'boolean' ? riskSummary.tls13Supported : summary.tls13Supported)) protocolScore -= 20;
  if (typeof riskSummary.legacyProtocolEnabled === 'boolean' ? riskSummary.legacyProtocolEnabled : summary.legacyProtocolEnabled) protocolScore -= 35;
  if (protocols.some((item) => item.label === 'SSL 3.0' && item.supported)) protocolScore -= 20;

  const details = isStoredRecord(snapshot.protocolDetails) ? snapshot.protocolDetails : {};
  let keyExchangeScore = 100;
  if (!details.forwardSecrecy) keyExchangeScore -= 28;
  if (!(Array.isArray(details.supportedNamedGroups) ? details.supportedNamedGroups.length : 0)) keyExchangeScore -= 14;
  if (!details.pqcSupported) keyExchangeScore -= 6;
  keyExchangeScore -= Math.min((Number(riskSummary.simulationFailedCount ?? summary.simulationFailedCount) || 0) * 2, 16);

  const cipherSuites = Array.isArray(snapshot.cipherSuites) ? snapshot.cipherSuites.filter(isStoredRecord) : [];
  let cipherStrengthScore = 100;
  cipherStrengthScore -= Math.min(cipherSuites.filter((item) => item.insecure).length * 18, 36);
  cipherStrengthScore -= Math.min(cipherSuites.filter((item) => item.weak && !item.insecure).length * 8, 24);
  const maxStrength = Math.max(...cipherSuites.map((item) => Number(item.strengthBits) || 0), 0);
  if (cipherSuites.length && maxStrength < 128) cipherStrengthScore -= 15;

  const score = Math.max(0, Math.min(100, Math.round(
    certificateScore * 0.3 + protocolScore * 0.3 + keyExchangeScore * 0.2 + cipherStrengthScore * 0.2,
  )));
  if (score >= 97) return 'A+';
  if (score >= 92) return 'A';
  if (score >= 85) return 'B';
  if (score >= 72) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function pagePayload(items: readonly StoredRecord[], url: URL): StoredRecord {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const requestedSize = Number(url.searchParams.get('pageSize') ?? (items.length || 20));
  const pageSize = Math.max(1, Number.isFinite(requestedSize) ? requestedSize : 20);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page, pageSize, total: items.length };
}

function writeStoredJson(response: ServerResponse, data: unknown): void {
  if (response.headersSent || response.writableEnded) return;
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ data, requestId: `req_${Date.now().toString(36)}`, timestamp: new Date().toISOString() }));
}

function writeStoredNotFound(response: ServerResponse): true {
  if (!response.headersSent && !response.writableEnded) {
    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ errorCode: 'RESOURCE_NOT_FOUND', message: 'TLS 快照不存在' }));
  }
  return true;
}

function writeUnavailableResponse(response: ServerResponse): void {
  if (!response.headersSent && !response.writableEnded) {
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ errorCode: 'TLS_INSPECTOR_UNAVAILABLE', message: 'TLS 深度检测服务暂不可用' }));
  }
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
