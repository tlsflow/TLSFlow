<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  GcConfirmAction,
  GcDataTable,
  GcEmptyState,
  GcPageHeader,
  GcPermissionButton,
  GcRiskBadge,
  GcStatusTag,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { usePermissionStore } from '@/stores/permission.store'
import { readNumber, readPath, readString, useBusinessPage, type ViewRow } from '@/composables/useBusinessPage'
import type { BusinessAction, BusinessPageConfig } from './business-page.types'

const props = defineProps<{ config: BusinessPageConfig }>()

const permissionStore = usePermissionStore()
const state = useBusinessPage(props.config)
const selectedId = ref<string | null>(null)
const primaryActionError = ref('')
const primaryActionPending = ref(false)

const tableColumns = computed<DataTableColumn<ViewRow>[]>(() =>
  props.config.columns.map((column) => ({ key: column.key, title: column.title })),
)
const hasDangerAction = computed(() => props.config.actions.some((action) => action.danger))
const visibleActions = computed(() =>
  props.config.actions.filter((action) =>
    permissionStore.hasPermission(action.permission)
    && !(action.hidden?.(selectedRow.value) ?? false),
  ),
)
const selectedRow = computed(() =>
  state.rows.value.find((row) => row.id === selectedId.value) ?? state.rows.value[0] ?? null,
)
const detailFields = computed(
  () => props.config.detailFields ?? props.config.columns.map((column) => ({ label: column.title, candidates: column.candidates })),
)
const filterValues = computed(() => props.config.filterValues ?? {})
const showHeader = computed(() => props.config.showHeader !== false)
const showMetrics = computed(() => props.config.showMetrics !== false)
const showEmptyState = computed(() => props.config.showEmptyState !== false)
const showPrimaryAction = computed(() => Boolean(props.config.primaryAction))
const showDetailPanel = computed(() => props.config.showDetailPanel === true)
const showActionPanel = computed(() => props.config.showActionPanel === true)
const hasRowDangerAction = computed(() => (props.config.rowActions ?? []).some((action) => action.danger))

watch(
  () => state.rows.value,
  (rows) => {
    if (rows.length === 0) {
      selectedId.value = null
      return
    }
    if (!selectedId.value || !rows.some((row) => row.id === selectedId.value)) {
      selectedId.value = rows[0]?.id ?? null
    }
  },
  { immediate: true },
)

watch(
  selectedRow,
  (row) => {
    props.config.onSelectionChange?.(row)
  },
  { immediate: true },
)

function metricCount(metricTitle: string): number {
  const matched = state.rows.value.filter(
    (row) => row.risk === 'HIGH' || row.risk === 'CRITICAL' || row.status === 'FAILED' || row.status === 'DRIFTED',
  )
  if (metricTitle.includes('总数') || metricTitle.includes('全部')) return state.total.value
  return matched.length
}

async function runAction(action: BusinessAction) {
  if (!action.run) return
  if (action.requiresSelection && !selectedRow.value) return
  if (action.hidden?.(selectedRow.value) ?? false) return
  const disabledReason = action.disabledReason?.(selectedRow.value)
  if (disabledReason) throw new Error(disabledReason)
  await action.run(selectedRow.value ?? undefined)
  await state.reload()
}

async function runRowAction(row: ViewRow, actionIndex: number) {
  const action = props.config.rowActions?.[actionIndex]
  if (!action?.run) return
  await action.run(row)
  if (action.reloadAfterRun !== false) {
    await state.reload()
  }
}

async function runPrimaryAction() {
  if (!props.config.primaryAction || primaryActionPending.value) return
  primaryActionPending.value = true
  primaryActionError.value = ''
  try {
    await props.config.primaryAction()
  } catch (cause) {
    primaryActionError.value = cause instanceof Error ? cause.message : '主操作执行失败'
  } finally {
    primaryActionPending.value = false
  }
}

function selectRow(row: ViewRow) {
  selectedId.value = row.id
}

async function updateFilter(key: string, value: string) {
  props.config.onFiltersChange?.({
    ...filterValues.value,
    [key]: value,
  })
  await state.reload()
}

async function clearFilters() {
  props.config.onFiltersChange?.({})
  await state.reload()
}

function detailValue(row: ViewRow, candidates: readonly string[]): string {
  return readString(row.raw, candidates)
}

function linkQueryValue(row: ViewRow, candidates: readonly string[]): string | null {
  const value = candidates
    .map((candidate) => readPath(row.raw, candidate))
    .find((item) => item !== undefined && item !== null && item !== '')
  return value === undefined || value === null || value === '' ? null : String(value)
}

function linkTarget(row: ViewRow, link: NonNullable<BusinessPageConfig['contextLinks']>[number]) {
  const value = linkQueryValue(row, link.candidates)
  if (!value) return null
  if (link.to.includes(':id')) {
    return { path: link.to.replace(':id', encodeURIComponent(value)) }
  }
  return { path: link.to, query: { [link.queryKey]: value } }
}

function isRowActionHidden(row: ViewRow, actionIndex: number): boolean {
  const action = props.config.rowActions?.[actionIndex]
  if (!action) return true
  return action.hidden?.(row) ?? false
}

defineExpose({
  reload: state.reload,
})
</script>

<template>
  <section class="gc-page business-page" :data-module="config.moduleName">
    <GcPageHeader v-if="showHeader" :title="config.title" :description="config.description">
      <template #actions>
        <GcPermissionButton :permission="config.primaryPermission" :disabled="primaryActionPending" @click="runPrimaryAction">
          {{ primaryActionPending ? '处理中…' : config.primaryActionLabel }}
        </GcPermissionButton>
      </template>
    </GcPageHeader>

    <p v-if="primaryActionError" class="business-page__primary-error">{{ primaryActionError }}</p>
    <slot name="after-header" />

    <section v-if="showMetrics" class="business-page__metrics" aria-label="业务指标">
      <article v-for="metric in config.metrics" :key="metric.title" class="gc-card business-page__metric">
        <strong>{{ metric.title }}</strong>
        <span class="business-page__metric-count">{{ metricCount(metric.title) }}</span>
        <p>{{ metric.description }}</p>
        <footer>
          <GcStatusTag :status="metric.status" />
          <GcRiskBadge :risk="metric.risk" />
        </footer>
      </article>
    </section>

    <GcEmptyState v-if="state.error.value" title="接口调用失败" :description="state.error.value.message">
      <p>错误码：{{ state.error.value.errorCode }}</p>
      <p v-if="state.error.value.requestId">requestId：{{ state.error.value.requestId }}</p>
      <button class="gc-button" type="button" @click="state.reload">重试</button>
    </GcEmptyState>

    <GcDataTable
      v-else
      :columns="tableColumns"
      :rows="state.rows.value"
      :loading="state.loading.value"
      :empty-text="config.emptyTitle"
      dense
    >
      <template #toolbar>
        <div class="business-page__toolbar">
          <div class="business-page__toolbar-title">
            <strong>{{ config.resourceName }}列表</strong>
            <span>总数 {{ state.total.value }}</span>
          </div>
          <div class="business-page__toolbar-actions">
            <GcPermissionButton
              v-if="!showHeader && showPrimaryAction"
              class="business-page__primary-button"
              :permission="config.primaryPermission"
              :disabled="primaryActionPending"
              @click="runPrimaryAction"
            >
              {{ primaryActionPending ? '处理中…' : config.primaryActionLabel }}
            </GcPermissionButton>
            <span v-if="hasDangerAction || hasRowDangerAction" class="business-page__pill business-page__pill--danger">高危操作需确认</span>
            <button class="gc-button" type="button" @click="state.reload">刷新</button>
          </div>
        </div>
        <form v-if="config.filters?.length" class="business-page__filters" @submit.prevent="state.reload">
          <label v-for="filter in config.filters" :key="filter.key" class="business-page__filter">
            <span>{{ filter.label }}</span>
            <select
              v-if="filter.type === 'select'"
              :value="filterValues[filter.key] ?? ''"
              @change="updateFilter(filter.key, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">全部</option>
              <option v-for="option in filter.options ?? []" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <input
              v-else
              :value="filterValues[filter.key] ?? ''"
              :placeholder="filter.placeholder"
              @change="updateFilter(filter.key, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <button class="gc-button" type="button" @click="clearFilters">清空筛选</button>
        </form>
      </template>

      <template #cell-name="{ row }">
        <button
          class="business-page__row-link"
          type="button"
          :aria-pressed="selectedRow?.id === row.id"
          @click="selectRow(row)"
        >
          {{ row.name }}
        </button>
      </template>

      <template #cell-status="{ row }">
        <GcStatusTag :status="String(row.status)" />
      </template>

      <template #cell-risk="{ row }">
        <GcRiskBadge :risk="row.risk" />
      </template>

      <template #cell-count="{ row }">
        {{ readNumber(row.raw, ['count', 'targetCount', 'affectedCount']) ?? row.count }}
      </template>

      <template #cell-actions="{ row }">
        <div class="business-page__row-actions">
          <template v-for="(action, index) in config.rowActions ?? []" :key="`${row.id}-${action.label}`">
            <GcConfirmAction
              v-if="action.danger && permissionStore.hasPermission(action.permission) && !isRowActionHidden(row, index)"
              :action-name="action.label"
              :impact-count="1"
              :risk-text="action.riskText"
              :confirm-text="action.confirmText"
              :disabled="Boolean(action.disabledReason?.(row))"
              :disabled-reason="action.disabledReason?.(row)"
              @confirm="runRowAction(row, index)"
            />
            <GcPermissionButton
              v-else-if="!action.danger && !isRowActionHidden(row, index)"
              :permission="action.permission"
              :danger="action.danger"
              @click="runRowAction(row, index)"
            >
              {{ action.label }}
            </GcPermissionButton>
          </template>
        </div>
      </template>

      <template #pagination>
        第 {{ state.page.value?.page ?? 1 }} 页 / 每页 {{ state.page.value?.pageSize ?? 20 }} 条
      </template>
    </GcDataTable>

    <GcEmptyState
      v-if="showEmptyState && !state.loading.value && !state.error.value && state.rows.value.length === 0"
      :title="config.emptyTitle"
      :description="config.emptyDescription"
    />

    <aside v-if="showDetailPanel && selectedRow" class="gc-card business-page__detail" aria-label="资源详情">
      <header>
        <div>
          <p>{{ config.resourceName }}详情</p>
          <h2>{{ selectedRow.name }}</h2>
        </div>
        <GcStatusTag :status="selectedRow.status" />
      </header>
      <dl>
        <template v-for="field in detailFields" :key="field.label">
          <dt>{{ field.label }}</dt>
          <dd>{{ detailValue(selectedRow, field.candidates) }}</dd>
        </template>
      </dl>
      <nav v-if="config.contextLinks?.length" class="business-page__context" aria-label="上下文入口">
        <template v-for="link in config.contextLinks" :key="link.label">
          <RouterLink
            v-if="linkTarget(selectedRow, link)"
            class="gc-button"
            :to="linkTarget(selectedRow, link)!"
          >
            {{ link.label }}
          </RouterLink>
        </template>
      </nav>
    </aside>

    <section v-if="showActionPanel && visibleActions.length" class="gc-card business-page__actions" aria-label="资源操作">
      <div class="business-page__actions-copy">
        <p>资源操作</p>
        <h2>{{ selectedRow?.name ?? config.resourceName }}</h2>
        <span>高危动作必须二次确认，授权仍以后端校验为准。</span>
      </div>
      <div class="business-page__actions-list">
        <template v-for="action in visibleActions" :key="action.label">
          <GcConfirmAction
            v-if="action.danger && permissionStore.hasPermission(action.permission)"
            :action-name="action.label"
            :impact-count="action.requiresSelection ? 1 : state.total.value"
            :risk-text="action.riskText"
            :confirm-text="action.confirmText"
            :disabled="Boolean(action.disabledReason?.(selectedRow))"
            :disabled-reason="action.disabledReason?.(selectedRow)"
            @confirm="runAction(action)"
          />
          <GcPermissionButton
            v-else-if="!action.danger"
            :permission="action.permission"
            :danger="action.danger"
            :disabled="Boolean(action.disabledReason?.(selectedRow))"
            @click="runAction(action)"
          >
            {{ action.label }}
          </GcPermissionButton>
        </template>
      </div>
    </section>
  </section>
</template>

<style scoped>
.business-page { display: grid; gap: var(--gc-space-5); }
.business-page__primary-error {
  margin: 0;
  border: 1px solid #fecaca;
  border-radius: 14px;
  padding: 12px 14px;
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: 750;
}
.business-page__metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--gc-space-4); }
.business-page__metric {
  position: relative;
  display: grid;
  gap: var(--gc-space-3);
  min-height: 150px;
  padding: 28px;
  overflow: hidden;
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.business-page__metric::after {
  content: '';
  position: absolute;
  top: 24px;
  right: 24px;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--gc-color-primary-weak), #fff);
  box-shadow: inset 0 0 0 1px #dbeafe;
}
.business-page__metric:hover { transform: translateY(-2px); box-shadow: var(--gc-shadow-md); border-color: #dbeafe; }
.business-page__metric strong { color: var(--gc-color-text-muted); font-weight: 850; }
.business-page__metric-count { color: #05070d; font-size: 40px; line-height: 1; font-weight: 950; letter-spacing: -0.055em; }
.business-page__metric p { max-width: 86%; margin: 0; color: var(--gc-color-text-muted); line-height: 1.55; }
.business-page__metric footer { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); align-items: center; }
.business-page__toolbar { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: center; }
.business-page__toolbar-title { display: grid; gap: var(--gc-space-1); }
.business-page__toolbar-title strong { font-size: 17px; letter-spacing: -0.02em; }
.business-page__toolbar-title span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 650; }
.business-page__toolbar-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); align-items: center; }
.business-page__filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--gc-space-3);
  align-items: end;
  margin-top: var(--gc-space-4);
}
.business-page__filter {
  display: grid;
  gap: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}
.business-page__filter input,
.business-page__filter select {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 11px;
  padding: 9px 11px;
  color: var(--gc-color-text);
  background: #fff;
}
.business-page__pill {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  border-radius: 999px;
  padding: 0 11px;
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}
.business-page__primary-button {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-primary);
  color: #fff;
}
.business-page__primary-button:hover:not(:disabled),
.business-page__primary-button:focus-visible:not(:disabled) {
  border-color: var(--gc-color-primary-hover);
  background: var(--gc-color-primary-hover);
  color: #fff;
}
.business-page__pill--danger { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.business-page__row-link { border: 0; background: transparent; color: var(--gc-color-primary); font: inherit; font-weight: 900; padding: 0; cursor: pointer; }
.business-page__row-link[aria-pressed="true"] { color: var(--gc-color-primary-hover); text-decoration: underline; text-underline-offset: 4px; }
.business-page__row-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.business-page__detail { display: grid; gap: var(--gc-space-4); padding: 26px; }
.business-page__detail header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.business-page__detail h2, .business-page__detail p { margin: 0; }
.business-page__detail h2 { margin-top: var(--gc-space-1); font-size: 24px; letter-spacing: -0.04em; }
.business-page__detail p, .business-page__detail dt { color: var(--gc-color-text-muted); font-weight: 800; }
.business-page__detail dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.business-page__detail dt { margin-bottom: var(--gc-space-1); font-size: var(--gc-font-size-xs); }
.business-page__detail dd { margin: 0; overflow-wrap: anywhere; font-weight: 750; }
.business-page__context { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); padding-top: var(--gc-space-2); border-top: 1px solid var(--gc-color-border); }
.business-page__actions { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--gc-space-4); align-items: center; }
.business-page__actions-copy { display: grid; gap: 3px; }
.business-page__actions-copy p, .business-page__actions-copy h2 { margin: 0; }
.business-page__actions-copy p { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.business-page__actions-copy h2 { font-size: 20px; letter-spacing: -0.03em; }
.business-page__actions-copy span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.business-page__actions-list { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); }
@media (max-width: 1100px) {
  .business-page__toolbar { align-items: flex-start; flex-direction: column; }
  .business-page__toolbar-actions { justify-content: flex-start; }
  .business-page__detail dl { grid-template-columns: 1fr; }
}
</style>
