import { onBeforeUnmount, onMounted, ref } from 'vue'

export interface UsePollingOptions {
  readonly intervalMs: number
  readonly immediate?: boolean
  readonly stopWhen?: () => boolean
}

export function usePolling(task: () => Promise<void> | void, options: UsePollingOptions) {
  const isPolling = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  let taskRunning = false

  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    isPolling.value = false
  }

  const tick = async () => {
    // 中文说明：避免慢请求尚未完成时，定时器再次发起同一个请求。
    if (taskRunning) return
    if (options.stopWhen?.()) {
      stop()
      return
    }
    taskRunning = true
    try {
      await task()
    } finally {
      taskRunning = false
    }
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
