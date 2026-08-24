<script setup lang="ts" generic="T extends Record<string, unknown>">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import GcPagination from './GcPagination.vue'

export interface DataTableColumn<T> {
  readonly key: keyof T | string
  readonly title: string
  readonly width?: string
  readonly truncate?: boolean
}

const props = withDefaults(defineProps<{
  columns: readonly DataTableColumn<T>[]
  rows: readonly T[]
  loading?: boolean
  rowKey?: string
  emptyText?: string
  /** 由调用方传入的翻译后表格区域名称。 */
  ariaLabel?: string
  dense?: boolean
  fixed?: boolean
  /** 启用内置分页（页脚导航 + 每页条数选择）。 */
  pagination?: boolean
  /** 每页条数选项；默认 [20, 50, 100]。 */
  pageSizeOptions?: readonly number[]
  /** 非受控模式下的默认每页条数；默认 20。 */
  defaultPageSize?: number
  /** 受控模式下的当前页码（服务端分页时由父级提供）。 */
  page?: number
  /** 受控模式下的每页条数。 */
  pageSize?: number
  /** 受控模式下的总记录数；缺省时取 rows.length。 */
  total?: number
  /** 内置分页是否展示总数；默认展示。 */
  paginationShowTotal?: boolean
}>(), {
  rowKey: 'id',
  dense: false,
  fixed: false,
  pagination: false,
  pageSizeOptions: () => [20, 50, 100],
  defaultPageSize: 20,
  paginationShowTotal: true,
})

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
}>()

const { t } = useI18n()

/** 受控模式：父级传入 page 时由父级负责切页与切片，组件只渲染分页 UI。 */
const isControlled = computed(() => props.page !== undefined)

const internalPage = ref(1)
const internalPageSize = ref(props.defaultPageSize)

const currentPage = computed(() => (isControlled.value ? props.page ?? 1 : internalPage.value))
const currentPageSize = computed(() => (isControlled.value ? props.pageSize ?? props.defaultPageSize : internalPageSize.value))
const totalRows = computed(() => props.total ?? props.rows.length)
const pageCount = computed(() => Math.max(1, Math.ceil(totalRows.value / Math.max(currentPageSize.value, 1))))

const displayRows = computed<readonly T[]>(() => {
  if (isControlled.value) return props.rows
  const start = (currentPage.value - 1) * currentPageSize.value
  return props.rows.slice(start, start + currentPageSize.value)
})

/** 非受控模式下数据变化后，把页码钳制到有效范围。 */
watch(
  () => [props.rows, props.defaultPageSize] as const,
  () => {
    if (!props.pagination || isControlled.value) return
    const target = Math.min(internalPage.value, pageCount.value)
    if (target !== internalPage.value) internalPage.value = target
  },
  { immediate: true },
)

function goToPage(page: number): void {
  const target = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount.value)
  if (target === currentPage.value) return
  if (isControlled.value) {
    emit('update:page', target)
  } else {
    internalPage.value = target
  }
}

function changePageSize(pageSize: number): void {
  if (pageSize <= 0 || pageSize === currentPageSize.value) return
  if (isControlled.value) {
    emit('update:pageSize', pageSize)
    return
  }
  internalPageSize.value = pageSize
  internalPage.value = 1
}
</script>

<template>
  <section
    class="gc-card gc-data-table"
    :class="{ 'gc-data-table--dense': dense, 'gc-data-table--fixed': fixed }"
    :aria-busy="loading || undefined"
    :aria-label="ariaLabel"
  >
    <div v-if="$slots.toolbar" class="gc-data-table__toolbar">
      <slot name="toolbar" />
    </div>
    <div v-if="loading" class="gc-data-table__state" role="status" aria-live="polite">{{ t('designSystem.dataTable.loading') }}</div>
    <div v-else-if="rows.length === 0" class="gc-data-table__state" role="status" aria-live="polite">
      <slot name="empty">{{ emptyText ?? t('designSystem.dataTable.empty') }}</slot>
    </div>
    <div v-else class="gc-data-table__scroll">
      <table>
        <thead>
          <tr>
            <th v-for="column in columns" :key="String(column.key)" :style="{ width: column.width }">
              <slot :name="`header-${String(column.key)}`" :column="column">
                {{ column.title }}
              </slot>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in displayRows" :key="String(row[rowKey])">
            <td
              v-for="column in columns"
              :key="String(column.key)"
              :class="{ 'gc-data-table__cell--truncate': column.truncate }"
              :title="column.truncate ? String(row[column.key as keyof T] ?? '') : undefined"
            >
              <slot :name="`cell-${String(column.key)}`" :row="row">
                {{ row[column.key as keyof T] }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer
      v-if="$slots.pagination || (pagination && rows.length > 0)"
      class="gc-data-table__footer"
    >
      <slot v-if="$slots.pagination" name="pagination" />
      <GcPagination
        v-else
        :total="totalRows"
        :page="currentPage"
        :page-size="currentPageSize"
        :page-size-options="pageSizeOptions"
        :show-total="paginationShowTotal"
        :disabled="loading"
        @update:page="goToPage"
        @update:page-size="changePageSize"
      />
    </footer>
  </section>
</template>

<style scoped>
.gc-data-table { overflow: hidden; padding: 0; border-radius: var(--gc-radius-card); }
.gc-data-table__toolbar { padding: var(--gc-space-panel) var(--gc-space-5); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); background: var(--gc-color-surface-glass); }
.gc-data-table__scroll { min-width: 0; overflow-x: auto; }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
.gc-data-table--fixed table { table-layout: fixed; }
th, td { text-align: left; padding: var(--gc-space-control) var(--gc-space-3); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); vertical-align: middle; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); }
.gc-data-table--fixed th,
.gc-data-table--fixed td { overflow-wrap: anywhere; }
.gc-data-table__cell--truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); font-size: var(--gc-font-size-caption); font-weight: 900; }
tbody tr { transition: background .16s ease; }
tbody tr:hover { background: var(--gc-color-surface-hover); }
tbody tr:last-child td { border-bottom: 0; }
.gc-data-table__state { display: grid; justify-items: center; gap: var(--gc-space-2); padding: var(--gc-space-12) var(--gc-space-8); text-align: center; color: var(--gc-color-text); font-weight: 750; }
.gc-data-table__footer { padding: var(--gc-space-control) var(--gc-space-5); color: var(--gc-color-text-muted); background: var(--gc-color-surface-glass); border-top: var(--gc-border-width-default) solid var(--gc-color-border); font-size: var(--gc-font-size-caption); font-weight: 650; }
.gc-data-table--dense .gc-data-table__toolbar { padding: var(--gc-space-panel) var(--gc-space-5); }
.gc-data-table--dense th,
.gc-data-table--dense td { padding: var(--gc-space-control) var(--gc-space-3); font-size: var(--gc-font-size-xs); }
.gc-data-table--dense th { font-size: var(--gc-font-size-caption); }
.gc-data-table--dense .gc-data-table__footer { padding: var(--gc-space-control) var(--gc-space-5); font-size: var(--gc-font-size-caption); }
</style>
