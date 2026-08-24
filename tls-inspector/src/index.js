import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileStore } from './store.js'
import { inspectTarget } from './scanner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function createTlsInspectorServer(options = {}) {
  const config = {
    host: options.host ?? process.env.TLS_INSPECTOR_HOST ?? '0.0.0.0',
    port: Number(options.port ?? process.env.TLS_INSPECTOR_PORT ?? 8788),
    dataDir: options.dataDir ?? process.env.TLS_INSPECTOR_DATA_DIR ?? path.resolve(__dirname, '..', '..', 'data', 'tls-inspector'),
    scanTimeoutMs: Number(options.scanTimeoutMs ?? process.env.TLS_INSPECTOR_SCAN_TIMEOUT_MS ?? 20_000),
    schedulerIntervalMs: Number(options.schedulerIntervalMs ?? process.env.TLS_INSPECTOR_SCHEDULER_INTERVAL_MS ?? 30_000),
  }

  const store = new FileStore(config.dataDir)
  let schedulerTimer = null
  let currentSweep = Promise.resolve()

  async function init() {
    await store.init()
    schedulerTimer = setInterval(() => {
      currentSweep = currentSweep.then(() => runScheduledInspections()).catch(() => undefined)
    }, config.schedulerIntervalMs)
    schedulerTimer.unref?.()
  }

  async function close() {
    if (schedulerTimer) {
      clearInterval(schedulerTimer)
      schedulerTimer = null
    }
  }

  async function runScheduledInspections() {
    const now = Date.now()
    const targets = store.listTargets()
    for (const target of targets) {
      if (target.status !== 'active') continue
      const latest = store.getLatestSnapshotForTarget(target.id, target.tenantId)
      const latestTime = latest?.finishedAt ? Date.parse(latest.finishedAt) : 0
      const intervalMs = Number(target.schedule?.intervalSeconds ?? 3600) * 1000
      if (latestTime && now - latestTime < intervalMs) continue
      try {
        const snapshot = await inspectTarget(target, { timeoutMs: config.scanTimeoutMs })
        await store.saveSnapshot(snapshot)
      } catch (error) {
        await store.saveSnapshot({
          tenantId: target.tenantId,
          targetId: target.id,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: 'failed',
          summary: {
            endpoint: `${target.host}:${target.port}`,
            lastInspectedAt: new Date().toISOString(),
          },
          certificate: null,
          trustPaths: [],
          protocols: [],
          cipherSuites: [],
          simulations: [],
          protocolDetails: {},
          riskSummary: {
            legacyProtocolEnabled: false,
            weakCipherDetected: false,
            tls13Supported: false,
            hstsTooShort: false,
            trustPathIssueCount: 0,
            simulationFailedCount: 0,
            boundaryNotes: [error instanceof Error ? error.message : '计划扫描失败'],
          },
          implementationVersion: '2026.08.07',
          profileCatalogVersion: '2026.08.07',
          trustCatalogVersion: '2026.08.07',
          errors: [{
            code: 'INSPECTION_TIMEOUT',
            message: error instanceof Error ? error.message : '计划扫描失败',
          }],
        })
      }
    }
  }

  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, { config, store })
    } catch (error) {
      writeError(response, 500, 'INTERNAL_ERROR', error instanceof Error ? error.message : '未知错误')
    }
  })

  server.on('close', close)

  return {
    config,
    store,
    server,
    init,
    close,
  }
}

async function handleRequest(request, response, context) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  setCorsHeaders(response, request)
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'GET' && url.pathname === '/healthz') {
    writeJson(response, 200, {
      status: 'ok',
      version: '2026.08.07',
      time: new Date().toISOString(),
      schedulerIntervalMs: context.config.schedulerIntervalMs,
    })
    return
  }

  const tenantId = request.headers['x-tenant-id']?.toString() || 'default'

  if (request.method === 'GET' && url.pathname === '/api/v1/tls-inspector/targets') {
    const items = context.store.listTargets(tenantId).map((target) => {
      const latest = context.store.getLatestSnapshotForTarget(target.id, target.tenantId)
      return {
        ...target,
        latestSummary: latest?.summary ?? null,
        latestSnapshotId: latest?.id ?? null,
        latestStatus: latest?.status ?? null,
      }
    })
    writeJson(response, 200, pagePayload(items, url))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/tls-inspector/targets') {
    const body = await readJsonBody(request)
    const target = await context.store.upsertTarget(normalizeTargetCreate(body, tenantId))
    writeJson(response, 201, target)
    return
  }

  const deleteMatch = url.pathname.match(/^\/api\/v1\/tls-inspector\/targets\/([^/]+)$/)
  if (request.method === 'DELETE' && deleteMatch) {
    const deleted = await context.store.deleteTarget(deleteMatch[1], tenantId)
    if (!deleted) {
      writeError(response, 404, 'RESOURCE_NOT_FOUND', 'TLS 深度检测目标不存在')
      return
    }
    writeJson(response, 200, deleted)
    return
  }

  const inspectMatch = url.pathname.match(/^\/api\/v1\/tls-inspector\/targets\/([^/]+)\/inspect$/)
  if (request.method === 'POST' && inspectMatch) {
    const target = context.store.getTarget(inspectMatch[1], tenantId)
    if (!target) {
      writeError(response, 404, 'RESOURCE_NOT_FOUND', 'TLS 深度检测目标不存在')
      return
    }
    const snapshot = await inspectTarget(target, { timeoutMs: context.config.scanTimeoutMs })
    const saved = await context.store.saveSnapshot(snapshot)
    writeJson(response, 200, saved)
    return
  }

  const latestMatch = url.pathname.match(/^\/api\/v1\/tls-inspector\/targets\/([^/]+)\/latest$/)
  if (request.method === 'GET' && latestMatch) {
    const snapshot = context.store.getLatestSnapshotForTarget(latestMatch[1], tenantId)
    if (!snapshot) {
      writeError(response, 404, 'RESOURCE_NOT_FOUND', '没有找到最新 TLS 快照')
      return
    }
    writeJson(response, 200, snapshot)
    return
  }

  const snapshotsMatch = url.pathname.match(/^\/api\/v1\/tls-inspector\/targets\/([^/]+)\/snapshots$/)
  if (request.method === 'GET' && snapshotsMatch) {
    const items = context.store.listSnapshotsForTarget(snapshotsMatch[1], tenantId).map((item) => ({
      id: item.id,
      targetId: item.targetId,
      status: item.status,
      startedAt: item.startedAt,
      finishedAt: item.finishedAt,
      summary: item.summary,
      riskSummary: item.riskSummary,
    }))
    writeJson(response, 200, pagePayload(items, url))
    return
  }

  const snapshotMatch = url.pathname.match(/^\/api\/v1\/tls-inspector\/snapshots\/([^/]+)$/)
  if (request.method === 'GET' && snapshotMatch) {
    const snapshot = context.store.getSnapshot(snapshotMatch[1], tenantId)
    if (!snapshot) {
      writeError(response, 404, 'RESOURCE_NOT_FOUND', 'TLS 快照不存在')
      return
    }
    writeJson(response, 200, snapshot)
    return
  }

  writeError(response, 404, 'RESOURCE_NOT_FOUND', '接口不存在')
}

function normalizeTargetCreate(body, tenantId) {
  const host = String(body.host ?? '').trim()
  if (!host) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'host 不能为空')
  }
  return {
    tenantId,
    serviceAssetId: body.serviceAssetId ? String(body.serviceAssetId) : null,
    host,
    port: Math.max(1, Math.min(65535, Number(body.port ?? 443))),
    serverName: body.serverName ? String(body.serverName) : host,
    enabledViews: Array.isArray(body.enabledViews) ? body.enabledViews.map((item) => String(item)) : undefined,
    schedule: {
      intervalSeconds: Math.max(60, Number(body.schedule?.intervalSeconds ?? body.intervalSeconds ?? 3600)),
    },
    status: String(body.status ?? 'active'),
  }
}

class HttpError extends Error {
  constructor(status, errorCode, message) {
    super(message)
    this.status = status
    this.errorCode = errorCode
  }
}

function writeJson(response, status, data) {
  const payload = JSON.stringify({
    data,
    requestId: `req_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
  })
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(payload)
}

function writeError(response, status, errorCode, message) {
  const payload = JSON.stringify({
    message,
    errorCode,
    requestId: `req_${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
  })
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(payload)
}

function pagePayload(items, url) {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1))
  const pageSizeValue = url.searchParams.get('pageSize')
  const pageSize = Math.max(1, Number(pageSizeValue ?? items.length ?? 20))
  const start = (page - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total: items.length,
  }
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'VALIDATION_FAILED', '请求体不是合法 JSON')
  }
}

function setCorsHeaders(response, request) {
  const origin = request.headers.origin ?? '*'
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Tenant-Id, X-Request-Id, X-Actor-Id, X-Actor-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const app = createTlsInspectorServer()
  await app.init()
  app.server.listen(app.config.port, app.config.host, () => {
    process.stdout.write(`tls-inspector listening on http://${app.config.host}:${app.config.port}\n`)
  })
}
