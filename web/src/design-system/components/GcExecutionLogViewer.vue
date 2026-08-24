<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const DEFAULT_VISIBLE_LOG_LIMIT = 500

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
  readonly stepType?: string
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
  maxVisibleLines?: number
}>(), {
  steps: () => [],
  polling: false,
  streaming: false,
  mode: 'static',
  maxVisibleLines: DEFAULT_VISIBLE_LOG_LIMIT,
})

const keyword = ref('')
const level = ref('all')
const showAllLogs = ref(false)
const { t } = useI18n()

const filteredLines = computed(() => props.lines.filter((line) => {
  const matchLevel = level.value === 'all' || line.level === level.value
  const matchKeyword = !keyword.value || line.message.includes(keyword.value)
  return matchLevel && matchKeyword
}))
const hiddenLineCount = computed(() => Math.max(filteredLines.value.length - props.maxVisibleLines, 0))
const visibleLines = computed(() => {
  if (showAllLogs.value || hiddenLineCount.value === 0) return filteredLines.value
  return filteredLines.value.slice(-props.maxVisibleLines)
})
</script>

<template>
  <section class="gc-card gc-log-viewer">
    <header>
      <div class="gc-log-viewer__title">
        <strong>{{ t('designSystem.executionProgress.aria.executionLog') }}</strong>
        <span v-if="mode === 'live'" class="gc-log-viewer__mode">
          {{ streaming ? t('designSystem.executionLogViewer.mode.realtime') : t('designSystem.executionLogViewer.mode.autoRefresh') }}
        </span>
      </div>
      <input v-model="keyword" :placeholder="t('designSystem.executionLogViewer.search.placeholder')" />
      <select v-model="level" :aria-label="t('designSystem.executionLogViewer.level.aria')">
        <option value="all">{{ t('designSystem.executionLogViewer.level.all') }}</option>
        <option value="debug">debug</option>
        <option value="info">info</option>
        <option value="warn">warn</option>
        <option value="error">error</option>
      </select>
      <button
        v-if="hiddenLineCount > 0"
        class="gc-button gc-log-viewer__toggle"
        type="button"
        @click="showAllLogs = !showAllLogs"
      >
        {{ showAllLogs
          ? t('designSystem.executionLogViewer.actions.showRecent', { count: props.maxVisibleLines })
          : t('designSystem.executionLogViewer.actions.showAll', { count: filteredLines.length }) }}
      </button>
    </header>
    <p v-if="hiddenLineCount > 0 && !showAllLogs" class="gc-log-viewer__hint">
      {{ t('designSystem.executionLogViewer.hint.limited', { visible: visibleLines.length, total: filteredLines.length }) }}
    </p>
    <p v-if="mode === 'live'" class="gc-log-viewer__hint">
      {{ streaming ? t('designSystem.executionLogViewer.hint.streaming') : t('designSystem.executionLogViewer.hint.autoRefresh') }}
      <span v-if="polling && !streaming">
        {{ t('designSystem.executionLogViewer.hint.pollingFallback') }}
      </span>
    </p>
    <section
      v-if="steps.length"
      class="gc-log-viewer__steps"
      :aria-label="t('designSystem.executionLogViewer.steps.aria')"
    >
      <article v-for="step in steps" :key="step.id" class="gc-log-viewer__step">
        <div class="gc-log-viewer__step-head">
          <strong>{{ step.name }}</strong>
          <span>{{ step.status }}</span>
        </div>
        <p>{{ step.detail ?? t('designSystem.executionLogViewer.steps.emptyDetail') }}</p>
        <small>{{ step.startedAt ?? t('designSystem.executionProgress.time.waitingStart') }}{{ step.finishedAt ? ` -> ${step.finishedAt}` : '' }}</small>
      </article>
    </section>
    <pre v-if="visibleLines.length"><code v-for="line in visibleLines" :key="line.id">[{{ line.time }}] [{{ line.level }}] {{ line.step ? `[${line.step}] ` : '' }}{{ line.message }}
</code></pre>
    <p v-else class="gc-log-viewer__empty">{{ t('designSystem.executionLogViewer.empty.logs') }}</p>
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

.gc-log-viewer__toggle {
  min-height: 32px;
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
  background: var(--gc-color-code-bg);
  color: var(--gc-color-muted-bg);
  padding: var(--gc-space-4);
  border-radius: var(--gc-radius-md);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
