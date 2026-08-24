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

export interface ExecutionStepLine {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly detail?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly requestId?: string
}

const props = withDefaults(defineProps<{
  lines: readonly ExecutionLogLine[]
  steps?: readonly ExecutionStepLine[]
  polling?: boolean
  streaming?: boolean
  mode?: 'live' | 'static'
}>(), {
  steps: () => [],
  polling: false,
  streaming: false,
  mode: 'static',
})

const keyword = ref('')
const level = ref('all')

const filteredLines = computed(() => props.lines.filter((line) => {
  const matchLevel = level.value === 'all' || line.level === level.value
  const matchKeyword = !keyword.value || line.message.includes(keyword.value)
  return matchLevel && matchKeyword
}))
</script>

<template>
  <section class="gc-card gc-log-viewer">
    <header>
      <div class="gc-log-viewer__title">
        <strong>执行日志</strong>
        <span v-if="mode === 'live'" class="gc-log-viewer__mode">{{ streaming ? '实时更新' : '自动刷新' }}</span>
      </div>
      <input v-model="keyword" placeholder="搜索日志内容" />
      <select v-model="level" aria-label="日志级别">
        <option value="all">全部</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
    </header>
    <p v-if="mode === 'live'" class="gc-log-viewer__hint">
      {{ streaming ? '任务状态与日志会持续实时更新。' : '任务状态与日志会自动刷新。' }}
      <span v-if="polling && !streaming">当前处于刷新兜底模式。</span>
    </p>
    <section v-if="steps.length" class="gc-log-viewer__steps" aria-label="执行步骤">
      <article v-for="step in steps" :key="step.id" class="gc-log-viewer__step">
        <div class="gc-log-viewer__step-head">
          <strong>{{ step.name }}</strong>
          <span>{{ step.status }}</span>
        </div>
        <p>{{ step.detail ?? '暂无步骤说明' }}</p>
        <small>{{ step.startedAt ?? '未开始' }}{{ step.finishedAt ? ` -> ${step.finishedAt}` : '' }}</small>
      </article>
    </section>
    <pre v-if="filteredLines.length"><code v-for="line in filteredLines" :key="line.id">[{{ line.time }}] [{{ line.level }}] {{ line.step ? `[${line.step}] ` : '' }}{{ line.message }}
</code></pre>
    <p v-else class="gc-log-viewer__empty">暂无日志。</p>
  </section>
</template>

<style scoped>
.gc-log-viewer {
  min-width: 0;
  overflow-x: hidden;
}

.gc-log-viewer header {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  margin-bottom: var(--gc-space-3);
  flex-wrap: wrap;
}

.gc-log-viewer__title {
  display: flex;
  align-items: center;
  gap: var(--gc-space-2);
  margin-right: auto;
  min-width: 0;
}

.gc-log-viewer__mode {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-bg);
  border-radius: 999px;
  padding: 2px 8px;
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}

.gc-log-viewer__hint,
.gc-log-viewer__empty {
  color: var(--gc-color-text-muted);
  overflow-wrap: anywhere;
}

.gc-log-viewer__steps {
  display: grid;
  gap: var(--gc-space-2);
  margin-bottom: var(--gc-space-3);
  min-width: 0;
}

.gc-log-viewer__step {
  border: 1px solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3);
  min-width: 0;
}

.gc-log-viewer__step-head {
  display: flex;
  justify-content: space-between;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.gc-log-viewer__step strong,
.gc-log-viewer__step span,
.gc-log-viewer__step p,
.gc-log-viewer__step small {
  overflow-wrap: anywhere;
}

.gc-log-viewer__step p,
.gc-log-viewer__step small {
  margin: var(--gc-space-1) 0 0;
  color: var(--gc-color-text-muted);
}

.gc-log-viewer input,
.gc-log-viewer select {
  border: 1px solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  padding: 6px 8px;
  min-width: 0;
}

pre {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  background: var(--gc-color-legacy-020617);
  color: var(--gc-color-muted-bg);
  padding: var(--gc-space-4);
  border-radius: var(--gc-radius-md);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
