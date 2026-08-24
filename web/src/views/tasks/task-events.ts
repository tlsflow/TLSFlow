export interface GlobalTaskRefreshDetail {
  readonly taskId?: string
  readonly source?: string
}

const GLOBAL_TASK_REFRESH_EVENT = 'gcac:tasks:refresh'

export function dispatchGlobalTaskRefresh(detail: GlobalTaskRefreshDetail = {}): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<GlobalTaskRefreshDetail>(GLOBAL_TASK_REFRESH_EVENT, { detail }))
}

export function subscribeGlobalTaskRefresh(
  listener: (detail: GlobalTaskRefreshDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<GlobalTaskRefreshDetail | undefined>
    listener(customEvent.detail ?? {})
  }
  window.addEventListener(GLOBAL_TASK_REFRESH_EVENT, handler as EventListener)
  return () => window.removeEventListener(GLOBAL_TASK_REFRESH_EVENT, handler as EventListener)
}
