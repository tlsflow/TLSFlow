<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  /** 总记录数。 */
  total: number
  /** 当前页码（从 1 开始）。 */
  page: number
  /** 每页记录数。 */
  pageSize: number
  /** 可选的每页条数选项；默认 [20, 50, 100]。 */
  pageSizeOptions?: readonly number[]
  /** 是否在页脚展示总数；默认展示。 */
  showTotal?: boolean
  /** 禁用分页交互。 */
  disabled?: boolean
}>(), {
  pageSizeOptions: () => [20, 50, 100],
  showTotal: true,
  disabled: false,
})

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
}>()

const { t } = useI18n()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / Math.max(props.pageSize, 1))))
const isFirstPage = computed(() => props.page <= 1)
const isLastPage = computed(() => props.page >= pageCount.value)

/** 页码序列；-1 表示省略号占位。 */
const pageItems = computed<number[]>(() => {
  const count = pageCount.value
  const current = props.page
  if (count <= 7) {
    return Array.from({ length: count }, (_, index) => index + 1)
  }
  const pages = new Set<number>([1, count, current - 1, current, current + 1])
  const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b)
  const output: number[] = []
  let previous = 0
  for (const p of sorted) {
    if (previous > 0 && p - previous > 1) output.push(-1)
    output.push(p)
    previous = p
  }
  return output
})

function goTo(page: number): void {
  if (props.disabled) return
  const target = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount.value)
  if (target !== props.page) emit('update:page', target)
}

function changePageSize(event: Event): void {
  if (props.disabled) return
  const size = Number((event.target as HTMLSelectElement).value)
  if (Number.isFinite(size) && size > 0 && size !== props.pageSize) {
    emit('update:pageSize', size)
  }
}
</script>

<template>
  <nav
    class="gc-pagination"
    :aria-label="t('designSystem.pagination.pager')"
    :class="{ 'gc-pagination--disabled': disabled }"
  >
    <span v-if="showTotal" class="gc-pagination__total">
      {{ t('designSystem.pagination.total', { count: total }) }}
    </span>

    <select
      class="gc-pagination__size-select"
      :value="pageSize"
      :disabled="disabled"
      :aria-label="t('designSystem.pagination.pageSize', { size: pageSize })"
      @change="changePageSize"
    >
      <option v-for="size in pageSizeOptions" :key="size" :value="size">{{ size }}</option>
    </select>

    <div class="gc-pagination__controls">
      <button
        class="gc-pagination__button"
        type="button"
        :disabled="disabled || isFirstPage"
        :aria-label="t('designSystem.pagination.previous')"
        @click="goTo(page - 1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>

      <template v-for="(item, index) in pageItems" :key="item === -1 ? `ellipsis-${index}` : item">
        <span v-if="item === -1" class="gc-pagination__ellipsis" aria-hidden="true">…</span>
        <button
          v-else
          class="gc-pagination__button gc-pagination__page"
          :class="{ 'gc-pagination__page--active': item === page }"
          type="button"
          :disabled="disabled"
          :aria-label="t('designSystem.pagination.goToPage', { page: item })"
          :aria-current="item === page ? 'page' : undefined"
          @click="goTo(item)"
        >
          {{ item }}
        </button>
      </template>

      <button
        class="gc-pagination__button"
        type="button"
        :disabled="disabled || isLastPage"
        :aria-label="t('designSystem.pagination.next')"
        @click="goTo(page + 1)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.gc-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
}
.gc-pagination--disabled { opacity: .55; }
.gc-pagination__total { white-space: nowrap; }

.gc-pagination__size-select {
  min-height: var(--gc-control-height-xs);
  border: 0;
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: 0;
  padding: 0 var(--gc-space-1);
  color: var(--gc-color-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.gc-pagination__size-select:focus-visible,
.gc-pagination__button:focus-visible {
  outline: var(--gc-border-width-default) solid var(--gc-color-focus);
  outline-offset: var(--gc-space-tight);
  box-shadow: var(--gc-shadow-focus);
}

.gc-pagination__controls {
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-tight);
}
.gc-pagination__button {
  display: inline-grid;
  place-items: center;
  min-width: var(--gc-control-height-xs);
  min-height: var(--gc-control-height-xs);
  padding: 0 var(--gc-space-1);
  border: 0;
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
  cursor: pointer;
  transition: color .16s ease, background .16s ease;
}
.gc-pagination__button:hover:not(:disabled) {
  color: var(--gc-color-text);
  background: var(--gc-color-surface-hover);
}
.gc-pagination__button:disabled { cursor: default; opacity: .4; }
.gc-pagination__button svg {
  width: var(--gc-font-size-sm);
  height: var(--gc-font-size-sm);
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.gc-pagination__page--active {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-weight: 850;
}
.gc-pagination__ellipsis { padding: 0 var(--gc-space-tight); }
</style>
