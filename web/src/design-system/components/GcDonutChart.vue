<script setup lang="ts">
import { computed } from 'vue'
import type { StatusTone } from '@/design-system/status/status-map'

export interface GcDonutChartSegment {
  /** 分段数值。非正数或非有限数值会被安全忽略。 */
  readonly value: number
  /** 分段的语义状态。 */
  readonly tone: StatusTone
}

interface RenderSegment {
  readonly index: number
  readonly tone: StatusTone
  readonly percentage: number
  readonly offset: number
}

const statusTones: readonly StatusTone[] = ['success', 'warning', 'danger', 'info', 'muted']

const props = defineProps<{
  /** 环形图分段数据。 */
  segments: readonly GcDonutChartSegment[]
  /** 由调用方翻译后的图表无障碍名称。 */
  ariaLabel: string
  /** 数据为空或均非法时由调用方提供的可见说明。 */
  emptyLabel: string
}>()

function resolveTone(value: unknown): StatusTone {
  return statusTones.includes(value as StatusTone) ? value as StatusTone : 'muted'
}

const validSegments = computed(() => props.segments
  .map((segment, index) => ({ index, value: segment?.value, tone: resolveTone(segment?.tone) }))
  .filter((segment): segment is { index: number; value: number; tone: StatusTone } => (
    Number.isFinite(segment.value) && segment.value > 0
  )))

const renderSegments = computed<readonly RenderSegment[]>(() => {
  if (validSegments.value.length === 0) return []

  const largestValue = Math.max(...validSegments.value.map((segment) => segment.value))
  const normalizedSegments = validSegments.value.map((segment) => ({
    ...segment,
    weight: segment.value / largestValue,
  }))
  const totalWeight = normalizedSegments.reduce((sum, segment) => sum + segment.weight, 0)
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return []

  let offset = 0
  return normalizedSegments.map((segment) => {
    const percentage = (segment.weight / totalWeight) * 100
    const renderSegment = { index: segment.index, tone: segment.tone, percentage, offset }
    offset += percentage
    return renderSegment
  })
})

const hasData = computed(() => renderSegments.value.length > 0)
</script>

<template>
  <div class="gc-donut-chart" role="img" :aria-label="ariaLabel">
    <div class="gc-donut-chart__canvas">
      <svg
        v-if="hasData"
        class="gc-donut-chart__svg"
        viewBox="0 0 100 100"
        aria-hidden="true"
        focusable="false"
      >
        <circle class="gc-donut-chart__track" cx="50" cy="50" r="42" pathLength="100" />
        <circle
          v-for="segment in renderSegments"
          :key="segment.index"
          class="gc-donut-chart__segment"
          :class="`gc-donut-chart__segment--${segment.tone}`"
          cx="50"
          cy="50"
          r="42"
          pathLength="100"
          :stroke-dasharray="`${segment.percentage} ${100 - segment.percentage}`"
          :stroke-dashoffset="-segment.offset"
        />
      </svg>
      <span v-else class="gc-donut-chart__empty" aria-hidden="true">{{ emptyLabel }}</span>
      <span v-if="hasData && $slots.center" class="gc-donut-chart__center">
        <slot name="center" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.gc-donut-chart {
  width: min(100%, var(--gc-size-card-min));
  min-width: 0;
}

.gc-donut-chart__canvas {
  position: relative;
  display: grid;
  width: 100%;
  aspect-ratio: 1;
}

.gc-donut-chart__svg,
.gc-donut-chart__empty,
.gc-donut-chart__center {
  grid-area: 1 / 1;
}

.gc-donut-chart__svg {
  display: block;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.gc-donut-chart__track,
.gc-donut-chart__segment {
  fill: none;
  stroke-width: var(--gc-size-progress);
  vector-effect: non-scaling-stroke;
}

.gc-donut-chart__track {
  stroke: var(--gc-color-surface-muted);
}

.gc-donut-chart__segment {
  stroke: var(--gc-color-muted);
  transition: stroke 180ms ease, stroke-dasharray 180ms ease, stroke-dashoffset 180ms ease;
}

.gc-donut-chart__segment--success { stroke: var(--gc-color-success); }
.gc-donut-chart__segment--warning { stroke: var(--gc-color-warning); }
.gc-donut-chart__segment--danger { stroke: var(--gc-color-danger); }
.gc-donut-chart__segment--info { stroke: var(--gc-color-info); }
.gc-donut-chart__segment--muted { stroke: var(--gc-color-muted); }

.gc-donut-chart__empty,
.gc-donut-chart__center {
  display: grid;
  place-items: center;
  min-width: 0;
  padding: var(--gc-space-3);
  text-align: center;
  overflow-wrap: anywhere;
}

.gc-donut-chart__empty {
  border: var(--gc-border-width-default) dashed var(--gc-color-border);
  border-radius: var(--gc-radius-full);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  font-size: var(--gc-font-size-sm);
}

.gc-donut-chart__center {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-heading-xs);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-tight);
}

@media (prefers-reduced-motion: reduce) {
  .gc-donut-chart__segment {
    transition: none;
  }
}
</style>
