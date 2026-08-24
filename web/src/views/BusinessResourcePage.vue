<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { ApiPage, ApiRecord } from '@/api/modules/common'
import {
  GcConfirmAction,
  GcDataTable,
  GcEmptyState,
  GcPageHeader,
  GcPageToolbar,
  GcPermissionButton,
  GcRiskBadge,
  GcStatusTag,
} from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'
import { usePermissionStore } from '@/stores/permission.store'
import { readNumber, readPath, readString, useBusinessPage, type ViewRow } from '@/composables/useBusinessPage'
import { formatMaybeLocalTimeByCandidates } from '@/utils/browser-local-time'
import type { BusinessAction, BusinessMetricCard, BusinessPageConfig } from './business-page.types'

const props = defineProps<{ config: BusinessPageConfig }>()

const { t } = useI18n()
const permissionStore = usePermissionStore()
const state = useBusinessPage(props.config, { t })
const selectedId = ref<string | null>(null)
const primaryActionError = ref('')
const primaryActionPending = ref(false)

const tableColumns = computed<DataTableColumn<ViewRow>[]>(() =>
  props.config.columns.map((column) => ({
    key: column.key,
    title: column.title,
    width: column.width,
    truncate: column.truncate,
  })),
)
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
const hasFilters = computed(() => Boolean(props.config.filters?.length))
const filtersVisible = ref(false)

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

function metricCount(metric: BusinessMetricCard): number {
  const matched = state.rows.value.filter(
    (row) => row.risk === 'HIGH' || row.risk === 'CRITICAL' || row.status === 'FAILED' || row.status === 'DRIFTED',
  )
  if (metric.kind === 'total') return state.total.value
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
    primaryActionError.value = cause instanceof Error ? cause.message : t('businessPage.primaryActionFailed')
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

function toggleFilters() {
  filtersVisible.value = !filtersVisible.value
}

function detailValue(row: ViewRow, candidates: readonly string[]): string {
  return formatMaybeLocalTimeByCandidates(readString(row.raw, candidates), candidates)
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

function upsertRecord(record: ApiRecord, options: { prepend?: boolean } = {}) {
  const recordId = readString(record, ['id', 'resourceId', 'certificateId', 'planId', 'runId', 'eventId'], '')
  if (!recordId) return
  const currentPage: ApiPage = state.page.value ?? { items: [], page: 1, pageSize: 20, total: 0 }
  const existingIndex = currentPage.items.findIndex((item) =>
    readString(item, ['id', 'resourceId', 'certificateId', 'planId', 'runId', 'eventId'], '') === recordId,
  )
  const items = [...currentPage.items]
  if (existingIndex >= 0) {
    items[existingIndex] = {
      ...items[existingIndex],
      ...record,
    }
  } else if (options.prepend) {
    items.unshift(record)
  } else {
    items.push(record)
  }
  const pageSize = currentPage.pageSize > 0 ? currentPage.pageSize : items.length
  state.page.value = {
    ...currentPage,
    items: items.slice(0, Math.max(pageSize, 1)),
    total: existingIndex >= 0 ? currentPage.total : currentPage.total + 1,
  }
}

function patchRecord(recordId: string, patch: ApiRecord) {
  if (!recordId || !state.page.value) return
  state.page.value = {
    ...state.page.value,
    items: state.page.value.items.map((item) => {
      const currentId = readString(item, ['id', 'resourceId', 'certificateId', 'planId', 'runId', 'eventId'], '')
      return currentId === recordId
        ? {
          ...item,
          ...patch,
        }
        : item
    }),
  }
}

defineExpose({
  reload: state.reload,
  upsertRecord,
  patchRecord,
})
</script>

<template>
  <section class="gc-page business-page" :data-module="config.moduleName">
    <GcPageHeader v-if="showHeader" :title="config.title" :description="config.description" />

    <p v-if="primaryActionError" class="business-page__primary-error">{{ primaryActionError }}</p>
    <slot name="after-header" />

    <section v-if="showMetrics" class="business-page__metrics" :aria-label="t('businessPage.metricsAria')">
      <article v-for="metric in config.metrics" :key="metric.title" class="gc-card business-page__metric">
        <strong>{{ metric.title }}</strong>
        <span class="business-page__metric-count">{{ metricCount(metric) }}</span>
        <p>{{ metric.description }}</p>
        <footer>
          <GcStatusTag :status="metric.status" />
          <GcRiskBadge :risk="metric.risk" />
        </footer>
      </article>
    </section>

    <GcEmptyState v-if="state.error.value" :title="t('businessPage.apiFailed')" :description="state.error.value.message">
      <p>{{ t('businessPage.errorCode', { code: state.error.value.errorCode }) }}</p>
      <p v-if="state.error.value.requestId">requestId：{{ state.error.value.requestId }}</p>
      <button class="gc-button" type="button" @click="state.reload">{{ t('businessPage.retry') }}</button>
      <GcPermissionButton
        v-if="showPrimaryAction"
        class="gc-button gc-button--primary"
        :permission="config.primaryPermission"
        :disabled="primaryActionPending"
        @click="runPrimaryAction"
      >
        {{ primaryActionPending ? t('businessPage.processing') : config.primaryActionLabel }}
      </GcPermissionButton>
    </GcEmptyState>

    <GcDataTable
      v-else
      :columns="tableColumns"
      :rows="state.rows.value"
      :loading="state.loading.value"
      :empty-text="config.emptyTitle"
      :aria-label="t('businessPage.resourceList', { resource: config.resourceName })"
      dense
      :fixed="config.tableFixed"
    >
      <template #toolbar>
        <div class="business-page__toolbar">
          <div class="business-page__toolbar-title">
            <strong>{{ t('businessPage.resourceList', { resource: config.resourceName }) }}</strong>
            <span>{{ t('businessPage.total', { count: state.total.value }) }}</span>
          </div>
          <GcPageToolbar class="business-page__toolbar-actions">
            <template #actions>
              <button
                v-if="hasFilters"
                class="gc-button"
                type="button"
                :aria-expanded="filtersVisible"
                @click="toggleFilters"
              >
                {{ t('businessPage.toggleFilters') }}
              </button>
              <slot name="toolbar-actions-before-refresh" />
              <button class="gc-button" type="button" @click="state.reload">{{ t('common.refresh') }}</button>
            </template>
            <template #primary>
              <GcPermissionButton
                v-if="showPrimaryAction"
                class="gc-button gc-button--primary"
                :permission="config.primaryPermission"
                :disabled="primaryActionPending"
                @click="runPrimaryAction"
              >
                {{ primaryActionPending ? t('businessPage.processing') : config.primaryActionLabel }}
              </GcPermissionButton>
            </template>
          </GcPageToolbar>
        </div>
        <form v-if="hasFilters && filtersVisible" class="business-page__filters" @submit.prevent="state.reload">
          <label v-for="filter in config.filters" :key="filter.key" class="business-page__filter">
            <span>{{ filter.label }}</span>
            <select
              v-if="filter.type === 'select'"
              :value="filterValues[filter.key] ?? ''"
              @change="updateFilter(filter.key, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('businessPage.all') }}</option>
              <option v-for="option in filter.options ?? []" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <input
              v-else
              :value="filterValues[filter.key] ?? ''"
              :placeholder="filter.placeholder"
              @change="updateFilter(filter.key, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <button class="gc-button" type="button" @click="clearFilters">{{ t('businessPage.clearFilters') }}</button>
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

      <template #cell-updateNeeded="{ row }">
        <GcStatusTag
          v-if="readString(row.raw, ['updateNeeded'], String(row.updateNeeded ?? ''))"
          :status="readString(row.raw, ['updateNeeded'], String(row.updateNeeded ?? 'UNKNOWN'))"
        />
        <span v-else>—</span>
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
              :danger="action.danger"
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

      <template #empty>
        <div v-if="showEmptyState" class="business-page__table-empty">
          <strong>{{ config.emptyTitle }}</strong>
          <p v-if="config.emptyDescription">{{ config.emptyDescription }}</p>
        </div>
        <span v-else>{{ config.emptyTitle }}</span>
      </template>

      <template #pagination>
        {{ t('businessPage.pagination', { page: state.page.value?.page ?? 1, pageSize: state.page.value?.pageSize ?? 20 }) }}
      </template>
    </GcDataTable>

    <aside v-if="showDetailPanel && selectedRow" class="gc-card business-page__detail" :aria-label="t('businessPage.resourceDetailAria')">
      <header>
        <div>
          <p>{{ t('businessPage.resourceDetailTitle', { resource: config.resourceName }) }}</p>
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
      <nav v-if="config.contextLinks?.length" class="business-page__context" :aria-label="t('businessPage.contextAria')">
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

    <section v-if="showActionPanel && visibleActions.length" class="gc-card business-page__actions" :aria-label="t('businessPage.resourceActionsAria')">
      <div class="business-page__actions-copy">
        <p>{{ t('businessPage.resourceActionsTitle') }}</p>
        <h2>{{ selectedRow?.name ?? config.resourceName }}</h2>
        <span>{{ t('businessPage.resourceActionsHint') }}</span>
      </div>
      <div class="business-page__actions-list">
        <template v-for="action in visibleActions" :key="action.label">
          <GcConfirmAction
            v-if="action.danger && permissionStore.hasPermission(action.permission)"
            :action-name="action.label"
            :impact-count="action.requiresSelection ? 1 : state.total.value"
            :risk-text="action.riskText"
            :confirm-text="action.confirmText"
            :danger="action.danger"
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
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-card);
  padding: var(--gc-space-3) var(--gc-space-4);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: 750;
}
.business-page__metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); }
.business-page__metric {
  display: grid;
  gap: var(--gc-space-3);
  min-height: var(--gc-size-card-min);
  padding: var(--gc-space-7);
  transition: box-shadow .16s ease, border-color .16s ease, background .16s ease;
}
.business-page__metric:hover { background: var(--gc-color-surface-hover); box-shadow: var(--gc-shadow-md); border-color: var(--gc-color-info-border); }
.business-page__metric strong { color: var(--gc-color-text-muted); font-weight: 850; }
.business-page__metric-count { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-2xl); line-height: 1; font-weight: 950; }
.business-page__metric p { margin: 0; color: var(--gc-color-text-muted); line-height: var(--gc-line-height-relaxed); }
.business-page__metric footer { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); align-items: center; }
.business-page__toolbar { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: center; }
.business-page__toolbar-title { display: grid; gap: var(--gc-space-1); }
.business-page__toolbar-title strong { font-size: var(--gc-font-size-sm); letter-spacing: 0; }
.business-page__toolbar-title span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 650; }
.business-page__toolbar-actions { min-width: 0; }
.business-page__toolbar-actions :deep(.gc-button),
.business-page__toolbar-actions :deep(.gc-permission-button),
.business-page__row-actions :deep(.gc-button),
.business-page__row-actions :deep(.gc-permission-button) {
  min-height: var(--gc-control-height-xs);
  padding: 0 var(--gc-space-2);
  font-size: var(--gc-font-size-xs);
}
.business-page__filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr));
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
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  padding: var(--gc-space-2);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
}
.business-page__filter input:focus-visible,
.business-page__filter select:focus-visible,
.business-page__row-link:focus-visible {
  outline: var(--gc-border-width-default) solid var(--gc-color-focus);
  outline-offset: var(--gc-space-tight);
  box-shadow: var(--gc-shadow-focus);
}
.business-page__row-link { border: 0; background: transparent; color: var(--gc-color-primary); font: inherit; font-weight: 900; padding: 0; cursor: pointer; }
.business-page__row-link[aria-pressed="true"] { color: var(--gc-color-primary-hover); text-decoration: underline; text-underline-offset: var(--gc-space-1); }
.business-page__row-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.business-page__table-empty { display: grid; justify-items: center; gap: var(--gc-space-2); }
.business-page__table-empty strong { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-heading-xs); line-height: var(--gc-line-height-tight); }
.business-page__table-empty p { max-width: var(--gc-size-content-readable); margin: 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); line-height: var(--gc-line-height-relaxed); }
.business-page__detail { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-7); }
.business-page__detail header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.business-page__detail h2, .business-page__detail p { margin: 0; }
.business-page__detail h2 { margin-top: var(--gc-space-1); font-size: var(--gc-font-size-xl); }
.business-page__detail p, .business-page__detail dt { color: var(--gc-color-text-muted); font-weight: 800; }
.business-page__detail dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.business-page__detail dt { margin-bottom: var(--gc-space-1); font-size: var(--gc-font-size-xs); }
.business-page__detail dd { margin: 0; overflow-wrap: anywhere; font-weight: 750; }
.business-page__context { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); padding-top: var(--gc-space-2); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.business-page__actions { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--gc-space-4); align-items: center; }
.business-page__actions-copy { display: grid; gap: var(--gc-space-1); }
.business-page__actions-copy p, .business-page__actions-copy h2 { margin: 0; }
.business-page__actions-copy p { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.business-page__actions-copy h2 { font-size: var(--gc-font-size-lg); }
.business-page__actions-copy span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); }
.business-page__actions-list { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); }
@media (max-width: 68.75rem) {
  .business-page__toolbar { align-items: flex-start; flex-direction: column; }
  .business-page__detail dl { grid-template-columns: 1fr; }
}
</style>
