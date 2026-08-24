import { onBeforeUnmount, onMounted, ref } from 'vue'

export interface UsePollingOptions {
  readonly intervalMs: number
  readonly immediate?: boolean
  readonly stopWhen?: () => boolean
}

export function usePolling(task: () => Promise<void> | void, options: UsePollingOptions) {
  const isPolling = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    isPolling.value = false
  }

  const tick = async () => {
    if (options.stopWhen?.()) {
      stop()
      return
    }
    await task()
  }

  const start = async () => {
    if (timer) return
    isPolling.value = true
    if (options.immediate) {
      await tick()
    }
    timer = setInterval(() => {
      void tick()
    }, options.intervalMs)
  }

  onMounted(() => {
    void start()
  })
  onBeforeUnmount(stop)

  return { isPolling, start, stop }
}
