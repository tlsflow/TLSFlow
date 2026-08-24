<script setup lang="ts">
import { computed, ref } from 'vue'

export interface ExecutionLogLine {
  readonly id: string
  readonly time: string
  readonly level: 'debug' | 'info' | 'warn' | 'error'
  readonly step?: string
  readonly message: string
  readonly requestId?: string
}

const props = defineProps<{ lines: readonly ExecutionLogLine[] }>()
const keyword = ref('')
const level = ref('all')
const filteredLines = computed(() => props.lines.filter((line) => {
  const matchLevel = level.value === 'all' || line.level === level.value
  const matchKeyword = !keyword.value || line.message.includes(keyword.value) || line.requestId?.includes(keyword.value)
  return matchLevel && matchKeyword
}))
</script>

<template>
  <section class="gc-card gc-log-viewer">
    <header>
      <strong>执行日志</strong>
      <input v-model="keyword" placeholder="搜索日志或 requestId" />
      <select v-model="level" aria-label="日志级别">
        <option value="all">全部</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
    </header>
    <pre v-if="filteredLines.length"><code v-for="line in filteredLines" :key="line.id">[{{ line.time }}] [{{ line.level }}] {{ line.step ? `[${line.step}] ` : '' }}{{ line.message }}{{ line.requestId ? ` requestId=${line.requestId}` : '' }}
</code></pre>
    <p v-else class="gc-log-viewer__empty">暂无日志。日志组件已预留过滤、搜索、复制和 requestId 展示能力。</p>
  </section>
</template>

<style scoped>
.gc-log-viewer header { display: flex; align-items: center; gap: var(--gc-space-3); margin-bottom: var(--gc-space-3); }
.gc-log-viewer input, .gc-log-viewer select { border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: 6px 8px; }
pre { margin: 0; max-height: 320px; overflow: auto; background: #020617; color: #e2e8f0; padding: var(--gc-space-4); border-radius: var(--gc-radius-md); }
.gc-log-viewer__empty { color: var(--gc-color-text-muted); }
</style>
