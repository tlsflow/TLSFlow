<script setup lang="ts" generic="T extends Record<string, unknown>">
export interface DataTableColumn<T> {
  readonly key: keyof T | string
  readonly title: string
  readonly width?: string
}

withDefaults(defineProps<{
  columns: readonly DataTableColumn<T>[]
  rows: readonly T[]
  loading?: boolean
  rowKey?: string
  emptyText?: string
  dense?: boolean
}>(), {
  rowKey: 'id',
  emptyText: '暂无数据',
  dense: false,
})
</script>

<template>
  <section class="gc-card gc-data-table" :class="{ 'gc-data-table--dense': dense }">
    <div v-if="$slots.toolbar" class="gc-data-table__toolbar">
      <slot name="toolbar" />
    </div>
    <div v-if="loading" class="gc-data-table__state">加载中...</div>
    <div v-else-if="rows.length === 0" class="gc-data-table__state">{{ emptyText }}</div>
    <table v-else>
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
        <tr v-for="row in rows" :key="String(row[rowKey])">
          <td v-for="column in columns" :key="String(column.key)">
            <slot :name="`cell-${String(column.key)}`" :row="row">
              {{ row[column.key as keyof T] }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
    <footer v-if="$slots.pagination" class="gc-data-table__footer">
      <slot name="pagination" />
    </footer>
  </section>
</template>

<style scoped>
.gc-data-table { overflow: hidden; padding: 0; border-radius: var(--gc-radius-lg); }
.gc-data-table__toolbar { padding: 14px 18px; border-bottom: 1px solid var(--gc-color-border); background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised)); }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--gc-color-border); vertical-align: middle; font-size: 12px; }
th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); font-size: 11px; font-weight: 900; }
tbody tr { transition: background .16s ease; }
tbody tr:hover { background: var(--gc-color-surface-hover); }
tbody tr:last-child td { border-bottom: 0; }
.gc-data-table__state { padding: 48px var(--gc-space-8); text-align: center; color: var(--gc-color-text); font-weight: 750; }
.gc-data-table__footer { padding: 10px 18px; color: var(--gc-color-text-muted); background: var(--gc-color-surface-raised); border-top: 1px solid var(--gc-color-border); font-size: 11px; font-weight: 650; }
.gc-data-table--dense .gc-data-table__toolbar { padding: 14px 18px; }
.gc-data-table--dense th,
.gc-data-table--dense td { padding: 10px 12px; font-size: 12px; }
.gc-data-table--dense th { font-size: 11px; }
.gc-data-table--dense .gc-data-table__footer { padding: 10px 18px; font-size: 11px; }
</style>
