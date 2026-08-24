<script setup lang="ts">
import { computed } from 'vue'
import type { StatusTone } from '@/design-system/status/status-map'

const props = withDefaults(defineProps<{
  /** 当前进度值。 */
  value: number
  /** 进度最大值。 */
  max?: number
  /** 进度条的语义状态。 */
  tone?: StatusTone
  /** 是否显示进度轨道边界。 */
  outlined?: boolean
  /** 传入翻译后的进度说明，用于 progressbar 的 ARIA 名称。 */
  ariaLabel: string
}>(), {
  max: 100,
  tone: 'info',
  outlined: false,
})

const normalizedMax = computed(() => Math.max(props.max, 1))
const normalizedValue = computed(() => Math.min(Math.max(props.value, 0), normalizedMax.value))
const percentage = computed(() => (normalizedValue.value / normalizedMax.value) * 100)
</script>

<template>
  <div
    class="gc-progress"
    :class="[`gc-progress--${tone}`, { 'gc-progress--outlined': outlined }]"
    role="progressbar"
    :aria-label="ariaLabel"
    :aria-valuemin="0"
    :aria-valuemax="normalizedMax"
    :aria-valuenow="normalizedValue"
  >
    <div class="gc-progress__track">
      <div class="gc-progress__fill" :style="{ width: `${percentage}%` }" />
    </div>
    <div v-if="$slots.default" class="gc-progress__caption">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.gc-progress {
  display: grid;
  gap: var(--gc-space-2);
  min-width: 0;
}

.gc-progress__track {
  height: var(--gc-space-2);
  overflow: hidden;
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-muted);
}

.gc-progress--outlined .gc-progress__track {
  box-sizing: border-box;
  border: var(--gc-border-width-default) solid var(--gc-color-border-muted);
}

.gc-progress__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--gc-color-info);
  transition: width 180ms ease, background 180ms ease;
}

.gc-progress--success .gc-progress__fill { background: var(--gc-color-success); }
.gc-progress--warning .gc-progress__fill { background: var(--gc-color-warning); }
.gc-progress--danger .gc-progress__fill { background: var(--gc-color-danger); }
.gc-progress--info .gc-progress__fill { background: var(--gc-color-info); }
.gc-progress--muted .gc-progress__fill { background: var(--gc-color-muted); }

.gc-progress__caption {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

@media (prefers-reduced-motion: reduce) {
  .gc-progress__fill {
    transition: none;
  }
}
</style>
