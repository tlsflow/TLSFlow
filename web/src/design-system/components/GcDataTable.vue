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
}>(), {
  rowKey: 'id',
  emptyText: '暂无数据'
})
</script>

<template>
  <section class="gc-card gc-data-table">
    <div v-if="$slots.toolbar" class="gc-data-table__toolbar">
      <slot name="toolbar" />
    </div>
    <div v-if="loading" class="gc-data-table__state">加载中...</div>
    <div v-else-if="rows.length === 0" class="gc-data-table__state">{{ emptyText }}</div>
    <table v-else>
      <thead>
        <tr>
          <th v-for="column in columns" :key="String(column.key)" :style="{ width: column.width }">
            {{ column.title }}
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
    <footer class="gc-data-table__footer">
      <slot name="pagination">服务端分页占位</slot>
    </footer>
  </section>
</template>

<style scoped>
.gc-data-table { overflow: hidden; padding: 0; }
.gc-data-table__toolbar { padding: var(--gc-space-4); border-bottom: 1px solid var(--gc-color-border); }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--gc-color-border); }
th { background: var(--gc-color-surface-muted); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.gc-data-table__state { padding: var(--gc-space-8); text-align: center; color: var(--gc-color-text-muted); }
.gc-data-table__footer { padding: var(--gc-space-3) var(--gc-space-4); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
</style>
