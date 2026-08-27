import { readApiRequestContext } from '@/api/client'
import { TENANT_CONTEXT_CHANGED_EVENT } from '@/stores/tenant-context.events'

export interface CaOperationsRealtimeSnapshotMessage {
  readonly type: 'snapshot'
  readonly emittedAt: string
}

export interface CaOperationsRealtimeChangedMessage {
  readonly type: 'ca.changed'
  readonly caId: string
  readonly providerId: string
  readonly objectTypes: readonly string[]
  readonly emittedAt: string
}

export type CaOperationsRealtimeMessage =
  | CaOperationsRealtimeSnapshotMessage
  | CaOperationsRealtimeChangedMessage

type CaOperationsRealtimeListener = (message: CaOperationsRealtimeMessage) => void

const realtimeListeners = new Set<CaOperationsRealtimeListener>()
const streamPath = '/v1/ca-operations/stream'

let socket: WebSocket | undefined
let reconnectTimer: number | undefined
let connectStarted = false
let tenantContextListenerAttached = false

export function subscribeCaOperationsRealtime(listener: CaOperationsRealtimeListener): () => void {
  realtimeListeners.add(listener)
  ensureConnection()
  return () => {
    realtimeListeners.delete(listener)
    if (realtimeListeners.size === 0) {
      clearReconnectTimer()
      connectStarted = false
      socket?.close()
      socket = undefined
    }
  }
}

export function resetCaOperationsRealtimeConnection(): void {
  clearReconnectTimer()
  connectStarted = false
  socket?.close()
  socket = undefined
  if (realtimeListeners.size > 0) ensureConnection()
}

export function parseCaOperationsRealtimeMessage(raw: unknown): CaOperationsRealtimeMessage | undefined {
  try {
    const payload = typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : undefined
    if (!payload || typeof payload.type !== 'string') return undefined
    if (payload.type === 'snapshot' && typeof payload.emittedAt === 'string') {
      return { type: 'snapshot', emittedAt: payload.emittedAt }
    }
    if (
      payload.type === 'ca.changed'
      && typeof payload.caId === 'string'
      && typeof payload.providerId === 'string'
      && Array.isArray(payload.objectTypes)
      && payload.objectTypes.every((value) => typeof value === 'string')
      && typeof payload.emittedAt === 'string'
    ) {
      return {
        type: 'ca.changed',
        caId: payload.caId,
        providerId: payload.providerId,
        objectTypes: payload.objectTypes,
        emittedAt: payload.emittedAt,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

function ensureConnection(): void {
  if (typeof window === 'undefined' || realtimeListeners.size === 0) return
  if (!tenantContextListenerAttached) {
    window.addEventListener(TENANT_CONTEXT_CHANGED_EVENT, resetCaOperationsRealtimeConnection)
    tenantContextListenerAttached = true
  }
  if (connectStarted && socket) return
  const url = buildRealtimeUrl()
  if (!url) return
  connectStarted = true
  clearReconnectTimer()
  const nextSocket = new WebSocket(url)
  socket = nextSocket
  nextSocket.addEventListener('message', (event) => {
    if (socket !== nextSocket) return
    const message = parseCaOperationsRealtimeMessage(event.data)
    if (!message) return
    realtimeListeners.forEach((listener) => listener(message))
  })
  nextSocket.addEventListener('close', () => {
    if (socket !== nextSocket) return
    socket = undefined
    scheduleReconnect()
  })
  nextSocket.addEventListener('error', () => {
    if (socket !== nextSocket) return
    // close 事件负责统一调度重连；这里不向页面暴露瞬时网络错误。
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer !== undefined || realtimeListeners.size === 0) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined
    connectStarted = false
    ensureConnection()
  }, 3_000)
}

function clearReconnectTimer(): void {
  if (reconnectTimer === undefined) return
  window.clearTimeout(reconnectTimer)
  reconnectTimer = undefined
}

function buildRealtimeUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const requestContext = readApiRequestContext()
  const tenantId = requestContext?.tenantId?.trim()
  if (!tenantId) return undefined
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api'
  const baseUrl = new URL(trimTrailingSlash(apiBase) || '/api', window.location.origin)
  const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = new URL(`${baseUrl.pathname}${streamPath}`, `${protocol}//${baseUrl.host}`)
  url.searchParams.set('tenantId', tenantId)
  const contextVersion = requestContext?.tenantContextVersion?.trim()
  if (contextVersion) url.searchParams.set('contextVersion', contextVersion)
  return url.toString()
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}
