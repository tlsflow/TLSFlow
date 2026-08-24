<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StatusTone } from '@/design-system/status/status-map'

export interface GcTrendChartPoint {
  /** 趋势数据的数值。非有限数值会被安全忽略。 */
  readonly value: number
}

interface RenderPoint {
  readonly index: number
  readonly value: number
  readonly x: number
  readonly y: number
}

interface RenderSegment {
  readonly key: number
  readonly areaPath: string
  readonly path: string
}

const chartWidth = 100
const chartHeight = 48
const chartPadding = 6
const curveTension = 0.18

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

const activePointIndex = ref<number | null>(null)

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
      value: point.value,
      x: chartPadding + ((point.index / totalIntervals) * horizontalRange),
      y: chartHeight - chartPadding - (relativeValue * verticalRange),
    }
  })
})

const lineSegments = computed<readonly RenderSegment[]>(() => {
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

  return segments.map((segment, index) => {
    const path = smoothPath(segment)
    const firstPoint = segment[0]
    const lastPoint = segment[segment.length - 1]
    const baseline = chartHeight - chartPadding
    return {
      key: index,
      path,
      areaPath: `${path} L ${coordinate(lastPoint.x)} ${coordinate(baseline)} L ${coordinate(firstPoint.x)} ${coordinate(baseline)} Z`,
    }
  })
})

const activePoint = computed(() => points.value.find((point) => point.index === activePointIndex.value) ?? null)
const hasData = computed(() => points.value.length > 0)
const activeValue = computed(() => activePoint.value ? formatValue(activePoint.value.value) : '')

function coordinate(value: number): string {
  return Number(value.toFixed(3)).toString()
}

/**
 * 使用 Catmull-Rom 到贝塞尔曲线的转换，保留原始数据点但消除折线拐角。
 */
function smoothPath(segment: readonly RenderPoint[]): string {
  if (segment.length === 0) return ''
  if (segment.length === 1) return `M ${coordinate(segment[0].x)} ${coordinate(segment[0].y)}`

  const commands = [`M ${coordinate(segment[0].x)} ${coordinate(segment[0].y)}`]
  for (let index = 0; index < segment.length - 1; index += 1) {
    const previous = segment[index - 1] ?? segment[index]
    const current = segment[index]
    const next = segment[index + 1]
    const following = segment[index + 2] ?? next
    const controlOneX = current.x + ((next.x - previous.x) * curveTension)
    const controlOneY = current.y + ((next.y - previous.y) * curveTension)
    const controlTwoX = next.x - ((following.x - current.x) * curveTension)
    const controlTwoY = next.y - ((following.y - current.y) * curveTension)
    commands.push(`C ${coordinate(controlOneX)} ${coordinate(controlOneY)} ${coordinate(controlTwoX)} ${coordinate(controlTwoY)} ${coordinate(next.x)} ${coordinate(next.y)}`)
  }
  return commands.join(' ')
}

function formatValue(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function activatePoint(index: number): void {
  activePointIndex.value = index
}

function clearActivePoint(): void {
  activePointIndex.value = null
}

function activateNearestPoint(event: PointerEvent): void {
  const canvas = event.currentTarget as SVGSVGElement
  const bounds = canvas.getBoundingClientRect()
  if (bounds.width <= 0 || points.value.length === 0) return
  const cursorX = ((event.clientX - bounds.left) / bounds.width) * chartWidth
  const nearest = points.value.reduce((candidate, point) =>
    Math.abs(point.x - cursorX) < Math.abs(candidate.x - cursorX) ? point : candidate,
  )
  activatePoint(nearest.index)
}

function activateFirstPoint(): void {
  if (activePointIndex.value === null && points.value[0]) activatePoint(points.value[0].index)
}

function moveActivePoint(offset: number): void {
  if (points.value.length === 0) return
  const currentPosition = Math.max(0, points.value.findIndex((point) => point.index === activePointIndex.value))
  const nextPosition = Math.min(points.value.length - 1, Math.max(0, currentPosition + offset))
  activatePoint(points.value[nextPosition].index)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault()
    moveActivePoint(-1)
    return
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault()
    moveActivePoint(1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    if (points.value[0]) activatePoint(points.value[0].index)
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    const lastPoint = points.value[points.value.length - 1]
    if (lastPoint) activatePoint(lastPoint.index)
    return
  }
  if (event.key === 'Escape') clearActivePoint()
}
</script>

<template>
  <div
    class="gc-trend-chart"
    :class="`gc-trend-chart--${tone}`"
    role="img"
    :aria-label="ariaLabel"
    :tabindex="hasData ? 0 : undefined"
    @focus="activateFirstPoint"
    @blur="clearActivePoint"
    @keydown="handleKeydown"
  >
    <svg
      v-if="hasData"
      class="gc-trend-chart__canvas"
      viewBox="0 0 100 48"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      @pointermove="activateNearestPoint"
      @pointerdown="activateNearestPoint"
      @pointerleave="clearActivePoint"
    >
      <line class="gc-trend-chart__grid-line" x1="6" x2="94" y1="12" y2="12" />
      <line class="gc-trend-chart__grid-line" x1="6" x2="94" y1="24" y2="24" />
      <line class="gc-trend-chart__grid-line" x1="6" x2="94" y1="36" y2="36" />
      <path
        v-for="segment in lineSegments"
        :key="`area-${segment.key}`"
        class="gc-trend-chart__area"
        :d="segment.areaPath"
      />
      <path
        v-for="segment in lineSegments"
        :key="segment.key"
        class="gc-trend-chart__line"
        :d="segment.path"
      />
      <line
        v-if="activePoint"
        class="gc-trend-chart__cursor"
        :x1="activePoint.x"
        :x2="activePoint.x"
        :y1="chartPadding"
        :y2="chartHeight - chartPadding"
      />
    </svg>
    <span
      v-for="point in points"
      :key="point.index"
      class="gc-trend-chart__point"
      :class="{ 'gc-trend-chart__point--active': activePoint?.index === point.index }"
      :style="{ left: `${point.x}%`, top: `${(point.y / chartHeight) * 100}%` }"
      aria-hidden="true"
      @pointerenter="activatePoint(point.index)"
      @pointerdown="activatePoint(point.index)"
      @pointerleave="clearActivePoint"
    />
    <span
      v-if="activePoint"
      class="gc-trend-chart__tooltip"
      role="status"
      aria-live="polite"
      :style="{ left: `${activePoint.x}%`, top: `${(activePoint.y / chartHeight) * 100}%` }"
    >{{ activeValue }}</span>
    <span v-else-if="!hasData" class="gc-trend-chart__empty" aria-hidden="true">{{ emptyLabel }}</span>
  </div>
</template>

<style scoped>
.gc-trend-chart {
  position: relative;
  display: grid;
  width: 100%;
  min-width: 0;
  aspect-ratio: 25 / 12;
  outline: none;
}

.gc-trend-chart:focus-visible { box-shadow: var(--gc-shadow-focus); border-radius: var(--gc-radius-card); }

.gc-trend-chart__canvas,
.gc-trend-chart__empty {
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
}

.gc-trend-chart__canvas {
  display: block;
  overflow: visible;
  cursor: crosshair;
}

.gc-trend-chart__grid-line {
  stroke: var(--gc-color-border-subtle);
  stroke-width: var(--gc-border-width-default);
  vector-effect: non-scaling-stroke;
}

.gc-trend-chart__area { fill: var(--gc-color-info-soft); }

.gc-trend-chart__line {
  fill: none;
  stroke: var(--gc-color-info);
  stroke-width: var(--gc-border-width-thick);
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  transition: stroke 180ms ease;
}

.gc-trend-chart__cursor {
  stroke: var(--gc-color-border-strong);
  stroke-width: var(--gc-border-width-default);
  stroke-dasharray: var(--gc-space-badge-block);
  vector-effect: non-scaling-stroke;
}

.gc-trend-chart__point {
  position: absolute;
  z-index: 1;
  display: block;
  width: var(--gc-space-2);
  height: var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-info);
  border-radius: var(--gc-radius-full);
  background: var(--gc-color-info);
  cursor: crosshair;
  transform: translate(-50%, -50%);
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
}

.gc-trend-chart__point--active {
  background: var(--gc-color-info);
  border-color: var(--gc-color-info);
  transform: translate(-50%, -50%) scale(1.15);
}

.gc-trend-chart__tooltip {
  position: absolute;
  z-index: var(--gc-z-tooltip);
  min-width: var(--gc-space-10);
  padding: var(--gc-space-tight) var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border-strong);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text-strong);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
  font-size: var(--gc-font-size-xs);
  font-family: var(--gc-font-family-mono);
  font-weight: var(--gc-font-weight-semibold);
  line-height: var(--gc-line-height-tight);
  transform: translate(-50%, calc(-100% - var(--gc-space-2)));
  pointer-events: none;
}

.gc-trend-chart--success .gc-trend-chart__area { fill: var(--gc-color-success-soft); }
.gc-trend-chart--success .gc-trend-chart__line { stroke: var(--gc-color-success); }
.gc-trend-chart--success .gc-trend-chart__point { border-color: var(--gc-color-success); background: var(--gc-color-success); }
.gc-trend-chart--success .gc-trend-chart__point--active { background: var(--gc-color-success); }
.gc-trend-chart--warning .gc-trend-chart__area { fill: var(--gc-color-warning-soft); }
.gc-trend-chart--warning .gc-trend-chart__line { stroke: var(--gc-color-warning); }
.gc-trend-chart--warning .gc-trend-chart__point { border-color: var(--gc-color-warning); background: var(--gc-color-warning); }
.gc-trend-chart--warning .gc-trend-chart__point--active { background: var(--gc-color-warning); }
.gc-trend-chart--danger .gc-trend-chart__area { fill: var(--gc-color-danger-soft); }
.gc-trend-chart--danger .gc-trend-chart__line { stroke: var(--gc-color-danger); }
.gc-trend-chart--danger .gc-trend-chart__point { border-color: var(--gc-color-danger); background: var(--gc-color-danger); }
.gc-trend-chart--danger .gc-trend-chart__point--active { background: var(--gc-color-danger); }
.gc-trend-chart--muted .gc-trend-chart__area { fill: var(--gc-color-surface-muted); }
.gc-trend-chart--muted .gc-trend-chart__line { stroke: var(--gc-color-muted); }
.gc-trend-chart--muted .gc-trend-chart__point { border-color: var(--gc-color-muted); background: var(--gc-color-muted); }
.gc-trend-chart--muted .gc-trend-chart__point--active { background: var(--gc-color-muted); }

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
  .gc-trend-chart__point { transition: none; }
}
</style>
