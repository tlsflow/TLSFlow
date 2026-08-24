<script setup lang="ts" generic="T extends Record<string, unknown>">
import { useI18n } from 'vue-i18n'

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
  /** 由调用方传入的翻译后表格区域名称。 */
  ariaLabel?: string
  dense?: boolean
}>(), {
  rowKey: 'id',
  dense: false,
})

const { t } = useI18n()
</script>

<template>
  <section
    class="gc-card gc-data-table"
    :class="{ 'gc-data-table--dense': dense }"
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
          <tr v-for="row in rows" :key="String(row[rowKey])">
            <td v-for="column in columns" :key="String(column.key)">
              <slot :name="`cell-${String(column.key)}`" :row="row">
                {{ row[column.key as keyof T] }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <footer v-if="$slots.pagination" class="gc-data-table__footer">
      <slot name="pagination" />
    </footer>
  </section>
</template>

<style scoped>
.gc-data-table { overflow: hidden; padding: 0; border-radius: var(--gc-radius-card); }
.gc-data-table__toolbar { padding: var(--gc-space-panel) var(--gc-space-5); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); background: var(--gc-color-surface-raised); }
.gc-data-table__scroll { min-width: 0; overflow-x: auto; }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
th, td { text-align: left; padding: var(--gc-space-control) var(--gc-space-3); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); vertical-align: middle; color: var(--gc-color-text); font-size: var(--gc-font-size-xs); }
th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); font-size: var(--gc-font-size-caption); font-weight: 900; }
tbody tr { transition: background .16s ease; }
tbody tr:hover { background: var(--gc-color-surface-hover); }
tbody tr:last-child td { border-bottom: 0; }
.gc-data-table__state { display: grid; justify-items: center; gap: var(--gc-space-2); padding: var(--gc-space-12) var(--gc-space-8); text-align: center; color: var(--gc-color-text); font-weight: 750; }
.gc-data-table__footer { padding: var(--gc-space-control) var(--gc-space-5); color: var(--gc-color-text-muted); background: var(--gc-color-surface-raised); border-top: var(--gc-border-width-default) solid var(--gc-color-border); font-size: var(--gc-font-size-caption); font-weight: 650; }
.gc-data-table--dense .gc-data-table__toolbar { padding: var(--gc-space-panel) var(--gc-space-5); }
.gc-data-table--dense th,
.gc-data-table--dense td { padding: var(--gc-space-control) var(--gc-space-3); font-size: var(--gc-font-size-xs); }
.gc-data-table--dense th { font-size: var(--gc-font-size-caption); }
.gc-data-table--dense .gc-data-table__footer { padding: var(--gc-space-control) var(--gc-space-5); font-size: var(--gc-font-size-caption); }
</style>
