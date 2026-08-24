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
  /** 是否将插槽内容叠加在加高的进度轨道内部。 */
  captionInside?: boolean
  /** 传入翻译后的进度说明，用于 progressbar 的 ARIA 名称。 */
  ariaLabel: string
}>(), {
  max: 100,
  tone: 'info',
  outlined: false,
  captionInside: false,
})

const normalizedMax = computed(() => Math.max(props.max, 1))
const normalizedValue = computed(() => Math.min(Math.max(props.value, 0), normalizedMax.value))
const percentage = computed(() => (normalizedValue.value / normalizedMax.value) * 100)
</script>

<template>
  <div
    class="gc-progress"
    :class="[`gc-progress--${tone}`, { 'gc-progress--outlined': outlined, 'gc-progress--caption-inside': captionInside }]"
    role="progressbar"
    :aria-label="ariaLabel"
    :aria-valuemin="0"
    :aria-valuemax="normalizedMax"
    :aria-valuenow="normalizedValue"
  >
    <div class="gc-progress__track">
      <div class="gc-progress__fill" :style="{ width: `${percentage}%` }" />
      <div v-if="$slots.default && captionInside" class="gc-progress__caption gc-progress__caption--inside">
        <slot />
      </div>
    </div>
    <div v-if="$slots.default && !captionInside" class="gc-progress__caption">
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
  position: relative;
  height: var(--gc-space-2);
  overflow: hidden;
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-surface-muted);
}

.gc-progress--caption-inside .gc-progress__track {
  height: var(--gc-size-progress-labeled);
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
  white-space: nowrap;
}

.gc-progress__caption--inside {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--gc-space-2);
  color: var(--gc-color-text-inverse);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-tight);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .gc-progress__fill {
    transition: none;
  }
}
</style>
