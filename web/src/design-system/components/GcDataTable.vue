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
.gc-data-table { overflow: hidden; padding: 0; border-radius: var(--gc-radius-lg); }
.gc-data-table__toolbar { padding: var(--gc-space-4) var(--gc-space-5); border-bottom: 1px solid var(--gc-color-border); background: linear-gradient(180deg, #fff, #fbfdff); }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
th, td { text-align: left; padding: 15px 18px; border-bottom: 1px solid var(--gc-color-border); vertical-align: middle; }
th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); font-size: var(--gc-font-size-sm); font-weight: 900; }
tbody tr { transition: background .16s ease; }
tbody tr:hover { background: #f8fbff; }
tbody tr:last-child td { border-bottom: 0; }
.gc-data-table__state { padding: 48px var(--gc-space-8); text-align: center; color: var(--gc-color-text); font-weight: 750; }
.gc-data-table__footer { padding: var(--gc-space-3) var(--gc-space-5); color: var(--gc-color-text-muted); background: #fbfdff; border-top: 1px solid var(--gc-color-border); font-size: var(--gc-font-size-sm); font-weight: 650; }
</style>
