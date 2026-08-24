<script setup lang="ts">
import { computed } from 'vue'
import type { StatusTone } from '@/design-system/status/status-map'

export interface GcTrendChartPoint {
  /** 趋势数据的数值。非有限数值会被安全忽略。 */
  readonly value: number
}

interface RenderPoint {
  readonly index: number
  readonly x: number
  readonly y: number
}

const chartWidth = 100
const chartHeight = 48
const chartPadding = 6

const props = withDefaults(defineProps<{
  /** 趋势数据点，按时间或调用方定义的顺序排列。 */
  data: readonly GcTrendChartPoint[]
  /** 由调用方翻译后的图表无障碍名称。 */
  ariaLabel: string
  /** 数据为空或均非法时由调用方提供的可见说明。 */
  emptyLabel: string
  /** 趋势线的语义状态。 */
  tone?: StatusTone
}>(), {
  tone: 'info',
})

const validValues = computed(() => props.data
  .map((point, index) => ({ index, value: point?.value }))
  .filter((point): point is { index: number; value: number } => Number.isFinite(point.value)))

const valueRange = computed(() => {
  if (validValues.value.length === 0) return { min: 0, max: 1 }
  const values = validValues.value.map((point) => point.value)
  return { min: Math.min(...values), max: Math.max(...values) }
})

const points = computed<readonly RenderPoint[]>(() => {
  const range = valueRange.value.max - valueRange.value.min
  const horizontalRange = chartWidth - (chartPadding * 2)
  const verticalRange = chartHeight - (chartPadding * 2)
  const totalIntervals = Math.max(props.data.length - 1, 1)

  return validValues.value.map((point) => {
    const relativeValue = range === 0 ? 0.5 : (point.value - valueRange.value.min) / range
    return {
      index: point.index,
      x: chartPadding + ((point.index / totalIntervals) * horizontalRange),
      y: chartHeight - chartPadding - (relativeValue * verticalRange),
    }
  })
})

const lineSegments = computed(() => {
  const pointByIndex = new Map(points.value.map((point) => [point.index, point]))
  const segments: RenderPoint[][] = []
  let currentSegment: RenderPoint[] = []

  props.data.forEach((_, index) => {
    const point = pointByIndex.get(index)
    if (point) {
      currentSegment.push(point)
      return
    }
    if (currentSegment.length > 1) segments.push(currentSegment)
    currentSegment = []
  })

  if (currentSegment.length > 1) segments.push(currentSegment)
  return segments.map((segment, index) => ({
    key: index,
    path: segment.map((point, pointIndex) => `${pointIndex === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
  }))
})

const hasData = computed(() => points.value.length > 0)
</script>

<template>
  <div
    class="gc-trend-chart"
    :class="`gc-trend-chart--${tone}`"
    role="img"
    :aria-label="ariaLabel"
  >
    <svg
      v-if="hasData"
      class="gc-trend-chart__canvas"
      viewBox="0 0 100 48"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <line class="gc-trend-chart__grid-line" x1="6" x2="94" y1="12" y2="12" />
      <line class="gc-trend-chart__grid-line" x1="6" x2="94" y1="24" y2="24" />
      <line class="gc-trend-chart__grid-line" x1="6" x2="94" y1="36" y2="36" />
      <path
        v-for="segment in lineSegments"
        :key="segment.key"
        class="gc-trend-chart__line"
        :d="segment.path"
      />
      <circle
        v-for="point in points"
        :key="point.index"
        class="gc-trend-chart__point"
        :cx="point.x"
        :cy="point.y"
        r="2"
      />
    </svg>
    <span v-else class="gc-trend-chart__empty" aria-hidden="true">{{ emptyLabel }}</span>
  </div>
</template>

<style scoped>
.gc-trend-chart {
  display: grid;
  width: 100%;
  min-width: 0;
  aspect-ratio: 25 / 12;
}

.gc-trend-chart__canvas,
.gc-trend-chart__empty {
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
}

.gc-trend-chart__canvas {
  display: block;
  overflow: visible;
}

.gc-trend-chart__grid-line {
  stroke: var(--gc-color-border-subtle);
  stroke-width: var(--gc-border-width-default);
  vector-effect: non-scaling-stroke;
}

.gc-trend-chart__line {
  fill: none;
  stroke: var(--gc-color-info);
  stroke-width: var(--gc-border-width-thick);
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  transition: stroke 180ms ease;
}

.gc-trend-chart__point {
  fill: var(--gc-color-surface-solid);
  stroke: var(--gc-color-info);
  stroke-width: var(--gc-border-width-thick);
  vector-effect: non-scaling-stroke;
  transition: fill 180ms ease, stroke 180ms ease;
}

.gc-trend-chart--success .gc-trend-chart__line,
.gc-trend-chart--success .gc-trend-chart__point { stroke: var(--gc-color-success); }
.gc-trend-chart--warning .gc-trend-chart__line,
.gc-trend-chart--warning .gc-trend-chart__point { stroke: var(--gc-color-warning); }
.gc-trend-chart--danger .gc-trend-chart__line,
.gc-trend-chart--danger .gc-trend-chart__point { stroke: var(--gc-color-danger); }
.gc-trend-chart--info .gc-trend-chart__line,
.gc-trend-chart--info .gc-trend-chart__point { stroke: var(--gc-color-info); }
.gc-trend-chart--muted .gc-trend-chart__line,
.gc-trend-chart--muted .gc-trend-chart__point { stroke: var(--gc-color-muted); }

.gc-trend-chart__empty {
  display: grid;
  place-items: center;
  min-width: 0;
  border: var(--gc-border-width-default) dashed var(--gc-color-border);
  border-radius: var(--gc-radius-card);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  padding: var(--gc-space-3);
  font-size: var(--gc-font-size-sm);
  text-align: center;
  overflow-wrap: anywhere;
}

@media (prefers-reduced-motion: reduce) {
  .gc-trend-chart__line,
  .gc-trend-chart__point {
    transition: none;
  }
}
</style>
